import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { downloadResumeText, getMainResumeSignedUrl } from "../storage";
import { submitToAts, detectAtsType } from "../services/ats";

/**
 * Auto-apply routes.
 * ──────────────────
 * The browser extension and the dashboard both consume these endpoints.
 *
 *   GET  /api/apply/profile          → user's saved answers
 *   PUT  /api/apply/profile          → upsert user's saved answers
 *   GET  /api/apply/job-context/:id  → resume url + profile + AI answers for one job
 *   POST /api/apply/track            → extension reports an outcome (success/fail)
 *   POST /api/apply/ats-submit/:id   → server-side direct submission via ATS API
 *   POST /api/apply/answer           → AI-generated answer for a free-text question
 *
 * All routes require auth; tenant isolation is enforced by `user_id` on
 * every query. Most endpoints also have small-blast-radius rate limits
 * applied at the index.ts mount point.
 */

const router = Router();
router.use(requireAuth);

// Per-IP cap on the OpenAI-backed answer endpoint. Each call costs
// real money even with the cache, so keep this tight independent of
// the global apiLimiter that's already on /api/*.
const answerLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,                     // 20 AI answers/min/IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many AI answer requests. Please wait a minute." },
});

// ── OpenAI lazy init ──────────────────────────────────────────────────
// Model + base URL are env-configurable so an operator can flip to a
// faster/cheaper or self-hosted model without a code change. Defaults
// match what shipped originally.
const APPLY_CHAT_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  return new OpenAI({ apiKey, baseURL, maxRetries: 2 });
}

// ── Profile shape (must mirror migration 0004) ────────────────────────
const PROFILE_FIELDS = [
  "full_name", "email", "phone",
  "linkedin_url", "github_url", "portfolio_url",
  "street", "city", "state_region", "postcode", "country",
  "work_auth_status", "requires_sponsorship", "willing_to_relocate",
  "salary_min", "salary_max", "salary_currency",
  "years_experience", "highest_degree", "university", "graduation_year",
  "start_date",
  "ethnicity", "gender", "veteran_status", "disability_status", "pronouns",
  "why_interested", "greatest_achievement", "problem_solved", "unique_strength",
  "custom_answers",
] as const;

type ProfileField = typeof PROFILE_FIELDS[number];

function pickProfileFields(input: any): Partial<Record<ProfileField, any>> {
  const out: Partial<Record<ProfileField, any>> = {};
  for (const k of PROFILE_FIELDS) {
    if (input && Object.prototype.hasOwnProperty.call(input, k)) {
      out[k] = input[k];
    }
  }
  return out;
}

function emptyProfile(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of PROFILE_FIELDS) out[k] = k === "custom_answers" ? {} : null;
  return out;
}

// ─── GET /api/apply/profile ─────────────────────────────────────────────
router.get("/profile", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql<any[]>`
      SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    if (!rows[0]) {
      res.json({ profile: emptyProfile(), exists: false });
      return;
    }
    const { user_id: _omit, ...profile } = rows[0];
    res.json({ profile, exists: true });
  } catch (err: any) {
    console.error("[GET /api/apply/profile]", err?.message || err);
    res.status(500).json({ error: "Could not load apply profile" });
  }
});

// ─── PUT /api/apply/profile ─────────────────────────────────────────────
router.put("/profile", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fields = pickProfileFields(req.body);

  // Coerce empty strings to null so the DB stays clean. Booleans and
  // numbers come through as-is.
  for (const k of Object.keys(fields)) {
    if (fields[k as ProfileField] === "") fields[k as ProfileField] = null;
  }

  try {
    const insertRow: any = { user_id: userId, ...fields };
    // SET row excludes user_id (the conflict key) - postgres.js's sql()
    // helper expands it into `col = $val` pairs for the UPDATE clause.
    const updateRow: any = { ...fields };

    if (Object.keys(fields).length === 0) {
      // No fields sent - just ensure a row exists.
      await sql`
        INSERT INTO apply_profiles (user_id) VALUES (${userId})
        ON CONFLICT (user_id) DO NOTHING
      `;
    } else {
      await sql`
        INSERT INTO apply_profiles ${sql(insertRow)}
        ON CONFLICT (user_id) DO UPDATE SET ${sql(updateRow)}, updated_at = NOW()
      `;
    }

    const rows = await sql<any[]>`
      SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    const { user_id: _omit, ...profile } = rows[0] || {};
    res.json({ profile, exists: !!rows[0] });
  } catch (err: any) {
    console.error("[PUT /api/apply/profile]", err?.message || err);
    res.status(500).json({ error: "Could not save apply profile" });
  }
});

// Shared helper used by both /:jobId and /by-url variants.
async function buildJobContext(userId: string, jobId: number) {
  const jobs = await sql<any[]>`
    SELECT id, job_title, company_name, apply_url, job_link,
           resume_url, cover_letter, hiring_message, description,
           status, match_score, ats_score
      FROM jobs
     WHERE id = ${jobId} AND user_id = ${userId}
     LIMIT 1
  `;
  const job = jobs[0];
  if (!job) return null;

  const profileRows = await sql<any[]>`
    SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
  `;
  const profile = profileRows[0]
    ? (() => { const { user_id: _o, ...rest } = profileRows[0]; return rest; })()
    : emptyProfile();

  const ats_type = detectAtsType(job.apply_url || job.job_link || "");
  const cached_answers_count = countCachedAnswers(profile);

  // Resume selection. Three states the engine can surface:
  //   1. Tailored: jobs.resume_url is set. Pipeline or manual Tailor
  //      generated this PDF for THIS specific job. Best match.
  //   2. Main: jobs.resume_url is null but the user has an original
  //      resume uploaded. Use that as a fallback. Engine notes "main
  //      resume (no tailored version for this job)".
  //   3. None: nothing uploaded. Engine skips the file-input step.
  let resume_url: string | null = job.resume_url || null;
  let resume_source: "tailored" | "main" | "none" = job.resume_url ? "tailored" : "none";
  if (!resume_url) {
    const main = await getMainResumeSignedUrl(userId);
    if (main) { resume_url = main.signedUrl; resume_source = "main"; }
  }

  return {
    job: {
      id: job.id,
      job_title: job.job_title,
      company_name: job.company_name,
      apply_url: job.apply_url || job.job_link,
      resume_url,
      resume_source,
      cover_letter: job.cover_letter,
      hiring_message: job.hiring_message,
      description: job.description,
      match_score: job.match_score,
      ats_score: job.ats_score,
    },
    profile,
    ats_type,
    cached_answers_count,
  };
}

