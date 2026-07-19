import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { downloadResumeText } from "../storage";

/**
 * STAR story bank routes (Postgres edition).
 * Per-user interview story library for behavioral prep.
 *
 * Also hosts the WORK EXPERIENCE stories feature: first-person
 * monologues generated from the resume's work history ("tell me about
 * your time at X"), with AI follow-up questions for every detail the
 * resume doesn't answer. The AI never invents facts: gaps become
 * questions, and the user's answers get woven into the narrative.
 */

const router = Router();
router.use(requireAuth);

const EXP_CHAT_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  return new OpenAI({ apiKey, baseURL, maxRetries: 2 });
}

// Belt-and-suspenders table creation (mirrors free_tailor_log's pattern)
// so the feature works even on a deploy where migration 0010 hasn't run.
// Tenant isolation is enforced by user_id on every query in this file;
// the API server connects with the service role, so RLS here is defense
// in depth for direct-DB access paths only.
let expTableReady = false;
async function ensureExperienceTable(): Promise<void> {
  if (expTableReady) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS experience_stories (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        date_range TEXT,
        monologue TEXT NOT NULL,
        day_in_life TEXT,
        how_it_felt TEXT,
        followups JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_experience_stories_user ON experience_stories(user_id)`;
    expTableReady = true;
  } catch (err: any) {
    console.error("[story-bank] ensureExperienceTable failed:", err?.message || err);
  }
}

interface ExperienceDraft {
  company: string;
  title: string;
  date_range: string | null;
  monologue: string;
  day_in_life: string | null;
  how_it_felt: string | null;
  followups: Array<{ question: string; answer: string | null }>;
}

const EXPERIENCE_GEN_SYS =
  "You turn the WORK EXPERIENCE entries of a resume into first-person interview narratives the candidate can speak aloud. " +
  "Identify each distinct job/internship on the resume (skip education, projects, certifications). For EACH one return:\n" +
  "- company, title, date_range: verbatim from the resume (date_range null if absent).\n" +
  "- monologue: 200-350 words, first person, natural spoken style. What I owned, what I built or did, the tools I used, who I worked with, the impact. " +
  "Grounded STRICTLY in what the resume says. This is the answer to 'tell me about your time at X'.\n" +
  "- day_in_life: 80-150 words, 'a typical day looked like...'. Only resume facts plus activities that are OBVIOUSLY generic for the role, clearly framed as typical ('mornings usually started with...'). No invented specifics: no fake meeting names, team sizes, or metrics.\n" +
  "- how_it_felt: 60-120 words on what working there was like: the pace, the ownership, what I learned, what stretched me. If the resume gives no signal about the environment, keep this to 1-2 honest sentences and push the rest into followups.\n" +
  "- followups: 3-6 SHORT direct questions for the candidate covering the details the resume does NOT answer, chosen to make this story vivid and personal: team size and structure, the hardest problem there, the thing they're proudest of shipping, a concrete number for impact, what the culture/pace was actually like, why they moved on. NEVER ask something the resume already answers.\n\n" +
  "HARD RULE: NEVER invent facts (numbers, tools, team details, anecdotes) that are not in the resume. A gap becomes a followup question, not fiction.\n" +
  "Return STRICT JSON: { experiences: [ { company, title, date_range, monologue, day_in_life, how_it_felt, followups: [string] } ] }";

const EXPERIENCE_REFINE_SYS =
  "You are improving a first-person work-experience narrative using the candidate's own answers to follow-up questions. " +
  "Rewrite monologue, day_in_life, and how_it_felt, weaving the answered details in naturally where they belong (numbers into impact lines, culture answers into how_it_felt, routine answers into day_in_life). " +
  "Keep the first-person spoken style. Keep everything from the current version that the answers don't change. " +
  "NEVER invent facts: every detail must come from the current narrative, the resume context, or the candidate's answers.\n" +
  "Then list the follow-up questions that are STILL unanswered (carry them over verbatim), plus at most 1 NEW question only if an answer opened an obvious gap. Max 4 open questions total; fewer is better. If nothing important is missing, return an empty list.\n" +
  "Return STRICT JSON: { monologue, day_in_life, how_it_felt, open_followups: [string] }";

// ─── GET /api/story-bank/experience ──────────────────────────────────
router.get("/experience", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    await ensureExperienceTable();
    const rows = await sql`
      SELECT id, company, title, date_range, monologue, day_in_life, how_it_felt,
             followups, status, created_at, updated_at
        FROM experience_stories
       WHERE user_id = ${userId}
       ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /api/story-bank/experience]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/story-bank/experience/generate ────────────────────────
//
// Body: { resumeText?: string } - optional override; defaults to the
// user's stored resume. One LLM call extracts every work-experience
// entry and drafts the narrative + follow-up questions for each.
// Companies that already have a story are skipped so regenerating
// never clobbers refined stories.
router.post("/experience/generate", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const openai = getOpenAI();
  if (!openai) { res.status(503).json({ error: "AI service is not configured on the server." }); return; }

  try {
    await ensureExperienceTable();
    const override = typeof (req.body || {}).resumeText === "string" ? req.body.resumeText.trim() : "";
    const resumeText = override || (await downloadResumeText(userId)) || "";
    if (resumeText.trim().length < 100) {
      res.status(400).json({
        error: "No resume found. Upload your resume in Settings (or on the landing page) first, then generate.",
      });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: EXP_CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXPERIENCE_GEN_SYS },
        { role: "user", content: "Resume:\n\n" + resumeText.slice(0, 14000) + "\n\nReturn the JSON now." },
      ],
      temperature: 0.5,
      max_tokens: 4000,
    });

    let parsed: any = {};
    try { parsed = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch { parsed = {}; }
    const drafts: ExperienceDraft[] = (Array.isArray(parsed.experiences) ? parsed.experiences : [])
      .slice(0, 6)
      .map((e: any) => ({
        company: String(e.company || "").slice(0, 200).trim(),
        title: String(e.title || "").slice(0, 200).trim(),
        date_range: e.date_range ? String(e.date_range).slice(0, 100) : null,
        monologue: String(e.monologue || "").slice(0, 4000).trim(),
        day_in_life: e.day_in_life ? String(e.day_in_life).slice(0, 2000) : null,
        how_it_felt: e.how_it_felt ? String(e.how_it_felt).slice(0, 2000) : null,
        followups: (Array.isArray(e.followups) ? e.followups : [])
          .slice(0, 6)
          .map((q: any) => ({ question: String(q).slice(0, 300), answer: null })),
      }))
      .filter((e: ExperienceDraft) => e.company && e.monologue.length > 50);

    if (drafts.length === 0) {
      res.status(422).json({ error: "Couldn't find work-experience entries in the resume. Make sure it has an Experience section." });
      return;
    }

    // Skip companies that already have a story (case-insensitive match on
    // company + title) so regenerate is additive, never destructive.
    const existing = await sql<{ company: string; title: string }[]>`
      SELECT company, title FROM experience_stories WHERE user_id = ${userId}
    `;
    const seen = new Set(existing.map((r) => (r.company + "|" + r.title).toLowerCase()));
    const fresh = drafts.filter((d) => !seen.has((d.company + "|" + d.title).toLowerCase()));

    const created: any[] = [];
    for (const d of fresh) {
      const rows = await sql<any[]>`
        INSERT INTO experience_stories (
          user_id, company, title, date_range, monologue, day_in_life, how_it_felt, followups, status
        ) VALUES (
          ${userId}, ${d.company}, ${d.title}, ${d.date_range}, ${d.monologue},
          ${d.day_in_life}, ${d.how_it_felt}, ${sql.json(d.followups as any)},
          ${d.followups.length > 0 ? "draft" : "complete"}
        )
        RETURNING id, company, title, date_range, monologue, day_in_life, how_it_felt, followups, status, created_at, updated_at
      `;
      created.push(rows[0]);
    }

    res.json({ created, skipped: drafts.length - fresh.length });
  } catch (err: any) {
    console.error("[POST /api/story-bank/experience/generate]", err?.message || err);
    res.status(500).json({ error: "Could not generate experience stories. Please try again." });
  }
});

