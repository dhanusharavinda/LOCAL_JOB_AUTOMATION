import { Router, Request, Response } from "express";
import { google } from "googleapis";
import crypto from "crypto";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Gmail routes (Postgres + per-user OAuth edition).
 * ──────────────────────────────────────────────────
 * The old implementation read/wrote a single `gmail-token.json` file, so
 * whoever connected Gmail last owned the integration for everyone on the
 * server. This rewrite gives each user their own row in the `gmail_tokens`
 * table, protected by RLS + tenant-scoped queries.
 *
 * OAuth flow:
 *   1. Client calls GET /api/gmail/auth (authenticated). We generate an
 *      HMAC-signed `state` parameter carrying the user id + a short TTL
 *      timestamp so the callback (which is NOT authenticated — it's the
 *      browser redirect from Google) can safely determine which user
 *      just authorized.
 *   2. User approves in Google's consent screen. Google redirects back
 *      to GET /api/gmail/callback?code=...&state=<signed>.
 *   3. We verify the state signature, exchange the code for tokens, and
 *      upsert into gmail_tokens WHERE user_id = <state.user_id>.
 */

const router = Router();

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || "http://localhost:3001/api/gmail/callback"
  );
}

// ── State signing ──────────────────────────────────────────────────
// We sign `userId|timestamp|nonce` with HMAC-SHA256 using the server's
// PIPELINE_INTERNAL_TOKEN (which is always set at boot, random if the
// operator didn't provide one). This gives us a stateless per-user
// state parameter without needing to store pending OAuth sessions in
// the DB.
function getStateKey(): Buffer {
  const key = process.env.PIPELINE_INTERNAL_TOKEN;
  if (!key) throw new Error("PIPELINE_INTERNAL_TOKEN is not set");
  return Buffer.from(key, "hex");
}

function signState(userId: string): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${userId}|${Date.now()}|${nonce}`;
  const sig = crypto.createHmac("sha256", getStateKey()).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

function verifyState(state: string): { userId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf-8");
    const parts = decoded.split("|");
    if (parts.length !== 4) return null;
    const [userId, tsStr, nonce, sig] = parts;
    const payload = `${userId}|${tsStr}|${nonce}`;
    const expected = crypto.createHmac("sha256", getStateKey()).update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
    const ts = parseInt(tsStr, 10);
    if (!Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS) return null;
    return { userId };
  } catch {
    return null;
  }
}

// ─── GET /api/gmail/status ───────────────────────────────────────────
router.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql<{ last_sync_at: Date | null }[]>`
      SELECT last_sync_at FROM gmail_tokens WHERE user_id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) {
      res.json({ connected: false, lastSync: null });
      return;
    }
    res.json({
      connected: true,
      lastSync: rows[0].last_sync_at ? new Date(rows[0].last_sync_at).toISOString() : null,
    });
  } catch (err: any) {
    console.error("[GET /api/gmail/status]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/gmail/auth ─────────────────────────────────────────────
// Returns the Google consent URL with a signed state parameter.
router.get("/auth", requireAuth, (req: Request, res: Response) => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    res.status(400).json({
      error: "GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are not set on the server.",
    });
    return;
  }
  const oAuth2Client = getOAuth2Client();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: signState(req.user!.id),
  });
  res.json({ url: authUrl });
});