/** Count entries in custom_answers, defensive against null/non-object. */
function countCachedAnswers(profile: any): number {
  const ca = profile?.custom_answers;
  if (!ca || typeof ca !== "object") return 0;
  return Object.keys(ca).length;
}

// ─── GET /api/apply/job-context/:jobId ──────────────────────────────────
//
// Called by the extension when the user lands on a supported ATS page.
// Returns tailored resume URL, cover letter, profile, and detected ATS.
router.get("/job-context/:jobId", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.jobId), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    const ctx = await buildJobContext(userId, id);
    if (!ctx) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(ctx);
  } catch (err: any) {
    console.error("[GET /api/apply/job-context]", err?.message || err);
    res.status(500).json({ error: "Could not load job context" });
  }
});

// ─── GET /api/apply/job-context-by-url ──────────────────────────────────
//
// Convenience endpoint for the extension's content script: look up the
// matching jobs row by URL (LinkedIn /jobs/view/<id> etc.) without the
// content script needing to know the internal id beforehand. The match
// is fuzzy: we accept either an exact `apply_url` match or a `job_link`
// containing the external id.
router.get("/job-context-by-url", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const url = String(req.query.url || "").trim();
  const externalId = String(req.query.external_id || "").trim();
  if (!url && !externalId) {
    res.status(400).json({ error: "Pass ?url= or ?external_id=" });
    return;
  }
  try {
    // Normalize the incoming URL: strip query/hash + trailing slash so a
    // posting URL with utm_source params still matches the canonical
    // form stored in the jobs table. The same normalization is applied
    // to the stored side via REGEXP_REPLACE so both sides compare apples
    // to apples.
    const normalizedUrl = normalizeUrlForMatch(url);
    const stripPattern = "^(https?://[^?#]*?)/?(\\?.*)?$";

    let jobs: any[] = [];

    // Step 1: exact-URL match (after normalization). Most reliable when
    // the dashboard tracked the job by pasting the same posting URL.
    if (normalizedUrl) {
      jobs = await sql<any[]>`
        SELECT id, resume_url, updated_at FROM jobs
         WHERE user_id = ${userId}
           AND resume_url IS NOT NULL
           AND (
             REGEXP_REPLACE(COALESCE(job_link, ''),  ${stripPattern}, '\\1') = ${normalizedUrl}
             OR REGEXP_REPLACE(COALESCE(apply_url, ''), ${stripPattern}, '\\1') = ${normalizedUrl}
           )
         ORDER BY updated_at DESC LIMIT 1
      `;
    }

    // Step 2: external-id match (LinkedIn job id, Greenhouse job id,
    // etc.) where the URL didn't match exactly but the posting id
    // appears in the stored job_link / apply_url. Skips rows without
    // a tailored resume so we don't lock in a "random" wrong resume
    // when a duplicate id slipped in.
    if (jobs.length === 0 && externalId && externalId.length >= 4) {
      jobs = await sql<any[]>`
        SELECT id, resume_url, updated_at FROM jobs
         WHERE user_id = ${userId}
           AND resume_url IS NOT NULL
           AND (job_link ILIKE ${"%" + externalId + "%"} OR apply_url ILIKE ${"%" + externalId + "%"})
         ORDER BY updated_at DESC LIMIT 1
      `;
    }

    // Step 3: fallback to the URL exact-match against rows WITHOUT a
    // tailored resume (still valid for tracked jobs, just no resume to
    // attach). If that hits, the engine falls back to the user's main
    // uploaded resume via /page-context's main_resume_url field.
    if (jobs.length === 0 && normalizedUrl) {
      jobs = await sql<any[]>`
        SELECT id FROM jobs
         WHERE user_id = ${userId}
           AND (
             REGEXP_REPLACE(COALESCE(job_link, ''),  ${stripPattern}, '\\1') = ${normalizedUrl}
             OR REGEXP_REPLACE(COALESCE(apply_url, ''), ${stripPattern}, '\\1') = ${normalizedUrl}
           )
         ORDER BY created_at DESC LIMIT 1
      `;
    }

    if (jobs.length === 0) {
      res.status(404).json({ error: "No tracked job matches this page" });
      return;
    }
    const ctx = await buildJobContext(userId, jobs[0].id);
    if (!ctx) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(ctx);
  } catch (err: any) {
    console.error("[GET /api/apply/job-context-by-url]", err?.message || err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

/**
 * Normalize a URL for tracked-job matching. Lowercases the host, drops
 * the query string and hash, and removes a trailing slash. Tolerant of
 * malformed input (returns "" for unparseable strings).
 */
function normalizeUrlForMatch(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.split("?")[0].split("#")[0].replace(/\/$/, "");
  }
}

// ─── GET /api/apply/page-context ────────────────────────────────────────
//
// Fallback for pages that aren't tracked in the user's jobs table.
// The extension's content script tries /api/apply/job-context-by-url
// first (which 404s if no row matches the page URL); on 404 it calls
// this endpoint to fill the form using profile-only mode.
//
// Returns the user's apply profile + the most-recent tailored resume
// URL (if any) so we can still attempt a resume upload on a custom
// careers page. Job-shaped fields are null so the engine knows it's
// in untracked mode (skip submit-track, skip company-aware AI prompt).
router.get("/page-context", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const profileRows = await sql<any[]>`
      SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    const profile = profileRows[0]
      ? (() => { const { user_id: _o, ...rest } = profileRows[0]; return rest; })()
      : emptyProfile();

    // Resume fallback for an untracked page. Prefer the user's main
    // uploaded resume (the unmodified one they uploaded to the
    // dashboard) over a "random" most-recent tailored PDF from a
    // different job. This matches the user's expectation that the
    // extension submits the resume they actually meant to send.
    let resume_url: string | null = null;
    let resume_source: "main" | "none" = "none";
    const main = await getMainResumeSignedUrl(userId);
    if (main) { resume_url = main.signedUrl; resume_source = "main"; }

    res.json({
      job: {
        id: null,
        job_title: null,
        company_name: null,
        apply_url: null,
        resume_url,
        resume_source,
        cover_letter: null,
        hiring_message: null,
        description: null,
        match_score: null,
        ats_score: null,
      },
      profile,
      ats_type: "generic",
      cached_answers_count: countCachedAnswers(profile),
    });
  } catch (err: any) {
    console.error("[GET /api/apply/page-context]", err?.message || err);
    res.status(500).json({ error: "Could not load page context" });
  }
});

// ─── POST /api/apply/track ──────────────────────────────────────────────
//
// Extension reports an apply outcome. Body:
//   { jobId, method, success: bool, errorMessage?: string, fieldsFilled?: number }
//
// On success: transition jobs.status to 'applied' (rank-aware: don't
// downgrade an already-interviewing or offered row), set applied_date,
// stamp apply_method + apply_attempted_at.
// On failure: stamp apply_attempted_at + apply_errors, leave status alone.
router.post("/track", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { jobId, method, success, errorMessage, fieldsFilled } = req.body || {};
  const id = parseInt(String(jobId), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid jobId" });
    return;
  }
  if (!method || typeof method !== "string") {
    res.status(400).json({ error: "Missing method" });
    return;
  }

  try {
    // Rank-aware status update: only promote to 'applied' from less-
    // advanced statuses. Mirrors gmail.ts:459-465.
    const rank: Record<string, number> = {
      filtered: 0, saved: 1, applied: 2, interviewing: 3, offer: 4, rejected: 1,
    };

    const rows = await sql<any[]>`
      SELECT id, status FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    const job = rows[0];
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (success) {
      const curRank = rank[job.status] ?? 0;
      const shouldPromote = curRank < (rank.applied ?? 2);
      if (shouldPromote) {
        await sql`
          UPDATE jobs
             SET status = 'applied',
                 applied_date = COALESCE(applied_date, NOW()),
                 apply_method = ${method},
                 apply_attempted_at = NOW(),
                 apply_errors = NULL,
                 updated_at = NOW()
           WHERE id = ${id} AND user_id = ${userId}
        `;
      } else {
        await sql`
          UPDATE jobs
             SET apply_method = ${method},
                 apply_attempted_at = NOW(),
                 apply_errors = NULL,
                 updated_at = NOW()
           WHERE id = ${id} AND user_id = ${userId}
        `;
      }
    } else {
      await sql`
        UPDATE jobs
           SET apply_attempted_at = NOW(),
               apply_method = ${method},
               apply_errors = ${errorMessage ? String(errorMessage).slice(0, 500) : "Unknown error"},
               updated_at = NOW()
         WHERE id = ${id} AND user_id = ${userId}
      `;
    }

    res.json({ ok: true, fieldsFilled: fieldsFilled || null });
  } catch (err: any) {
    console.error("[POST /api/apply/track]", err?.message || err);
    res.status(500).json({ error: "Track failed" });
  }
});

