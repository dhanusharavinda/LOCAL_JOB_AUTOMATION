import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { getUsage, getLimitsForUser, PLAN_LIMITS } from "../middleware/gate";

/**
 * Auth routes — Postgres edition.
 * Returns profile + usage + plan limits; lets the user change plan and name.
 * Tables: public.profiles, public.user_settings, public.candidates,
 *         public.usage_tracking — all gated by RLS on user_id.
 */

const router = Router();

// ─── GET /api/auth/me ────────────────────────────────────────────────
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    const usage = await getUsage(user.id);
    const limits = getLimitsForUser(user.plan);

    let candidateCount = 0;
    if (user.plan === "enterprise") {
      const rows = await sql<{ cnt: string }[]>`
        SELECT COUNT(*)::text AS cnt FROM candidates WHERE user_id = ${user.id}
      `;
      candidateCount = parseInt(rows[0]?.cnt ?? "0", 10);
    }

    // Admin status is server-determined from ADMIN_EMAILS (CSV env).
    // Computing it here means the client never has to know the admin list
    // — it just reads `is_admin` from /me and shows/hides the admin UI.
    const adminCsv = (process.env.ADMIN_EMAILS || "").trim();
    const admins = adminCsv ? adminCsv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean) : [];
    const isAdmin = admins.includes(user.email.toLowerCase());

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        onboarded_at: user.onboarded_at,
        approval_status: user.approval_status,
        is_admin: isAdmin,
      },
      usage,
      limits,
      candidateCount,
      planLimits: PLAN_LIMITS[user.plan as keyof typeof PLAN_LIMITS],
    });
  } catch (err: any) {
    // Surface the real Postgres error so the browser banner is
    // diagnosable. The DB's error code + detail pinpoint which table
    // or column is actually broken (e.g. missing usage_tracking
    // migration, stale RLS, etc.) rather than leaving the user staring
    // at a bare 500.
    console.error("[GET /api/auth/me]", {
      pgCode: err?.code, pgDetail: err?.detail, pgTable: err?.table, message: err?.message, stack: err?.stack,
    });
    res.status(500).json({
      error: err?.message || "Failed to load profile",
      code: err?.code,
      detail: err?.detail,
    });
  }
});

// ─── POST /api/auth/onboarded ────────────────────────────────────────
router.post("/onboarded", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    const rows = await sql<{ onboarded_at: string | null }[]>`
      SELECT onboarded_at FROM profiles WHERE id = ${user.id} LIMIT 1
    `;
    if (rows[0]?.onboarded_at) {
      res.json({ ok: true, onboarded_at: rows[0].onboarded_at });
      return;
    }
    const now = new Date().toISOString();
    await sql`UPDATE profiles SET onboarded_at = ${now} WHERE id = ${user.id}`;
    res.json({ ok: true, onboarded_at: now });
  } catch (err: any) {
    console.error("[POST /api/auth/onboarded]", err?.message || err);
    res.status(500).json({ error: "Failed to mark onboarded" });
  }
});

// ─── PUT /api/auth/plan ──────────────────────────────────────────────
// Test-phase plan switching. Enterprise is NOT available to test users —
// only free and pro. Stripe wiring replaces this endpoint entirely later.
router.put("/plan", requireAuth, async (req: Request, res: Response) => {
  const { plan } = req.body;
  if (!["free", "pro"].includes(plan)) {
    res.status(400).json({
      error: plan === "enterprise"
        ? "Enterprise plan is not available during testing."
        : "Invalid plan",
    });
    return;
  }
  try {
    await sql`UPDATE profiles SET plan = ${plan} WHERE id = ${req.user!.id}`;
    res.json({ ok: true, plan });
  } catch (err: any) {
    console.error("[PUT /api/auth/plan]", err?.message || err);
    res.status(500).json({ error: "Failed to update plan" });
  }
});

// ─── PATCH /api/auth/me ──────────────────────────────────────────────
router.patch("/me", requireAuth, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    await sql`UPDATE profiles SET name = ${name.trim()} WHERE id = ${req.user!.id}`;
    res.json({ ok: true, name: name.trim() });
  } catch (err: any) {
    console.error("[PATCH /api/auth/me]", err?.message || err);
    res.status(500).json({ error: "Failed to update name" });
  }
});

// ─── Admin: approval gate ────────────────────────────────────────────
// Owner-only endpoints. Admin identity is determined by ADMIN_EMAILS env
// (CSV of emails). Keeps the gate off the database schema so you can add
// admins without a migration. For bigger teams, promote this to a
// profiles.role column later.
function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const adminCsv = (process.env.ADMIN_EMAILS || "").trim();
  if (!adminCsv) return false;
  const admins = adminCsv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdmin(req.user?.email)) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// ─── GET /api/auth/admin/users ───────────────────────────────────────
