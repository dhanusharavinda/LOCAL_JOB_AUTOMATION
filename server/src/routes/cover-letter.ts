import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { downloadResumeText } from "../storage";

const router = Router();
router.use(requireAuth);

const CL_CHAT_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined, maxRetries: 2 });
}

/** Fetch job + resume text for the signed-in user. */
async function loadJobAndResume(userId: string, jobId: number): Promise<
  { error: string; status: number } |
  { job: { id: number; job_title: string; company_name: string; description: string | null }; resumeText: string }
> {
  const jobRows = await sql<{
    id: number;
    job_title: string;
    company_name: string;
    description: string | null;
  }[]>`
    SELECT id, job_title, company_name, description
      FROM jobs
     WHERE id = ${jobId} AND user_id = ${userId}
     LIMIT 1
  `;
  if (jobRows.length === 0) return { error: "Job not found", status: 404 } as const;
  const job = jobRows[0];
  if (!job.description) return { error: "Job has no description", status: 400 } as const;

  const profileRows = await sql<{ resume_text: string }[]>`
    SELECT resume_text FROM resume_profiles
     WHERE user_id = ${userId}
     ORDER BY is_default DESC, updated_at DESC
     LIMIT 1
  `;
  let resumeText = profileRows[0]?.resume_text || "";
  if (!resumeText) {
    const stored = await downloadResumeText(userId);
    if (stored) resumeText = stored;
  }
  if (!resumeText || resumeText.length < 50) {
    return { error: "No resume found. Upload one in Settings first.", status: 400 } as const;
  }

  return { job, resumeText } as const;
}

function buildPrompt(
  companyName: string,
  jobTitle: string,
  candidateSkills: string,
  jobDescription: string
): string {
  const jd = jobDescription.length > 4000 ? jobDescription.slice(0, 4000) + "..." : jobDescription;

  return `Write a cover letter for a job application. Output valid JSON only. No backticks, no markdown.

Return this exact JSON structure:
{
  "coverLetter": "the cover letter text here"
}

=== ANTI-AI-SLOP RULES (CRITICAL) ===
BANNED WORDS AND PHRASES:
- "I am writing to express my interest", "I am confident", "Thank you for your time and consideration"
- "highly motivated", "results-driven", "passionate about", "leveraged", "transformative", "groundbreaking"
- "delve", "foster", "enhance", "underscore", "showcase", "pivotal", "crucial", "vital", "vibrant"
- "tapestry", "landscape" (abstract), "testament", "enduring", "garnered", "interplay", "intricate"
- "Additionally", "Furthermore", "It's not just about X, it's about Y"
- "commitment to excellence", "cutting-edge", "innovative solutions", "dynamic environment"
- "I believe I would be a valuable addition", "I am eager to contribute"
- ZERO em dashes (—). Use commas, periods, or parentheses. The em dash is the loudest tell of AI writing — never include one.

STYLE REQUIREMENTS:
- Vary sentence length. Short punchy ones. Then longer ones that breathe.
- Use "I" naturally.
- Be specific. Reference actual tools and concrete outcomes.
- Sound like a real person who read this specific JD.
- Keep it tight. Every sentence earns its place.
- No curly quotes, no bolding. Plain text.

=== TRUTHFULNESS RULES (CRITICAL) ===
You only know the candidate through the CANDIDATE SKILLS list below.
- NEVER name a tool, framework, or technology that does NOT appear in CANDIDATE SKILLS as something the candidate has used. The skills list is your only source of truth.
- NEVER say "I haven't used X" or any negative-knowledge claim. You don't know what they haven't done.
- If a JD requirement isn't in the skills list, just talk about a different requirement that IS.

=== COVER LETTER RULES ===
- 3 short paragraphs, under 150 words total. Tight, not chatty.
- Start with "Dear Hiring Team,"
- First paragraph (1-2 sentences): mention the ${jobTitle} role and something concrete from the JD.
- Second paragraph (2-3 sentences): connect YOUR skills (from CANDIDATE SKILLS) to THEIR needs. Use real examples like "I built X that did Y", grounded in the skills list.
- Third paragraph (1-2 sentences): one specific thing about this role that interests you. Then sign off.
- Sign off: "Best regards"
- Double space between paragraphs (use \\n\\n)

=== JOB DESCRIPTION ===
${jd}

=== CANDIDATE SKILLS (your only source of truth for what the candidate has used) ===
${candidateSkills}

Generate the JSON now. No extra text outside the JSON.`;
}

