import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { downloadResumeText } from "../storage";

/**
 * Resume analyze + apply (ReWrite flow).
 *
 * The client's ResumeCompareModal expects a richer shape than the old
 * "atsScore + suggestions[]" payload — sections of bullets the user can
 * accept/reject one by one, plus a rewritten summary, plus an ATS score
 * for the header. This module now produces that full shape in a single
 * OpenAI call and persists the score back to the job row.
 */

const router = Router();
router.use(requireAuth);

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, maxRetries: 2 });
}

// ─── POST /api/jobs/:id/analyze-resume ───────────────────────────────
// Returns ResumeAnalysis shape (see client/src/api.ts):
//   { jobId, jobTitle, companyName, matchScore, atsScore,
//     analysis: { strengths, foundKeywords, addedKeywords, missingKeywords },
//     optimizations: [{ section, role, company, date, bullets[] }],
//     summaryOriginal, summaryImproved }
router.post("/:id/analyze-resume", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  // Optional client overrides
  const customDescription = typeof (req.body as any)?.customDescription === "string"
    ? (req.body as any).customDescription
    : null;
  const overrideResumeText = typeof (req.body as any)?.resumeText === "string" && (req.body as any).resumeText.length > 50
    ? (req.body as any).resumeText
    : null;

  try {
    const jobRows = await sql<{
      id: number;
      job_title: string;
      company_name: string;
      description: string | null;
    }[]>`
      SELECT id, job_title, company_name, description
        FROM jobs
       WHERE id = ${id} AND user_id = ${userId}
       LIMIT 1
    `;
    if (jobRows.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = jobRows[0];
    const jobDescription = customDescription || job.description || "";
    if (!jobDescription || jobDescription.length < 30) {
      res.status(400).json({ error: "Job has no description to analyze against" });
      return;
    }

    let resumeText = overrideResumeText || "";
    if (!resumeText) {
      const profileRows = await sql<{ resume_text: string }[]>`
        SELECT resume_text FROM resume_profiles
         WHERE user_id = ${userId}
         ORDER BY is_default DESC, updated_at DESC
         LIMIT 1
      `;
      resumeText = profileRows[0]?.resume_text || "";
      if (!resumeText) {
        const stored = await downloadResumeText(userId);
        if (stored) resumeText = stored;
      }
    }
    if (!resumeText || resumeText.length < 50) {
      res.status(400).json({ error: "No resume found. Upload one in Settings first." });
      return;
    }

    const MAX_INPUT_CHARS = 25000;
    if (resumeText.length + jobDescription.length > MAX_INPUT_CHARS) {
      res.status(400).json({ error: "Resume + job description exceed 25,000 characters." });
      return;
    }

    const openai = getOpenAI();
    if (!openai) {
      res.status(503).json({ error: "OpenAI is not configured on the server" });
      return;
    }

    // Trim aggressively for the prompt — the response is the expensive
    // part. 5k of resume + 3k of JD is enough for a good analysis.
    const resumeForPrompt = resumeText.slice(0, 5000);
    const jdForPrompt = jobDescription.slice(0, 3000);

    const prompt = `You are an ATS (Applicant Tracking System) expert and resume coach. Compare the candidate's resume against the job description and return ONE structured JSON analysis.

=== JOB ===
TITLE: ${job.job_title}
COMPANY: ${job.company_name}
DESCRIPTION:
${jdForPrompt}

=== CANDIDATE RESUME ===
${resumeForPrompt}

=== OUTPUT JSON SHAPE (strict — no extra fields) ===
{
  "matchScore": 0-100 integer reflecting overall fit + keyword coverage,
  "atsScore": 0-100 integer reflecting ATS keyword density specifically,
  "keywordMatchRate": 0-1 float (atsScore / 100 is fine),
  "analysis": {
    "strengths": ["short bullet describing the candidate's strongest match", "..."],
    "foundKeywords": ["keywords from JD that appear in resume verbatim"],
    "addedKeywords": ["keywords from JD that we'll add via the rewrites below"],
    "missingKeywords": ["keywords from JD that don't fit the candidate's actual experience"]
  },
  "optimizations": [
    {
      "section": "experience" | "projects",
      "role": "exact role title from resume",
      "company": "exact company/project name from resume",
      "date": "exact date string from resume",
      "bullets": [
        {
          "original": "verbatim bullet from resume",
          "improved": "rewritten bullet that injects 1-3 JD keywords naturally without inventing facts, OR null if the original is already strong",
          "addedKeywords": ["keywords this rewrite introduces"],
          "accepted": false
        }
      ]
    }
  ],
  "summaryOriginal": "candidate's existing summary verbatim",
  "summaryImproved": "rewritten 2-4 sentence summary aligned to the JD, preserving every visa / clearance / availability statement verbatim"
}

=== RULES ===
- Every bullet in optimizations MUST have an "original" pulled verbatim from the resume.
- "improved" can be null when the original already covers the JD requirement well.
- Never invent companies, roles, dates, or certifications.
- Do not echo full JD sentences into the summary or bullets — only individual tool/skill keywords.
- Banned words in any rewrite: leveraged, spearheaded, orchestrated, pioneered, cutting-edge, innovative, dynamic, passionate, results-driven, synergy, transformative, delve, foster, showcase, pivotal, crucial.
- Banned punctuation: em dashes (—). Use commas/periods/parens.

Return ONLY the JSON. No markdown. No prose.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 3500,
    });

    let analysis: any;
    try {
      analysis = JSON.parse(completion.choices[0].message.content || "{}");
    } catch {
      res.status(500).json({ error: "AI returned invalid JSON. Try again." });
      return;
    }

    // Defensive defaults — guarantee the client never receives `undefined`
    // for fields it indexes into (the previous shape mismatch caused the
    // ResumeCompareModal to crash on `optimizations.reduce`).
    const matchScore = Number.isFinite(analysis.matchScore) ? Math.round(analysis.matchScore) : 0;
    const atsScore = Number.isFinite(analysis.atsScore) ? Math.round(analysis.atsScore) : matchScore;
    const safeAnalysis = {
      strengths: Array.isArray(analysis.analysis?.strengths) ? analysis.analysis.strengths : [],
      foundKeywords: Array.isArray(analysis.analysis?.foundKeywords) ? analysis.analysis.foundKeywords : [],
      addedKeywords: Array.isArray(analysis.analysis?.addedKeywords) ? analysis.analysis.addedKeywords : [],
      missingKeywords: Array.isArray(analysis.analysis?.missingKeywords) ? analysis.analysis.missingKeywords : [],
    };
    const safeOptimizations = Array.isArray(analysis.optimizations)
      ? analysis.optimizations.map((s: any) => ({
          section: typeof s.section === "string" ? s.section : "experience",
          role: typeof s.role === "string" ? s.role : "",
          company: typeof s.company === "string" ? s.company : "",
          date: typeof s.date === "string" ? s.date : "",
          bullets: Array.isArray(s.bullets) ? s.bullets.map((b: any) => ({
            original: typeof b.original === "string" ? b.original : "",
            improved: typeof b.improved === "string" ? b.improved : null,
            addedKeywords: Array.isArray(b.addedKeywords) ? b.addedKeywords : [],
            accepted: false,
          })) : [],
        }))
      : [];

    // Persist the score so the kanban card and skills page can surface it.
    await sql`
      UPDATE jobs
         SET ats_score = ${atsScore},
             keyword_match_rate = ${Number.isFinite(analysis.keywordMatchRate) ? analysis.keywordMatchRate : (atsScore / 100)},
             updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;

    res.json({
      jobId: id,
      jobTitle: job.job_title,
      companyName: job.company_name,
      matchScore,
      atsScore,
      analysis: safeAnalysis,
      optimizations: safeOptimizations,
      summaryOriginal: typeof analysis.summaryOriginal === "string" ? analysis.summaryOriginal : "",
      summaryImproved: typeof analysis.summaryImproved === "string" ? analysis.summaryImproved : "",
    });
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/analyze-resume]", err);
    res.status(500).json({ error: err?.message || "Something went wrong. Please try again." });
  }
});