// ─── POST /api/apply/track-untracked ────────────────────────────────────
//
// One-click "add this to my kanban as applied" for jobs the user
// reached via the extension on a page NOT already tracked in the
// dashboard. Before this route the extension said "Page not tracked —
// open dashboard to add it." and the user had to manually re-type the
// position title, company, location, etc. via "Add Custom Application".
//
// Body:
//   {
//     job_title: string (required),
//     company_name: string (required),
//     job_link: string  (required, used for dedup against existing jobs),
//     location?: string,
//     job_type?: string,
//     method?: string  (e.g. "extension_greenhouse"),
//     apply_url?: string,
//   }
//
// Behaviour:
//   - If a job with this user + job_link already exists, PROMOTE it to
//     "applied" status via the existing rank logic; do NOT create a
//     duplicate. Returns the existing row's id + `{ existed: true }`.
//   - Otherwise INSERT a new row with status="applied" + applied_date=NOW
//     and return its id + `{ existed: false }`.
router.post("/track-untracked", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    job_title,
    company_name,
    job_link,
    location,
    job_type,
    method,
    apply_url,
  } = (req.body || {}) as Record<string, string | undefined>;

  if (!job_title || !company_name || !job_link) {
    res.status(400).json({ error: "job_title, company_name, and job_link are required" });
    return;
  }

  try {
    // Dedup against existing jobs by URL. If we find a match, just
    // promote it — saves the user a manual delete-and-readd if they
    // tracked the job earlier in the day.
    const existing = await sql<{ id: number; status: string }[]>`
      SELECT id, status FROM jobs
       WHERE user_id = ${userId} AND job_link = ${job_link}
       LIMIT 1
    `;

    const applyMethod = String(method || "extension_untracked").slice(0, 80);

    if (existing[0]) {
      // Mirrors the rank logic in /track so we never downgrade.
      const rank: Record<string, number> = {
        filtered: 0, saved: 1, applied: 2, interviewing: 3, offer: 4, rejected: 1,
      };
      const curRank = rank[existing[0].status] ?? 0;
      if (curRank < (rank.applied ?? 2)) {
        await sql`
          UPDATE jobs
             SET status = 'applied',
                 applied_date = COALESCE(applied_date, NOW()),
                 apply_method = ${applyMethod},
                 apply_attempted_at = NOW(),
                 apply_errors = NULL,
                 updated_at = NOW()
           WHERE id = ${existing[0].id} AND user_id = ${userId}
        `;
      } else {
        // Already at or past applied — just stamp the method + attempt.
        await sql`
          UPDATE jobs
             SET apply_method = ${applyMethod},
                 apply_attempted_at = NOW(),
                 apply_errors = NULL,
                 updated_at = NOW()
           WHERE id = ${existing[0].id} AND user_id = ${userId}
        `;
      }
      res.json({ ok: true, id: existing[0].id, existed: true });
      return;
    }

    // Fresh insert. Length-clip every text field defensively so a
    // pathological page title can't blow up the row.
    const inserted = await sql<{ id: number }[]>`
      INSERT INTO jobs (
        user_id, job_title, company_name, job_link, apply_url, location,
        seniority_level, status, applied_date,
        apply_method, apply_attempted_at, source, sources
      )
      VALUES (
        ${userId},
        ${String(job_title).slice(0, 200)},
        ${String(company_name).slice(0, 200)},
        ${String(job_link).slice(0, 1000)},
        ${apply_url ? String(apply_url).slice(0, 1000) : null},
        ${location ? String(location).slice(0, 200) : null},
        ${job_type ? String(job_type).slice(0, 80) : null},
        'applied',
        NOW(),
        ${applyMethod},
        NOW(),
        'extension',
        ${sql.json(['extension'])}
      )
      RETURNING id
    `;
    res.json({ ok: true, id: inserted[0].id, existed: false });
  } catch (err: any) {
    console.error("[POST /api/apply/track-untracked]", err?.message || err);
    res.status(500).json({ error: err?.message || "Could not track this application" });
  }
});

