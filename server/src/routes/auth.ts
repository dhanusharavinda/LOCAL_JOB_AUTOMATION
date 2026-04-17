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

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        onboarded_at: user.onboarded_at,
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

export default router;
