import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { sql } from "../db";
import { coercePlan } from "./gate";

/**
 * Supabase Auth middleware (Postgres edition).
 * ─────────────────────────────────────────────
 *
 *   1. Client holds a Supabase session (access + refresh tokens) in
 *      localStorage via @supabase/supabase-js.
 *   2. Every request arrives with `Authorization: Bearer <access_token>`.
 *   3. This middleware calls supabase.auth.getUser(token), which verifies
 *      the JWT signature and expiration against Supabase's auth server.
 *   4. On success we read the matching row from `public.profiles` in
 *      Supabase Postgres. The trigger `handle_new_user` creates that row
 *      automatically when the user first signs up, so no JIT provisioning
 *      is needed at the app layer.
 *
 * Key difference from the old SQLite flow: `AuthUser.id` is now the
 * Supabase auth.users UUID (a string), not a local integer. Every
 * downstream FK in the schema uses this UUID directly.
 *
 * Notes for production hardening:
 *   - `getUser(token)` makes one HTTPS call to Supabase per request. At
 *     scale this should be swapped for local JWT verification using the
 *     project's JWT secret.
 *   - Server uses the Postgres superuser connection, which bypasses RLS.
 *     Tenant isolation is enforced in application code via `user_id =
 *     ${req.user.id}` clauses. RLS policies in the schema provide a
 *     second line of defence if a query is ever made over a per-JWT
 *     connection in the future.
 */

export interface AuthUser {
  id: string;                      // Supabase auth.users.id (UUID)
  email: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  onboarded_at: string | null;     // ISO timestamp or null if tour not completed
  approval_status: "pending" | "approved" | "rejected";
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ── Supabase client (server-side) ───────────────────────────────────
// Uses only the anon key - sufficient for getUser(token) JWT verification.
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url  = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    if (!(getSupabase as any)._warned) {
      console.warn("[auth] SUPABASE_URL and SUPABASE_ANON_KEY are not set - all auth will fail.");
      (getSupabase as any)._warned = true;
    }
    return null;
  }
  _supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _supabase;
}

function extractToken(req: Request): string | null {
  // Preferred: Authorization: Bearer <jwt>
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;

  // Fallback: ?access_token=<jwt> in the query string.
  // Required for browser SSE (EventSource) which can't set custom headers.
  // Only used for GET requests where this is safe - never accept JWTs in
  // the query string for state-changing verbs (POST/PUT/PATCH/DELETE) to
  // avoid accidental CSRF via logged URLs.
  if (req.method === "GET") {
    const q = req.query?.access_token;
    if (typeof q === "string" && q.trim()) return q.trim();
  }
  return null;
}

/**
 * Server-internal machine-to-machine auth (pipeline subprocess → server API).
 * Unchanged from the SQLite flow except that the user id is now a UUID
 * string rather than a number.
 */
async function tryInternalAuth(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Internal ")) return null;

  const expected = process.env.PIPELINE_INTERNAL_TOKEN;
  if (!expected) return null;

  // Format: "Internal <token>:<userId>"
  const rest = header.slice("Internal ".length).trim();
  const idx = rest.lastIndexOf(":");
  if (idx === -1) return null;
  const token = rest.slice(0, idx);
  const userId = rest.slice(idx + 1);
  if (!token || !userId) return null;

  // Constant-time compare to defeat timing oracles - a `!==` on strings
  // short-circuits on first differing byte, leaking the token byte-by-byte.
  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (tokenBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(tokenBuf, expectedBuf)) return null;

  try {
    const rows = await sql<AuthUser[]>`
      SELECT id, email, name, plan, onboarded_at, approval_status
        FROM profiles
       WHERE id = ${userId}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { ...row, plan: coercePlan(row.plan) };
  } catch (err: any) {
    console.error("[auth] internal lookup failed:", err?.message || err);
    return null;
  }
}

/**
 * Load the profile row for a Supabase-verified user. Returns null if the
 * profiles row doesn't exist yet (should be rare - the handle_new_user
 * trigger fires on signup, so this only happens in edge cases like a
 * manually-created auth.users row).
 */
async function loadProfile(supabaseUid: string): Promise<AuthUser | null> {
  try {
    const rows = await sql<AuthUser[]>`
      SELECT id, email, name, plan, onboarded_at, approval_status
        FROM profiles
       WHERE id = ${supabaseUid}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { ...row, plan: coercePlan(row.plan) };
  } catch (err: any) {
    console.error("[auth] profile lookup failed:", err?.message || err);
    return null;
  }
}

