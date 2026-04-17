import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { getUsage, getLimitsForUser } from "../middleware/gate";

/**
 * Candidates routes (Postgres edition).
 * Enterprise-only feature: one user manages many candidates, each with
 * their own resume, jobs, and usage counters. All queries scoped to the
 * owning user_id.
 */

const router = Router();
router.use(requireAuth);

// ─── GET /api/candidates ─────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan = req.user!.plan;
  if (plan !== "enterprise") {
    res.status(403).json({ error: "Candidates feature requires Enterprise plan" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      SELECT c.*,
             (SELECT COUNT(*) FROM jobs j WHERE j.candidate_id = c.id AND j.user_id = ${userId}) AS job_count,
             (SELECT COUNT(*) FROM jobs j WHERE j.candidate_id = c.id AND j.user_id = ${userId} AND j.resume_url IS NOT NULL) AS tailored_count
        FROM candidates c
       WHERE c.user_id = ${userId}
       ORDER BY c.created_at DESC
    `;

    // Attach usage + daily run eligibility for each candidate
    const result = [];
    for (const c of rows) {
      const usage = await getUsage(userId, c.id);
      const limits = getLimitsForUser(plan, c.id, c.tier as 1 | 2 | 3);
      result.push({
        ...c,
        job_count: parseInt(String(c.job_count || 0), 10),
        tailored_count: parseInt(String(c.tailored_count || 0), 10),
        usage,
        limits,
        canRunToday: usage.pipeline_runs < 1,
      });
    }
    res.json(result);
  } catch (err: any) {
    console.error("[GET /api/candidates]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/candidates ────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  if (req.user!.plan !== "enterprise") {
    res.status(403).json({ error: "Candidates feature requires Enterprise plan" });
    return;
  }
  const { name, email, resume_text, resume_filename, notes, tier } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      INSERT INTO candidates (user_id, name, email, resume_text, resume_filename, notes, tier)
      VALUES (${userId}, ${name.trim()}, ${email || null}, ${resume_text || null},
              ${resume_filename || null}, ${notes || null}, ${tier || 1})
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[POST /api/candidates]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── PUT /api/candidates/:id ─────────────────────────────────────────
router.put("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }
  const allowed = ["name", "email", "resume_text", "resume_filename", "notes", "tier"];
  const patch: Record<string, any> = {};
  for (const f of allowed) if (req.body[f] !== undefined) patch[f] = req.body[f];
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      UPDATE candidates SET ${sql(patch)}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[PUT /api/candidates/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/candidates/:id ──────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM candidates WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/candidates/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/candidates/:id/jobs ────────────────────────────────────
router.get("/:id/jobs", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }
  try {
    const rows = await sql`
      SELECT * FROM jobs WHERE candidate_id = ${id} AND user_id = ${userId}
       ORDER BY updated_at DESC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/candidates/:id/jobs]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
