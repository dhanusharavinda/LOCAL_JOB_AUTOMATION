import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { summarizeSalaries, SalaryBenchmark } from "../services/salary";

/**
 * AI Career Coach.
 * ────────────────
 * Produces a roadmap (positioning summary, skill gaps, learning plan,
 * salary benchmark, next actions) grounded in the user's own data:
 *   - their default resume (resume_profiles.is_default),
 *   - their scored jobs (match_score + detected_role_type + salary),
 *   - the latest skill snapshot (in-demand skills from scraped JDs).
 *
 * GET  /api/career-coach           -> latest stored roadmap (or null)
 * POST /api/career-coach/generate  -> build a fresh roadmap, store, return
 *
 * The salary benchmark is computed deterministically in code (see
 * services/salary.ts) and handed to the model as ground truth so the
 * dollar figures are never hallucinated; the model only adds a short note.
 */

const router = Router();
router.use(requireAuth);

const COACH_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  return new OpenAI({ apiKey, baseURL, maxRetries: 2 });
}

/**
 * Belt-and-suspenders: create career_roadmaps on first use so the feature
 * works even on a deploy where migration 0007 hasn't been applied yet.
 * Migration 0007 is the canonical definition (it also adds the FK + RLS
 * policy); this fallback only guarantees the table exists. Cached after
 * the first successful run so we don't issue the DDL on every request.
 */