/**
 * Backfill a profiles row if the trigger didn't run (e.g. a user
 * existed in auth.users before this migration was deployed). Also
 * ensures a user_settings row exists so settings reads never 404.
 */
async function ensureProfile(
  supabaseUid: string,
  email: string,
  nameHint: string
): Promise<AuthUser> {
  const existing = await loadProfile(supabaseUid);
  if (existing) return existing;

  const name = (nameHint || email.split("@")[0]).trim();

  await sql`
    INSERT INTO profiles (id, email, name)
    VALUES (${supabaseUid}, ${email.toLowerCase().trim()}, ${name})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO user_settings (user_id, config_json)
    VALUES (${supabaseUid}, '{}'::jsonb)
    ON CONFLICT (user_id) DO NOTHING
  `;

  return {
    id: supabaseUid,
    email,
    name,
    plan: "free",
    onboarded_at: null,
    // Fresh JIT-provisioned profile - treated the same as a new trigger-
    // created row. Falls under the approval gate by default.
    approval_status: "pending",
  };
}

/**
 * Approval gate - 403s any signed-in user whose profile hasn't been
 * approved by an admin yet.
 *
 * The client renders <WaitlistScreen /> for pending/rejected users, but
 * that's only a render decision: the user still holds a fully valid
 * Supabase JWT, so without this middleware they can skip the UI entirely
 * and hit /api/* directly with curl - running the pipeline, tailoring
 * resumes and burning OpenAI credit while nominally sitting on the
 * waitlist. A rejected user keeps that access too. This is the
 * server-side half of the gate.
 *
 * Mount AFTER requireAuth (it reads req.user). Routes that must stay
 * reachable for an unapproved user - /api/auth (so /me can drive the
 * waitlist screen) and /api/feedback (public contact form) - are
 * registered before this runs and are therefore unaffected.
 *
 * Admins bypass, mirroring the client: a freshly-seeded owner account
 * starts as 'pending' and would otherwise be locked out of the very
 * admin panel used to approve it.
 */
export function requireApproved(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  if (isAdminEmail(user.email)) { next(); return; }
  if (user.approval_status === "approved") { next(); return; }
  res.status(403).json({
    error:
      user.approval_status === "rejected"
        ? "Your account was not approved for access."
        : "Your account is awaiting approval.",
    approval_status: user.approval_status,
    pending_approval: true,
  });
}

/**
 * Local copy of the ADMIN_EMAILS lookup. Duplicated rather than imported
 * from routes/auth.ts to keep the middleware layer free of a dependency
 * on the route layer (routes/auth.ts already imports from here, and a
 * cycle would leave one side undefined at module-init time).
 */
function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const adminCsv = (process.env.ADMIN_EMAILS || "").trim();
  if (!adminCsv) return false;
  return adminCsv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Required auth - 401s when no valid Supabase JWT is present.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const internal = await tryInternalAuth(req);
  if (internal) { req.user = internal; next(); return; }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const supabase = getSupabase();
  if (!supabase) {
    res.status(500).json({ error: "Auth is not configured on the server" });
    return;
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user || !data.user.email) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const sUser = data.user;
    const nameHint =
      (sUser.user_metadata?.full_name as string | undefined) ||
      (sUser.user_metadata?.name as string | undefined) ||
      sUser.email!.split("@")[0];
    req.user = await ensureProfile(sUser.id, sUser.email!, nameHint);
    next();
  } catch (err: any) {
    console.error("[auth] verify failed:", err?.message || err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

