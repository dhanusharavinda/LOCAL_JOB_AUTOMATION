import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { downloadResumeText } from "../storage";

/**
 * Interview practice routes.
 * --------------------------
 * The user picks a tracked job (or pastes a JD + resume manually),
 * picks a mode (behavioral / technical), and the server generates 8-12
 * questions. The client drives the voice loop with Web Speech API +
 * OpenAI tts-1; per-turn it POSTs to /turn for the "follow-up vs next"
 * decision, and at the end POSTs to /score for the final rubric.
 *
 *   POST   /api/interview/start            create session, generate questions
 *   POST   /api/interview/turn             { sessionId, answer } -> follow-up | next | wrap
 *   POST   /api/interview/score            { sessionId } -> final rubric, persist
 *   POST   /api/interview/tts              { text } -> audio/mpeg streamed back
 *   POST   /api/interview/stt              multipart audio -> { text } via Whisper
 *   GET    /api/interview/sessions         list user's sessions
 *   GET    /api/interview/sessions/:id     load a single session (for resume)
 *   PATCH  /api/interview/sessions/:id     mark abandoned
 *
 * All routes require auth; tenant isolation is enforced by user_id.
 */

const router = Router();
router.use(requireAuth);

// Tighter limiter than the global apiLimiter because every endpoint
// here makes an OpenAI call. 30 requests/min/IP is enough for a single
// practice session even with rapid follow-ups.
const interviewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many interview requests. Please wait a minute." },
});
router.use(interviewLimiter);

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  return new OpenAI({ apiKey, baseURL, maxRetries: 2 });
}

// ── Tunable constants (env-configurable) ──────────────────────────────
// Defaults match what shipped originally; operators can override
// per environment without a redeploy.
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

const CHAT_MODEL = envStr("OPENAI_MODEL", "gpt-4o-mini");
const TTS_MODEL  = envStr("OPENAI_TTS_MODEL", "tts-1");
const TTS_VOICE  = envStr("OPENAI_TTS_VOICE", "alloy");

const QUESTIONS_PER_SESSION = envInt("INTERVIEW_QUESTIONS_PER_SESSION", 10);
const FOLLOWUP_CAP          = envInt("INTERVIEW_FOLLOWUP_CAP", 2);
const SESSION_MAX_MS        = envInt("INTERVIEW_MAX_MS", 20 * 60_000);

// Daily quotas. Free tier gets 2 sessions/day, pro gets 10. Counted
// across the user_id; the day boundary is 00:00 UTC like the rest of
// the app's quotas.
const DAILY_QUOTA = {
  free: envInt("INTERVIEW_DAILY_FREE", 2),
  pro:  envInt("INTERVIEW_DAILY_PRO", 10),
} as const;

/**
 * Detect "I don't know / can't recall / let's skip" answers so the
 * decide step can fast-forward without burning an OpenAI call. Returns
 * true ONLY when the give-up phrase is essentially the WHOLE answer - 
 * an answer like "I'm not sure but here's how I'd approach it..." is
 * NOT a give-up because it pivots into substance after.
 */
