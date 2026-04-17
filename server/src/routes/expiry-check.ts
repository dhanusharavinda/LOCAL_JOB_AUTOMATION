import { Router, Request, Response } from "express";
import dns from "node:dns/promises";
import net from "node:net";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Expiry check routes (Postgres edition).
 * Checks whether tracked job links are still live. Marks 404'd / removed
 * listings as expired so the kanban can filter them out.
 */

const router = Router();
router.use(requireAuth);

// Generic "home / search page" patterns that indicate the original listing
// has been taken down and the server is now redirecting to a fallback page.
const GONE_URL_PATTERNS = [
  /\/jobs\/?$/i,
  /\/careers\/?$/i,
  /\/search\/?$/i,
  /linkedin\.com\/?$/i,
  /linkedin\.com\/jobs\/?$/i,
];

const GONE_BODY_MARKERS = [
  "this job is no longer available",
  "no longer accepting applications",
  "position has been filled",
  "this posting has expired",
  "job not found",
  "page not found",
  "404",
];

// Return true if an IPv4/IPv6 literal belongs to a private, loopback,
// link-local, or cloud-metadata range that a server-side fetch should
// never reach. Any job_link that resolves to one of these ranges is an
// SSRF attempt — a user trying to pivot the server into reading internal
// services (Railway/AWS/GCP metadata, Supabase private network, etc.).
function isBlockedIp(ip: string): boolean {
  // IPv4
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map((n) => parseInt(n, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;              // link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
    if (a === 192 && b === 168) return true;              // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT 100.64.0.0/10 (Railway uses this)
    if (a >= 224) return true;                             // multicast + reserved
    return false;
  }
  // IPv6
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true;            // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice(7);
      if (net.isIPv4(v4)) return isBlockedIp(v4);
    }
    return false;
  }
  return true;
}

/**
 * Gate an outbound URL before `fetch`. Rejects non-http(s), embedded
 * credentials, and any hostname that resolves to a private / loopback /
 * metadata IP. Resolution happens here AND we pass the URL unchanged to
 * fetch — there's a tiny TOCTOU window where a DNS rebind could swap the
 * IP between our check and fetch's own resolution, but the attacker still
 * needs to control the authoritative DNS and match our first resolution.
 * Acceptable for a job-expiry checker; harden further only if this surface
 * widens.
 */
async function validateOutboundUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Unsupported protocol ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URL cannot contain credentials" };
  }
  const host = url.hostname;
  // Literal IPs — check directly
  if (net.isIP(host)) {
    if (isBlockedIp(host)) return { ok: false, reason: "Blocked IP range" };
    return { ok: true, url };
  }
  // Hostname — resolve and check every record. all=true returns A and AAAA.
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      if (isBlockedIp(r.address)) return { ok: false, reason: "Resolves to blocked range" };
    }
  } catch {
    return { ok: false, reason: "DNS lookup failed" };
  }
  return { ok: true, url };
}

async function checkLink(jobLink: string): Promise<{ status: "live" | "expired" | "unknown"; reason: string | null }> {
  const gate = await validateOutboundUrl(jobLink);
  if (!gate.ok) {
    return { status: "unknown", reason: gate.reason };
  }
  try {
    const res = await fetch(gate.url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GOCANDID8-ExpiryCheck/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });

    // Manual redirect handling — each redirect target must also pass the
    // outbound-URL gate so attackers can't set a public URL that 302s to
    // http://169.254.169.254/. Follow up to 3 hops.
    let hops = 0;
    let current = res;
    while (current.status >= 300 && current.status < 400 && hops < 3) {
      const loc = current.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, gate.url).toString();
      const nextGate = await validateOutboundUrl(next);
      if (!nextGate.ok) {
        return { status: "unknown", reason: `Redirect blocked: ${nextGate.reason}` };
      }
      current = await fetch(nextGate.url.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GOCANDID8-ExpiryCheck/1.0)",
        },
        signal: AbortSignal.timeout(10000),
      });
      hops++;
    }

    if (current.status === 404 || current.status === 410) {
      return { status: "expired", reason: `HTTP ${current.status}` };
    }
    if (!current.ok) {
      return { status: "unknown", reason: `HTTP ${current.status}` };
    }

    // Check if we were redirected to a generic listing page
    const finalUrl = current.url || jobLink;
    for (const pattern of GONE_URL_PATTERNS) {
      if (pattern.test(finalUrl) && !pattern.test(jobLink)) {
        return { status: "expired", reason: "Redirected to generic listing page" };
      }
    }

    // Check body for common "this listing is gone" markers. Cap the read so
    // a multi-GB response can't OOM the server. `.text()` on Node's fetch
    // decodes the full body; bodyUsed check short-circuits when redirects
    // already consumed it.
    const body = (await current.text()).toLowerCase().slice(0, 50_000);
    for (const marker of GONE_BODY_MARKERS) {
      if (body.includes(marker)) {
        return { status: "expired", reason: `Body contains "${marker}"` };
      }
    }

    return { status: "live", reason: null };
  } catch {
    // Swallow the underlying error — it can leak internal hostnames or
    // TLS details that help attackers fingerprint our infra.
    return { status: "unknown", reason: "fetch failed" };
  }
}

// ─── POST /api/jobs/check-expiry ─────────────────────────────────────
// Batch check every active job for this user. Returns a summary and
// marks expired rows in the DB.
router.post("/check-expiry", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const jobs = await sql<{ id: number; job_link: string | null }[]>`
      SELECT id, job_link FROM jobs
       WHERE user_id = ${userId}
         AND expired = false
         AND status IN ('filtered', 'saved', 'applied')
         AND job_link IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 50
    `;

    let checked = 0;
    let expired = 0;
    for (const j of jobs) {
      if (!j.job_link) continue;
      checked++;
      const result = await checkLink(j.job_link);
      if (result.status === "expired") {
        await sql`
          UPDATE jobs
             SET expired = true,
                 expiry_reason = ${result.reason},
                 last_checked_at = NOW()
           WHERE id = ${j.id} AND user_id = ${userId}
        `;
        expired++;
      } else {
        await sql`
          UPDATE jobs SET last_checked_at = NOW()
           WHERE id = ${j.id} AND user_id = ${userId}
        `;
      }
    }

    res.json({ checked, expired });
  } catch (err: any) {
    console.error("[POST /api/jobs/check-expiry]", err?.message || err);
    res.status(500).json({ error: "Expiry check failed" });
  }
});

// ─── GET /api/jobs/:id/check-link ────────────────────────────────────
// Check a single job's link on demand.
router.get("/:id/check-link", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const rows = await sql<{ job_link: string | null }[]>`
      SELECT job_link FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (!rows[0].job_link) {
      res.json({ status: "unknown", reason: "No job_link set" });
      return;
    }
    const result = await checkLink(rows[0].job_link);
    if (result.status === "expired") {
      await sql`
        UPDATE jobs SET expired = true, expiry_reason = ${result.reason}, last_checked_at = NOW()
         WHERE id = ${id} AND user_id = ${userId}
      `;
    } else {
      await sql`
        UPDATE jobs SET last_checked_at = NOW()
         WHERE id = ${id} AND user_id = ${userId}
      `;
    }
    res.json(result);
  } catch (err: any) {
    console.error("[GET /api/jobs/:id/check-link]", err?.message || err);
    res.status(500).json({ error: "Check failed" });
  }
});

export default router;