function buildWhyFitPrompt(
  companyName: string,
  jobTitle: string,
  candidateSkills: string,
  jobDescription: string
): string {
  const jd = jobDescription.length > 4000 ? jobDescription.slice(0, 4000) + "..." : jobDescription;
  void companyName;

  return `Write a "why I'm a fit" summary for a ${jobTitle} role. Output valid JSON only. No backticks, no markdown.

Return this exact JSON structure:
{
  "whyImAFit": "the why I'm a fit summary here"
}

=== ANTI-AI-SLOP RULES (CRITICAL) ===
BANNED WORDS AND PHRASES:
- "highly motivated", "results-driven", "passionate about", "leveraged", "transformative"
- "delve", "foster", "enhance", "underscore", "showcase", "pivotal", "crucial", "vital"
- "commitment to excellence", "cutting-edge", "innovative solutions", "dynamic environment"
- ZERO em dashes (—). Use commas, periods, or parentheses. The em dash is the loudest tell of AI writing — never include one.

=== TRUTHFULNESS RULES (CRITICAL — read twice) ===
You only know the candidate through the CANDIDATE SKILLS list below. You do NOT know the candidate's full work history.
- NEVER say "I haven't used X" or "I haven't worked with X" or "while I'm new to X" or any negative-knowledge claim.
  You don't know what they haven't done. Inventing a gap is a hallucination that gets the candidate filtered out.
- NEVER speculate about gaps. If a JD requirement isn't in CANDIDATE SKILLS, just don't mention it. Pick a different requirement.
- NEVER name a specific tool, framework, or technology that does NOT appear in CANDIDATE SKILLS as something the candidate hasn't used. The skills list is your only source of truth.
- Only make positive claims grounded in the skills list.
- If you can't find at least 3 honest matches between CANDIDATE SKILLS and the JD, write fewer points rather than fabricate.

=== WHY I'M A FIT RULES ===
This section is read by the hiring team. They already know their company. Write as if speaking directly to them.

- 3-4 points (cap at 4), each ONE sentence. Two sentences max if the example needs a metric.
- Do NOT start any point with a dash, bullet, or number. Just write the sentences.
- Separate each point with \\n\\n (double newline)
- Do NOT refer to the company in third person. Address the requirement directly ("You need X").
- Format per point: name the JD requirement, then the concrete match from the candidate's skills.
- Pick the 3-4 STRONGEST positive matches. Do not list every JD requirement.
- NO generic points like "Strong communication skills" or "Team player"
- NO negative claims (see TRUTHFULNESS RULES above) — most common failure, instant filter-out for the candidate.
- Use plain text only

=== JOB DESCRIPTION ===
${jd}

=== CANDIDATE SKILLS (your only source of truth for what the candidate has used) ===
${candidateSkills}

Generate the JSON now. No extra text outside the JSON.`;
}