function isGiveUpAnswer(ans: string): boolean {
  const lower = ans.toLowerCase().trim();
  if (lower.length === 0) return false;
  // 100 chars of substantive content rules out a pure give-up. Real
  // "I don't know" answers are typically <60 chars.
  if (lower.length > 100) return false;
  // Strip punctuation + filler so "I don't know..." matches "i dont know".
  const cleaned = lower.replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();
  const patterns: RegExp[] = [
    /^(i\s)?(do\s?not|don'?t|cannot|can'?t)\s(know|remember|recall|recollect|have)\b/,
    /^(i\s)?(do\s?not|don'?t|cannot|can'?t)\s(really\s)?(know|remember|recall)\b/,
    /^no\s(idea|clue|memory|experience|answer)\b/,
    /^i\s(have\s)?no\s(idea|clue|experience|memory|answer)\b/,
    /^(i'?m|im)\s(not|completely)\s(sure|certain)\.?$/,
    /^(i'?m|im)\sblanking\b/,
    /^(skip|pass|next|move\s?on|next\squestion)\b/,
    /^(can\s?we|let'?s)\s(skip|move\s?on|pass)\b/,
    /^i\s(would|will)\s(skip|pass)\b/,
    /^(uh|um|er|hmm)\s*(no|nothing|nope)\b/,
    /^(no|nope|nada|nothing)\.?$/,
    /^drawing\sa\sblank\b/,
    /^my\smind('?s|\sis)\sblank\b/,
  ];
  return patterns.some((p) => p.test(cleaned));
}

async function countSessionsToday(userId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM interview_sessions
     WHERE user_id = ${userId}
       AND started_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
  `;
  return parseInt(rows[0]?.count || "0", 10);
}

// ── Question generation ────────────────────────────────────────────────
interface GeneratedQuestion {
  idx: number;
  question: string;
  type: "behavioral" | "technical" | "jd_specific";
  rubric_target: string[];   // dimensions this question stresses
  hidden_hint: string;       // for the model only; never shown to user
  expected_length: "short" | "medium" | "long";
}

type Difficulty = "easy" | "medium" | "hard";

async function generateQuestions(
  mode: "behavioral" | "technical",
  difficulty: Difficulty,
  ctx: {
    job_title?: string | null;
    company_name?: string | null;
    description?: string | null;
    seniority?: string | null;
    resume_text?: string | null;
    fine_tune_focus?: string | null;
    story_bank_titles?: string[];
  }
): Promise<GeneratedQuestion[]> {
  const openai = getOpenAI();
  if (!openai) throw new Error("OpenAI not configured");

  // Difficulty shapes the question mix + tone. The split changes
  // (more warm-ups on easy, more stretch on hard) and the difficulty
  // line in the system prompt nudges question depth.
  const difficultyDirective =
    difficulty === "easy"
      ? "DIFFICULTY: easy. Friendly screening tone. Focus on warm-up + foundational questions. Avoid trick questions, edge-case probing, or follow-up bait. Mix: 4 warm-up, 5 substantive, 1 stretch."
    : difficulty === "hard"
      ? "DIFFICULTY: hard. Senior bar. Expect candidates to articulate trade-offs, edge cases, and second-order effects. Sharper question framing; assume strong fundamentals. Mix: 1 warm-up, 5 substantive, 4 stretch."
      : "DIFFICULTY: medium. Realistic mid-round bar at a competent company. Mix: 2 warm-up, 6 substantive, 2 stretch.";

  const hasJd = !!(ctx.description && ctx.description.trim().length > 100);
  const hasResume = !!(ctx.resume_text && ctx.resume_text.trim().length > 100);

  const sys =
    "You are a warm but incisive senior interviewer running a VOICE-based mock interview. " +
    "Every question you write will be READ ALOUD by a text-to-speech voice, so write it exactly the way a human interviewer would say it out loud: " +
    "conversational, one or at most two short sentences, no lists, no markdown, no numbering, no 'Question 1:' prefixes, and never multi-part ('...and also...') questions. " +
    "Generate exactly " + QUESTIONS_PER_SESSION + " questions. " +
    (mode === "behavioral"
      ? "BEHAVIORAL mode: 70% STAR-format behavioral questions (past experience, conflict, leadership, growth, failure). 30% role-specific situational. "
      : "TECHNICAL mode: 70% concept and verbal-system-design (no whiteboard); the candidate explains how they'd approach it out loud. 30% behavioral on engineering practices. ") +
    difficultyDirective + " " +
    (hasJd
      ? "A job description is provided. At least 6 of the questions MUST anchor to something CONCRETE in it: the product, the team's stack, a named responsibility, the domain. A candidate reading the JD should think 'they clearly wrote these for THIS job'. Generic questions that could apply to any role are allowed only as the single warm-up opener. "
      : "") +
    (hasResume
      ? "A resume is provided. At least 2 questions must probe SPECIFIC items on it: a named project, a role transition, a skill claim that deserves scrutiny. Reference the item naturally ('You mentioned migrating X...'). "
      : "") +
    "Return STRICT JSON: { questions: [ { idx, question, type, rubric_target, hidden_hint, expected_length } ] }. " +
    "Each rubric_target is an array of 1-3 dimensions from: clarity, structure, technical_accuracy, jd_relevance, communication. " +
    "hidden_hint is one line for the AI follow-up decider: what a STRONG answer must include, and the most revealing probe if the answer is thin. Never shown to the candidate. " +
    "expected_length is short / medium / long. " +
    "Order: warmest first, hardest last.";

  const lines: string[] = [];
  if (ctx.job_title) lines.push(`Role: ${ctx.job_title}`);
  if (ctx.company_name) lines.push(`Company: ${ctx.company_name}`);
  if (ctx.seniority) lines.push(`Seniority: ${ctx.seniority}`);
  if (ctx.description) lines.push("Job description (truncated):\n" + ctx.description.slice(0, 2500));
  if (ctx.resume_text) lines.push("Candidate resume (truncated):\n" + ctx.resume_text.slice(0, 2500));
  if (ctx.story_bank_titles?.length) {
    lines.push("Candidate's saved STAR stories (titles only - prefer questions that let them use these):\n- " + ctx.story_bank_titles.join("\n- "));
  }
  if (ctx.fine_tune_focus) lines.push("User-provided focus for this practice round:\n" + ctx.fine_tune_focus);

  const usr = lines.join("\n\n") + "\n\nReturn the JSON now.";

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr },
    ],
    temperature: 0.7,
    max_tokens: 2500,
  });

  const raw = completion.choices[0]?.message?.content || "";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const arr = parsed?.questions;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("Question generator returned no questions");
  }
  return arr.slice(0, QUESTIONS_PER_SESSION).map((q, i) => ({
    idx: i,
    question: String(q.question || "").slice(0, 500),
    type: ["behavioral", "technical", "jd_specific"].includes(q.type) ? q.type : "behavioral",
    rubric_target: Array.isArray(q.rubric_target) ? q.rubric_target.slice(0, 5) : ["clarity"],
    hidden_hint: String(q.hidden_hint || "").slice(0, 300),
    expected_length: ["short", "medium", "long"].includes(q.expected_length) ? q.expected_length : "medium",
  })) as GeneratedQuestion[];
}

// ── POST /api/interview/start ──────────────────────────────────────────
router.post("/start", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan = req.user!.plan === "pro" || req.user!.plan === "enterprise" ? "pro" : "free";
  const { jobId, manualJd, manualResumeText, fineTuneFocus, mode, difficulty: rawDifficulty } = req.body || {};

  if (!mode || !["behavioral", "technical"].includes(mode)) {
    res.status(400).json({ error: "mode must be 'behavioral' or 'technical'" });
    return;
  }

  // Normalize difficulty. Default to medium so existing clients that
  // don't pass it keep behaving identically to the old prompt.
  const difficulty: Difficulty =
    rawDifficulty === "easy" || rawDifficulty === "hard" ? rawDifficulty : "medium";

  // Quota check
  const used = await countSessionsToday(userId);
  if (used >= DAILY_QUOTA[plan]) {
    res.status(429).json({
      error: `Daily quota reached (${DAILY_QUOTA[plan]} sessions/day on ${plan}). Try again tomorrow.`,
      plan, used, quota: DAILY_QUOTA[plan],
    });
    return;
  }

  try {
    // Pull context. Either tracked job (jobId) or manual.
    let jobCtx: {
      job_title?: string | null;
      company_name?: string | null;
      description?: string | null;
      seniority?: string | null;
      resume_text?: string | null;
    } = {};

    if (jobId) {
      const id = parseInt(String(jobId), 10);
      if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid jobId" }); return; }
      const rows = await sql<any[]>`
        SELECT job_title, company_name, description, seniority_level
          FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
      `;
      const j = rows[0];
      if (!j) { res.status(404).json({ error: "Job not found" }); return; }
      jobCtx = {
        job_title: j.job_title,
        company_name: j.company_name,
        description: j.description,
        seniority: j.seniority_level,
        resume_text: await downloadResumeText(userId),
      };
    } else {
      // Manual context. Need at least the JD or resume to generate
      // meaningful questions; reject if both are missing.
      if (!manualJd && !manualResumeText) {
        res.status(400).json({ error: "Provide jobId, or paste a JD or resume to practice manually." });
        return;
      }
      jobCtx = {
        description: String(manualJd || "").slice(0, 6000),
        resume_text: manualResumeText
          ? String(manualResumeText).slice(0, 6000)
          : await downloadResumeText(userId),
      };
    }

    // Story-bank cross-reference for behavioral mode.
    let storyBankTitles: string[] = [];
    if (mode === "behavioral") {
      try {
        const stories = await sql<any[]>`
          SELECT title FROM story_bank WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 20
        `;
        storyBankTitles = stories.map((s) => s.title).filter(Boolean);
      } catch { /* table may not exist for older deploys */ }
    }

    const questions = await generateQuestions(mode, difficulty, {
      ...jobCtx,
      fine_tune_focus: fineTuneFocus ? String(fineTuneFocus).slice(0, 1000) : null,
      story_bank_titles: storyBankTitles,
    });

    const insertRow: any = {
      user_id: userId,
      job_id: jobId ? parseInt(String(jobId), 10) : null,
      manual_jd: manualJd ? String(manualJd).slice(0, 8000) : null,
      manual_resume_text: manualResumeText ? String(manualResumeText).slice(0, 8000) : null,
      fine_tune_focus: fineTuneFocus ? String(fineTuneFocus).slice(0, 1000) : null,
      mode,
      status: "active",
      questions: sql.json(questions as any),
      transcript: sql.json([] as any),
    };
    const created = await sql<any[]>`
      INSERT INTO interview_sessions ${sql(insertRow)} RETURNING id, mode, questions
    `;
    res.json({
      sessionId: created[0].id,
      mode: created[0].mode,
      questions: created[0].questions,
      followupCap: FOLLOWUP_CAP,
      sessionMaxMs: SESSION_MAX_MS,
    });
  } catch (err: any) {
    console.error("[POST /api/interview/start]", err?.message || err);
    res.status(500).json({ error: err?.message || "Could not start session" });
  }
});

// ── POST /api/interview/turn ───────────────────────────────────────────
//
// Body: { sessionId, qIdx, answer, followUpDepth }
//
// Returns: { action: "follow_up" | "next" | "wrap", followUpQuestion?: string }
//
// The decide step. Looks at the current question + this answer +
// follow-up depth so far + the question's hidden hint, returns one of
// three actions. Doesn't append to the transcript here; the client
// is the source of truth for transcript and POSTs the cumulative
// transcript at /score time.
router.post("/turn", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { sessionId, qIdx, answer, followUpDepth } = req.body || {};
  const sid = parseInt(String(sessionId), 10);
  const idx = parseInt(String(qIdx), 10);
  const depth = Math.max(0, Math.min(FOLLOWUP_CAP, parseInt(String(followUpDepth || 0), 10) || 0));
  if (!Number.isFinite(sid) || !Number.isFinite(idx)) {
    res.status(400).json({ error: "Invalid sessionId or qIdx" }); return;
  }
  const ans = String(answer || "").trim();
  if (ans.length === 0) {
    // Empty answer; skip the model and go straight to a follow-up
    // prompt. The model would just generate a "could you elaborate?"
    // anyway, no need to spend a token round-trip on it.
    res.json({ action: "follow_up", followUpQuestion: "Take your time. What's the first thing that comes to mind?" });
    return;
  }

  // Give-up detection. If the candidate flat out says they don't know
  // / can't recall / want to skip, jumping straight to "next" is
  // strictly better than burning an OpenAI call only for it to come
  // back with "could you walk me through that with a specific example?"
  // The candidate already said no. Respect that.
  if (isGiveUpAnswer(ans)) {
    res.json({ action: "next" });
    return;
  }

  try {
    const rows = await sql<any[]>`
      SELECT mode, questions FROM interview_sessions
       WHERE id = ${sid} AND user_id = ${userId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) { res.status(404).json({ error: "Session not found" }); return; }
    const questions = row.questions as GeneratedQuestion[];
    const q = questions[idx];
    if (!q) { res.status(400).json({ error: "Question index out of range" }); return; }

    // If we're already at the follow-up cap, force "next" without
    // burning a model call.
    if (depth >= FOLLOWUP_CAP) {
      res.json({ action: "next" });
      return;
    }

    const openai = getOpenAI();
    if (!openai) { res.status(500).json({ error: "AI not configured" }); return; }

    const sys =
      "You are the interviewer in a live VOICE mock interview, deciding whether the candidate's answer needs a follow-up or whether to move on. " +
      "Return STRICT JSON: { action: 'follow_up' | 'next', ack: string, follow_up_question: string|null, reason: string }. " +
      "ack: a short spoken reaction to what they JUST said, max 12 words, referencing their actual content ('Shipping that under a deadline is a solid example.'). " +
      "It is read aloud before the next thing you say, so keep it natural and specific. Never generic filler ('Great answer!'), never condescending, no exclamation spam. If the answer was weak, the ack stays neutral ('Okay, I think I follow.'). " +
      "Choose 'follow_up' if the answer is short, vague, missing a key element from the rubric/hidden hint, or skips the situation/action/result. " +
      "Choose 'next' if the answer is complete enough to score. " +
      "follow_up_question: ONE probing angle only, one conversational sentence, written to be spoken aloud, no preamble, never a repeat of the original question.";

    const usr =
      `Mode: ${row.mode}\n` +
      `Question ${idx + 1}: ${q.question}\n` +
      `Question type: ${q.type}\n` +
      `Rubric dimensions to assess: ${q.rubric_target.join(", ")}\n` +
      `Hidden hint (interviewer note): ${q.hidden_hint}\n` +
      `Follow-up depth so far: ${depth} of ${FOLLOWUP_CAP}\n\n` +
      `Candidate's answer:\n${ans}\n\n` +
      "Decide.";

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      temperature: 0.4,
      max_tokens: 300,
    });

    let decision: any = {};
    try { decision = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch { /* fall through */ }
    const action = decision.action === "follow_up" ? "follow_up" : "next";
    const followUpQuestion = action === "follow_up"
      ? String(decision.follow_up_question || "Could you walk me through that with a specific example?").slice(0, 300)
      : undefined;
    // Spoken one-line reaction; the client prepends it to the next
    // prompt so the exchange sounds conversational.
    const ack = typeof decision.ack === "string" ? decision.ack.trim().slice(0, 140) : "";

    res.json({ action, followUpQuestion, ack });
  } catch (err: any) {
    console.error("[POST /api/interview/turn]", err?.message || err);
    res.status(500).json({ error: "Decide step failed" });
  }
});

// ── POST /api/interview/score ──────────────────────────────────────────
//
// Body: { sessionId, transcript: [{ qIdx, role, text, t_start, t_end }] }
//
// Final scoring pass. Computes deterministic metrics (filler words,
// WPM, hedging) and runs ONE LLM call for the qualitative rubric.
// Persists everything onto the session row + denormalizes
// readiness_score onto the jobs row when applicable.
router.post("/score", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { sessionId, transcript } = req.body || {};
  const sid = parseInt(String(sessionId), 10);
  if (!Number.isFinite(sid)) { res.status(400).json({ error: "Invalid sessionId" }); return; }
  if (!Array.isArray(transcript) || transcript.length === 0) {
    res.status(400).json({ error: "Missing transcript" }); return;
  }

  try {
    const rows = await sql<any[]>`
      SELECT mode, questions, job_id FROM interview_sessions
       WHERE id = ${sid} AND user_id = ${userId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) { res.status(404).json({ error: "Session not found" }); return; }
    const questions = row.questions as GeneratedQuestion[];

    // Deterministic metrics on user turns only.
    const userTurns = transcript.filter((t: any) => t.role === "user");
    const allText = userTurns.map((t: any) => String(t.text || "")).join(" ");
    const totalWords = (allText.match(/\b\w+\b/g) || []).length;
    const totalSeconds = userTurns.reduce(
      (s: number, t: any) => s + Math.max(0, ((t.t_end || 0) - (t.t_start || 0)) / 1000),
      0,
    );
    const fillerRegex = /\b(um|uh|like|you know|kind of|basically|literally|sort of)\b/gi;
    const fillerCount = (allText.match(fillerRegex) || []).length;
    const hedgingRegex = /\b(maybe|kinda|i guess|probably|i think|i mean|sort of)\b/gi;
    const hedgingCount = (allText.match(hedgingRegex) || []).length;
    const selfCorrectRegex = /\b(actually|wait|let me|sorry,)\b/gi;
    const selfCorrectCount = (allText.match(selfCorrectRegex) || []).length;
    const wpm = totalSeconds > 0 ? Math.round((totalWords / totalSeconds) * 60) : 0;

    const metrics = {
      total_words: totalWords,
      total_seconds: Math.round(totalSeconds),
      wpm,
      filler_count: fillerCount,
      filler_per_100w: totalWords > 0 ? Number(((fillerCount / totalWords) * 100).toFixed(1)) : 0,
      hedging_count: hedgingCount,
      self_correct_count: selfCorrectCount,
      turn_count: userTurns.length,
    };

    // LLM rubric.
    const openai = getOpenAI();
    if (!openai) { res.status(500).json({ error: "AI not configured" }); return; }

    const compact = transcript
      .map((t: any) => {
        const role = t.role === "ai" ? "INTERVIEWER" : "CANDIDATE";
        const txt = String(t.text || "").slice(0, 800);
        return `${role}: ${txt}`;
      })
      .join("\n");

    const sys =
      "You are an interview rubric scorer. Read the transcript and score 0-100 on each dimension. " +
      "Return STRICT JSON: { overall_readiness: 0-100, dimensions: { clarity, structure, technical_accuracy, jd_relevance, communication }, " +
      "by_question: [{ q_idx, score, strengths: [string], gaps: [string], pull_quote: string, model_answer: string }], " +
      "weak_areas_to_prep: [string], stories_used: [string] }. " +
      "Be strict on factual accuracy and structure (STAR for behavioral). Be generous on tone. " +
      "model_answer: 2-3 first-person sentences showing what a STRONG answer to this question would have sounded like for THIS candidate, reusing their real experience from the transcript where possible. Concrete and speakable; no clichés, no bullet lists. " +
      "weak_areas_to_prep is a 3-5 item action list, each starting with a verb. " +
      "stories_used names any specific past experiences the candidate referenced.";

    const usr =
      `Mode: ${row.mode}\n` +
      `Questions:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}\n\n` +
      `Transcript:\n${compact}\n\nScore now.`;

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      temperature: 0.3,
      max_tokens: 3000,
    });

    let rubric: any = {};
    try { rubric = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch { rubric = {}; }
    const readiness = Math.max(0, Math.min(100, parseInt(String(rubric.overall_readiness || 0), 10) || 0));

    await sql`
      UPDATE interview_sessions
         SET transcript = ${sql.json(transcript)},
             rubric = ${sql.json(rubric)},
             metrics = ${sql.json(metrics)},
             readiness_score = ${readiness},
             status = 'completed',
             ended_at = NOW(),
             updated_at = NOW()
       WHERE id = ${sid} AND user_id = ${userId}
    `;

    if (row.job_id) {
      await sql`
        UPDATE jobs SET interview_readiness_score = ${readiness}, updated_at = NOW()
         WHERE id = ${row.job_id} AND user_id = ${userId}
      `;
    }

    res.json({ readiness_score: readiness, rubric, metrics });
  } catch (err: any) {
    console.error("[POST /api/interview/score]", err?.message || err);
    res.status(500).json({ error: "Scoring failed" });
  }
});

// ── POST /api/interview/tts ────────────────────────────────────────────
//
// Body: { text }
// Returns: audio/mpeg stream from OpenAI tts-1.
//
// We proxy through the server so the OpenAI key never touches the
// browser. Streaming so first audio chunk arrives in ~400ms.
router.post("/tts", async (req: Request, res: Response) => {
  // Strip markdown artifacts (asterisks, backticks, headings) and
  // collapse whitespace so the voice never reads formatting aloud.
  const text = String((req.body || {}).text || "")
    .replace(/[*_#`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) { res.status(400).json({ error: "Missing text" }); return; }
  if (text.length > 1500) { res.status(400).json({ error: "Text too long" }); return; }
  const openai = getOpenAI();
  if (!openai) { res.status(500).json({ error: "AI not configured" }); return; }
  try {
    const speech = await openai.audio.speech.create({
      model: TTS_MODEL,
      // OpenAI's voice param is a string union; we cast since the env
      // var is free-form and the SDK validates the value at request time.
      voice: TTS_VOICE as any,
      input: text,
      response_format: "mp3",
    });
    const buf = Buffer.from(await speech.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.send(buf);
  } catch (err: any) {
    console.error("[POST /api/interview/tts]", err?.message || err);
    res.status(500).json({ error: "TTS failed" });
  }
});

