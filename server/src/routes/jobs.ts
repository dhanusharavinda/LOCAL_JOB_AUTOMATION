import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { uploadResumePdf } from "../storage";

/**
 * Jobs routes (Postgres edition).
 * Every query is scoped by user_id so a signed-in user never sees or
 * mutates another tenant's rows. RLS on the schema provides a second
 * line of defence if an individual query omits the filter.
 */

// Map internal scraper identifiers to neutral buckets before sending
// rows to the browser. We still store the real source in Postgres so
// pipeline-side dedup / analytics work, but nothing identifying leaves
// the API boundary.
const SOURCE_BUCKETS: Record<string, "primary" | "secondary" | "portal"> = {
  linkedin: "primary",
  company_portal: "portal",
};
function maskSource(src: string | null | undefined): string | null {
  if (!src) return null;
  return SOURCE_BUCKETS[src.toLowerCase()] || "secondary";
}
function maskJobRow<T extends { source?: string | null; sources?: unknown }>(row: T): T {
  const masked: any = { ...row };
  masked.source = maskSource(row.source ?? null);
  // `sources` is stored as JSONB — it can arrive as an array, a JSON
  // string, or null depending on how the row was inserted.
  if (Array.isArray(row.sources)) {
    masked.sources = Array.from(new Set((row.sources as any[]).map((s: any) => maskSource(String(s))))).filter(Boolean);
  } else if (typeof row.sources === "string" && row.sources.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(row.sources);
      if (Array.isArray(arr)) {
        masked.sources = Array.from(new Set(arr.map((s: any) => maskSource(String(s))))).filter(Boolean);
      }
    } catch { /* leave as-is */ }
  }
  return masked as T;
}

const router = Router();

// Whitelisted fields for PATCH + INSERT. Keeping this in one place
// prevents drift between the two handlers. Any field the pipeline sends
// must be in here — otherwise the PATCH route silently drops it and
// pipeline-generated assets (cover letters, tailored PDFs, score
// breakdowns) never land on the kanban card.
const EDITABLE_FIELDS = [
  "job_title", "company_name", "company_url", "job_link", "location",
  "salary", "seniority_level", "applicants_count", "apply_url", "resume_url",
  "outreach_email", "description", "status", "match_score", "match_reason",
  "applied_date", "notes", "deadline", "job_category",
  "interview_date", "offer_date",
  "source", "sources", "source_count", "content_hash",
  "posted_at", "freshness_score", "tags", "flagged",
  // Pipeline-generated asset fields (added for the SaaS migration)
  "cover_letter", "hiring_message", "score_breakdown", "detected_role_type",
  "resume_profile_id", "keyword_match_rate", "interview_prep",
] as const;