// ─── GET /api/gmail/callback ─────────────────────────────────────────
// Unauthenticated (browser redirect from Google). Identifies the user
// via the signed state parameter set in /auth.
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;
  if (!code || typeof code !== "string" || !state || typeof state !== "string") {
    res.status(400).send("Missing code or state");
    return;
  }
  const verified = verifyState(state);
  if (!verified) {
    res.status(400).send("Invalid or expired state. Please try connecting Gmail again.");
    return;
  }
  try {
    const oAuth2Client = getOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);

    await sql`
      INSERT INTO gmail_tokens (
        user_id, access_token, refresh_token, scope, token_type, expiry_date, connected_at
      ) VALUES (
        ${verified.userId},
        ${tokens.access_token || ""},
        ${tokens.refresh_token || ""},
        ${tokens.scope || null},
        ${tokens.token_type || null},
        ${tokens.expiry_date || null},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        access_token  = EXCLUDED.access_token,
        refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), gmail_tokens.refresh_token),
        scope         = EXCLUDED.scope,
        token_type    = EXCLUDED.token_type,
        expiry_date   = EXCLUDED.expiry_date,
        connected_at  = NOW()
    `;

    // Pick the FIRST allowed client URL (CLIENT_URL may be a CSV of origins
    // for multi-environment deploys) and validate it's a plain http(s) URL
    // before interpolating into inline JS. Anything suspicious falls back to
    // localhost so a malformed env var can never land as executable script.
    const rawClientUrl = (process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim();
    const isSafeUrl = /^https?:\/\/[a-z0-9.\-:]+(?:\/[^\s"'<>]*)?$/i.test(rawClientUrl);
    const clientUrl = isSafeUrl ? rawClientUrl : "http://localhost:5173";
    // JSON.stringify handles quote/backslash/unicode escaping for JS string
    // literals, so even if the validator is ever loosened the content can't
    // break out of the string into executable script.
    const clientUrlJs = JSON.stringify(clientUrl);
    const redirectUrlJs = JSON.stringify(clientUrl + "/?gmail=connected");
    res.send(`<!DOCTYPE html><html><body style='font-family:sans-serif;background:#07080a;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>
      <div style='text-align:center'>
        <h2 style='color:#34d399'>Gmail connected!</h2>
        <p>Redirecting back to GO CANDID8...</p>
        <script>
          try { if (window.opener) window.opener.postMessage('gmail_connected', ${clientUrlJs}); } catch(e) {}
          setTimeout(function() {
            try { window.location.href = ${redirectUrlJs}; } catch(e) {}
            setTimeout(function() { window.close(); }, 500);
          }, 800);
        </script>
      </div>
    </body></html>`);
  } catch (err: any) {
    console.error(`[Gmail OAuth] ${err?.message || err}`);
    res.status(500).send("OAuth failed. Please try again.");
  }
});