// ── POST /api/interview/stt ────────────────────────────────────────────
//
// Body: multipart/form-data with field `audio` containing a recorded
// audio blob (audio/webm, audio/mp4, audio/ogg, audio/wav - anything
// Whisper accepts).
//
// Why this exists: the browser's built-in SpeechRecognition routes
// through Google's servers in Chrome and fails (network error) on
// corp networks, slow Wi-Fi, or anywhere those endpoints are blocked.
// Whisper round-trips through OUR server so it works wherever the
// dashboard works. ~$0.006 per minute, ~1s latency for short answers.
//
// 25MB hard cap matches Whisper's input limit.
const sttUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
router.post("/stt", sttUpload.single("audio"), async (req: Request, res: Response) => {
  const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname?: string } | undefined;
  if (!file || !file.buffer || file.buffer.length === 0) {
    res.status(400).json({ error: "Missing audio file" });
    return;
  }
  const openai = getOpenAI();
  if (!openai) { res.status(500).json({ error: "AI not configured" }); return; }
  try {
    // OpenAI's SDK accepts a File-like object; toFile wraps the buffer
    // with the right name + mime so the multipart upload to OpenAI
    // succeeds. We pick the extension from the mimetype since that's
    // what the SDK uses to set Content-Type on its outgoing request.
    const ext = (file.mimetype || "").includes("webm") ? "webm"
              : (file.mimetype || "").includes("mp4")  ? "mp4"
              : (file.mimetype || "").includes("ogg")  ? "ogg"
              : (file.mimetype || "").includes("wav")  ? "wav"
              : "webm";
    const oaiFile = await OpenAI.toFile(file.buffer, `audio.${ext}`, { type: file.mimetype || "audio/webm" });
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: oaiFile,
      // Force English unless the user has multi-language interviews
      // turned on later. Whisper auto-detects but English-locked is
      // ~30% faster and avoids occasional misdetection on short clips.
      language: "en",
      response_format: "json",
    });
    const text = String((transcription as any).text || "").trim();
    res.json({ text });
  } catch (err: any) {
    console.error("[POST /api/interview/stt]", err?.message || err);
    res.status(500).json({ error: "Transcription failed" });
  }
});

