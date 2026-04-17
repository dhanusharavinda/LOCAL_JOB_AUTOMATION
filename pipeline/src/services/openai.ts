import OpenAI from "openai";
import { config } from "../config";
import { JobVerdict, ResumeData } from "../types";
import {
  buildRelevanceSystemPrompt,
  buildRelevanceUserPrompt,
  SCORING_DIMENSIONS,
  scoreToLetterGrade,
  scoreTo10Scale,
} from "../prompts/relevance";
import type { ScoringDimensionKey } from "../prompts/relevance";
import { buildResumeSystemPrompt, buildResumeUserPrompt } from "../prompts/resume";
import { log } from "../logger";

/**
 * Prompt-caching note: OpenAI gpt-4o-mini automatically caches any identical
 * prefix ≥1024 tokens across requests in a ~5-10 minute window and bills
 * cached input tokens at 50%. Every function below is structured so the
 * *system* message holds the static bulk (framework + resume + instructions)
 * and the *user* message holds only the per-job JD. Do not re-inline the
 * resume into the user message — that breaks caching and roughly doubles
 * the input-token bill for Phase 1 scoring.
 */

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      maxRetries: 4,
      timeout: 120_000, // 2 minute timeout per request
    });
  }
  return client;
}

function cleanJsonResponse(text: string): string {
  return text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
}

export async function checkJobRelevance(
  resumeText: string,
  jobDescription: string,
  targetRole?: string
): Promise<JobVerdict> {
  const openai = getClient();

  // Truncate job description for relevance check to save tokens
  const truncatedDesc = jobDescription.length > 3000
    ? jobDescription.slice(0, 3000) + "\n[...truncated]"
    : jobDescription;

  // System message = static prefix (framework + resume + target role).
  // Must be byte-stable across all Phase 1 calls for prompt caching to hit.
  // User message = just the JD — small, unique per job.
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: buildRelevanceSystemPrompt(resumeText, targetRole) },
      { role: "user", content: buildRelevanceUserPrompt(truncatedDesc) },
    ],
    temperature: 0.3,
  });

  const rawText = response.choices[0]?.message?.content || "";
  const cleaned = cleanJsonResponse(rawText);

  try {
    const parsed = JSON.parse(cleaned);

    // New 10-dimension format
    if (parsed.dimensions && typeof parsed.dimensions === "object") {
      const dims = parsed.dimensions as Record<string, { score: number; reasoning: string }>;
      let weightedSum = 0;
      let totalWeight = 0;
      let gateCapped = false;

      for (const [key, cfg] of Object.entries(SCORING_DIMENSIONS)) {
        const dimKey = key as ScoringDimensionKey;
        const dimScore = dims[dimKey]?.score ?? 3;
        const clampedScore = Math.max(1, Math.min(5, dimScore));
        weightedSum += clampedScore * cfg.weight;
        totalWeight += cfg.weight;
        // Gate-pass check
        if (cfg.gate && clampedScore < 2) {
          gateCapped = true;
        }
      }

      let weightedScore = totalWeight > 0 ? weightedSum / totalWeight : 2.5;
      if (gateCapped) {
        weightedScore = Math.min(weightedScore, 2.0);
      }

      const letterGrade = scoreToLetterGrade(weightedScore);
      const score10 = scoreTo10Scale(weightedScore);
      const detectedRoleType = parsed.detected_role_type || "Other";

      return {
        verdict: parsed.verdict === true || parsed.verdict === "true" || weightedScore >= 2.5,
        reason: parsed.reason || "",
        score: score10,
        is_reach: parsed.is_reach === true || (dims.seniority_fit?.score <= 2 && dims.role_match?.score >= 3),
        score_breakdown: {
          dimensions: dims as any,
          weighted_score: Math.round(weightedScore * 100) / 100,
          letter_grade: letterGrade,
          detected_role_type: detectedRoleType,
          gate_capped: gateCapped,
        },
        detected_role_type: detectedRoleType,
      };
    }

    // Fallback: legacy single-score format
    return {
      verdict: parsed.verdict === true || parsed.verdict === "true",
      reason: parsed.reason || "",
      score: (() => {
        if (typeof parsed.score === "number") return parsed.score;
        const coerced = parseInt(String(parsed.score), 10);
        return isNaN(coerced) ? (parsed.verdict ? 5 : 2) : coerced;
      })(),
      is_reach: parsed.is_reach === true,
    };
  } catch {
    return { verdict: false, reason: "Failed to parse AI response", score: 0, is_reach: false };
  }
}