// ─── POST /api/gmail/disconnect ──────────────────────────────────────
router.post("/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    await sql`DELETE FROM gmail_tokens WHERE user_id = ${userId}`;
    res.json({ disconnected: true });
  } catch (err: any) {
    console.error("[POST /api/gmail/disconnect]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ── Helpers (email classification — unchanged from SQLite version) ──

type JobStatusUpdate = "applied" | "interviewing" | "offer" | "rejected";

interface EmailInfo {
  status: JobStatusUpdate | null;
  label: string;
  company: string | null;
  jobTitle: string | null;
  location: string | null;
  date: string;
}

const PLATFORM_DOMAINS = [
  "linkedin.com", "greenhouse.io", "greenhouse-mail.io",
  "lever.co", "hire.lever.co", "workday.com", "myworkday.com",
  "smartrecruiters.com", "taleo.net", "ashbyhq.com", "teamtailor.com",
  "recruitee.com", "jobvite.com", "icims.com", "successfactors.com",
  "bamboohr.com", "workable.com", "breezy.hr", "applytojob.com",
];

function isFromPlatform(from: string): boolean {
  return PLATFORM_DOMAINS.some((d) => from.toLowerCase().includes(d));
}

function decodeBody(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch { return ""; }
}

function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBody(payload.body.data);
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBody(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  return "";
}

function extractCompanyFromSubject(subject: string): string | null {
  const s = subject.replace(/^[A-Z][a-z]+,\s+/, "").trim();
  const patterns = [
    /your application was sent to\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /application(?:\s+\w+)?\s+(?:was sent|submitted)\s+to\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /thank you for applying to\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /we received your application(?:\s+for\s+.+?)?\s+at\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /your application to\s+(.+?)\s+has been/i,
    /application submitted(?:\s+to)?\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /interview.{0,20}(?:from|with|at)\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /offer.{0,20}(?:from|at)\s+(.+?)(?:\s*[-–|,!]|$)/i,
    /(?:unfortunately|regret).{0,30}(?:from|at|with)\s+(.+?)(?:\s*[-–|,!]|$)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1].trim().replace(/[.!,]+$/, "");
  }
  return null;
}

function parseLinkedInApplicationBody(body: string, companyName: string): { jobTitle: string | null; location: string | null } {
  if (!body || !companyName) return { jobTitle: null, location: null };
  const lines = body.split(/\n|\r|\u00b7|•/).map((l) => l.replace(/<[^>]+>/g, "").trim()).filter((l) => l.length > 1 && l.length < 100);
  let jobTitle: string | null = null;
  let location: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const companyTokenList = companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const isCompanyLine = companyTokenList.some((t) => line.toLowerCase().includes(t));
    if (isCompanyLine) {
      if (i > 0 && !jobTitle) jobTitle = lines[i - 1] || null;
      const locMatch = line.match(/\b(On-site|Hybrid|Remote|Full.time|Part.time)\b/i)
        || line.match(/[,·]\s*([^,·]+(?:shire|land|burg|ford|wick|ley|ton|field|minster|city|Dublin|London|Ireland|UK|Germany|Netherlands|France|Spain|Remote).*?)(?:[·,]|$)/i);
      if (locMatch) location = locMatch[1]?.trim() || null;
      continue;
    }
    if (!location && /(On-site|Hybrid|Remote|Dublin|London|Ireland|UK|Germany|Netherlands|France|Spain|Waterford|Cork|Galway)/i.test(line) && line.length < 60) {
      location = line;
    }
  }
  if (!jobTitle) {
    const m = body.match(/for\s+([A-Z][^.•·\n]{3,60}?)\s+(?:at|@)\s+/);
    if (m) jobTitle = m[1].trim();
  }
  return { jobTitle, location };
}

function companyTokens(name: string): string[] {
  const stop = new Set(["llc", "ltd", "inc", "plc", "gmbh", "ag", "sa", "corp", "co", "the", "and", "of", "group", "services", "solutions", "technologies"]);
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
}

function textMatchesCompany(text: string, companyName: string): boolean {
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return false;
  const t = text.toLowerCase();
  return tokens.some((tok) => t.includes(tok));
}

function isPromotional(subject: string, from: string, snippet: string): boolean {
  const text = (subject + " " + snippet).toLowerCase();
  if (/unsubscribe|newsletter|marketing|promotional|digest|weekly round/.test(text)) return true;
  if (/job alert|jobs you might|recommended jobs|people also viewed|new jobs for you|open roles|we thought you|jobs based on your profile|similar jobs/.test(text)) return true;
  if (isFromPlatform(from) && /"[^"]+"\s*:/.test(subject)) return true;
  return false;
}

function classifyEmail(subject: string, snippet: string, body: string): EmailInfo {
  const text = (subject + " " + snippet + " " + body.slice(0, 800)).toLowerCase();
  const today = new Date().toISOString().split("T")[0];
  const company = extractCompanyFromSubject(subject);

  if (/offer letter|job offer|formal offer|pleased to offer|we.?d like to offer|extend.{0,10}offer|congratulations.{0,30}offer|welcome.{0,20}(team|aboard)|start date|onboarding details|joining date/.test(text)) {
    return { status: "offer", label: "Job offer received", company, jobTitle: null, location: null, date: today };
  }
  if (/\binterview\b|schedule.{0,20}(call|meeting|interview)|calendar invite|video call|phone screen|next step|meet with you|hiring manager|technical assessment|coding (challenge|test)|take.home|online assessment|hackerrank|codility|testgorilla/.test(text)) {
    return { status: "interviewing", label: "Interview / next step", company, jobTitle: null, location: null, date: today };
  }
  if (/unfortunately|not moving forward|not selected|other candidates|regret to inform|decided not to (proceed|move)|position.{0,20}filled|wish you.{0,30}(best|luck|success)|after.{0,40}(consideration|review).{0,20}not|not be pursuing|unsuccessful/.test(text)) {
    return { status: "rejected", label: "Application rejected", company, jobTitle: null, location: null, date: today };
  }
  if (/application (was sent|has been sent|submitted|received|is under review)|your application to .+ (has been|was)|thank you for apply|we.?ve received your application|successfully applied|easy apply/.test(text)) {
    return { status: "applied", label: "Application confirmed", company, jobTitle: null, location: null, date: today };
  }
  return { status: null, label: "", company, jobTitle: null, location: null, date: today };
}