// ─── GET /api/jobs/exists?job_link=... ───────────────────────────────
// Duplicate check used by the pipeline subprocess before inserting a
// scraped job. User-scoped since the same link can legitimately appear
// in two different users' kanbans.
router.get("/exists", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const jobLink = req.query.job_link;
  if (!jobLink || typeof jobLink !== "string") {
    res.json({ exists: false });
    return;
  }
  try {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM jobs WHERE user_id = ${userId} AND job_link = ${jobLink} LIMIT 1
    `;
    res.json({ exists: rows.length > 0, id: rows[0]?.id ?? null });
  } catch (err: any) {
    console.error("[GET /api/jobs/exists]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/jobs ───────────────────────────────────────────────────
// List jobs for the signed-in user, optionally filtered by status or
// candidate (for enterprise accounts with multiple candidates).
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const candidateId = req.query.candidate_id ? parseInt(String(req.query.candidate_id), 10) : null;

  try {
    let rows;
    if (candidateId && status) {
      rows = await sql`
        SELECT * FROM jobs
         WHERE user_id = ${userId}
           AND candidate_id = ${candidateId}
           AND status = ${status}
         ORDER BY updated_at DESC
      `;
    } else if (candidateId) {
      rows = await sql`
        SELECT * FROM jobs
         WHERE user_id = ${userId} AND candidate_id = ${candidateId}
         ORDER BY updated_at DESC
      `;
    } else if (status) {
      rows = await sql`
        SELECT * FROM jobs
         WHERE user_id = ${userId} AND status = ${status}
         ORDER BY updated_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM jobs
         WHERE user_id = ${userId}
         ORDER BY updated_at DESC
      `;
    }
    res.json((rows as any[]).map(maskJobRow));
  } catch (err: any) {
    console.error("[GET /api/jobs]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/jobs/exists-batch ─────────────────────────────────────
// Batch duplicate check for the pipeline. Takes an array of job_link
// strings and returns the subset that already live in this user's
// kanban. Used once per pipeline run so we don't make N round-trips to
// /exists?job_link=... for every scraped link (hundreds of requests on
// a normal scrape).
//
// IMPORTANT: this route MUST be registered before `/:id` — otherwise
// Express's router sees the path "exists-batch" and tries to match it
// against the `/:id` handler, which parseInt()s it to NaN and 400s.
router.post("/exists-batch", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const links = req.body?.links;
  if (!Array.isArray(links)) {
    res.status(400).json({ error: "links must be an array of strings" });
    return;
  }
  // Drop non-strings / empties defensively so a single malformed entry
  // doesn't poison the whole query.
  const cleanLinks = links.filter((l): l is string => typeof l === "string" && l.length > 0);
  if (cleanLinks.length === 0) {
    res.json({ duplicates: [], flagged: [] });
    return;
  }
  try {
    const rows = await sql<{ job_link: string; flagged: boolean | null }[]>`
      SELECT job_link, flagged
        FROM jobs
       WHERE user_id = ${userId}
         AND job_link = ANY(${cleanLinks})
    `;
    const duplicates = rows.map((r) => r.job_link);
    // `flagged` jobs are ones the user has explicitly told the pipeline to
    // skip forever (e.g. "already rejected me"). The pipeline merges both
    // sets client-side into a single exclusion set.
    const flagged = rows.filter((r) => r.flagged).map((r) => r.job_link);
    res.json({ duplicates, flagged });
  } catch (err: any) {
    console.error("[POST /api/jobs/exists-batch]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/jobs/:id ───────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    const rows = await sql`
      SELECT * FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(maskJobRow(rows[0] as any));
  } catch (err: any) {
    console.error("[GET /api/jobs/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/jobs ──────────────────────────────────────────────────
// Create or upsert a job. Called manually from the UI (Add Job button)
// and by the pipeline subprocess after scoring jobs. Conflict key is
// (user_id, job_link) — per-user uniqueness, so two users can both
// track the same job URL.
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = req.body || {};
  const { job_title, company_name } = body;

  if (!job_title || !company_name) {
    res.status(400).json({
      error: `job_title and company_name are required (got job_title=${JSON.stringify(job_title)}, company_name=${JSON.stringify(company_name)})`,
    });
    return;
  }

  try {
    // Build the row with only the whitelisted fields present. postgres.js's
    // `sql(row, ...)` helper emits an INSERT with all supplied columns.
    const row: Record<string, any> = {
      user_id: userId,
      job_title,
      company_name,
      company_url: body.company_url ?? null,
      job_link: body.job_link ?? null,
      location: body.location ?? null,
      salary: body.salary ?? null,
      seniority_level: body.seniority_level ?? null,
      applicants_count: body.applicants_count ?? null,
      apply_url: body.apply_url ?? null,
      resume_url: body.resume_url ?? null,
      outreach_email: body.outreach_email ?? null,
      description: body.description ?? null,
      status: body.status ?? "applied",
      match_score: body.match_score ?? null,
      match_reason: body.match_reason ?? null,
      applied_date: body.applied_date || null,
      notes: body.notes ?? null,
      deadline: body.deadline ?? null,
      job_category: body.job_category ?? null,
      interview_date: body.interview_date ?? null,
      offer_date: body.offer_date ?? null,
      source: body.source ?? "linkedin",
      sources: body.sources ?? null,
      source_count: body.source_count ?? 1,
      content_hash: body.content_hash ?? null,
      posted_at: body.posted_at ?? null,
      freshness_score: body.freshness_score ?? null,
      tags: body.tags ?? null,
      // Pipeline-scored / tailored fields. Posted by the subprocess after
      // it finishes AI scoring + resume tailoring. Nullable because manual
      // "Add Job" from the UI doesn't supply them.
      score_breakdown: body.score_breakdown ?? null,
      detected_role_type: body.detected_role_type ?? null,
      cover_letter: body.cover_letter ?? null,
      hiring_message: body.hiring_message ?? null,
      resume_profile_id: body.resume_profile_id ?? null,
      keyword_match_rate: body.keyword_match_rate ?? null,
    };

    const jobLink: string | null = row.job_link;

    if (jobLink) {
      // Upsert path — respect the per-user unique index on (user_id, job_link).
      // COALESCE preserves existing resume_url, cover_letter, etc. if the new
      // row doesn't provide them (pipeline re-runs are idempotent).
      const rows = await sql`
        INSERT INTO jobs ${sql(row)}
        ON CONFLICT (user_id, job_link) WHERE job_link IS NOT NULL
        DO UPDATE SET
          job_title        = EXCLUDED.job_title,
          company_name     = EXCLUDED.company_name,
          company_url      = EXCLUDED.company_url,
          location         = EXCLUDED.location,
          salary           = EXCLUDED.salary,
          seniority_level  = EXCLUDED.seniority_level,
          applicants_count = EXCLUDED.applicants_count,
          apply_url        = EXCLUDED.apply_url,
          resume_url       = COALESCE(EXCLUDED.resume_url, jobs.resume_url),
          outreach_email   = COALESCE(EXCLUDED.outreach_email, jobs.outreach_email),
          description      = COALESCE(EXCLUDED.description, jobs.description),
          status           = EXCLUDED.status,
          match_score      = EXCLUDED.match_score,
          match_reason     = COALESCE(EXCLUDED.match_reason, jobs.match_reason),
          applied_date     = EXCLUDED.applied_date,
          deadline         = COALESCE(EXCLUDED.deadline, jobs.deadline),
          job_category     = COALESCE(EXCLUDED.job_category, jobs.job_category),
          interview_date   = COALESCE(EXCLUDED.interview_date, jobs.interview_date),
          offer_date       = COALESCE(EXCLUDED.offer_date, jobs.offer_date),
          source           = COALESCE(EXCLUDED.source, jobs.source),
          sources          = COALESCE(EXCLUDED.sources, jobs.sources),
          source_count     = COALESCE(EXCLUDED.source_count, jobs.source_count),
          content_hash     = COALESCE(EXCLUDED.content_hash, jobs.content_hash),
          posted_at        = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
          freshness_score  = COALESCE(EXCLUDED.freshness_score, jobs.freshness_score),
          tags             = COALESCE(EXCLUDED.tags, jobs.tags),
          score_breakdown  = COALESCE(EXCLUDED.score_breakdown, jobs.score_breakdown),
          detected_role_type = COALESCE(EXCLUDED.detected_role_type, jobs.detected_role_type),
          cover_letter     = COALESCE(EXCLUDED.cover_letter, jobs.cover_letter),
          hiring_message   = COALESCE(EXCLUDED.hiring_message, jobs.hiring_message),
          resume_profile_id = COALESCE(EXCLUDED.resume_profile_id, jobs.resume_profile_id),
          keyword_match_rate = COALESCE(EXCLUDED.keyword_match_rate, jobs.keyword_match_rate),
          updated_at       = NOW()
        RETURNING *
      `;
      res.status(201).json(rows[0]);
      return;
    }

    // Plain insert (no job_link → no conflict possible)
    const rows = await sql`INSERT INTO jobs ${sql(row)} RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[POST /api/jobs]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── PATCH /api/jobs/:id ─────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  // Build a partial update set from whitelisted fields only.
  const patch: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      patch[field] = req.body[field];
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  try {
    const rows = await sql`
      UPDATE jobs SET ${sql(patch)}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(maskJobRow(rows[0] as any));
  } catch (err: any) {
    // Postgres-side failures on a status drag are almost always one of:
    //   - CHECK constraint (jobs_status_check) rejecting an unknown status
    //   - a whitelisted column that doesn't exist yet in this DB (stale
    //     migration)
    //   - a connection hiccup
    // Surface the real postgres code + message so the browser banner is
    // actionable instead of the generic "Database error".
    console.error("[PATCH /api/jobs/:id]", {
      pgCode: err?.code, pgDetail: err?.detail, pgTable: err?.table, message: err?.message, fields: Object.keys(patch),
    });
    res.status(500).json({
      error: err?.message || "Database error",
      code: err?.code,
      detail: err?.detail,
    });
  }
});

// ─── POST /api/jobs/upload-pdf ───────────────────────────────────────
// Pipeline posts a base64-encoded tailored-resume PDF here. We upload
// it to Supabase Storage under the user's private folder, return a
// 7-day signed URL, and update the job row (identified by job_link)
// so the kanban card gets a download link. The pipeline doesn't know
// numeric job ids — it identifies jobs by their job_link — so we look
// them up server-side.
router.post("/upload-pdf", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { filename, base64, job_link } = req.body || {};
  if (!filename || !base64) {
    res.status(400).json({ error: "filename and base64 are required" });
    return;
  }
  try {
    const buffer = Buffer.from(String(base64), "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "base64 decoded to empty buffer" });
      return;
    }
    const { signedUrl } = await uploadResumePdf(userId, String(filename), buffer);

    if (job_link && typeof job_link === "string") {
      await sql`
        UPDATE jobs SET resume_url = ${signedUrl}, updated_at = NOW()
         WHERE user_id = ${userId} AND job_link = ${job_link}
      `;
    }
    res.json({ ok: true, resume_url: signedUrl });
  } catch (err: any) {
    console.error("[POST /api/jobs/upload-pdf]", err?.message || err);
    res.status(500).json({ error: err?.message || "Upload failed" });
  }
});

// ─── DELETE /api/jobs/batch ──────────────────────────────────────────
router.delete("/batch", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  const numericIds = ids.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n));
  if (numericIds.length === 0) {
    res.status(400).json({ error: "ids must contain valid numbers" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM jobs WHERE user_id = ${userId} AND id IN ${sql(numericIds)}
    `;
    res.json({ deleted: result.count });
  } catch (err: any) {
    console.error("[DELETE /api/jobs/batch]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── DELETE /api/jobs/:id ────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    const result = await sql`
      DELETE FROM jobs WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/jobs/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
