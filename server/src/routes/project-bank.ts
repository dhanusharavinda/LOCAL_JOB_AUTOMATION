import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Project bank routes (Postgres edition).
 * User-scoped backup projects for resume tailoring. The old version
 * had ZERO user scoping (all 4 endpoints were global).
 */

const router = Router();
router.use(requireAuth);

// ─── GET /api/project-bank ───────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql`
      SELECT id, title, link, date, location, summary, bullet_points, tags, created_at, updated_at
        FROM project_bank
       WHERE user_id = ${userId}
       ORDER BY updated_at DESC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/project-bank]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/project-bank ──────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { title, link, date, location, summary, bulletPoints, tags } = req.body;
  if (!title || !Array.isArray(bulletPoints) || !Array.isArray(tags)) {
    res.status(400).json({ error: "title, bulletPoints (array), and tags (array) are required" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      INSERT INTO project_bank (user_id, title, link, date, location, summary, bullet_points, tags)
      VALUES (
        ${userId}, ${title}, ${link || null}, ${date || null}, ${location || null},
        ${summary || null}, ${sql.json(bulletPoints)}, ${sql.json(tags)}
      )
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[POST /api/project-bank]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── PUT /api/project-bank/:id ───────────────────────────────────────
router.put("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { title, link, date, location, summary, bulletPoints, tags } = req.body;
  const patch: Record<string, any> = {};
  if (title !== undefined) patch.title = title;
  if (link !== undefined) patch.link = link;
  if (date !== undefined) patch.date = date;
  if (location !== undefined) patch.location = location;
  if (summary !== undefined) patch.summary = summary;
  if (bulletPoints !== undefined) patch.bullet_points = sql.json(bulletPoints);
  if (tags !== undefined) patch.tags = sql.json(tags);

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      UPDATE project_bank SET ${sql(patch)}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[PUT /api/project-bank/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/project-bank/:id ────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM project_bank WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/project-bank/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