// ─── POST /api/gmail/sync ────────────────────────────────────────────
router.post("/sync", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const tokRows = await sql<{
      access_token: string;
      refresh_token: string;
      scope: string | null;
      token_type: string | null;
      expiry_date: string | null;
      last_sync_at: Date | null;
    }[]>`
      SELECT access_token, refresh_token, scope, token_type, expiry_date, last_sync_at
        FROM gmail_tokens
       WHERE user_id = ${userId}
       LIMIT 1
    `;
    if (tokRows.length === 0) {
      res.status(401).json({ error: "Gmail not connected. Visit /api/gmail/auth first." });
      return;
    }
    const tok = tokRows[0];

    const oAuth2Client = getOAuth2Client();
    oAuth2Client.setCredentials({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      scope: tok.scope || undefined,
      token_type: tok.token_type || undefined,
      expiry_date: tok.expiry_date ? Number(tok.expiry_date) : undefined,
    });

    // Persist refreshed tokens back to the DB automatically.
    oAuth2Client.on("tokens", async (tokens) => {
      try {
        await sql`
          UPDATE gmail_tokens SET
            access_token = ${tokens.access_token || tok.access_token},
            refresh_token = COALESCE(${tokens.refresh_token || null}, refresh_token),
            expiry_date = ${tokens.expiry_date || tok.expiry_date || null}
          WHERE user_id = ${userId}
        `;
      } catch (e: any) {
        console.error("[Gmail token refresh persist]", e?.message || e);
      }
    });

    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    // How far back to scan
    let daysBack = 90;
    if (tok.last_sync_at) {
      const ms = Date.now() - new Date(tok.last_sync_at).getTime();
      daysBack = Math.max(1, Math.ceil(ms / 86400000) + 1);
    }

    const q = [
      `newer_than:${daysBack}d`,
      "(",
      'subject:"application was sent"',
      'OR subject:"application submitted"',
      'OR subject:"thank you for applying"',
      'OR subject:"we received your application"',
      'OR subject:"your application"',
      'OR subject:interview',
      'OR subject:"offer letter"',
      'OR subject:"job offer"',
      'OR subject:"next steps"',
      'OR subject:unfortunately',
      'OR subject:"not moving forward"',
      'OR subject:congratulations',
      'OR subject:assessment',
      'OR subject:"phone screen"',
      'OR subject:"video interview"',
      'OR subject:"easy apply"',
      ")",
      "-label:promotions -label:social -category:promotions",
    ].join(" ");

    const listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 200 });
    const messages = listRes.data.messages || [];

    const updates: Array<{
      id: number | null; company: string; newStatus: string; label: string; subject: string; created?: boolean;
    }> = [];

    // Load all this user's jobs into memory for matching
    const allJobs = await sql<{
      id: number; company_name: string; job_link: string | null; status: string;
    }[]>`
      SELECT id, company_name, job_link, status FROM jobs WHERE user_id = ${userId}
    `;
    const jobsMut = allJobs.map((j) => ({ ...j }));

    const rank: Record<string, number> = { filtered: 0, saved: 0, applied: 1, interviewing: 2, offer: 3, rejected: 4 };

    for (const msg of messages) {
      if (!msg.id) continue;
      try {
        const detail = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
        const headers = detail.data.payload?.headers || [];
        const subject = headers.find((h) => h.name === "Subject")?.value || "";
        const from    = headers.find((h) => h.name === "From")?.value || "";
        const dateHdr = headers.find((h) => h.name === "Date")?.value || "";
        const snippet = detail.data.snippet || "";
        const body    = extractPlainText(detail.data.payload);

        if (isPromotional(subject, from, snippet)) continue;

        const info = classifyEmail(subject, snippet, body);
        if (!info.status) continue;

        const fromPlatform = isFromPlatform(from);

        let matchedJob: typeof jobsMut[0] | null = null;
        for (const job of jobsMut) {
          let matched = false;
          if (fromPlatform) {
            if (info.company) matched = textMatchesCompany(info.company, job.company_name);
            if (!matched)     matched = textMatchesCompany(subject + " " + snippet, job.company_name);
          } else {
            matched = textMatchesCompany(from, job.company_name);
          }
          if (!matched) continue;

          const newRank = rank[info.status] ?? 0;
          const curRank = rank[job.status] ?? 0;
          if (newRank <= curRank && info.status !== "rejected") continue;

          matchedJob = job;
          break;
        }

        if (matchedJob) {
          if (info.status === "interviewing") {
            await sql`
              UPDATE jobs SET status = ${info.status},
                              interview_date = COALESCE(interview_date, ${info.date}),
                              updated_at = NOW()
               WHERE id = ${matchedJob.id} AND user_id = ${userId}
            `;
          } else if (info.status === "offer") {
            await sql`
              UPDATE jobs SET status = ${info.status},
                              offer_date = COALESCE(offer_date, ${info.date}),
                              updated_at = NOW()
               WHERE id = ${matchedJob.id} AND user_id = ${userId}
            `;
          } else {
            await sql`
              UPDATE jobs SET status = ${info.status}, updated_at = NOW()
               WHERE id = ${matchedJob.id} AND user_id = ${userId}
            `;
          }
          matchedJob.status = info.status;
          updates.push({ id: matchedJob.id, company: matchedJob.company_name, newStatus: info.status, label: info.label, subject });

        } else if (info.status === "applied" && info.company) {
          const alreadyCreated = jobsMut.some((j) => textMatchesCompany(info.company!, j.company_name));
          if (alreadyCreated) continue;

          const parsed = parseLinkedInApplicationBody(body || snippet, info.company);
          const jobTitle = parsed.jobTitle || "Application";
          const location = parsed.location || null;

          let appliedDate = info.date;
          if (dateHdr) {
            try {
              const d = new Date(dateHdr);
              if (!isNaN(d.getTime())) appliedDate = d.toISOString().split("T")[0];
            } catch {}
          }

          const rows = await sql<{ id: number }[]>`
            INSERT INTO jobs (
              user_id, job_title, company_name, location, status, applied_date, notes
            ) VALUES (
              ${userId}, ${jobTitle}, ${info.company}, ${location},
              'applied', ${appliedDate}, 'Auto-added by Gmail sync (LinkedIn Easy Apply)'
            )
            RETURNING id
          `;
          const newId = rows[0].id;
          jobsMut.push({ id: newId, company_name: info.company, job_link: null, status: "applied" });
          updates.push({ id: newId, company: info.company, newStatus: "applied", label: "New job auto-created", subject, created: true });
        }
      } catch (msgErr: any) {
        console.error(`[Gmail sync] Error processing message ${msg.id}: ${msgErr?.message || msgErr}`);
      }
    }

    await sql`
      UPDATE gmail_tokens SET last_sync_at = NOW() WHERE user_id = ${userId}
    `;

    res.json({ synced: updates.length, updates, scanned: messages.length });
  } catch (err: any) {
    console.error("[POST /api/gmail/sync]", err?.message || err);
    res.status(500).json({ error: err?.message || "Sync failed" });
  }
});

export default router;