// ─── POST /api/apply/ats-submit/:jobId ──────────────────────────────────
//
// Server-side direct submission using a public ATS API. Works for
// Greenhouse / Lever / Workable / Ashby. Looks up the job, downloads the
// tailored resume PDF (signed URL), POSTs the multipart application,
// then on success stamps the row.
router.post("/ats-submit/:jobId", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.jobId), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    const jobs = await sql<any[]>`
      SELECT * FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    const job = jobs[0];
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const profileRows = await sql<any[]>`
      SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    const profile = profileRows[0];
    if (!profile || !profile.full_name || !profile.email) {
      res.status(400).json({
        error: "Set up your apply profile first (full name + email are required).",
        needsProfile: true,
      });
      return;
    }

    const ats = detectAtsType(job.apply_url || job.job_link || "");
    if (!ats || ats === "linkedin" || ats === "workday" || ats === "unknown") {
      res.status(400).json({
        error: `Server-side submit isn't available for ${ats || "this site"}. Use the browser extension instead.`,
        ats,
      });
      return;
    }

    const resumeText = await downloadResumeText(userId);
    const result = await submitToAts({
      ats,
      job: { ...job, user_id: userId },
      profile,
      resumeText,
      coverLetter: job.cover_letter || "",
    });

    if (!result.ok) {
      await sql`
        UPDATE jobs
           SET apply_attempted_at = NOW(),
               apply_method = ${"api_" + ats},
               apply_errors = ${String(result.error || "Submit failed").slice(0, 500)},
               updated_at = NOW()
         WHERE id = ${id} AND user_id = ${userId}
      `;
      res.status(502).json({ ok: false, error: result.error });
      return;
    }

    await sql`
      UPDATE jobs
         SET status = 'applied',
             applied_date = COALESCE(applied_date, NOW()),
             apply_method = ${"api_" + ats},
             apply_attempted_at = NOW(),
             apply_errors = NULL,
             updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;
    res.json({ ok: true, ats, response: result.response || null });
  } catch (err: any) {
    console.error("[POST /api/apply/ats-submit]", err?.message || err);
    res.status(500).json({ error: "ATS submit failed" });
  }
});

// ─── POST /api/apply/answer ─────────────────────────────────────────────
//
// AI-generated answer for a single free-text application question.
// Body: { jobId?: number, question: string, maxWords?: number }
//
// Builds a tight prompt from the user's apply profile + the job
// description (when jobId is provided) and asks GPT-4o-mini for a
// natural-sounding, first-person answer. Caches the result in
// apply_profiles.custom_answers keyed by a normalized form of the
// question, so the same question on a later application is free.
router.post("/answer", answerLimiter, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { jobId, question, maxWords, options } = req.body || {};
  const q = String(question || "").trim();
  if (!q || q.length < 3) {
    res.status(400).json({ error: "Empty or too-short question" });
    return;
  }
  if (q.length > 1000) {
    res.status(400).json({ error: "Question too long (max 1000 chars)" });
    return;
  }

  // When the caller passes a finite list of options (a dropdown / radio
  // group from the form), the AI's job changes: instead of writing a
  // free-text answer, it must pick the option label that best fits.
  // Cap to 30 options (sanity) and trim each to a reasonable length.
  let optionList: string[] | null = null;
  if (Array.isArray(options) && options.length > 0) {
    optionList = options
      .map((o) => String(o ?? "").trim())
      .filter((o) => o.length > 0 && o.length < 200)
      .slice(0, 30);
    if (optionList.length === 0) optionList = null;
  }

  const wordCap = Math.max(
    optionList ? 1 : 20,
    Math.min(400, parseInt(String(maxWords || (optionList ? 30 : 150)), 10) || 150)
  );

  // Normalize for the cache key. Lowercase + collapse whitespace +
  // strip trailing punctuation. Different ATSs phrase the same question
  // differently ("Why are you interested in this role?" vs "why interested in role"),
  // and exact-match caching is fine here because we expect repeated wording
  // within the same ATS / company group.
  const cacheKey = q.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  try {
    const profileRows = await sql<any[]>`
      SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    const profile = profileRows[0];
    if (!profile) {
      res.status(400).json({
        error: "Set up your apply profile first so the AI can answer in your voice.",
        needsProfile: true,
      });
      return;
    }

    // Cache hit (text mode only - option-mode replies are short and
    // depend on the option list, which can change per ATS, so we don't
    // cache those).
    if (!optionList) {
      const cached = profile.custom_answers?.[cacheKey];
      if (typeof cached === "string" && cached.length > 0 && !req.query.refresh) {
        res.json({ answer: cached, cached: true });
        return;
      }
    }

    // Pull job context if given.
    let jobCtx = "";
    if (jobId && Number.isFinite(parseInt(String(jobId), 10))) {
      const jobRows = await sql<any[]>`
        SELECT job_title, company_name, description
          FROM jobs
         WHERE id = ${parseInt(String(jobId), 10)} AND user_id = ${userId}
         LIMIT 1
      `;
      const j = jobRows[0];
      if (j) {
        const desc = String(j.description || "").slice(0, 1500);
        jobCtx = `\n\nJob: ${j.job_title} at ${j.company_name}.${desc ? "\nJob description (truncated):\n" + desc : ""}`;
      }
    }

    const openai = getOpenAI();
    if (!openai) {
      res.status(500).json({ error: "AI is not configured on the server" });
      return;
    }

    const profileBrief = [
      profile.full_name && `Name: ${profile.full_name}`,
      profile.years_experience != null && `Years experience: ${profile.years_experience}`,
      profile.highest_degree && `Highest degree: ${profile.highest_degree}`,
      profile.university && `University: ${profile.university}`,
      profile.why_interested && `Career motivation: ${profile.why_interested}`,
      profile.greatest_achievement && `Greatest achievement: ${profile.greatest_achievement}`,
      profile.problem_solved && `A problem they solved: ${profile.problem_solved}`,
      profile.unique_strength && `Unique strength: ${profile.unique_strength}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Voice calibration: pull up to 3 prior answers from the cache so
    // the model can match the candidate's tone, sentence length, and
    // specificity. Skips short / one-word entries (those are usually
    // option-pick artifacts, not story prose).
    const cacheMap = (profile.custom_answers as Record<string, string> | null) || {};
    const priorAnswers = Object.entries(cacheMap)
      .map(([k, v]) => ({ k, v: String(v || "") }))
      .filter((e) => e.v.length > 60 && e.v.length < 800)
      .slice(0, 3);
    const voiceBrief = priorAnswers.length > 0
      ? "\n\nPrior answers from this candidate (for voice calibration - match this register, sentence rhythm, and specificity. Do NOT copy phrases verbatim):\n" +
        priorAnswers.map((a, i) => `Sample ${i + 1}: ${a.v}`).join("\n")
      : "";

    let sys: string;
    let usr: string;

    if (optionList) {
      // Option-pick mode. The AI must return EXACTLY one of the labels.
      sys =
        "You select which option from a fixed list best fits a job application question, given the candidate's profile. " +
        "Return ONLY the option label, copied verbatim. No explanation, no quotes, no extra text.";
      usr =
        `Candidate brief:\n${profileBrief || "(no profile details available)"}` +
        jobCtx +
        `\n\nQuestion: "${q}"\n\nOptions (pick exactly one):\n` +
        optionList.map((o, i) => `${i + 1}. ${o}`).join("\n") +
        `\n\nReturn the label of the option you choose, copied exactly. No numbering, no quotes.`;
    } else {
      sys =
        "You write short, natural, first-person answers to job-application questions. " +
        "Match the candidate's authentic voice using the brief below. NEVER invent jobs, employers, " +
        "degrees, or numbers that aren't in the brief. Keep it concrete and specific. " +
        "No corporate filler, no clichés (passionate about, dynamic, synergy, deeply value). " +
        "If the question asks about company or role specifics, weave in details from the job. " +
        "Plain prose only, no bullet points unless the question asks for a list.";
      usr =
        `Candidate brief:\n${profileBrief || "(no profile details available)"}` +
        voiceBrief +
        jobCtx +
        `\n\nQuestion the application form is asking:\n"${q}"\n\n` +
        `Write the candidate's answer. Hard cap: ${wordCap} words. ` +
        `Return only the answer, no preamble, no quotes around it.`;
    }

    const completion = await openai.chat.completions.create({
      model: APPLY_CHAT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: optionList ? 0.2 : 0.6,
      max_tokens: optionList ? 60 : Math.ceil(wordCap * 2.5),
    });

    let answer = (completion.choices[0]?.message?.content || "").trim();
    if (!answer) {
      res.status(502).json({ error: "AI returned an empty answer" });
      return;
    }

    // Option mode - sanitize the model's reply against the option list.
    // Sometimes the model adds quotes, prefixes "Option: ", or paraphrases.
    // Always return the closest matching option label so the client's
    // fuzzy-match doesn't have to clean it up.
    if (optionList) {
      const normalized = answer.replace(/^["'\d.\s)-]+/, "").replace(/["']+$/, "").trim().toLowerCase();
      const exact = optionList.find((o) => o.toLowerCase() === normalized);
      const partial = exact || optionList.find((o) => normalized.includes(o.toLowerCase()) || o.toLowerCase().includes(normalized));
      answer = partial || optionList[0];
      res.json({ answer, cached: false });
      return;
    }

    // Cache it. JSONB merge keeps any prior keys intact.
    await sql`
      UPDATE apply_profiles
         SET custom_answers = COALESCE(custom_answers, '{}'::jsonb) || ${sql.json({ [cacheKey]: answer })},
             updated_at = NOW()
       WHERE user_id = ${userId}
    `;

    res.json({ answer, cached: false });
  } catch (err: any) {
    console.error("[POST /api/apply/answer]", err?.message || err);
    res.status(500).json({ error: "AI answer failed" });
  }
});

