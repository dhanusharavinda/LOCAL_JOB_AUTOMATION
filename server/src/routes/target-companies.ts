import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Target companies routes (Postgres edition).
 * Per-user careers-page scanner config. Fully RLS + tenant-scoped.
 */

const router = Router();
router.use(requireAuth);

// ─── GET /api/target-companies ───────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql`
      SELECT id, company_name, careers_url, ats_type, title_keywords, negative_keywords,
             last_scanned_at, active, created_at
        FROM target_companies
       WHERE user_id = ${userId}
       ORDER BY company_name ASC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/target-companies]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/target-companies ──────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { company_name, careers_url, ats_type, title_keywords, negative_keywords } = req.body;
  if (!company_name || !careers_url) {
    res.status(400).json({ error: "company_name and careers_url are required" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      INSERT INTO target_companies (
        user_id, company_name, careers_url, ats_type, title_keywords, negative_keywords
      ) VALUES (
        ${userId}, ${company_name}, ${careers_url}, ${ats_type || "custom"},
        ${sql.json(title_keywords || [])}, ${sql.json(negative_keywords || [])}
      )
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[POST /api/target-companies]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/target-companies/seed ─────────────────────────────────
// Bulk-insert a starter set of companies. Accepts an array in req.body.companies.
router.post("/seed", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { companies } = req.body;
  if (!Array.isArray(companies)) {
    res.status(400).json({ error: "companies must be an array" });
    return;
  }
  let inserted = 0;
  try {
    for (const c of companies) {
      if (!c.company_name || !c.careers_url) continue;
      await sql`
        INSERT INTO target_companies (
          user_id, company_name, careers_url, ats_type, title_keywords, negative_keywords
        ) VALUES (
          ${userId}, ${c.company_name}, ${c.careers_url}, ${c.ats_type || "custom"},
          ${sql.json(c.title_keywords || [])}, ${sql.json(c.negative_keywords || [])}
        )
      `;
      inserted++;
    }
    res.json({ inserted, total: companies.length });
  } catch (err: any) {
    console.error("[POST /api/target-companies/seed]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── PUT /api/target-companies/:id ───────────────────────────────────
router.put("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { company_name, careers_url, ats_type, title_keywords, negative_keywords, active } = req.body;
  const patch: Record<string, any> = {};
  if (company_name !== undefined) patch.company_name = company_name;
  if (careers_url !== undefined) patch.careers_url = careers_url;
  if (ats_type !== undefined) patch.ats_type = ats_type;
  if (title_keywords !== undefined) patch.title_keywords = sql.json(title_keywords);
  if (negative_keywords !== undefined) patch.negative_keywords = sql.json(negative_keywords);
  if (active !== undefined) patch.active = !!active;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  try {
    const rows = await sql<any[]>`
      UPDATE target_companies SET ${sql(patch)}
       WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Target company not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[PUT /api/target-companies/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/target-companies/:id ────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM target_companies WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Target company not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/target-companies/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
