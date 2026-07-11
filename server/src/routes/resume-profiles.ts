import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Resume profiles routes (Postgres edition).
 * Per-user base resumes keyed by role type. All queries scoped to the
 * owning user so the old "SET is_default = 0 for every row on every call"
 * global mutation is impossible.
 */

const router = Router();
router.use(requireAuth);

// ─── GET /api/resume-profiles ────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql`
      SELECT id, name, role_type, resume_text, original_filename, is_default, created_at, updated_at
        FROM resume_profiles
       WHERE user_id = ${userId}
       ORDER BY is_default DESC, updated_at DESC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/resume-profiles]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/resume-profiles ───────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, role_type, resume_text, original_filename } = req.body;
  if (!name || !role_type || !resume_text) {
    res.status(400).json({ error: "name, role_type, and resume_text are required" });
    return;
  }
  try {
    // First profile for this user becomes default automatically
    const countRows = await sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt FROM resume_profiles WHERE user_id = ${userId}
    `;
    const isDefault = parseInt(countRows[0].cnt, 10) === 0;

    const rows = await sql<any[]>`
      INSERT INTO resume_profiles (user_id, name, role_type, resume_text, original_filename, is_default)
      VALUES (${userId}, ${name}, ${role_type}, ${resume_text},
              ${original_filename || null}, ${isDefault})
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[POST /api/resume-profiles]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── PUT /api/resume-profiles/:id ────────────────────────────────────
router.put("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowed = ["name", "role_type", "resume_text", "original_filename"];
  const patch: Record<string, any> = {};
  for (const f of allowed) if (req.body[f] !== undefined) patch[f] = req.body[f];
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      UPDATE resume_profiles SET ${sql(patch)}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Resume profile not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[PUT /api/resume-profiles/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/resume-profiles/:id ─────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM resume_profiles WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Resume profile not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/resume-profiles/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── PATCH /api/resume-profiles/:id/default ──────────────────────────
// Sets this profile as default. The update is scoped to this user's
// rows only - no global wipe.
router.patch("/:id/default", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await sql.begin(async (tx) => {
      await tx`UPDATE resume_profiles SET is_default = false WHERE user_id = ${userId}`;
      await tx`UPDATE resume_profiles SET is_default = true WHERE id = ${id} AND user_id = ${userId}`;
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[PATCH /api/resume-profiles/:id/default]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
