import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { generateLocalPdf } from "../pdf";
import { uploadResumePdf } from "../storage";

/**
 * Resume Tailor — the marketing-bait feature on the landing page.
 *
 * Flow: anyone can open the landing page and fill the form, but the
 * client forces signup BEFORE calling this endpoint. Once authenticated,
 * the daily quota kicks in:
 *   free = 1/day
 *   pro  = 5/day
 * Counter resets at 00:00 UTC every day — mirrors the pipeline's
 * usage_tracking boundary so manual + auto tailors refill on the same tick.
 *
 * Enterprise is off during the testing phase; auth middleware coerces
 * legacy enterprise rows to 'pro' before they reach this route.
 */

const router = Router();
router.use(requireAuth);

// Strict per-plan daily quotas for the resume tailor hook. Shape the
// quotas so the STRICTEST bound wins if plan strings drift.
const DAILY_QUOTA: Record<"free" | "pro", number> = {
  free: 1,
  pro: 5,
};

function quotaFor(plan: string | undefined): number {
  if (plan === "pro" || plan === "enterprise") return DAILY_QUOTA.pro;
  return DAILY_QUOTA.free;
}

/**
 * Count rows created since the most recent 00:00 UTC boundary. Using
 * `date_trunc('day', NOW() AT TIME ZONE 'UTC')` pins the cutoff to
 * midnight UTC regardless of the DB's session timezone, so the quota
 * refills at the same instant for every user.
 */

async function ensureTable(): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS free_tailor_log (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  } catch {}
}