let roadmapTableReady = false;
async function ensureRoadmapTable(): Promise<void> {
  if (roadmapTableReady) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS career_roadmaps (
        user_id          uuid primary key,
        role_target      text,
        summary          text,
        skill_gaps       jsonb not null default '[]'::jsonb,
        learning_plan    jsonb not null default '[]'::jsonb,
        salary_benchmark jsonb,
        action_items     jsonb not null default '[]'::jsonb,
        generated_at     timestamptz not null default now()
      )
    `;
    roadmapTableReady = true;
  } catch (err: any) {
    console.error("[career-coach] ensureRoadmapTable failed:", err?.message || err);
  }
}

interface RoadmapRow {
  role_target: string | null;
  summary: string | null;
  skill_gaps: any;
  learning_plan: any;
  salary_benchmark: any;
  action_items: any;
  generated_at: string;
}

function shapeRoadmap(row: RoadmapRow | undefined) {
  if (!row) return null;
  return {
    role_target: row.role_target || "",
    summary: row.summary || "",
    skill_gaps: Array.isArray(row.skill_gaps) ? row.skill_gaps : [],
    learning_plan: Array.isArray(row.learning_plan) ? row.learning_plan : [],
    salary_benchmark: row.salary_benchmark || null,
    action_items: Array.isArray(row.action_items) ? row.action_items : [],
    generated_at: row.generated_at,
  };
}

/** The user's default resume text (falls back to the most recent one). */
async function getDefaultResumeText(userId: string): Promise<string | null> {
  try {
    const rows = await sql<{ resume_text: string }[]>`
      SELECT resume_text
        FROM resume_profiles
       WHERE user_id = ${userId} AND resume_text IS NOT NULL AND resume_text <> ''
       ORDER BY is_default DESC, updated_at DESC
       LIMIT 1
    `;
    return rows[0]?.resume_text?.slice(0, 12000) || null;
  } catch {
    return null;
  }
}

// ─── GET /api/career-coach ───────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    await ensureRoadmapTable();
    const rows = await sql<RoadmapRow[]>`
      SELECT role_target, summary, skill_gaps, learning_plan,
             salary_benchmark, action_items, generated_at
        FROM career_roadmaps
       WHERE user_id = ${userId}
       LIMIT 1
    `;
    res.json({ roadmap: shapeRoadmap(rows[0]) });
  } catch (err: any) {
    console.error("[GET /api/career-coach]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/career-coach/generate ─────────────────────────────────
router.post("/generate", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const resumeText = await getDefaultResumeText(userId);
  if (!resumeText || resumeText.length < 50) {
    res.status(422).json({
      error:
        "Add your resume first (Auto-Apply profile or a resume profile) so the coach has something to work from.",
    });
    return;
  }

  try {
    // ── Gather grounding data from the user's scored jobs ──
    const jobRows = await sql<{
      detected_role_type: string | null;
      match_score: number | null;
      salary: string | null;
      match_reason: string | null;
      seniority_level: string | null;
    }[]>`
      SELECT detected_role_type, match_score, salary, match_reason, seniority_level
        FROM jobs
       WHERE user_id = ${userId}
       ORDER BY match_score DESC NULLS LAST
       LIMIT 400
    `;

    // Inferred target role = most common detected_role_type among scored jobs.
    const roleCounts = new Map<string, number>();
    for (const j of jobRows) {
      const r = (j.detected_role_type || "").trim();
      if (r) roleCounts.set(r, (roleCounts.get(r) || 0) + 1);
    }
    const inferredRole =
      [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    // Salary benchmark from the user's scored jobs (deterministic, grounded).
    const salaryBenchmark: SalaryBenchmark | null = summarizeSalaries(
      jobRows.map((j) => j.salary),
    );

    // Average match score + a few representative match reasons for context.
    const scored = jobRows.filter((j) => typeof j.match_score === "number");
    const avgMatch =
      scored.length > 0
        ? Math.round(
            (scored.reduce((s, j) => s + (j.match_score || 0), 0) / scored.length) * 10,
          ) / 10
        : null;
    const sampleReasons = jobRows
      .map((j) => (j.match_reason || "").trim())
      .filter(Boolean)
      .slice(0, 8);

    // In-demand market skills from the latest skill snapshot, if any.
    let marketSkills: string[] = [];
    try {
      const snap = await sql<{ skills_json: any }[]>`
        SELECT skills_json FROM skill_snapshots
         WHERE user_id = ${userId}
         ORDER BY date DESC
         LIMIT 1
      `;
      const skillsJson = snap[0]?.skills_json;
      if (skillsJson && typeof skillsJson === "object") {
        marketSkills = Object.entries(skillsJson as Record<string, number>)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 25)
          .map(([skill]) => skill);
      }
    } catch {
      /* skill snapshot is optional */
    }

    const openai = getOpenAI();
    if (!openai) {
      res.status(503).json({ error: "AI service is not configured on the server." });
      return;
    }

    const benchmarkLine = salaryBenchmark
      ? `Computed salary benchmark from ${salaryBenchmark.sample_size} of the user's scored jobs (use these EXACT numbers, do not invent others): ${salaryBenchmark.currency} ${salaryBenchmark.low.toLocaleString()} (p25) / ${salaryBenchmark.median.toLocaleString()} (median) / ${salaryBenchmark.high.toLocaleString()} (p75).`
      : "Not enough parseable salary data in the user's jobs to compute a benchmark. Set salary_note to acknowledge that and do not invent figures.";

    const systemPrompt = `You are a precise, grounded career coach. You produce an actionable roadmap for ONE candidate based ONLY on the facts provided. You never invent employers, certifications, or salary figures. Output strictly valid JSON, no markdown, no backticks.

Hard rules:
- Ground every skill gap and learning suggestion in the gap between the candidate's resume and the in-demand market skills provided. If a skill is already clearly on the resume, it is NOT a gap.
- Never recommend lying on a resume or fabricating experience.
- Do not use em dashes. Use commas, periods, or colons.
- Avoid AI-slop words: leverage, delve, robust, dynamic, passionate, results-driven, synergy, transformative, cutting-edge, pivotal, foster, showcase.
- Keep it specific and short. Real resource names where you know them (e.g. "AWS Skill Builder", "dbt Fundamentals course"), otherwise describe the type of resource.

Return this exact JSON shape:
{
  "role_target": "the single role the roadmap targets",
  "summary": "2-3 sentences positioning the candidate for that role, in their own framing",
  "skill_gaps": [ { "skill": "", "why": "one line: why it matters for this role", "priority": "high" | "medium" | "low" } ],
  "learning_plan": [ { "title": "", "detail": "one or two lines", "resource": "a concrete resource or resource type", "timeframe": "e.g. 2 weeks" } ],
  "action_items": [ "concrete next step", "concrete next step" ],
  "salary_note": "one short sentence interpreting the salary benchmark for this candidate, or acknowledging there isn't enough data"
}

Limits: at most 6 skill_gaps, at most 6 learning_plan items, at most 5 action_items.`;

    const userPrompt = `TARGET ROLE (inferred from the user's tracked jobs): ${inferredRole || "infer the best single role from the resume"}

IN-DEMAND MARKET SKILLS (from the job descriptions this user has scraped, most frequent first):
${marketSkills.length ? marketSkills.join(", ") : "(no skill snapshot available yet)"}

USER SIGNAL:
- Average AI match score across ${scored.length} scored jobs: ${avgMatch ?? "n/a"} / 10
- Representative match reasons:
${sampleReasons.length ? sampleReasons.map((r) => `  - ${r}`).join("\n") : "  (none)"}

${benchmarkLine}

CANDIDATE RESUME:
${resumeText}

Produce the roadmap JSON now. Respond with ONLY the JSON object.`;

    const completion = await openai.chat.completions.create({
      model: COACH_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 1600,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: "AI returned invalid JSON. Please try again." });
      return;
    }

    const roleTarget =
      (typeof parsed.role_target === "string" && parsed.role_target.trim()) ||
      inferredRole ||
      "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const skillGaps = Array.isArray(parsed.skill_gaps) ? parsed.skill_gaps.slice(0, 6) : [];
    const learningPlan = Array.isArray(parsed.learning_plan)
      ? parsed.learning_plan.slice(0, 6)
      : [];
    const actionItems = Array.isArray(parsed.action_items)
      ? parsed.action_items.slice(0, 5).filter((s: any) => typeof s === "string")
      : [];

    // Merge the deterministic benchmark with the model's interpretive note.
    const salaryOut = salaryBenchmark
      ? {
          role: roleTarget,
          currency: salaryBenchmark.currency,
          low: salaryBenchmark.low,
          median: salaryBenchmark.median,
          high: salaryBenchmark.high,
          sample_size: salaryBenchmark.sample_size,
          note: typeof parsed.salary_note === "string" ? parsed.salary_note.trim() : "",
        }
      : null;

    await ensureRoadmapTable();
    await sql`
      INSERT INTO career_roadmaps (
        user_id, role_target, summary, skill_gaps, learning_plan, salary_benchmark, action_items, generated_at
      ) VALUES (
        ${userId}, ${roleTarget}, ${summary},
        ${sql.json(skillGaps)}, ${sql.json(learningPlan)},
        ${salaryOut ? sql.json(salaryOut) : null}, ${sql.json(actionItems)}, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        role_target = EXCLUDED.role_target,
        summary = EXCLUDED.summary,
        skill_gaps = EXCLUDED.skill_gaps,
        learning_plan = EXCLUDED.learning_plan,
        salary_benchmark = EXCLUDED.salary_benchmark,
        action_items = EXCLUDED.action_items,
        generated_at = EXCLUDED.generated_at
    `;

    res.json({
      roadmap: {
        role_target: roleTarget,
        summary,
        skill_gaps: skillGaps,
        learning_plan: learningPlan,
        salary_benchmark: salaryOut,
        action_items: actionItems,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[POST /api/career-coach/generate]", err?.message || err);
    res.status(500).json({ error: "Something went wrong building your roadmap. Please try again." });
  }
});

export default router;