// ─── POST /api/apply/extract-from-resume ────────────────────────────────
//
// Reads the user's uploaded resume text from Supabase Storage, runs a
// few regexes for LinkedIn / GitHub / portfolio URLs and a phone
// number, and returns whatever it found. The client offers these as
// suggested values in the ApplyProfileEditor; the user reviews and
// saves. We do NOT auto-write to apply_profiles here; user keeps
// authority over what their profile looks like.
router.post("/extract-from-resume", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const text = await downloadResumeText(userId);
    if (!text) {
      res.status(404).json({ error: "No resume uploaded yet. Upload one in Settings first." });
      return;
    }
    const found = extractContactsFromResume(text);
    res.json(found);
  } catch (err: any) {
    console.error("[POST /api/apply/extract-from-resume]", err?.message || err);
    res.status(500).json({ error: "Could not parse resume" });
  }
});

/**
 * Pull contact-link patterns out of a resume's plain text.
 *
 * LinkedIn:    linkedin.com/in/<slug> (with or without protocol)
 * GitHub:      github.com/<user>      (excluding /pulls / /issues etc)
 * Portfolio:   any other http(s)://... URL that isn't LinkedIn/GitHub/email
 * Phone:       e.164-ish or common formats. We DON'T overwrite existing
 *              profile values; the client decides whether to apply.
 */
function extractContactsFromResume(text: string): {
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  phone: string | null;
  email: string | null;
} {
  const out = { linkedin_url: null as string | null, github_url: null as string | null,
                portfolio_url: null as string | null, phone: null as string | null,
                email: null as string | null };

  // LinkedIn. Most common form is "linkedin.com/in/<slug>".
  const liMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  if (liMatch) out.linkedin_url = ensureProtocol(liMatch[0]);

  // GitHub. Profile page only (avoid repo URLs that aren't the user's profile).
  const ghMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+(?!\/[A-Za-z])/i);
  if (ghMatch) out.github_url = ensureProtocol(ghMatch[0].split(/\s/)[0]);

  // Portfolio. Pick the first http(s) URL that isn't LinkedIn/GitHub/email.
  const urlMatches = text.match(/https?:\/\/[^\s)"'>]+/gi) || [];
  for (const u of urlMatches) {
    const lo = u.toLowerCase();
    if (lo.includes("linkedin.com")) continue;
    if (lo.includes("github.com")) continue;
    if (lo.includes("mailto:")) continue;
    out.portfolio_url = u.replace(/[.,)]+$/, "");
    break;
  }

  // Email. First match wins.
  const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) out.email = emailMatch[0];

  // Phone. Loose international format. Picks the first 10+ digit run
  // that looks plausible (with optional + prefix and spaces/dashes).
  const phoneMatch = text.match(/\+?\d[\d\s().-]{8,}\d/);
  if (phoneMatch) out.phone = phoneMatch[0].trim();

  return out;
}

function ensureProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// ─── POST /api/apply/learn ──────────────────────────────────────────────
//
// Profile-bank learning. The extension posts the user's actual answers
// at submit time so future applications can pre-fill the same questions
// without an AI call. Body:
//
//   { entries: [{ question: string, answer: string }, ...] }
//
// Each entry is normalized + merged into apply_profiles.custom_answers.
// We never overwrite a longer existing answer with a shorter incoming
// one (otherwise a Yes/No answer to a different-but-similar question
// could clobber a previous good prose answer); ties prefer the newer.
router.post("/learn", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = (req.body || {}) as { entries?: Array<{ question?: string; answer?: string }> };
  const raw = Array.isArray(body.entries) ? body.entries : [];
  if (raw.length === 0) {
    res.json({ ok: true, learned: 0 });
    return;
  }

  const cleaned: Record<string, string> = {};
  for (const e of raw.slice(0, 50)) {
    const q = String(e?.question || "").trim();
    const a = String(e?.answer || "").trim();
    if (q.length < 3 || a.length < 1 || a.length > 4000) continue;
    const key = q.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!key) continue;
    // If the same key shows up twice in the batch (rare but possible),
    // keep the longer answer.
    if (cleaned[key] && cleaned[key].length >= a.length) continue;
    cleaned[key] = a;
  }
  if (Object.keys(cleaned).length === 0) {
    res.json({ ok: true, learned: 0 });
    return;
  }

  try {
    // Read existing cache, then write back with the per-key length-aware
    // merge. We can't do this in pure SQL because we want to compare the
    // existing value's length against the incoming one before deciding
    // to overwrite - JSONB doesn't have a "max-by-length" operator.
    const rows = await sql<any[]>`
      SELECT custom_answers FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    const existing: Record<string, string> = (rows[0]?.custom_answers as any) || {};
    const merged: Record<string, string> = { ...existing };
    for (const [k, v] of Object.entries(cleaned)) {
      const prev = existing[k];
      if (typeof prev === "string" && prev.length > v.length) continue;
      merged[k] = v;
    }
    await sql`
      INSERT INTO apply_profiles (user_id, custom_answers, updated_at)
      VALUES (${userId}, ${sql.json(merged)}, NOW())
      ON CONFLICT (user_id) DO UPDATE
         SET custom_answers = ${sql.json(merged)}, updated_at = NOW()
    `;
    res.json({ ok: true, learned: Object.keys(cleaned).length });
  } catch (err: any) {
    console.error("[POST /api/apply/learn]", err?.message || err);
    res.status(500).json({ error: "Could not save to profile bank" });
  }
});

// ─── DELETE /api/apply/answer-cache ─────────────────────────────────────
//
// Manual reset for the user when an old cached answer goes stale (they
// changed jobs, updated their story, etc.). Body: { key?: string } -
// passing a key clears one entry, omitting it clears all.
router.delete("/answer-cache", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const key = String((req.body || {}).key || "").trim();
  try {
    if (key) {
      const cacheKey = key.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      await sql`
        UPDATE apply_profiles
           SET custom_answers = (COALESCE(custom_answers, '{}'::jsonb)) - ${cacheKey},
               updated_at = NOW()
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        UPDATE apply_profiles SET custom_answers = '{}'::jsonb, updated_at = NOW()
         WHERE user_id = ${userId}
      `;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[DELETE /api/apply/answer-cache]", err?.message || err);
    res.status(500).json({ error: "Cache clear failed" });
  }
});

// ─── POST /api/apply/assistant-text ─────────────────────────────────────
//
// Personalised text generator for the extension's in-popup AI assistant.
// The user has a resume and apply_profile already on file, so each call
// stays compact: the caller sends an action type plus pasted context
// (JD, LinkedIn post, recipient profile) and gets back a short, voice-
// matched draft without re-uploading anything.
//
// Action types:
//   - "followup"            recruiter / hiring-manager follow-up email
//   - "linkedin_connect"    short note attached to a LinkedIn connect request
//   - "linkedin_comment"    insightful comment on someone's post
//   - "referral_request"    asking a connection for a genuine referral
//   - "cold_outreach"       cold message to a hiring manager / engineer
//   - "thank_you"           post-interview thank-you note
//   - "custom"              caller supplies a freeform instruction
//
// Style contract (enforced via prompt):
//   - short, precise, personalised
//   - no em-dashes (the user has a hard rule against them)
//   - no AI-slop openers ("I am writing to", "I hope this finds you well")
//   - no "leverage", "synergy", "circle back", "delve"
//   - first-person, warm but professional
const ASSISTANT_ACTION_TYPES = new Set([
  "followup", "linkedin_connect", "linkedin_comment",
  "referral_request", "cold_outreach", "thank_you", "custom",
]);

router.post("/assistant-text", answerLimiter, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    actionType,
    context,
    recipientName,
    recipientRole,
    customInstruction,
    targetCompany,
    targetRole,
  } = req.body || {};

  const action = String(actionType || "").trim();
  if (!ASSISTANT_ACTION_TYPES.has(action)) {
    res.status(400).json({ error: "Unknown actionType" });
    return;
  }
  const ctxText = String(context || "").trim();
  if (action !== "custom" && !ctxText && action !== "followup") {
    res.status(400).json({ error: "Paste the JD / post / profile so the assistant has something to ground the reply in." });
    return;
  }
  if (ctxText.length > 6000) {
    res.status(400).json({ error: "Context too long (max 6000 chars). Trim it down to the relevant bits." });
    return;
  }
  if (action === "custom" && !String(customInstruction || "").trim()) {
    res.status(400).json({ error: "Custom action needs a customInstruction telling it what to write." });
    return;
  }

  try {
    const profileRows = await sql<any[]>`
      SELECT * FROM apply_profiles WHERE user_id = ${userId} LIMIT 1
    `;
    const profile = profileRows[0];

    // Resume text is optional. If the user hasn't uploaded one yet the
    // assistant still works on profile fields alone, just with less
    // grounding. We hard-cap to a budget to keep the prompt cheap.
    let resumeText = "";
    try {
      const r = await downloadResumeText(userId);
      resumeText = (r || "").slice(0, 4000);
    } catch { /* missing resume is fine; profile fields fill the gap */ }

    const profileBrief = profile
      ? [
          profile.full_name && `Name: ${profile.full_name}`,
          profile.years_experience != null && `Years experience: ${profile.years_experience}`,
          profile.highest_degree && `Degree: ${profile.highest_degree}`,
          profile.university && `University: ${profile.university}`,
          profile.why_interested && `Career motivation: ${profile.why_interested}`,
          profile.greatest_achievement && `Top achievement: ${profile.greatest_achievement}`,
          profile.problem_solved && `Sample problem solved: ${profile.problem_solved}`,
          profile.unique_strength && `Differentiator: ${profile.unique_strength}`,
        ].filter(Boolean).join("\n")
      : "";

    if (!profileBrief && !resumeText) {
      res.status(400).json({
        error: "Set up your apply profile (or upload a resume) first so the assistant has something to personalise from.",
        needsProfile: true,
      });
      return;
    }

    const openai = getOpenAI();
    if (!openai) {
      res.status(500).json({ error: "AI is not configured on the server" });
      return;
    }

    const actionRule = buildAssistantActionRule(action, {
      recipientName: String(recipientName || "").trim(),
      recipientRole: String(recipientRole || "").trim(),
      targetCompany: String(targetCompany || "").trim(),
      targetRole: String(targetRole || "").trim(),
      customInstruction: String(customInstruction || "").trim(),
    });

    // System prompt is built from the humanizer SKILL.md ban list (Wikipedia's
    // "Signs of AI writing") so that the model knows the exact patterns to
    // avoid. The previous version produced obvious AI-isms like "hands-on,
    // data-driven decision-making" — the new prompt names those tells
    // explicitly so the model recognises them as forbidden, not just
    // unfashionable.
    const system = [
      "You are the candidate's personal writing assistant.",
      "Your only job: produce SHORT, SPECIFIC, HUMAN-SOUNDING messages in the candidate's voice.",
      "",
      "## Hard style contract (break any of these and the output is wrong)",
      "",
      "1. NO em-dashes (—) anywhere. Use a comma, period, colon, or split sentences. None of: en-dash (–), two hyphens (--).",
      "2. NO curly quotes. Use straight quotes only.",
      "3. NO AI-slop openers. Banned: 'I am writing to', 'I am reaching out', 'I wanted to reach out', 'I hope this finds you well', 'I came across your profile', 'Hope you are well', 'Great question', 'Hope you don't mind'.",
      "4. NO sycophantic / servile praise. Banned: 'huge fan', 'absolutely love', 'truly impressive', 'incredible work', 'amazing post', 'great insights', 'this resonates'.",
      "5. NO generic positive conclusions. Banned: 'exciting times ahead', 'looking forward to the journey', 'eager to contribute'.",
      "6. NO AI vocabulary. Banned (case-insensitive, applies to all forms): leverage, synergy, circle back, delve, holistic, ecosystem, navigate, foster, embark, journey, robust, cutting-edge, paradigm, hands-on, data-driven decision-making, results-driven, results-oriented, passionate about, deeply committed, proven track record, dynamic, vibrant, seamless, intuitive, transformative, groundbreaking, pivotal, intricate, intricacies, tapestry, testament, underscore, underscoring, highlight (as a verb), align with, alignment, additionally, furthermore, moreover, in today's fast-paced world.",
      "7. NO superficial -ing analyses. Banned tails: 'highlighting...', 'underscoring...', 'reflecting...', 'symbolizing...', 'contributing to...', 'fostering...', 'showcasing...', 'emphasizing...', 'ensuring...'.",
      "8. NO copula avoidance. Use 'is' / 'are' / 'has'. Banned substitutes: 'serves as', 'stands as', 'functions as', 'represents a', 'marks a', 'boasts'.",
      "9. NO negative parallelism. Banned: 'It's not just X, it's Y', 'Not only... but also...'.",
      "10. NO rule-of-three slogans. Banned: triplets like 'precise, scalable, and impactful' or 'innovation, inspiration, and insight'.",
      "11. NO elegant variation. If you mean 'the team', say 'the team' the next time too. Don't cycle 'the team / the group / the squad / the org'.",
      "12. NO weasel attributions. Don't write 'industry experts agree', 'studies show', 'many believe'.",
      "13. NO filler. 'In order to' → 'to'. 'At this point in time' → 'now'. 'Due to the fact that' → 'because'. 'Has the ability to' → 'can'.",
      "14. NO hedging stacks. Banned: 'could potentially possibly', 'might be able to maybe'.",
      "15. NO knowledge-cutoff disclaimers. Banned: 'as of my last update', 'while specific details are limited'.",
      "16. NO emojis, NO bold, NO headers, NO bullet lists unless the medium absolutely requires it (it usually doesn't).",
      "17. NO meta-talk. Don't write 'Here is the draft', 'Let me know if you want me to adjust'. Output only the message.",
      "",
      "## Voice contract (positive rules)",
      "",
      "- First person, warm, plain English. Sound like the candidate would actually talk over coffee.",
      "- Use everyday vocabulary by default. Reach for a technical term ONLY when it carries real weight — and then use ONE precise term, not three near-synonyms.",
      "- Be specific. Name one concrete detail from the pasted context AND one concrete detail from the candidate's resume / profile. Generic praise is worse than no praise.",
      "- Vary sentence length. Mix short punchy ones with one slightly longer one. Not every sentence the same shape.",
      "- Acknowledge real things. If something is uncertain, say so plainly. Don't pad with confidence theatre.",
      "- One idea per sentence. No long buildups. Get to the point.",
      "- Show a hint of a real person: an opinion, a small specific reaction, a concrete reason. Not a press release.",
      "- Stay within the length budget of the action. Better to be 2 sentences short than 2 sentences long.",
      "",
      "## Final self-check (silent, before output)",
      "",
      "Before you output, audit your draft against this list:",
      "- Does it contain ANY banned word or phrase above? If yes, rewrite that line in plain English.",
      "- Does any sentence start with 'I am writing' or 'I hope' or 'I wanted'? Cut it.",
      "- Are there em-dashes? Replace each with a comma or period.",
      "- Does it sound like a press release or a LinkedIn bio? Rewrite.",
      "- Does it reference at least one specific detail from the pasted context? If not, you don't have enough material — write the shortest honest version.",
      "",
      "## Candidate profile",
      profileBrief || "(none on file)",
      resumeText ? `\n## Resume excerpt (truncated to 4000 chars)\n${resumeText}` : "",
    ].join("\n");

    const user = [
      `Action: ${action}`,
      actionRule,
      ctxText ? `\nContext the candidate pasted:\n"""\n${ctxText}\n"""` : "",
      "",
      "Write the message now. Output only the message body.",
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: APPLY_CHAT_MODEL,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    let text = (completion.choices[0]?.message?.content || "").trim();
    text = scrubAiArtifacts(text);

    // If after scrubbing the text still looks like a press release (very
    // few sentences with mostly banned-word density), regenerate ONCE
    // with a stronger reminder. Belt-and-braces: the prompt should have
    // caught it, but gpt-4o-mini occasionally regresses on the second
    // request in a row.
    if (containsBannedPhrases(text)) {
      const retry = await openai.chat.completions.create({
        model: APPLY_CHAT_MODEL,
        temperature: 0.6,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
          {
            role: "user",
            content:
              "That draft contains banned phrases (em-dashes, AI-slop openers, or words like 'hands-on / data-driven / passionate about / leverage'). Rewrite it now from scratch with NONE of those, keeping the same length budget and the same specific details. Output only the new message.",
          },
        ],
      });
      const retryText = (retry.choices[0]?.message?.content || "").trim();
      if (retryText) text = scrubAiArtifacts(retryText);
    }

    res.json({ text, action });
  } catch (err: any) {
    console.error("[POST /api/apply/assistant-text]", err?.message || err);
    res.status(500).json({ error: err?.message || "Assistant generation failed" });
  }
});

