import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { parseSalary, rangesOverlap } from "../services/salary";

/**
 * Realtime Job Matching.
 * ──────────────────────
 * Surfaces the user's best-matching jobs from the already-scored `jobs`
 * table, aligned to their apply profile (target salary + city). The AI
 * relevance scoring happens in the pipeline; this route is the curated
 * read-side surface over it. The client polls it (hourly + on open), which
 * is where "refreshed hourly" comes from for the surfacing layer; the
 * underlying scrape+score cadence is still the pipeline.
 *
 * GET /api/job-matches?min=7&limit=50
 *   -> { matches: [...], profile: {...}, generated_at }
 */

const router = Router();
router.use(requireAuth);

interface MatchRow {
  id: number;
  job_title: string;
  company_name: string;
  location: string | null;
  salary: string | null;
  seniority_level: string | null;
  match_score: number | null;
  match_reason: string | null;
  detected_role_type: string | null;
  score_breakdown: string | null;
  apply_url: string | null;
  job_link: string | null;
  status: string;
  posted_at: string | null;
}

function letterGrade(scoreBreakdown: string | null): string {
  if (!scoreBreakdown) return "";
  try {
    return String(JSON.parse(scoreBreakdown)?.letter_grade || "").toUpperCase();
  } catch {
    return "";
  }
}

// ─── GET /api/job-matches ────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  // Default threshold of 6/10 keeps the list to genuinely relevant roles.
  const minScore = Math.min(10, Math.max(0, parseInt((req.query.min as string) || "6", 10) || 0));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10) || 50));

  try {
    // The user's salary + city targets, used for alignment flags.
    const profileRows = await sql<{
      salary_min: number | null;
      salary_max: number | null;
      salary_currency: string | null;
      city: string | null;
    }[]>`
      SELECT salary_min, salary_max, salary_currency, city
        FROM apply_profiles
       WHERE user_id = ${userId}
       LIMIT 1
    `;
    const profile = profileRows[0] || {
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      city: null,
    };
    const cityLower = (profile.city || "").trim().toLowerCase();

    // Curated matches: scored jobs at or above the threshold, freshest of
    // the best first. We exclude rejected/expired so the list is actionable.
    const rows = await sql<MatchRow[]>`
      SELECT id, job_title, company_name, location, salary, seniority_level,
             match_score, match_reason, detected_role_type, score_breakdown,
             apply_url, job_link, status, posted_at
        FROM jobs
       WHERE user_id = ${userId}
         AND match_score IS NOT NULL
         AND match_score >= ${minScore}
         AND status <> 'rejected'
         AND (expired IS NULL OR expired = 0)
       ORDER BY match_score DESC NULLS LAST, posted_at DESC NULLS LAST
       LIMIT ${limit}
    `;

    const matches = rows.map((r) => {
      const parsed = parseSalary(r.salary);
      const salaryFit =
        parsed !== null &&
        (profile.salary_min !== null || profile.salary_max !== null) &&
        rangesOverlap(parsed.min, parsed.max, profile.salary_min, profile.salary_max);
      const locLower = (r.location || "").toLowerCase();
      const cityFit = cityLower.length > 0 && locLower.includes(cityLower);
      return {
        id: r.id,
        job_title: r.job_title,
        company_name: r.company_name,
        location: r.location,
        salary: r.salary,
        seniority_level: r.seniority_level,
        match_score: r.match_score,
        match_reason: r.match_reason,
        detected_role_type: r.detected_role_type,
        letter_grade: letterGrade(r.score_breakdown),
        apply_url: r.apply_url,
        job_link: r.job_link,
        status: r.status,
        posted_at: r.posted_at,
        salary_fit: salaryFit,
        city_fit: cityFit,
      };
    });

    res.json({
      matches,
      profile: {
        salary_min: profile.salary_min,
        salary_max: profile.salary_max,
        salary_currency: profile.salary_currency || "USD",
        city: profile.city || null,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[GET /api/job-matches]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