// ─── POST /api/story-bank/experience/:id/refine ──────────────────────
//
// Body: { answers: [{ question, answer }] } - the user's answers to
// open follow-ups. One LLM call weaves them into the narrative and
// returns whatever questions remain open.
router.post("/experience/:id/refine", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const answers = (Array.isArray((req.body || {}).answers) ? req.body.answers : [])
    .map((a: any) => ({
      question: String(a?.question || "").slice(0, 300),
      answer: String(a?.answer || "").slice(0, 1500).trim(),
    }))
    .filter((a: any) => a.question && a.answer);
  if (answers.length === 0) {
    res.status(400).json({ error: "Answer at least one follow-up question first." });
    return;
  }

  const openai = getOpenAI();
  if (!openai) { res.status(503).json({ error: "AI service is not configured on the server." }); return; }

  try {
    await ensureExperienceTable();
    const rows = await sql<any[]>`
      SELECT * FROM experience_stories WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    const story = rows[0];
    if (!story) { res.status(404).json({ error: "Story not found" }); return; }

    const usr =
      `Role: ${story.title} at ${story.company}${story.date_range ? ` (${story.date_range})` : ""}\n\n` +
      `CURRENT MONOLOGUE:\n${story.monologue}\n\n` +
      `CURRENT DAY IN THE LIFE:\n${story.day_in_life || "(none)"}\n\n` +
      `CURRENT HOW IT FELT:\n${story.how_it_felt || "(none)"}\n\n` +
      `CANDIDATE'S ANSWERS:\n` +
      answers.map((a: any, i: number) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`).join("\n") +
      `\n\nUNANSWERED QUESTIONS (carry over the still-relevant ones):\n` +
      ((story.followups || []) as any[])
        .filter((f) => !f.answer && !answers.some((a: any) => a.question === f.question))
        .map((f) => `- ${f.question}`)
        .join("\n") +
      "\n\nReturn the JSON now.";

    const completion = await openai.chat.completions.create({
      model: EXP_CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXPERIENCE_REFINE_SYS },
        { role: "user", content: usr },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    });

    let parsed: any = {};
    try { parsed = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch { parsed = {}; }
    const monologue = String(parsed.monologue || story.monologue).slice(0, 4000);
    const dayInLife = parsed.day_in_life ? String(parsed.day_in_life).slice(0, 2000) : story.day_in_life;
    const howItFelt = parsed.how_it_felt ? String(parsed.how_it_felt).slice(0, 2000) : story.how_it_felt;

    // Answered questions are stored with their answers (audit trail);
    // open questions come back from the model with answer: null.
    const answered = answers.map((a: any) => ({ question: a.question, answer: a.answer }));
    const stillOpen = (Array.isArray(parsed.open_followups) ? parsed.open_followups : [])
      .slice(0, 4)
      .map((q: any) => ({ question: String(q).slice(0, 300), answer: null }));
    const priorAnswered = ((story.followups || []) as any[]).filter((f) => f.answer);
    const followups = [...priorAnswered, ...answered, ...stillOpen];
    const status = stillOpen.length === 0 ? "complete" : "draft";

    const updated = await sql<any[]>`
      UPDATE experience_stories
         SET monologue = ${monologue},
             day_in_life = ${dayInLife},
             how_it_felt = ${howItFelt},
             followups = ${sql.json(followups as any)},
             status = ${status},
             updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
       RETURNING id, company, title, date_range, monologue, day_in_life, how_it_felt, followups, status, created_at, updated_at
    `;
    res.json(updated[0]);
  } catch (err: any) {
    console.error("[POST /api/story-bank/experience/:id/refine]", err?.message || err);
    res.status(500).json({ error: "Could not update the story. Please try again." });
  }
});

// ─── DELETE /api/story-bank/experience/:id ───────────────────────────
router.delete("/experience/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await ensureExperienceTable();
    const result = await sql`
      DELETE FROM experience_stories WHERE id = ${id} AND user_id = ${userId}
    `;
    if (result.count === 0) { res.status(404).json({ error: "Story not found" }); return; }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/story-bank/experience/:id]", err?.message || err);
    res.status(500).json({ error: "Database error" });
  }
});

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