// ── GET /api/interview/sessions ────────────────────────────────────────
router.get("/sessions", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const rows = await sql<any[]>`
      SELECT s.id, s.mode, s.status, s.started_at, s.ended_at,
             s.readiness_score, s.metrics, s.job_id,
             j.job_title, j.company_name
        FROM interview_sessions s
        LEFT JOIN jobs j ON j.id = s.job_id AND j.user_id = ${userId}
       WHERE s.user_id = ${userId}
       ORDER BY s.started_at DESC
       LIMIT 50
    `;
    res.json({ sessions: rows });
  } catch (err: any) {
    console.error("[GET /api/interview/sessions]", err?.message || err);
    res.status(500).json({ error: "Could not list sessions" });
  }
});

// ── GET /api/interview/sessions/:id ────────────────────────────────────
router.get("/sessions/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await sql<any[]>`
      SELECT s.*, j.job_title, j.company_name, j.description AS job_description
        FROM interview_sessions s
        LEFT JOIN jobs j ON j.id = s.job_id AND j.user_id = ${userId}
       WHERE s.id = ${id} AND s.user_id = ${userId}
       LIMIT 1
    `;
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    const { user_id: _o, ...session } = rows[0];
    res.json(session);
  } catch (err: any) {
    console.error("[GET /api/interview/sessions/:id]", err?.message || err);
    res.status(500).json({ error: "Could not load session" });
  }
});

// ── PATCH /api/interview/sessions/:id (mark abandoned) ─────────────────
router.patch("/sessions/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { status } = req.body || {};
  if (status !== "abandoned") { res.status(400).json({ error: "Only status=abandoned is supported here" }); return; }
  try {
    await sql`
      UPDATE interview_sessions
         SET status = 'abandoned', ended_at = NOW(), updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[PATCH /api/interview/sessions/:id]", err?.message || err);
    res.status(500).json({ error: "Could not update session" });
  }
});

// ── GET /api/interview/quota ───────────────────────────────────────────
router.get("/quota", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan = req.user!.plan === "pro" || req.user!.plan === "enterprise" ? "pro" : "free";
  const used = await countSessionsToday(userId);
  res.json({ used, quota: DAILY_QUOTA[plan], remaining: Math.max(0, DAILY_QUOTA[plan] - used), plan });
});

export default router;