// List all profiles with approval status. Optional `?status=pending`
// filter to only see the waitlist. Ordered newest-first so the owner
// can triage signups in the order they arrived.
router.get("/admin/users", requireAuth, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  try {
    // Aggregate usage per user in one query. The LEFT JOIN + GROUP BY
    // folds every usage_tracking row into a single counter per profile,
    // plus the subselects pull total jobs / manual tailors / gmail
    // connectivity. Kept under one round-trip so the admin list scales
    // past a few hundred users without N+1 queries.
    const rows = status
      ? await sql`
          SELECT
            p.id, p.email, p.name, p.plan, p.approval_status, p.approved_at, p.created_at,
            COALESCE(SUM(CASE WHEN ut.period = CURRENT_DATE THEN ut.jobs_scraped      ELSE 0 END), 0)::int AS jobs_scraped_today,
            COALESCE(SUM(CASE WHEN ut.period = CURRENT_DATE THEN ut.resumes_tailored  ELSE 0 END), 0)::int AS resumes_tailored_today,
            COALESCE(SUM(CASE WHEN ut.period = CURRENT_DATE THEN ut.pipeline_runs     ELSE 0 END), 0)::int AS pipeline_runs_today,
            COALESCE(SUM(ut.jobs_scraped), 0)::int      AS jobs_scraped_total,
            COALESCE(SUM(ut.resumes_tailored), 0)::int  AS resumes_tailored_total,
            COALESCE(SUM(ut.pipeline_runs), 0)::int     AS pipeline_runs_total,
            (SELECT COUNT(*)::int FROM jobs              WHERE user_id = p.id)                                                     AS total_jobs,
            (SELECT COUNT(*)::int FROM free_tailor_log   WHERE user_id = p.id::text AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')) AS manual_tailors_today,
            (SELECT COUNT(*)::int FROM free_tailor_log   WHERE user_id = p.id::text)                                                     AS manual_tailors_total,
            EXISTS(SELECT 1 FROM gmail_tokens            WHERE user_id = p.id)                                                     AS gmail_connected,
            (SELECT MAX(period) FROM usage_tracking      WHERE user_id = p.id)                                                     AS last_active_date
          FROM profiles p
          LEFT JOIN usage_tracking ut ON ut.user_id = p.id
          WHERE p.approval_status = ${status}
          GROUP BY p.id
          ORDER BY p.created_at DESC
          LIMIT 500
        `
      : await sql`
          SELECT
            p.id, p.email, p.name, p.plan, p.approval_status, p.approved_at, p.created_at,
            COALESCE(SUM(CASE WHEN ut.period = CURRENT_DATE THEN ut.jobs_scraped      ELSE 0 END), 0)::int AS jobs_scraped_today,
            COALESCE(SUM(CASE WHEN ut.period = CURRENT_DATE THEN ut.resumes_tailored  ELSE 0 END), 0)::int AS resumes_tailored_today,
            COALESCE(SUM(CASE WHEN ut.period = CURRENT_DATE THEN ut.pipeline_runs     ELSE 0 END), 0)::int AS pipeline_runs_today,
            COALESCE(SUM(ut.jobs_scraped), 0)::int      AS jobs_scraped_total,
            COALESCE(SUM(ut.resumes_tailored), 0)::int  AS resumes_tailored_total,
            COALESCE(SUM(ut.pipeline_runs), 0)::int     AS pipeline_runs_total,
            (SELECT COUNT(*)::int FROM jobs              WHERE user_id = p.id)                                                     AS total_jobs,
            (SELECT COUNT(*)::int FROM free_tailor_log   WHERE user_id = p.id::text AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')) AS manual_tailors_today,
            (SELECT COUNT(*)::int FROM free_tailor_log   WHERE user_id = p.id::text)                                                     AS manual_tailors_total,
            EXISTS(SELECT 1 FROM gmail_tokens            WHERE user_id = p.id)                                                     AS gmail_connected,
            (SELECT MAX(period) FROM usage_tracking      WHERE user_id = p.id)                                                     AS last_active_date
          FROM profiles p
          LEFT JOIN usage_tracking ut ON ut.user_id = p.id
          GROUP BY p.id
          ORDER BY p.created_at DESC
          LIMIT 500
        `;
    res.json({ users: rows });
  } catch (err: any) {
    console.error("[GET /api/auth/admin/users]", err?.message || err);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// ─── POST /api/auth/admin/approve/:userId ────────────────────────────
// Flip a profile to approved or rejected. `status` in the body selects
// which; defaults to 'approved' so a bare POST works as the happy path.
router.post("/admin/approve/:userId", requireAuth, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { userId } = req.params;
  const next = typeof req.body?.status === "string" ? req.body.status : "approved";
  if (next !== "approved" && next !== "rejected" && next !== "pending") {
    res.status(400).json({ error: "status must be approved, rejected, or pending" });
    return;
  }
  // Prevent an admin from accidentally rejecting or suspending themselves
  // — that would lock them out of the very panel they're using. If they
  // really need to change their own status, have another admin do it or
  // edit the row from the Supabase SQL editor.
  if (userId === req.user!.id && next !== "approved") {
    res.status(400).json({ error: "You can't change your own approval status. Ask another admin." });
    return;
  }
  try {
    const rows = await sql<{ id: string; email: string; approval_status: string }[]>`
      UPDATE profiles
         SET approval_status = ${next},
             approved_at     = CASE WHEN ${next} = 'approved' THEN NOW() ELSE approved_at END,
             approved_by     = CASE WHEN ${next} = 'approved' THEN ${req.user!.id}::uuid ELSE approved_by END
       WHERE id = ${userId}
      RETURNING id, email, approval_status
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true, user: rows[0] });
  } catch (err: any) {
    console.error("[POST /api/auth/admin/approve/:userId]", err?.message || err);
    res.status(500).json({ error: "Failed to update approval" });
  }
});

export default router;
