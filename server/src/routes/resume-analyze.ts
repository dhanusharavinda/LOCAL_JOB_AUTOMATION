import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { downloadResumeText } from "../storage";

/**
 * Resume analyze routes (Postgres edition).
 * ATS keyword match + tailoring suggestions for a specific job vs. the
 * user's uploaded resume. All queries user-scoped.
 */

const router = Router();
router.use(requireAuth);

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, maxRetries: 2 });
}

// ─── POST /api/jobs/:id/analyze-resume ───────────────────────────────
// Generates an ATS score + keyword matches + suggestions for this job.
router.post("/:id/analyze-resume", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  try {
    // Load the job
    const jobRows = await sql<{
      id: number;
      job_title: string;
      company_name: string;
      description: string | null;
      ats_score: number | null;
      keyword_match_rate: number | null;
    }[]>`
      SELECT id, job_title, company_name, description, ats_score, keyword_match_rate
        FROM jobs
       WHERE id = ${id} AND user_id = ${userId}
       LIMIT 1
    `;
    if (jobRows.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = jobRows[0];
    if (!job.description) {
      res.status(400).json({ error: "Job has no description to analyze against" });
      return;
    }

    // Resume: either the user's default resume_profile or the uploaded resume text
    const profileRows = await sql<{ resume_text: string }[]>`
      SELECT resume_text FROM resume_profiles
       WHERE user_id = ${userId}
       ORDER BY is_default DESC, updated_at DESC
       LIMIT 1
    `;
    let resumeText = profileRows[0]?.resume_text || "";

    if (!resumeText) {
      // Fall back to the uploaded resume in Supabase Storage
      const stored = await downloadResumeText(userId);
      if (stored) resumeText = stored;
    }

    if (!resumeText || resumeText.length < 50) {
      res.status(400).json({ error: "No resume found. Upload one in Settings first." });
      return;
    }

    const MAX_INPUT_CHARS = 25000;
    const totalInput = (resumeText?.length || 0) + (job.description?.length || 0);
    if (totalInput > MAX_INPUT_CHARS) {
      return res.status(400).json({ error: "Input too large. Resume + job description must be under 25,000 characters combined." });
    }

    const openai = getOpenAI();
    if (!openai) {
      res.status(503).json({ error: "OpenAI is not configured on the server" });
      return;
    }

    const prompt = `You are an ATS (Applicant Tracking System) expert. Compare this resume to the job description and return a JSON analysis.

JOB TITLE: ${job.job_title}
COMPANY: ${job.company_name}
JOB DESCRIPTION:
${job.description.slice(0, 4000)}

RESUME:
${resumeText.slice(0, 6000)}

Return ONLY valid JSON with this structure:
{
  "atsScore": 0-100 integer,
  "keywordMatchRate": 0-1 float,
  "matchedKeywords": ["kw1", "kw2", ...],
  "missingKeywords": ["kw1", "kw2", ...],
  "suggestions": [{ "type": "add|rephrase|remove", "target": "what to change", "because": "why" }]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const analysis = JSON.parse(completion.choices[0].message.content || "{}");

    // Persist the score to the job row
    await sql`
      UPDATE jobs
         SET ats_score = ${analysis.atsScore ?? null},
             keyword_match_rate = ${analysis.keywordMatchRate ?? null},
             updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;

    res.json(analysis);
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/analyze-resume]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/jobs/:id/apply-suggestions ────────────────────────────
// Takes a list of resume edit suggestions and applies them to the
// user's default resume profile.
router.post("/:id/apply-suggestions", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { suggestions } = req.body;
  if (!Array.isArray(suggestions)) {
    res.status(400).json({ error: "suggestions must be an array" });
    return;
  }
  try {
    const profileRows = await sql<{ id: number; resume_text: string }[]>`
      SELECT id, resume_text FROM resume_profiles
       WHERE user_id = ${userId}
       ORDER BY is_default DESC
       LIMIT 1
    `;
    if (profileRows.length === 0) {
      res.status(404).json({ error: "No resume profile found to apply suggestions to" });
      return;
    }

    // Apply the suggestions via OpenAI so the edit blends naturally.
    const openai = getOpenAI();
    if (!openai) {
      res.status(503).json({ error: "OpenAI is not configured" });
      return;
    }

    const prompt = `Apply these resume edit suggestions and return ONLY the updated resume text:

ORIGINAL RESUME:
${profileRows[0].resume_text}

SUGGESTIONS:
${suggestions.map((s: any) => `- [${s.type}] ${s.target} (${s.because})`).join("\n")}

Return the updated resume text verbatim with the suggestions applied. Keep the formatting identical.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const updated = completion.choices[0].message.content || profileRows[0].resume_text;
    await sql`
      UPDATE resume_profiles
         SET resume_text = ${updated}, updated_at = NOW()
       WHERE id = ${profileRows[0].id} AND user_id = ${userId}
    `;

    res.json({ ok: true, applied: suggestions.length });
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/apply-suggestions]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
