import { Request, Response, NextFunction } from "express";
import { sql } from "./db";

/**
 * Launch access control (invite-only launch).
 *
 * Who gets in:
 *   - Admins (ADMIN_EMAILS): everything, no expiry.
 *   - Approved users (via an invite link, or manual admin approval):
 *     only the LAUNCH FEATURES below, until access_expires_at (null =
 *     no expiry).
 *   - Everyone else: nothing except redeeming an invite.
 *
 * Enforced HERE on the server, not just in the UI, so a user can't reach
 * a coming-soon feature by calling the API directly.
 *
 * To open a feature to everyone later, add its API prefix to
 * LAUNCH_API_PREFIXES and flip its flag in launchFeatures().
 */

// API prefixes a non-admin approved user may call. Everything else under
// /api (behind requireAuth) answers 403 coming_soon for them.
const LAUNCH_API_PREFIXES = [
  "/api/free-tailor",   // manual resume tailor (+ cover letter)
  "/api/pdf/generate",  // review-editor PDF re-render
  "/api/parse-pdf",     // resume upload parsing
  "/api/parse-docx",
];

// Reachable while signed in but WITHOUT access yet: that's how access
// is obtained in the first place.
const PRE_ACCESS_PREFIXES = ["/api/invites/redeem"];

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const csv = (process.env.ADMIN_EMAILS || "").trim();
  if (!csv) return false;
  return csv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

/** Feature flags sent to the client via /api/auth/me. */
export function launchFeatures(isAdmin: boolean) {
  return {
    tailor: true,
    pipeline: isAdmin,
    autoApply: isAdmin,
    interview: isAdmin,
    dashboard: isAdmin,
    storyBank: isAdmin,
    careerCoach: isAdmin,
  };
}

// ── Self-healing schema ─────────────────────────────────────────────
// Memoized so it runs once per process. Resolves false if the DDL fails,
// in which case callers fall back to queries without the new columns
// (auth must never break because a migration is missing).
let schemaPromise: Promise<boolean> | null = null;
export function ensureInviteSchema(): Promise<boolean> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        // ADD COLUMN IF NOT EXISTS still takes an ACCESS EXCLUSIVE lock
        // even when the column is already there. Without a lock timeout
        // it waits behind any other session touching the table, and
        // every later read of profiles then queues behind IT: one idle
        // transaction is enough to hang every signed-in request. Fail
        // fast instead; the next boot retries.
        await sql`SET lock_timeout = '4s'`;
        await sql`SET statement_timeout = '15s'`;
        await sql`
          CREATE TABLE IF NOT EXISTS invite_links (
            id BIGSERIAL PRIMARY KEY,
            token TEXT NOT NULL UNIQUE,
            label TEXT,
            access_days INTEGER NOT NULL DEFAULT 30,
            created_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            redeemed_by UUID,
            redeemed_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ
          )
        `;
        await sql`ALTER TABLE invite_links ENABLE ROW LEVEL SECURITY`;
        await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ`;
        await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invite_id BIGINT`;
        await sql`RESET lock_timeout`;
        await sql`RESET statement_timeout`;
        return true;
      } catch (err: any) {
        console.error("[access] ensureInviteSchema failed:", err?.message || err);
        try { await sql`RESET lock_timeout`; await sql`RESET statement_timeout`; } catch { /* connection may be gone */ }
        schemaPromise = null; // retry on a later boot / admin call
        return false;
      }
    })();
  }
  return schemaPromise;
}

export type AccessState = "admin" | "active" | "expired" | "invite_required" | "rejected";

export function accessStateFor(user: {
  email: string;
  approval_status?: string;
  access_expires_at?: string | Date | null;
}): AccessState {
  if (isAdminEmail(user.email)) return "admin";
  if (user.approval_status === "rejected") return "rejected";
  if (user.approval_status !== "approved") return "invite_required";
  if (user.access_expires_at && new Date(user.access_expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

function pathOf(req: Request): string {
  return (req.originalUrl || req.url || "").split("?")[0];
}

/**
 * Mount AFTER requireAuth. Admins and internal (pipeline) calls pass
 * straight through; everyone else is limited to the launch features.
 */
export function requireLaunchAccess(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  if (req.headers.authorization?.startsWith("Internal ")) { next(); return; }

  const state = accessStateFor(user as any);
  if (state === "admin") { next(); return; }

  const path = pathOf(req);
  if (PRE_ACCESS_PREFIXES.some((p) => path.startsWith(p))) { next(); return; }

  if (state === "invite_required" || state === "rejected") {
    res.status(403).json({
      code: "invite_required",
      error: "GO CANDID8 is invite-only right now. Open your invite link to get access.",
    });
    return;
  }
  if (state === "expired") {
    res.status(403).json({
      code: "access_expired",
      error: "Your free early-access period has ended.",
    });
    return;
  }
  if (LAUNCH_API_PREFIXES.some((p) => path.startsWith(p))) { next(); return; }

  res.status(403).json({
    code: "coming_soon",
    error: "This feature is coming soon. Early access currently includes the Resume Tailor.",
  });
}