// ─── POST /api/jobs/:id/cover-letter ────────────────────────────────
router.post("/:id/cover-letter", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  try {
    const result = await loadJobAndResume(userId, id);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const { job, resumeText } = result;

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

    const skills = resumeText.slice(0, 2000);
    const prompt = buildPrompt(job.company_name, job.job_title, skills, job.description!);

    const completion = await openai.chat.completions.create({
      model: CL_CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const coverLetter = parsed.coverLetter || "";

    await sql`
      UPDATE jobs SET cover_letter = ${coverLetter}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;

    res.json({ cover_letter: coverLetter });
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/cover-letter]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/jobs/:id/why-fit ─────────────────────────────────────
router.post("/:id/why-fit", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  try {
    const result = await loadJobAndResume(userId, id);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const { job, resumeText } = result;

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

    const skills = resumeText.slice(0, 2000);
    const prompt = buildWhyFitPrompt(job.company_name, job.job_title, skills, job.description!);

    const completion = await openai.chat.completions.create({
      model: CL_CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const hiringMessage = parsed.whyImAFit || "";

    await sql`
      UPDATE jobs SET hiring_message = ${hiringMessage}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;

    res.json({ hiring_message: hiringMessage });
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/why-fit]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/jobs/:id/interview-prep ──────────────────────────────
router.get("/:id/interview-prep", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  try {
    const rows = await sql<{ interview_prep: string | null }[]>`
      SELECT interview_prep FROM jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    let parsed = null;
    try { parsed = rows[0].interview_prep ? JSON.parse(rows[0].interview_prep) : null; } catch {}
    res.json({ interview_prep: parsed });
  } catch (err: any) {
    console.error("[GET /api/jobs/:id/interview-prep]", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── POST /api/jobs/:id/interview-prep ─────────────────────────────
router.post("/:id/interview-prep", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  try {
    const result = await loadJobAndResume(userId, id);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const { job, resumeText } = result;

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

    const skills = resumeText.slice(0, 2000);
    const jd = (job.description || "").length > 4000
      ? job.description!.slice(0, 4000) + "..."
      : job.description || "";

    const prompt = `You are preparing a candidate for an interview for ${job.job_title} at ${job.company_name}. Output valid JSON only. No backticks, no markdown.

Return this exact JSON structure:
{
  "roleKeyThemes": ["theme1", "theme2", "theme3"],
  "topicsToStudy": [
    { "topic": "topic name", "why": "why this matters for the interview", "depth": "surface|working|deep" }
  ],
  "starStories": [
    { "scenario": "describe a situation to prepare", "maps_to": "which JD requirement it addresses", "tip": "how to frame the answer" }
  ],
  "companyIntel": {
    "whatTheyDo": "brief company description relevant to the role",
    "whyThisRole": "why this role exists and what impact it has",
    "sharpQuestions": ["question1", "question2", "question3"]
  },
  "opener": "a natural, confident opening line for the interview",
  "closerQuestions": ["thoughtful closing question 1", "thoughtful closing question 2"]
}

=== RULES ===
- 3-5 key themes that capture what the role is really about
- 4-6 topics to study, mix of surface/working/deep depth
- 3-5 STAR story scenarios tailored to this specific JD
- 3-4 sharp questions that show genuine interest and research
- 2-3 closer questions that are specific to this role/company
- Be specific to this exact role and company. No generic advice.
- No em dashes. Use commas or periods instead.

=== JOB DESCRIPTION ===
${jd}

=== CANDIDATE SKILLS ===
${skills}

Generate the JSON now.`;

    const completion = await openai.chat.completions.create({
      model: CL_CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");

    // Save to DB
    const prepJson = JSON.stringify(parsed);
    await sql`
      UPDATE jobs SET interview_prep = ${prepJson}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId}
    `;

    // Auto-generate STAR stories for the Story Bank from the prep
    if (parsed.starStories && Array.isArray(parsed.starStories)) {
      for (const story of parsed.starStories) {
        try {
          await sql`
            INSERT INTO story_bank (user_id, story_title, situation, task, action, result, tags, source_job_id)
            VALUES (
              ${userId},
              ${story.scenario || "Interview Story"},
              ${story.maps_to || "Mapped from JD requirement"},
              ${"Prepare a response demonstrating this competency"},
              ${story.tip || "Frame your answer using the STAR method"},
              ${"[To be filled after interview practice]"},
              ${sql.json([job.company_name, job.job_title].filter(Boolean))},
              ${id}
            )
          `;
        } catch {}
      }
    }

    res.json({ interview_prep: parsed });
  } catch (err: any) {
    console.error("[POST /api/jobs/:id/interview-prep]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