/**
 * Strip the obvious AI tells the model occasionally smuggles past the
 * system prompt. Replaces em-dashes/en-dashes with commas, removes
 * wrapper quotes/code fences, normalises curly quotes, and trims
 * meta-talk like "Here is the draft:" or "Let me know if you want...".
 *
 * We intentionally do NOT delete banned WORDS (leverage, holistic, etc.)
 * — replacing them silently would break the sentence. The retry path
 * regenerates the whole message instead. This scrub only fixes
 * punctuation and shell.
 */
function scrubAiArtifacts(input: string): string {
  let text = input;
  text = text.replace(/[—–]/g, ", ");
  text = text.replace(/--/g, ", ");
  text = text.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  text = text.replace(/^\s*(here(?:'s| is)\s+(?:the\s+)?(?:draft|message|text|note)[:\-]?\s*)/i, "");
  text = text.replace(/\n*\s*let me know if (?:you|there)[^\n]*$/i, "").trim();
  text = text.replace(/\n*\s*hope this helps[^\n]*$/i, "").trim();
  text = text.replace(/[ \t]+,/g, ",").replace(/,{2,}/g, ",").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

const BANNED_PHRASE_REGEX = new RegExp(
  [
    "\\b(?:hands-on|data-driven decision)\\b",
    "\\b(?:results-driven|results-oriented|passionate about|deeply committed)\\b",
    "\\bproven track record\\b",
    "\\bin today's fast-paced\\b",
    "\\b(?:leverage|leveraging|leverages)\\b",
    "\\b(?:synergy|synergistic|synergies)\\b",
    "\\b(?:delve|delves|delving|delved)\\b",
    "\\bholistic\\b",
    "\\b(?:foster|fostering|fostered)\\b",
    "\\bembark(?:ing|ed)?\\b",
    "\\b(?:robust|cutting-edge|paradigm|seamless|intuitive|transformative|groundbreaking|pivotal)\\b",
    "\\b(?:tapestry|testament|underscore|underscoring|underscores)\\b",
    "\\b(?:additionally|moreover|furthermore)\\b",
    "i am writing to",
    "i am reaching out",
    "i hope this finds you well",
    "i wanted to reach out",
    "i came across your profile",
    "great question",
    "huge fan",
    "this resonates",
    "—",
  ].join("|"),
  "i"
);

function containsBannedPhrases(text: string): boolean {
  return BANNED_PHRASE_REGEX.test(text);
}

interface AssistantActionInputs {
  recipientName: string;
  recipientRole: string;
  targetCompany: string;
  targetRole: string;
  customInstruction: string;
}

function buildAssistantActionRule(action: string, x: AssistantActionInputs): string {
  const who = x.recipientName
    ? `Address it to ${x.recipientName}${x.recipientRole ? ` (${x.recipientRole})` : ""}.`
    : "Use a neutral greeting (no name) if no recipient is named.";
  const co = x.targetCompany ? `Target company: ${x.targetCompany}.` : "";
  const role = x.targetRole ? `Target role: ${x.targetRole}.` : "";

  switch (action) {
    case "followup":
      return [
        "Write a recruiter / hiring-manager follow-up email.",
        "3 to 5 short sentences. Reference one specific detail (a project, the JD, a recent post) so it does not read as a template.",
        "End with a soft ask (timeline check, next steps, brief chat).",
        who, co, role,
      ].filter(Boolean).join("\n");
    case "linkedin_connect":
      return [
        "Write a LinkedIn connection-request note. STRICT 280-character limit.",
        "Open with one genuine, specific reason for connecting (their work, a post, a shared interest).",
        "Mention what the candidate brings or is looking for in one short line. End warmly. No 'I would love to'.",
        who, co, role,
      ].filter(Boolean).join("\n");
    case "linkedin_comment":
      return [
        "Write an INSIGHTFUL comment on the LinkedIn post in the context.",
        "2 to 3 sentences. Add a real perspective the candidate has earned the right to share (a project, a result, a counterpoint).",
        "Do NOT start with 'Great post' or 'This resonates'. Lead with the idea.",
        "Sound like a peer, not a fan.",
      ].filter(Boolean).join("\n");
    case "referral_request":
      return [
        "Write a SHORT message asking for a genuine referral.",
        "4 short sentences max: who the candidate is in one line, the role they want, one specific reason this person's referral matters, a low-pressure ask.",
        "Acknowledge that a referral is a favour and offer to send anything that makes it easy (resume, blurb).",
        who, co, role,
      ].filter(Boolean).join("\n");
    case "cold_outreach":
      return [
        "Write a cold outreach message to a hiring manager or engineer on the team.",
        "4 short sentences: one line of credible signal about the candidate, one specific tie to the company or role, a one-line ask, a graceful close.",
        "No flattery. No 'I am a huge fan'. Earn the reply.",
        who, co, role,
      ].filter(Boolean).join("\n");
    case "thank_you":
      return [
        "Write a post-interview thank-you note.",
        "3 to 4 sentences. Reference one specific topic that came up in the interview. Reinforce one concrete strength the candidate brings to that topic.",
        "End with quiet confidence, not a hard ask.",
        who, co, role,
      ].filter(Boolean).join("\n");
    case "custom":
      return [
        `Follow this custom instruction from the candidate exactly: "${x.customInstruction}".`,
        "Keep it SHORT and personalised to the context. Apply all the global style rules.",
        who, co, role,
      ].filter(Boolean).join("\n");
    default:
      return "Write something short, specific, and personal.";
  }
}

export default router;