async function countUsedToday(userId: string): Promise<number> {
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM free_tailor_log
       WHERE user_id = ${userId}
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
    `;
    return parseInt(rows[0]?.count || "0", 10);
  } catch {
    await ensureTable();
    return 0;
  }
}

/**
 * Stable 64-bit key derived from the user id for pg_advisory_xact_lock.
 * Two concurrent tailor requests from the same user serialize on this
 * lock, closing the TOCTOU window between the quota check and the
 * usage-row insert. Different users hash to different keys and don't
 * contend.
 */
function advisoryLockKey(userId: string): bigint {
  // FNV-1a 64-bit — fast, no deps, good distribution.
  let h = 0xcbf29ce484222325n;
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  for (let i = 0; i < userId.length; i++) {
    h = (h ^ BigInt(userId.charCodeAt(i))) & MASK;
    h = (h * PRIME) & MASK;
  }
  // Postgres advisory locks take a signed bigint, so map to [-2^63, 2^63-1].
  const SIGNED_MAX = 0x7fffffffffffffffn;
  return h > SIGNED_MAX ? h - (MASK + 1n) : h;
}

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, maxRetries: 2 });
}

// ─── GET /api/free-tailor/status ────────────────────────────────────
router.get("/status", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan = req.user!.plan;
  const quota = quotaFor(plan);
  const used = await countUsedToday(userId);
  const remaining = Math.max(0, quota - used);
  res.json({
    plan,
    quota,
    used,
    remaining,
    usedToday: remaining === 0,
  });
});

// ─── POST /api/free-tailor ──────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan = req.user!.plan;
  const quota = quotaFor(plan);
  const { resumeText, jobDescription } = req.body;

  if (!resumeText || resumeText.length < 50) {
    res.status(400).json({ error: "Resume text must be at least 50 characters." });
    return;
  }
  if (!jobDescription || jobDescription.length < 30) {
    res.status(400).json({ error: "Job description must be at least 30 characters." });
    return;
  }

  const MAX_INPUT_CHARS = 25000;
  const totalInput = (resumeText?.length || 0) + (jobDescription?.length || 0);
  if (totalInput > MAX_INPUT_CHARS) {
    return res.status(400).json({ error: "Input too large. Resume + job description must be under 25,000 characters combined." });
  }

  // ── Plan-based daily quota: free=1, pro=5 ──
  // A pg transaction-scoped advisory lock keyed on the user id serializes
  // concurrent requests from the same user, so we cannot count `used=0`
  // in two tabs at once and burn two OpenAI calls. Different users hash
  // to different keys so they don't block each other.
  const lockKey = advisoryLockKey(userId);
  let used: number;
  try {
    used = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${lockKey})`;
      const rows = await tx<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM free_tailor_log
         WHERE user_id = ${userId}
           AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
      `;
      const current = parseInt(rows[0]?.count || "0", 10);
      if (current >= quota) return current;
      // Reserve the slot inside the same transaction so a second concurrent
      // request that re-reads after we commit sees the updated count.
      await tx`INSERT INTO free_tailor_log (user_id) VALUES (${userId})`;
      return current;
    }) as number;
  } catch (err: any) {
    console.error("[POST /api/free-tailor] quota txn failed", err?.message || err);
    res.status(500).json({ error: "Could not verify quota. Please try again." });
    return;
  }
  if (used >= quota) {
    const isPro = plan === "pro" || plan === "enterprise";
    const upgradeHint = isPro
      ? `You have used all ${quota} manual tailors for today. Your quota resets at 00:00 UTC.`
      : `You have used your ${quota} free tailor for today. Upgrade to Pro for 5 per day. Resets at 00:00 UTC.`;
    res.status(429).json({
      error: upgradeHint,
      upgrade: !isPro,
      plan,
      quota,
      used,
      remaining: 0,
    });
    return;
  }

  const openai = getOpenAI();
  if (!openai) {
    res.status(503).json({ error: "AI service is not configured on the server." });
    return;
  }

  try {
    // Clamp intensity (1-10) from the request; default to 5 = medium.
    const rawIntensity = Number((req.body as any).intensity);
    const intensity = Number.isFinite(rawIntensity)
      ? Math.min(10, Math.max(1, Math.round(rawIntensity)))
      : 5;

    // Don't truncate the resume too aggressively — when a candidate has
    // 3 degrees + 5 roles, a 6000-char clamp silently drops the later
    // entries, which is exactly the "only 1 education shows up" bug.
    // 16000 chars is roughly 4000 tokens, well within the context budget.
    const resume = resumeText.slice(0, 16000);
    const jd = jobDescription.slice(0, 4000);

    // Rough counts nudge the model to return the correct number of
    // entries. These heuristics are intentionally loose; the prompt
    // treats them as a hint, not a contract.
    const expectedEducation = (resume.match(/\b(?:University|Institute|College|School|Academy|B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D|Bachelor|Master|Doctorate|B\.?Tech|M\.?Tech|MBA)\b/gi) || []).length;
    const expectedExperience = (resume.match(/\b(?:Engineer|Developer|Manager|Analyst|Intern|Consultant|Designer|Scientist|Architect|Director|Lead|Specialist|Coordinator|Officer|Associate)\b/gi) || []).length;

    const systemPrompt = buildTailorPrompt(resume, intensity, expectedEducation, expectedExperience);
    const userPrompt = `Job description:\n\n${jd}\n\nProduce the tailored resume JSON now. Respond with ONLY the JSON object.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
      // Generous ceiling — a 3-degree / 5-role resume can easily exceed
      // the default cap, which manifests as truncated JSON (the model
      // hits the limit mid-array and we only get the first few entries).
      max_tokens: 4000,
    });

    const raw = completion.choices[0].message.content || "{}";
    let resumeData: any;
    try {
      resumeData = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "AI returned invalid JSON. Please try again." });
      return;
    }

    // The AI may return { resumeData: { ... } } or just { personalInfo, ... }
    const inner = resumeData.resumeData || resumeData;
    if (!inner.personalInfo) {
      res.status(500).json({ error: "AI output is missing required resume fields." });
      return;
    }

    // Generate PDF
    const pdfBuffer = await generateLocalPdf(inner);

    // Upload to storage so the user can re-download later. Use the
    // uploaded resume's original filename (minus extension) prefixed
    // with MODIFIED_ so the tailored PDF is visually paired with the
    // source file on disk. Fall back to a timestamp if the client
    // didn't send a name. We sanitise to safe filesystem characters.
    const rawOriginal = typeof (req.body as any).originalFilename === "string"
      ? (req.body as any).originalFilename
      : "";
    const baseName = rawOriginal
      .replace(/\.(pdf|docx?|rtf|txt)$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .slice(0, 80);
    const filename = baseName
      ? `MODIFIED_${baseName}.pdf`
      : `MODIFIED_free-tailor-${Date.now()}.pdf`;
    let pdfUrl: string | null = null;
    try {
      const result = await uploadResumePdf(userId, filename, pdfBuffer);
      pdfUrl = result.signedUrl;
    } catch {
      // Fall back to inline base64 if storage isn't configured.
    }

    // Usage row was already inserted under the advisory lock above; no
    // second insert here. Report the post-reservation count to the client.
    const newUsed = used + 1;
    res.json({
      pdfBase64: pdfBuffer.toString("base64"),
      pdfUrl,
      resumeData: inner,
      plan,
      quota,
      used: newUsed,
      remaining: Math.max(0, quota - newUsed),
    });
  } catch (err: any) {
    console.error("[POST /api/free-tailor]", err);
    // The slot was reserved before OpenAI was called; refund it on hard
    // failure so the user isn't charged for a tailor that didn't ship.
    // We delete the most recent row for this user in the 24h window.
    try {
      await sql`
        DELETE FROM free_tailor_log
         WHERE id = (
           SELECT id FROM free_tailor_log
            WHERE user_id = ${userId}
              AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
            ORDER BY created_at DESC
            LIMIT 1
         )
      `;
    } catch (refundErr: any) {
      console.error("[POST /api/free-tailor] refund failed", refundErr?.message || refundErr);
    }
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * Resume tailoring prompt. Mirrors the pipeline's 1-10 intensity scale
 * so the free hook produces the same quality output as a paid pipeline
 * run. The critical "preserve every entry" rules are hard-coded here
 * because the free-tailor endpoint is stateless — we only get one shot
 * per request, and truncating a candidate's third degree is the fastest
 * way to lose their trust.
 */
function buildTailorPrompt(
  resumeText: string,
  intensity: number,
  expectedEducation: number,
  expectedExperience: number
): string {
  let intensityRules: string;
  if (intensity <= 3) {
    intensityRules = `TAILORING INTENSITY: LOW (${intensity}/10)
- Preserve 75%+ of the original wording in every bullet.
- Add at most 2 JD keywords per bullet.
- Rewrite at most 1 bullet per role; leave the rest lightly polished.
- Do NOT reorder skills. Append new JD skills at the end of each category.
- Summary: change at most one phrase to reference the target role.`;
  } else if (intensity <= 6) {
    intensityRules = `TAILORING INTENSITY: MEDIUM (${intensity}/10)
- Preserve 50%+ of the original wording in every bullet.
- Add up to 4 JD keywords per bullet where they fit naturally.
- All bullets may be rewritten with stronger verbs + JD-relevant tools.
- Reorder skills so the most JD-relevant ones appear first in each category.
- Summary: rewrite with 3-5 JD keywords while keeping the candidate's voice.`;
  } else if (intensity <= 9) {
    intensityRules = `TAILORING INTENSITY: HIGH (${intensity}/10)
- No per-bullet keyword cap. Pull in JD KEYWORDS — meaning specific tools, technologies, platforms, methodologies, and domain nouns (e.g. "Salesforce", "HubSpot", "SQL", "pipeline hygiene", "outbound cadences"). NOT full JD sentences.
- Every bullet should name at least one JD tool or domain term if possible.
- Target 90%+ TOOL / SKILL coverage against the JD.
- Restructure skills categories around JD priorities.
- Summary: rewrite around the target role, but the sentences must describe the CANDIDATE's own achievements in their own framing. Do not echo JD responsibilities back.`;
  } else {
    intensityRules = `TAILORING INTENSITY: MAXIMUM (10/10)
- Aim for 90%+ keyword coverage against the JD, where "keyword" = a specific tool, technology, certification, methodology, or domain-specific noun (e.g. "Salesforce", "Outreach", "ABM", "MEDDIC", "ICP targeting"). Keywords are TOKENS, not PHRASES.
- Every bullet must reference JD-relevant tools, domain terms, or outcome types.
- You may invent realistic metrics that are plausible within the candidate's actual experience.
- You may add up to 2 new bullets per role that plausibly extend real work described in the resume.
- Restructure skills and summary around the target role.
- Still grounded: never invent companies, schools, job titles, or time periods.

=== ANTI-MIRRORING RULES (INTENSITY 10 — HARD STOPS) ===
A recruiter screening dozens of CVs spots JD-mirroring in seconds and reads it as lazy or manipulative. Avoid it absolutely:

1. NEVER copy sentence fragments of 4+ consecutive words from the JD into the resume (summary, bullets, skills headings). Running "analyzing lead data to identify patterns" back into the summary is an instant disqualifier.
2. NEVER paraphrase JD responsibility sentences into the SUMMARY. The summary describes the CANDIDATE's past achievements and positioning, in the candidate's own framing. It is NOT a restatement of the JD's "what you'll do" section.
3. Do NOT copy JD phrasings like "collaborating with X teams to optimize Y", "managing high volumes of Z", "driving [metric] through [activity]" — these are JD boilerplate, not resume material. If the candidate did similar work, describe it in the candidate's voice using their actual scope and outcomes.
4. Do NOT use JD-flavoured gerund-chains in the summary ("analyzing…collaborating…managing…"). Lead with concrete past-tense achievements.
5. Keywords travel as TOKENS (tool names, platform names, domain nouns, certifications, metric types). They do NOT travel as full JD phrases or sentence structures.
6. If the candidate's resume does NOT show evidence of a JD responsibility, don't fabricate that they performed it. You may include the adjacent tool/technology in the SKILLS section; do not stage-manage new bullets under unrelated roles.
7. The candidate's professional summary must open with a concrete past achievement or role framing in their voice. Example of BAD (JD-mirrored): "Motivated BDR analyzing lead data, collaborating with sales teams to optimize lead handoff, managing high-volume inbound leads." Example of GOOD: "Data engineer turned BDR-curious analyst, 2+ years turning messy CRM data into clean pipelines at [Company]. Comfortable with Salesforce and Outreach; built dashboards sales teams actually use."

Before you finalise the summary: read it back and ask "does any 4-word run also appear in the JD?" If yes, rephrase in the candidate's voice.`;
  }

  return `You are a senior resume writer who tailors resumes across every industry and role type. Output must be strictly valid JSON.

=== CANDIDATE RESUME (parse this completely) ===
${resumeText}
=== END RESUME ===

${intensityRules}

=== ZERO-DATA-LOSS RULES (HIGHEST PRIORITY — DO NOT VIOLATE) ===

1. EDUCATION — the candidate's resume appears to contain approximately ${expectedEducation} education-related markers. You MUST include EVERY degree / diploma / certification in the education array:
   - Every Bachelor's, Master's, PhD, MBA, diploma, bootcamp, or formal academic program.
   - Preserve institution name EXACTLY as written.
   - Preserve dates EXACTLY as written.
   - Preserve GPA / CGPA / percentage EXACTLY as written. Do not round, do not convert, do not drop.
   - If the candidate has 3 degrees, output 3 education entries. If they have 2, output 2. NEVER output fewer than the resume shows.

2. EXPERIENCE — the resume contains approximately ${expectedExperience} role-title markers. You MUST include EVERY job / internship / role in the experience array:
   - Every full-time role, part-time role, internship, freelance engagement, research position, teaching assistantship.
   - Preserve company name, role title, and date range EXACTLY as written.
   - LOCATION is mandatory whenever the resume specifies one. Never drop the location field. Never return null for location when the resume shows a city or country.
   - If a bullet has no metric, don't invent one unless intensity is 10.

3. PROJECTS — include EVERY project the resume describes:
   - Preserve project title, links (GitHub, demo URLs), and dates EXACTLY.
   - Include location when the resume specifies one.

4. PERSONAL INFO — copy verbatim:
   - Name, phone, email, LinkedIn, GitHub, portfolio. If the resume has a link, include it. Never substitute or rewrite URLs.

5. SKILLS — include EVERY skill the resume lists, grouped into the same categories (or your best inference of categories if the resume is flat).

6. CERTIFICATIONS / AWARDS — include EVERY entry from these sections if they exist.

7. SUMMARY — preserve hard facts verbatim:
   The original summary may contain factual statements that ATS systems and recruiters MUST see exactly as the candidate wrote them. Examples:
   - Work-authorization / visa / sponsorship status: "Authorized to work in Ireland - no employer sponsorship required", "EU citizen", "Stamp 1G visa, eligible to work full-time", "Tier 2 visa sponsorship required"
   - Security clearances: "Active TS/SCI clearance", "SC cleared (UK)"
   - Driving licenses / regulated certifications: "Full clean Irish driving license", "Registered with NMBI"
   - Availability: "Available immediately", "30-day notice period"

   When any such statement exists in the original summary:
   - Append it VERBATIM as the final sentence(s) of the rewritten summary.
   - Do NOT paraphrase, shorten, translate, or reword.
   - Keep original capitalization, punctuation, separators (em dash, hyphen, period).
   - The preserved sentence is in addition to your keyword-rich rewrite — it doesn't count toward sentence limits.
   When in doubt, PRESERVE IT. Cost of dropping a visa line = missed shortlist; cost of preserving = one extra sentence.

If you're unsure whether to include an item, INCLUDE IT. Omission is a failure.

=== BULLET REWRITE RULES ===
- For every bullet, return BOTH "original" (the exact text from the resume) AND "improved" (your tailored version).
- Set "accepted" to true for all improved bullets.
- If a bullet is already strong and needs no changes, set "improved" to null and "accepted" to false.
- Use strong action verbs. Lead with impact, not responsibilities.

=== ANTI-AI-SLOP ===
BANNED words: "leveraged", "spearheaded", "orchestrated", "pioneered", "cutting-edge", "innovative", "dynamic", "passionate", "results-driven", "synergy", "transformative", "delve", "foster", "showcase", "pivotal", "crucial".
BANNED punctuation: em dashes (—). Use commas, periods, or parentheses instead.
Sound human. Vary sentence length. Be specific about tools and outcomes.

=== OUTPUT JSON SCHEMA (strict) ===
{
  "resumeData": {
    "personalInfo": {
      "name": "string",
      "phone": "string or null",
      "email": "string or null",
      "linkedin": "string or null",
      "github": "string or null",
      "portfolio": "string or null"
    },
    "summary": "tailored summary string",
    "education": [
      { "institution": "string", "date": "string", "degree": "string", "gpa": "string or null" }
    ],
    "skills": { "Category Name": "skill1, skill2, skill3" },
    "experience": [
      {
        "title": "string",
        "company": "string",
        "date": "string",
        "location": "string (copy verbatim from resume when present, null only if truly absent)",
        "summary": "string or null",
        "bulletPoints": [
          { "original": "string", "improved": "string or null", "accepted": true }
        ]
      }
    ],
    "projects": [
      {
        "title": "string",
        "link": "string or null (copy verbatim)",
        "date": "string or null",
        "location": "string or null (copy verbatim)",
        "bulletPoints": [
          { "original": "string", "improved": "string or null", "accepted": true }
        ]
      }
    ],
    "certifications": [
      { "name": "string", "issuer": "string or null", "date": "string or null" }
    ],
    "awards": [
      { "title": "string", "issuer": "string or null", "date": "string or null" }
    ]
  }
}

=== FINAL CHECKS BEFORE RETURNING ===
1. Count entries in education. Does it match the number of degrees in the resume? If not, add the missing ones.
2. Count entries in experience. Does it match the number of roles? If not, add the missing ones.
3. For every experience entry, is "location" populated if the resume shows one? If not, fix it.
4. For every bullet, is "original" the verbatim resume text? If not, fix it.
5. Re-read the ORIGINAL summary. If it contained a work-authorization, visa, sponsorship, security-clearance, driving-license, or availability statement, that sentence MUST appear unchanged at the end of your rewritten summary. Verify character-for-character. If you paraphrased or dropped it, restore the original phrasing now.

Return ONLY the JSON object. No markdown, no backticks, no prose.`;
}

export default router;