export async function customizeResume(
  resumeText: string,
  jobDescription: string,
  targetRole?: string
): Promise<ResumeData> {
  const openai = getClient();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Wait before retry (exponential backoff: 0s, 3s, 6s)
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }

      // System message = cacheable prefix: instructions + resume + schema.
      // User message = JD + intensity reminder. Across a pipeline run's 20
      // tailoring calls this lets OpenAI cache ~5K tokens at 50% billing.
      //
      // Model choice scales with intensity. At Level 10 the prompt requires
      // multi-step keyword extraction, verbatim JD mirroring, and fabrication
      // that's internally consistent with the candidate's real roles — gpt-4o-mini
      // drifts on instructions that complex. Intensities 1-9 stay on mini for cost.
      //
      // Temperature also scales inversely — Level 10 needs strict rule
      // adherence (mirror the JD mechanically), low levels need gentler
      // polish where some variation reads more natural.
      const intensity = config.TAILORING_INTENSITY;
      const model = intensity >= 10 ? "gpt-4o" : "gpt-4o-mini";
      const temperature = intensity >= 10 ? 0.2 : intensity >= 7 ? 0.3 : 0.4;
      const response = await openai.chat.completions.create({
        model,
        max_tokens: 16384,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildResumeSystemPrompt(resumeText, intensity, targetRole),
          },
          { role: "user", content: buildResumeUserPrompt(jobDescription, intensity) },
        ],
        temperature,
      });

      const rawText = response.choices[0]?.message?.content || "";
      const finishReason = response.choices[0]?.finish_reason;
      const cleaned = cleanJsonResponse(rawText);

      if (!cleaned) {
        throw new Error("OpenAI returned empty response for resume customization");
      }

      // If output was truncated, the JSON is likely incomplete
      if (finishReason === "length") {
        throw new Error("OpenAI output truncated (max_tokens reached) — retrying");
      }

      const parsed = JSON.parse(cleaned);
      if (!parsed?.resumeData?.personalInfo) {
        throw new Error("Resume JSON missing required structure (resumeData.personalInfo)");
      }

      // ── Post-LLM validation: detect dropped data ──
      // Goal: catch hard failures (zero experience, missing links) and
      // retry. Soft mismatches (got 2 education entries when the regex
      // counted 3 occurrences of "university") get logged but accepted —
      // the regex is naive and over-counts when "university" appears in
      // the summary, projects, or as part of an institution name spread
      // across multiple lines, leading to expensive retries that always
      // produce the same output anyway.
      const rd = parsed.resumeData;
      const softWarnings: string[] = []; // logged, never trigger retry
      const hardWarnings: string[] = []; // trigger retry

      // ── Education count check (SOFT) ──
      // Count distinct education-section markers. Over-counting is common
      // because the keyword can appear in non-education contexts.
      const eduMatches = resumeText.match(/\b(university|institute|college|school|academy|polytechnic)\b/gi);
      const expectedEdu = eduMatches ? eduMatches.length : 0;
      const gotEdu = (rd.education || []).length;
      if (expectedEdu > 0 && gotEdu < expectedEdu) {
        // Tolerate off-by-one (or off-by-two for very chatty resumes).
        const shortBy = expectedEdu - gotEdu;
        const note = `education: expected ~${expectedEdu}, got ${gotEdu}`;
        if (gotEdu === 0 || shortBy >= Math.max(2, Math.ceil(expectedEdu / 2))) {
          // Hard miss — likely actually dropping degrees, retry helps
          hardWarnings.push(note);
        } else {
          // Off-by-one or close — heuristic noise, accept silently
          softWarnings.push(note);
        }
      }

      // ── Personal-info link check (SOFT) ──
      // The regex matches URLs that may also appear in projects or experience
      // bullets, so missing-link warnings are advisory only.
      const urlMatches = resumeText.match(/https?:\/\/[^\s,)]+/g) || [];
      for (const url of urlMatches) {
        const urlLower = url.toLowerCase().replace(/\/+$/, "");
        const piValues = Object.values(rd.personalInfo || {}).map((v: any) =>
          typeof v === "string" ? v.toLowerCase().replace(/\/+$/, "") : ""
        );
        if (!piValues.some((v: string) => v.includes(urlLower) || urlLower.includes(v))) {
          softWarnings.push(`missing link: ${url}`);
        }
      }

      // ── Experience count check (HARD) ──
      // Empty experience for a resume with content is a real failure.
      const gotExp = (rd.experience || []).length;
      if (gotExp === 0 && resumeText.length > 500) {
        hardWarnings.push("experience array is empty");
      }

      // ── Certifications drop check (HARD) ──
      // If the source resume has a CERTIFICATIONS/LICENSES section or
      // credential keywords and the output has zero certifications, the
      // model silently dropped them. Retry.
      const hasCertSection = /\b(certifications?|licenses?|credentials?)\b\s*[:\-]?\s*\n/i.test(resumeText);
      const hasCertKeywords = /\b(certified|certificate|certification|credential|licensed)\b/i.test(resumeText);
      const gotCerts = (rd.certifications || []).length;
      if ((hasCertSection || hasCertKeywords) && gotCerts === 0) {
        hardWarnings.push("certifications dropped (source has credentials but output has none)");
      }

      const allWarnings = [...hardWarnings, ...softWarnings];
      if (allWarnings.length > 0) {
        log.warn(`Resume data validation: ${allWarnings.join("; ")}`);
      }

      // Only retry on hard warnings — soft ones don't improve with retries
      // and just burn OpenAI tokens for no quality gain.
      if (hardWarnings.length > 0 && attempt < maxAttempts) {
        throw new Error(`Incomplete resume data (${hardWarnings.join("; ")}) — retrying`);
      }

      return parsed as ResumeData;
    } catch (err: any) {
      if (attempt < maxAttempts) {
        log.warn(`Resume customization attempt ${attempt} failed (${err.message}), retrying...`);
      } else {
        throw new Error(`Resume customization failed after ${maxAttempts} attempts: ${err.message}`);
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Resume customization failed");
}
