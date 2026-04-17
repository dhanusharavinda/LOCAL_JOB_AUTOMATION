import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * STAR story bank routes (Postgres edition).
 * Per-user interview story library for behavioral prep.
 */

const router = Router();
router.use(requireAuth);

// ─── GET /api/story-bank ─────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql`
      SELECT id, story_title, situation, task, action, result, reflection, tags,
             source_job_id, created_at
        FROM story_bank
       WHERE user_id = ${userId}
       ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/story-bank]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/story-bank/by-tag/:tag ─────────────────────────────────
router.get("/by-tag/:tag", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tag = req.params.tag;
  try {
    // jsonb `?` operator checks if an array contains the element as a string
    const rows = await sql`
      SELECT id, story_title, situation, task, action, result, reflection, tags,
             source_job_id, created_at
        FROM story_bank
       WHERE user_id = ${userId} AND tags ? ${tag}
       ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/story-bank/by-tag/:tag]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/story-bank ────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { story_title, situation, task, action, result, reflection, tags, source_job_id } = req.body;
  if (!story_title || !situation || !task || !action || !result) {
    res.status(400).json({ error: "story_title, situation, task, action, result are required" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      INSERT INTO story_bank (
        user_id, story_title, situation, task, action, result, reflection, tags, source_job_id
      ) VALUES (
        ${userId}, ${story_title}, ${situation}, ${task}, ${action}, ${result},
        ${reflection || null}, ${sql.json(tags || [])}, ${source_job_id || null}
      )
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[POST /api/story-bank]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/story-bank/batch ──────────────────────────────────────
router.post("/batch", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { stories } = req.body;
  if (!Array.isArray(stories)) {
    res.status(400).json({ error: "stories must be an array" });
    return;
  }
  let inserted = 0;
  try {
    for (const s of stories) {
      if (!s.story_title || !s.situation || !s.task || !s.action || !s.result) continue;
      await sql`
        INSERT INTO story_bank (
          user_id, story_title, situation, task, action, result, reflection, tags, source_job_id
        ) VALUES (
          ${userId}, ${s.story_title}, ${s.situation}, ${s.task}, ${s.action}, ${s.result},
          ${s.reflection || null}, ${sql.json(s.tags || [])}, ${s.source_job_id || null}
        )
      `;
      inserted++;
    }
    res.json({ inserted, total: stories.length });
  } catch (err: any) {
    console.error("[POST /api/story-bank/batch]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/story-bank/:id ──────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM story_bank WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/story-bank/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
