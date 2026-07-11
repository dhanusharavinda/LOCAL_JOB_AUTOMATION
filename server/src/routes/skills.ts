import { Router, Request, Response } from "express";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";

/**
 * Skills routes (Postgres edition).
 * Every query is scoped to the caller's user_id. The old SQLite version
 * had THREE live cross-tenant data leaks (trend, snapshot, and the archive
 * cleanup); those are structurally impossible now.
 */

const router = Router();

// ─── GET /api/skills/trend ───────────────────────────────────────────
router.get("/trend", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const limit = Math.min(parseInt((req.query.limit as string) || "30", 10), 90);

  try {
    const rows = await sql<{ date: string; total_jobs: number; skills_json: any }[]>`
      SELECT to_char(date, 'YYYY-MM-DD') AS date, total_jobs, skills_json
        FROM skill_snapshots
       WHERE user_id = ${userId}
       ORDER BY date DESC
       LIMIT ${limit}
    `;
    const snapshots = rows.map((r) => ({
      date: r.date,
      total_jobs: r.total_jobs,
      skills: r.skills_json ?? {},
    }));
    res.json({ snapshots: snapshots.reverse() });
  } catch (err: any) {
    console.error("[GET /api/skills/trend]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/skills/snapshot ───────────────────────────────────────
// Pipeline calls this at the end of each run. Upsert by (user_id, date).
router.post("/snapshot", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { date, total_jobs, skills } = req.body;
  if (!date || !skills) {
    res.status(400).json({ error: "date and skills are required" });
    return;
  }
  try {
    await sql`
      INSERT INTO skill_snapshots (user_id, date, total_jobs, skills_json)
      VALUES (${userId}, ${date}, ${total_jobs || 0}, ${sql.json(skills)})
      ON CONFLICT (user_id, date) DO UPDATE
        SET total_jobs = EXCLUDED.total_jobs,
            skills_json = EXCLUDED.skills_json
    `;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[POST /api/skills/snapshot]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// Predefined skills list for tokenization
const SKILLS = [
  "python", "sql", "r", "scala", "java", "javascript", "typescript", "go",
  "spark", "hadoop", "kafka", "airflow", "dbt", "snowflake", "databricks",
  "aws", "azure", "gcp", "terraform", "docker", "kubernetes",
  "tableau", "power bi", "looker", "excel",
  "machine learning", "deep learning", "nlp", "llm", "pytorch", "tensorflow",
  "pandas", "numpy", "scikit-learn",
  "postgresql", "mysql", "mongodb", "redis", "bigquery",
  "react", "node.js", "fastapi", "flask", "django",
  "git", "ci/cd", "agile", "scrum",
  "data pipeline", "etl", "elt", "data warehouse", "data lake",
  "analytics", "statistics", "data visualization", "reporting",
];

// Pre-compiled word-boundary regexes for each skill. Short tokens like
// "r" and "go" must match as whole words - plain `.includes("r")` hits
// the letter "r" inside "required", "experience", etc. and falsely puts
// R-language at the top of every dashboard.
const SKILL_PATTERNS: RegExp[] = SKILLS.map((s) => {
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-zA-Z/])${escaped}(?![a-zA-Z/])`, "i");
});

// ─── GET /api/skills/current ─────────────────────────────────────────
// Top skills extracted from the user's scraped job descriptions.
router.get("/current", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const source = (req.query.source as string) || "archive";
  const role = (req.query.role as string) || "";
  const location = (req.query.location as string) || "";
  const company = (req.query.company as string) || "";

  try {
    // We UNION across scraped_jobs_archive + jobs so a fresh user who's
    // only manually added jobs still sees data.
    const rolePattern = role ? `%${role.toLowerCase()}%` : null;
    const locPattern = location ? `%${location.toLowerCase()}%` : null;
    const companyPattern = company ? `%${company.toLowerCase()}%` : null;

    const archiveRows = await sql<{ description: string }[]>`
      SELECT description FROM scraped_jobs_archive
       WHERE user_id = ${userId}
         AND description IS NOT NULL
         AND description <> ''
         ${rolePattern ? sql`AND LOWER(job_title) LIKE ${rolePattern}` : sql``}
         ${locPattern ? sql`AND LOWER(location) LIKE ${locPattern}` : sql``}
         ${companyPattern ? sql`AND LOWER(company_name) LIKE ${companyPattern}` : sql``}
       ORDER BY scraped_at DESC
       LIMIT 2000
    `;

    const jobRows = source === "archive"
      ? await sql<{ description: string }[]>`
          SELECT description FROM jobs
           WHERE user_id = ${userId}
             AND description IS NOT NULL
             AND description <> ''
             ${rolePattern ? sql`AND LOWER(job_title) LIKE ${rolePattern}` : sql``}
             ${locPattern ? sql`AND LOWER(location) LIKE ${locPattern}` : sql``}
             ${companyPattern ? sql`AND LOWER(company_name) LIKE ${companyPattern}` : sql``}
           LIMIT 500
        `
      : [];

    const jobs = [...archiveRows, ...jobRows];

    const skillFreq: Record<string, number> = {};
    for (const job of jobs) {
      const text = job.description || "";
      for (let i = 0; i < SKILLS.length; i++) {
        if (SKILL_PATTERNS[i].test(text)) {
          skillFreq[SKILLS[i]] = (skillFreq[SKILLS[i]] || 0) + 1;
        }
      }
    }

    const sorted = Object.entries(skillFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([skill, count]) => ({
        skill,
        count,
        pct: Math.round((count / Math.max(jobs.length, 1)) * 100),
      }));

    res.json({ total_jobs: jobs.length, skills: sorted });
  } catch (err: any) {
    console.error("[GET /api/skills/current]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── GET /api/skills/filters ─────────────────────────────────────────
// Dropdown options for the Skills modal. Per-user, combined across
// scraped_jobs_archive + jobs so the dropdown reflects every company
// the user has touched.
router.get("/filters", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    // Role extraction pulls from both tables.
    const titleRows = await sql<{ title: string }[]>`
      SELECT LOWER(job_title) AS title FROM scraped_jobs_archive
        WHERE user_id = ${userId} AND job_title IS NOT NULL
      UNION ALL
      SELECT LOWER(job_title) AS title FROM jobs
        WHERE user_id = ${userId} AND job_title IS NOT NULL
    `;

    const roleKeywords = new Map<string, number>();
    // Cross-domain role patterns. The old list was tech-only (data /
    // software / devops) so a nurse or consultant's skills-trend filter
    // came up empty, making the feature unusable for them. This covers
    // tech, consulting, finance, legal, healthcare, education,
    // operations, marketing, sales, HR, design, research, engineering
    // disciplines, hospitality, retail, writing, and common seniority
    // markers. Multi-word patterns are checked first so "data analyst"
    // isn't double-counted as both "data" and "analyst".
    const ROLE_PATTERNS = [
      // Tech (existing)
      "data engineer", "data analyst", "data scientist", "analytics engineer",
      "bi analyst", "bi developer", "machine learning", "ml engineer", "ai engineer",
      "software engineer", "backend engineer", "frontend engineer", "full stack",
      "devops", "cloud engineer", "platform engineer", "site reliability",
      "python developer", "java developer", "product analyst", "business analyst",
      "database administrator", "etl developer", "data architect",
      "mobile developer", "ios developer", "android developer",
      "qa engineer", "test engineer", "security engineer", "cybersecurity",
      // Product / project / design
      "product manager", "product owner", "project manager", "program manager",
      "scrum master", "ux designer", "ui designer", "product designer", "graphic designer",
      // Consulting / strategy
      "management consultant", "strategy consultant", "business consultant",
      "associate consultant", "consultant", "strategist",
      // Finance / accounting
      "financial analyst", "investment analyst", "accountant", "auditor",
      "tax consultant", "actuary", "finance manager", "controller",
      // Legal
      "lawyer", "attorney", "solicitor", "paralegal", "legal counsel",
      // Healthcare
      "registered nurse", "staff nurse", "nurse practitioner", "doctor", "physician",
      "pharmacist", "physiotherapist", "occupational therapist", "healthcare assistant",
      // Education
      "teacher", "lecturer", "professor", "tutor", "instructor", "teaching assistant",
      // Operations / supply chain / logistics
      "operations manager", "supply chain", "logistics", "procurement",
      "warehouse manager", "fleet manager",
      // Marketing / sales
      "marketing manager", "marketing coordinator", "digital marketing", "growth marketing",
      "brand manager", "content writer", "copywriter", "seo specialist",
      "sales representative", "account executive", "account manager",
      "business development", "sales manager",
      // HR / recruiting
      "hr manager", "hr coordinator", "people operations", "talent acquisition",
      "recruiter", "hr business partner",
      // Engineering (non-software)
      "mechanical engineer", "electrical engineer", "civil engineer", "chemical engineer",
      // Hospitality / retail
      "hotel manager", "restaurant manager", "chef", "sous chef",
      "store manager", "retail associate", "buyer", "merchandiser",
      // Research / science
      "research scientist", "research analyst", "research associate",
      // Writing / content
      "technical writer", "editor", "journalist",
      // Early career
      "intern", "graduate program", "graduate scheme", "trainee",
    ];

    for (const row of titleRows) {
      for (const pattern of ROLE_PATTERNS) {
        if (row.title.includes(pattern)) {
          roleKeywords.set(pattern, (roleKeywords.get(pattern) || 0) + 1);
        }
      }
    }

    const roles = Array.from(roleKeywords.entries())
      .filter(([, count]) => count >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => ({
        label: role.replace(/\b\w/g, (c) => c.toUpperCase()),
        value: role,
        count,
      }));

    const locRows = await sql<{ location: string; total_cnt: string }[]>`
      SELECT location, SUM(cnt)::text AS total_cnt FROM (
        SELECT INITCAP(LOWER(location)) AS location, COUNT(*) AS cnt FROM scraped_jobs_archive
          WHERE user_id = ${userId} AND location IS NOT NULL AND location <> ''
          GROUP BY LOWER(location)
        UNION ALL
        SELECT INITCAP(LOWER(location)) AS location, COUNT(*) AS cnt FROM jobs
          WHERE user_id = ${userId} AND location IS NOT NULL AND location <> ''
          GROUP BY LOWER(location)
      ) AS combined
      GROUP BY location
      ORDER BY SUM(cnt) DESC
      LIMIT 50
    `;

    const locations = locRows.map((r) => ({
      label: r.location,
      value: r.location.toLowerCase(),
      count: parseInt(r.total_cnt, 10),
    }));

    const companyRows = await sql<{ company_name: string; total_cnt: string }[]>`
      SELECT company_name, SUM(cnt)::text AS total_cnt FROM (
        SELECT INITCAP(LOWER(company_name)) AS company_name, COUNT(*) AS cnt FROM scraped_jobs_archive
          WHERE user_id = ${userId} AND company_name IS NOT NULL AND company_name <> ''
          GROUP BY LOWER(company_name)
        UNION ALL
        SELECT INITCAP(LOWER(company_name)) AS company_name, COUNT(*) AS cnt FROM jobs
          WHERE user_id = ${userId} AND company_name IS NOT NULL AND company_name <> ''
          GROUP BY LOWER(company_name)
      ) AS combined
      GROUP BY company_name
      ORDER BY SUM(cnt) DESC
      LIMIT 200
    `;

    const companies = companyRows.map((r) => ({
      label: r.company_name,
      value: r.company_name.toLowerCase(),
      count: parseInt(r.total_cnt, 10),
    }));

    res.json({ roles, locations, companies });
  } catch (err: any) {
    console.error("[GET /api/skills/filters]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/skills/archive ────────────────────────────────────────
// Pipeline bulk-inserts every scraped job here for historical analysis.
// Conflict key is (user_id, content_hash) so reruns dedupe naturally.
router.post("/archive", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { jobs } = req.body;
  if (!Array.isArray(jobs)) {
    res.status(400).json({ error: "jobs must be an array" });
    return;
  }

  let inserted = 0;
  try {
    for (const job of jobs) {
      if (!job.title || !job.companyName) continue;
      const result = await sql`
        INSERT INTO scraped_jobs_archive (
          user_id, job_title, company_name, location, description, source, content_hash
        ) VALUES (
          ${userId}, ${job.title}, ${job.companyName},
          ${job.location || null}, ${job.description || null},
          ${job.source || null}, ${job.contentHash || null}
        )
        ON CONFLICT (user_id, content_hash) DO NOTHING
      `;
      if (result.count > 0) inserted++;
    }
    res.json({ inserted, total: jobs.length });
  } catch (err: any) {
    console.error("[POST /api/skills/archive]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
