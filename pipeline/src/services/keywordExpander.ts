import OpenAI from "openai";
import { log } from "../logger";

/**
 * Keyword expansion service.
 *
 * Job boards do substring matching — typing "data engineer" misses
 * postings titled "ETL Engineer", "Analytics Engineer", "Data Platform
 * Engineer" even though those are the same job. This service runs one
 * LLM call per pipeline run to expand the candidate's raw role search
 * into the set of titles that recruiters actually use for the same role.
 *
 * Output is a CSV-joined string that gets written back into
 * config.SEARCH_KEYWORDS, so every downstream scraper (Indeed, Truefetch,
 * LinkedIn URL builder, Naukri) picks up the broader set automatically
 * via the existing pickScraperKeywords helper.
 *
 * Cost: ~$0.0002 per run with gpt-4o-mini. In-memory cache means one
 * call per pipeline invocation regardless of how many scrapers ask.
 */

let openaiClient: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    maxRetries: 1, // expansion is best-effort; don't burn time on retries
  });
  return openaiClient;
}

// In-memory cache keyed by the raw input. Same input → same output within
// the process lifetime. The pipeline is a short-lived subprocess so this
// effectively means "one call per run".
const cache = new Map<string, string[]>();

/**
 * Expand a CSV of role search keywords into a broader set of titles
 * that recruiters actually use for the same role.
 *
 * Returns the expanded list. Falls back to the original list (split
 * by comma) on any failure — never throws.
 *
 * @param raw - the user's raw SEARCH_KEYWORDS / TARGET_ROLE input
 * @param perInputVariants - how many alt-titles to generate per input role
 */
export async function expandKeywords(
  raw: string,
  perInputVariants = 4,
): Promise<string[]> {
  const input = (raw || "").trim();
  if (!input) return [];

  // Honour the cache so the multiple scrapers don't each pay for an
  // expansion call. The first scraper triggers it; the rest land here.
  const key = input.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  // Split the user's CSV so we can fall back to it on any error path.
  const literalKeywords = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const openai = getClient();
  if (!openai) {
    log.warn("  Keyword expansion: OPENAI_API_KEY not set, using raw keywords");
    cache.set(key, literalKeywords);
    return literalKeywords;
  }

  const sys =
    "You expand a job-seeker's role search keywords into a list of closely " +
    "related job titles that recruiters and companies use for essentially " +
    "the SAME role. Goal: catch listings where the company uses a slightly " +
    "different title (e.g. 'ETL Engineer' for a Data Engineer search) so " +
    "the candidate doesn't miss them.\n\n" +
    "Rules:\n" +
    "- Stick CLOSE to the original role. The expansion is for the SAME job, " +
    "not adjacent roles. Don't suggest 'Data Analyst' for a 'Data Engineer' " +
    "search — they're different jobs with different hiring criteria.\n" +
    "- Output ONLY job titles. No descriptions, no commentary.\n" +
    "- Do NOT include seniority words ('Junior X', 'Senior X', 'Lead X', " +
    "'Staff X', 'Principal X', 'I/II/III'). Seniority is filtered separately.\n" +
    "- Do NOT include the company name or location.\n" +
    "- Prefer titles that are common in job postings, not academic / niche.\n" +
    `- For each input role, include the original + ${perInputVariants} closely ` +
    "related variants. If the input already has multiple roles, expand each " +
    "and merge — total output should be roughly the number of input roles × " +
    `(${perInputVariants} + 1).\n` +
    "- Return STRICT JSON: { \"titles\": [\"title 1\", \"title 2\", ...] }";

  const usr = `Original keywords: "${input}"\n\nReturn the expanded titles list.`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const rawOutput = completion.choices[0]?.message?.content || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      parsed = null;
    }
    const titles: unknown = parsed?.titles;
    if (!Array.isArray(titles) || titles.length === 0) {
      log.warn("  Keyword expansion: model returned no titles, using raw input");
      cache.set(key, literalKeywords);
      return literalKeywords;
    }

    // Sanitize: strings only, trim, drop empties, dedupe case-insensitively,
    // drop titles that suspiciously contain seniority words despite the
    // system prompt (gpt sometimes ignores rules). Cap at 12 to keep the
    // scrape budget reasonable.
    const SENIORITY_RE = /\b(junior|jr|senior|sr|lead|staff|principal|head\s+of|chief|director|vp|i{1,3}\b|iv\b)\b/i;
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const t of titles) {
      const s = String(t).trim();
      if (!s || s.length > 80) continue;
      if (SENIORITY_RE.test(s)) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      cleaned.push(s);
      if (cleaned.length >= 12) break;
    }

    // Always keep the user's original literal keywords at the FRONT — if
    // the LLM somehow drops them, the user's stated intent stays intact.
    const merged: string[] = [];
    const finalSeen = new Set<string>();
    for (const k of [...literalKeywords, ...cleaned]) {
      const lk = k.toLowerCase();
      if (finalSeen.has(lk)) continue;
      finalSeen.add(lk);
      merged.push(k);
    }

    if (merged.length === 0) {
      cache.set(key, literalKeywords);
      return literalKeywords;
    }

    log.info(
      `  Keyword expansion: "${input}" → ${merged.length} titles (${merged.slice(0, 6).join(", ")}${merged.length > 6 ? "..." : ""})`
    );
    cache.set(key, merged);
    return merged;
  } catch (err: any) {
    // Never block the pipeline on expansion failures. Apify scrapes work
    // fine with just the literal user input — we'd just miss the
    // ETL-Engineer-shaped jobs.
    log.warn(`  Keyword expansion failed: ${err?.message || err}. Using raw input.`);
    cache.set(key, literalKeywords);
    return literalKeywords;
  }
}