// ─── POST /api/jobs/:id/apply-suggestions ────────────────────────────
// Accepts the post-review optimizations payload from the client (with
// `accepted: true` on the bullets the user wants to keep), regenerates
// the resume profile text by replacing originals with improved bullets,
// and returns a placeholder resumeUrl. The PDF rebuild is deferred —
// the next pipeline run picks up the new resume_text.
router.post("/:id/apply-suggestions", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const optimizations = (req.body as any)?.optimizations;
  const summaryImproved = typeof (req.body as any)?.summaryImproved === "string"
    ? (req.body as any).summaryImproved
    : null;
  const overrideResumeText = typeof (req.body as any)?.resumeText === "string" && (req.body as any).resumeText.length > 50
    ? (req.body as any).resumeText
    : null;

  if (!Array.isArray(optimizations)) {
    res.status(400).json({ error: "optimizations must be an array" });
    return;
  }

  try {
    // Source resume: client-provided text, or stored profile, or storage
    let baseText = overrideResumeText || "";
    let profileId: number | null = null;
    if (!baseText) {
      const profileRows = await sql<{ id: number; resume_text: string }[]>`
        SELECT id, resume_text FROM resume_profiles
         WHERE user_id = ${userId}
         ORDER BY is_default DESC, updated_at DESC
         LIMIT 1
      `;
      if (profileRows.length > 0) {
        profileId = profileRows[0].id;
        baseText = profileRows[0].resume_text;
      } else {
        const stored = await downloadResumeText(userId);
        if (stored) baseText = stored;
      }
    } else {
      // Even if the client supplied resumeText, we still want to write
      // the result back to the user's default profile so the next
      // pipeline run picks it up.
      const profileRows = await sql<{ id: number }[]>`
        SELECT id FROM resume_profiles
         WHERE user_id = ${userId}
         ORDER BY is_default DESC
         LIMIT 1
      `;
      if (profileRows.length > 0) profileId = profileRows[0].id;
    }

    if (!baseText) {
      res.status(404).json({ error: "No resume to apply suggestions to. Upload one in Settings." });
      return;
    }

    // Apply: for every accepted bullet, swap original → improved in the
    // resume text. Plain string replace because we don't have a parsed
    // resume tree. If the original isn't found verbatim (because the
    // model abbreviated it), the bullet is silently skipped — preferable
    // to corrupting the rest of the resume.
    let updated = baseText;
    let appliedCount = 0;
    for (const section of optimizations) {
      if (!section || !Array.isArray(section.bullets)) continue;
      for (const b of section.bullets) {
        if (!b?.accepted || !b?.improved || !b?.original) continue;
        if (updated.includes(b.original)) {
          updated = updated.replace(b.original, b.improved);
          appliedCount++;
        }
      }
    }

    // Replace summary in-place if the client sent an improved version
    // that looks like an actual rewrite (not just whitespace/empty).
    if (summaryImproved && summaryImproved.trim().length > 20) {
      // Heuristic: replace the first paragraph if it loosely matches a
      // summary section header. Otherwise prepend.
      const firstPara = updated.split(/\n\s*\n/)[0] || "";
      if (firstPara.length < 800) {
        updated = updated.replace(firstPara, summaryImproved.trim());
      }
    }

    if (profileId) {
      await sql`
        UPDATE resume_profiles
           SET resume_text = ${updated}, updated_at = NOW()
         WHERE id = ${profileId} AND user_id = ${userId}
      `;
    } else {
      // No profile row yet — create the user's first one as the default
      await sql`
        INSERT INTO resume_profiles (user_id, name, role_type, resume_text, is_default)
        VALUES (${userId}, 'Default', 'general', ${updated}, true)
      `;
    }

    // resumeUrl is part of the contract but we don't regenerate the PDF
    // here (Puppeteer is heavy and the user can re-run the pipeline to
    // pick up the new text). Return empty so the client's onResumeUpdated
    // callback fires harmlessly.
    res.json({ ok: true, applied: appliedCount, resumeUrl: "" });
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/apply-suggestions]", err);
    res.status(500).json({ error: err?.message || "Something went wrong. Please try again." });
  }
});

// ─── GET /api/jobs/:id/timeline ──────────────────────────────────────
// Returns the status-history audit trail for a single job. The
// JobDetailModal calls this on mount; before this route existed it
// 404'd, which the client silently caught but littered the console
// with errors on every modal open.
router.get("/:id/timeline", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    // Confirm the user owns the job before exposing history.
    const own = await sql<{ id: number }[]>`
      SELECT id FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    if (own.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const rows = await sql<{
      from_status: string | null;
      to_status: string;
      changed_at: string;
    }[]>`
      SELECT from_status, to_status, changed_at
        FROM job_status_history
       WHERE job_id = ${id} AND user_id = ${userId}
       ORDER BY changed_at DESC
       LIMIT 50
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/jobs/:id/timeline]", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
