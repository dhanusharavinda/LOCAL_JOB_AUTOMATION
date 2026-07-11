import { config, buildLinkedInUrl } from "../config";
import { LinkedInJob } from "../types";
import { log } from "../logger";

const BASE_URL = "https://api.apify.com/v2";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Apify is the upstream we cannot control - it returns 502/503/504/429
// often enough that ONE bad-gateway response shouldn't abort the whole
// pipeline run. Retry transient failures with exponential backoff before
// surfacing the error to the caller.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
async function apifyFetch(path: string, options?: RequestInit): Promise<any> {
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}token=${config.APIFY_API_TOKEN}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // fetch() is awaited OUTSIDE the response-status handling so that a
    // deliberate "non-retryable status" throw below isn't swallowed by the
    // network-error catch. (Previous version threw the 4xx error inside the
    // same try block, its own catch caught it, and 404s got retried twice
    // for nothing - "Apify API error: 404 Not Found - retrying (2/3)".)
    let res: Response | null = null;
    try {
      res = await fetch(url, options);
    } catch (err: any) {
      // fetch() rejection (DNS/network/timeout) - retryable
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (res) {
      if (res.ok) return res.json();
      const httpErr = new Error(`Apify API error: ${res.status} ${res.statusText}`);
      // Non-retryable (4xx other than 429) - a 404/401/403 won't heal on
      // retry; bail immediately instead of burning 7s of backoff.
      if (!RETRYABLE_STATUSES.has(res.status)) throw httpErr;
      lastErr = httpErr;
    }
    if (attempt < MAX_RETRIES) {
      // 1s, 2s, 4s - total worst-case 7s before giving up.
      const backoff = 1000 * Math.pow(2, attempt);
      log.warn(`  Apify request failed (${lastErr?.message}) - retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await delay(backoff);
    }
  }
  throw lastErr || new Error("Apify request failed after retries");
}

/**
 * Resolve the keyword list each Apify scraper should fan out over.
 * Normalizes case + dedups so "AI Engineer", "ai engineer", and
 * "  Ai Engineer  " collapse to one search term. Caps at
 * MAX_KEYWORDS_PER_SCRAPER (default 3) so a 10-keyword config doesn't
 * fan out into 10 Apify calls per scraper - that's a Apify-cost
 * disaster.
 *
 * Why this exists: every non-LinkedIn scraper used to take only
 * keywords[0], so a user with "ai engineer, ml engineer, data scientist"
 * silently dropped 2/3 of their interest before the AI scorer ever saw
 * those listings. The user's complaint about "missing relevant jobs"
 * traced back to here.
 */
export function pickScraperKeywords(raw: string): string[] {
  const max = Math.max(1, Math.min(10, config.MAX_KEYWORDS_PER_SCRAPER));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw.split(",")) {
    const trimmed = k.trim();
    if (!trimmed) continue;
    // Case-insensitive dedup. Indeed/Naukri/Truefetch all do
    // case-insensitive matching server-side - "AI" and "ai" return
    // the same listings - so running both is pure waste.
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Run a single Apify actor over MULTIPLE keywords in parallel, then
 * dedup the combined dataset by `link`. Each keyword pass requests
 * `ceil(totalBudget / keywords.length)` items so total items returned
 * lands near `totalBudget` regardless of how many keywords ran.
 *
 * `buildInput(keyword)` lets each scraper assemble its own
 * actor-specific input shape (Indeed: { title, country, limit };
 * Naukri: { keyword, maxJobs, fetchDetails }; Truefetch:
 * { keyword, country, max_results, ... }) while sharing the loop.
 */
async function runApifyActorMultiKeyword(
  actorId: string,
  keywords: string[],
  totalBudget: number,
  baseLabel: string,
  buildInput: (kw: string, perKwBudget: number) => Record<string, any>,
  normalize: (item: any) => LinkedInJob,
): Promise<LinkedInJob[]> {
  if (keywords.length === 0) return [];
  const perKwBudget = Math.max(10, Math.ceil(totalBudget / keywords.length));
  log.info(`  ${baseLabel}: fanning out across ${keywords.length} keyword(s) @ ${perKwBudget} jobs each`);

  // Parallel - same wall-clock time as one call. Individual failures
  // don't sink the whole scraper; allSettled lets partial successes
  // bubble through.
  const settled = await Promise.allSettled(
    keywords.map((kw) =>
      runApifyActor(actorId, buildInput(kw, perKwBudget), `${baseLabel}[${kw}]`)
    )
  );

  const merged: LinkedInJob[] = [];
  const seenLinks = new Set<string>();
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "rejected") {
      log.warn(`  ${baseLabel}[${keywords[i]}] failed: ${(r.reason as any)?.message || r.reason}`);
      continue;
    }
    for (const raw of r.value) {
      const job = normalize(raw);
      if (!hasRequiredFields(job)) continue;
      const key = job.link.toLowerCase();
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      merged.push(job);
    }
  }
  log.info(`  ${baseLabel}: ${merged.length} unique jobs after inline dedup`);
  return merged;
}

/**
 * Generic Apify actor runner. Starts the actor with the given input,
 * polls until the run terminates, then returns the dataset items.
 * Used by LinkedIn, Naukri, and Indeed scrapers - each passes its own
 * actor-specific input payload.
 */
async function runApifyActor(
  actorId: string,
  input: Record<string, any>,
  label: string
): Promise<any[]> {
  log.info(`Starting Apify ${label} scraper (${actorId})...`);
  const runResult = await apifyFetch(`/acts/${actorId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const runId = runResult.data.id;
  const datasetId = runResult.data.defaultDatasetId;
  log.info(`  ${label} run started (ID: ${runId})`);

  const pollIntervalMs = 10000;
  const maxPolls = Math.ceil((config.APIFY_MAX_POLL_MINUTES * 60 * 1000) / pollIntervalMs);
  let status = runResult.data.status;
  let pollCount = 0;

  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
    pollCount++;
    if (pollCount > maxPolls) {
      throw new Error(
        `Apify ${label} timed out after ${config.APIFY_MAX_POLL_MINUTES} minutes (run ID: ${runId}).`
      );
    }
    await delay(pollIntervalMs);
    const runInfo = await apifyFetch(`/actor-runs/${runId}`);
    status = runInfo.data.status;
    const elapsedSec = pollCount * (pollIntervalMs / 1000);
    log.info(`  ${label} scraping... (${elapsedSec}s elapsed, status: ${status})`);
  }

  if (status !== "SUCCEEDED") {
    throw new Error(`Apify ${label} run ${status}: ${runId}`);
  }

  const dataset = await apifyFetch(`/datasets/${datasetId}/items`);
  if (!Array.isArray(dataset)) {
    throw new Error(`Apify ${label} returned unexpected format (expected array)`);
  }
  log.success(`  ${label}: ${dataset.length} raw items`);
  return dataset;
}

/**
 * Internal helper that runs ONE LinkedIn scrape against a given URL.
 * Returns the validated jobs array (may be empty). Splitting this out
 * lets scrapeLinkedInJobs retry with a broadened URL when the first
 * pass returns 0 results.
 */
async function runLinkedInScrape(searchUrl: string, count: number, label: string): Promise<LinkedInJob[]> {
  log.info(`${label}...`);
  log.info(`  Search URL: ${searchUrl}`);
  log.info(`  Requesting ${count} jobs from Apify`);
  const runResult = await apifyFetch(`/acts/${config.APIFY_ACTOR_ID}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count, scrapeCompany: false, urls: [searchUrl] }),
  });
  const runId = runResult.data.id;
  const datasetId = runResult.data.defaultDatasetId;
  log.info(`Actor run started (ID: ${runId})`);

  const pollIntervalMs = 10000;
  const maxPolls = Math.ceil((config.APIFY_MAX_POLL_MINUTES * 60 * 1000) / pollIntervalMs);
  let status = runResult.data.status;
  let pollCount = 0;
  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
    pollCount++;
    if (pollCount > maxPolls) {
      throw new Error(
        `Apify actor timed out after ${config.APIFY_MAX_POLL_MINUTES} minutes (run ID: ${runId}). ` +
        `Check https://console.apify.com/actors/runs/${runId} for status.`
      );
    }
    await delay(pollIntervalMs);
    const runInfo = await apifyFetch(`/actor-runs/${runId}`);
    status = runInfo.data.status;
    const elapsedSec = pollCount * (pollIntervalMs / 1000);
    log.info(`  Scraping in progress... (${elapsedSec}s elapsed, status: ${status})`);
  }
  if (status !== "SUCCEEDED") throw new Error(`Apify actor run ${status}: ${runId}`);

  log.success("Scraping complete, fetching results...");
  const dataset = await apifyFetch(`/datasets/${datasetId}/items`);
  if (!Array.isArray(dataset)) throw new Error("Apify returned unexpected format (expected array)");
  return dataset as LinkedInJob[];
}

export async function scrapeLinkedInJobs(explicitCount?: number): Promise<LinkedInJob[]> {
  // Step 1: Start the actor run
  const searchUrl = buildLinkedInUrl();
  // Caller can override the scrape volume - the pipeline uses this to
  // over-scrape 3× the user's target so the AI relevance filter has enough
  // raw candidates to hit the target after filtering. Falls back to the
  // user-facing APIFY_JOB_COUNT when called without an argument.
  const count = explicitCount ?? config.APIFY_JOB_COUNT;

  let dataset = await runLinkedInScrape(searchUrl, count, "Starting Apify LinkedIn scraper");

  // Auto-broaden experience filter when 0 results came back AND f_E was
  // restricting things. Common case: user picked 'entry level' but the
  // current week only has senior listings. Rather than zero-result the
  // run, retry without f_E and let the AI scorer's seniority_fit
  // dimension penalise mid-senior matches in scoring instead. The
  // user's intent (entry-level preference) gets honoured by the
  // scorer's reasoning, just not as a hard scrape filter.
  if (dataset.length === 0) {
    try {
      const u = new URL(searchUrl);
      const hadF_E = u.searchParams.has("f_E");
      if (hadF_E) {
        const exp = u.searchParams.get("f_E") || "(none)";
        log.warn(
          `LinkedIn returned 0 jobs with experience filter f_E=${exp}. ` +
          "Retrying with experience filter removed - the AI scorer will still penalise non-matching seniority."
        );
        u.searchParams.delete("f_E");
        const broadenedUrl = u.toString();
        dataset = await runLinkedInScrape(broadenedUrl, count, "Retrying without experience filter");
        if (dataset.length === 0) {
          // Still nothing - fall through to the generic 0-result diagnostic.
          const kw = u.searchParams.get("keywords") || "(none)";
          const geo = u.searchParams.get("geoId") || "(none)";
          const tpr = u.searchParams.get("f_TPR") || "(none)";
          const wt = u.searchParams.get("f_WT") || "(any)";
          log.warn(
            `Retry also returned 0. Params: keywords="${kw.slice(0, 80)}" geoId=${geo} time=${tpr} workType=${wt}. ` +
            "The keywords + location combo has no listings in this time window. Try widening the time filter or simplifying keywords."
          );
        } else {
          log.success(`Broadened search returned ${dataset.length} jobs (experience filter removed).`);
        }
      } else {
        const kw = u.searchParams.get("keywords") || "(none)";
        const geo = u.searchParams.get("geoId") || "(none)";
        const tpr = u.searchParams.get("f_TPR") || "(none)";
        const wt = u.searchParams.get("f_WT") || "(any)";
        log.warn(
          `Search returned 0 jobs. Params used: keywords="${kw.slice(0, 80)}" geoId=${geo} time=${tpr} workType=${wt}. ` +
          "Common causes: time filter too narrow (try r604800 = 1 week), keywords too specific, or no listings for this combo."
        );
      }
    } catch {
      log.warn("Search returned 0 jobs and the search URL couldn't be parsed for diagnostics.");
    }
  }

  // Log raw keys of first item so we can debug field name mismatches
  if (dataset.length > 0) {
    const firstItem = dataset[0];
    const locationRelatedKeys = Object.keys(firstItem).filter((k) =>
      /loc|place|city|country|region/i.test(k)
    );
    log.info(`  [debug] First item location-related keys: ${JSON.stringify(locationRelatedKeys)}`);
    log.info(`  [debug] First item location value: ${JSON.stringify(firstItem.location)}`);
  }

  // Filter out jobs missing critical fields
  const validJobs = dataset.filter((job: any) => {
    if (!job.link || !job.title || !job.companyName) {
      log.warn(`Skipping job with missing data: ${job.title || "unknown"} @ ${job.companyName || "unknown"}`);
      return false;
    }
    return true;
  });

  if (validJobs.length < dataset.length) {
    log.warn(`${dataset.length - validJobs.length} jobs dropped due to missing required fields`);
  }

  // Sanitize fields that Apify may return as objects/arrays instead of
  // strings. The TypeScript type says employmentType is a string, but
  // the actor occasionally returns an array (e.g. ["Full-time","Remote"])
  // - cast to any so the runtime check + array-flatten doesn't fight
  // the narrowed type.
  for (const j of validJobs) {
    const job = j as any;
    if (job.employmentType && typeof job.employmentType !== "string") {
      job.employmentType = Array.isArray(job.employmentType)
        ? job.employmentType.join(", ")
        : String(job.employmentType);
    }
  }

  // ── Title-keyword pre-filter ─────────────────────────────────────
  //
  // LinkedIn's "keywords" param is a full-text search across title +
  // description, so a query for "ai engineer OR python developer"
  // happily returns "Trainee Optical Assistant" or "ESL Teacher" when
  // their JDs happen to mention python/data once. The AI scorer
  // catches them, but each one burns ~$0.001 in tokens and clutters
  // the run logs.
  //
  // Filter rule: the job title must contain at least one TECH token
  // from the user's keyword list. Generic seniority modifiers
  // (graduate / junior / intern / entry / etc.) are stripped out
  // because they match anything ("Graduate Veterinary Nurse"). If
  // strong tokens can't be extracted (user's keywords are all
  // seniority words), we skip the filter - better to over-include
  // than to silently zero-out the run.
  const filtered = applyTitleKeywordFilter(validJobs);
  return filtered as LinkedInJob[];
}

/** Seniority / generic modifiers that should NOT count as tech tokens
 *  (they match too many non-tech roles). Lowercase, alphanumeric only. */
const TITLE_FILTER_STOPWORDS = new Set([
  "graduate", "junior", "jr", "intern", "internship", "entry", "level",
  "mid", "senior", "sr", "principal", "lead", "staff", "associate",
  "year", "years", "fresher", "trainee", "apprentice", "i", "ii", "iii",
  "and", "or", "the", "a", "an", "of", "for", "to", "in", "with",
]);

function applyTitleKeywordFilter(jobs: any[]): any[] {
  const source = (config.SEARCH_KEYWORDS || config.LINKEDIN_KEYWORDS || config.TARGET_ROLE || "")
    .toLowerCase();
  if (!source.trim()) return jobs;

  const strongTokens = new Set<string>();
  for (const phrase of source.split(",")) {
    for (const tok of phrase.trim().split(/\s+/)) {
      const cleaned = tok.replace(/[^a-z0-9]/g, "");
      if (cleaned.length >= 2 && !TITLE_FILTER_STOPWORDS.has(cleaned)) {
        strongTokens.add(cleaned);
      }
    }
  }
  if (strongTokens.size === 0) return jobs;

  // Word-boundary regex per token so "ai" doesn't match "said" and
  // "ml" doesn't match "html". Escaped because tokens like "c++" or
  // ".net" would otherwise blow up the RegExp constructor.
  const patterns = Array.from(strongTokens).map(
    (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
  );
  const before = jobs.length;
  const kept = jobs.filter((j) => {
    const title = String((j as any).title || "");
    return patterns.some((re) => re.test(title));
  });
  const dropped = before - kept.length;
  if (dropped > 0) {
    const sample = Array.from(strongTokens).slice(0, 8).join(", ");
    const more = strongTokens.size > 8 ? `, +${strongTokens.size - 8} more` : "";
    log.info(
      `  Title-keyword filter: dropped ${dropped}/${before} jobs whose titles didn't match any tech keyword (${sample}${more}).`
    );
  }
  return kept;
}

// ──────────────────────────────────────────────────────────────────────
// Naukri (India) - Apify actor muhammetakkurtt~naukri-job-scraper
// ──────────────────────────────────────────────────────────────────────

/**
 * Scrape Naukri.com for Indian jobs via Apify. Only runs when "india" is
 * in TARGET_COUNTRIES. Returns jobs in LinkedInJob shape so downstream
 * scoring/tailoring doesn't care which source a job came from.
 */
export async function scrapeNaukriViaApify(count: number): Promise<LinkedInJob[]> {
  const keywords = pickScraperKeywords(config.SEARCH_KEYWORDS);
  if (keywords.length === 0) {
    log.warn("  Naukri: SEARCH_KEYWORDS is empty, skipping");
    return [];
  }

  // Naukri actor expects `keyword` + `maxJobs` (min 50). `fetchDetails: true`
  // is required to get the job description text - without it the actor only
  // returns title + company and the AI relevance step has nothing to score.
  return runApifyActorMultiKeyword(
    config.APIFY_NAUKRI_ACTOR_ID,
    keywords,
    count,
    "Naukri",
    (kw, perKw) => ({
      keyword: kw,
      maxJobs: Math.max(50, perKw),
      fetchDetails: true,
    }),
    normalizeNaukriJob,
  );
}

// ──────────────────────────────────────────────────────────────────────
// Indeed - Apify actor valig~indeed-jobs-scraper
// ──────────────────────────────────────────────────────────────────────

/**
 * Scrape Indeed via Apify. Runs for whichever country is in TARGET_COUNTRIES.
 * Country code maps to Indeed's domain (IE, UK, NL, IN, US, etc.).
 */
export async function scrapeIndeedViaApify(count: number): Promise<LinkedInJob[]> {
  const keywords = pickScraperKeywords(config.SEARCH_KEYWORDS);
  if (keywords.length === 0) {
    log.warn("  Indeed: SEARCH_KEYWORDS is empty, skipping");
    return [];
  }

  // Indeed country codes are lowercase ISO-3166-1 alpha-2 on this actor.
  // When a new country gets added to the dashboard picker, add its code
  // here too - the previous silent fallback to "ie" meant unknown
  // countries scraped Ireland, with no log line saying so.
  const countryCodeMap: Record<string, string> = {
    ireland: "ie",
    uk: "uk",
    netherlands: "nl",
    india: "in",
    newzealand: "nz",
  };
  const firstCountry = config.TARGET_COUNTRIES.split(",")[0].trim().toLowerCase();
  const country = countryCodeMap[firstCountry];
  if (!country) {
    log.warn(
      `  Indeed: TARGET_COUNTRIES="${firstCountry}" has no country-code mapping - skipping Indeed scrape rather than silently scraping the wrong country. ` +
      "Supported: ireland, uk, netherlands, india, newzealand."
    );
    return [];
  }

  // valig/indeed-jobs-scraper expects `title` (not `position`) and `limit`
  // (not `maxItems`). Output items have nested employer/location/description
  // objects - normalized in normalizeIndeedJob below.
  return runApifyActorMultiKeyword(
    config.APIFY_INDEED_ACTOR_ID,
    keywords,
    count,
    "Indeed",
    (kw, perKw) => ({ title: kw, country, limit: perKw }),
    normalizeIndeedJob,
  );
}

/**
 * Normalize a muhammetakkurtt/naukri-job-scraper item. Key fields:
 *   title, companyName, jdURL, location, salary, createdDate,
 *   tagsAndSkills (comma string), jobDescription (only with fetchDetails=true)
 */
function normalizeNaukriJob(item: any): LinkedInJob {
  const link = item.jdURL || item.url || item.link || "";
  const jd = item.jobDescription || item.jobDetails?.description || "";
  const salary =
    item.salary ||
    (item.jobDetails?.salaryDetail?.label) ||
    "";
  return {
    id: String(item.jobId || item.id || link),
    link,
    title: item.title || "",
    companyName: item.companyName || "",
    location: item.location || "",
    salary: typeof salary === "string" ? salary : String(salary),
    postedAt: item.createdDate || item.postedAt || "",
    descriptionText: typeof jd === "string" ? jd : String(jd),
    applicantsCount: "",
    applyUrl: link,
    seniorityLevel: item.experience || "",
    employmentType: "",
    source: "naukri",
    tags: typeof item.tagsAndSkills === "string"
      ? item.tagsAndSkills.split(",").map((t: string) => t.trim()).filter(Boolean)
      : undefined,
  };
}

/**
 * Normalize a valig/indeed-jobs-scraper item. Output has nested objects:
 *   title, url/jobUrl, employer.{name}, location.{city, countryName},
 *   baseSalary.{min, max, currencyCode}, description.{text, html},
 *   datePublished
 */
function normalizeIndeedJob(item: any): LinkedInJob {
  const link = item.jobUrl || item.url || "";
  const locParts = [item.location?.city, item.location?.admin1Code, item.location?.countryName]
    .filter(Boolean)
    .join(", ");
  const salary = item.baseSalary
    ? [item.baseSalary.min, item.baseSalary.max].filter(Boolean).join("-") +
      (item.baseSalary.currencyCode ? ` ${item.baseSalary.currencyCode}` : "")
    : "";
  const jd = item.description?.text || item.description?.html || "";
  return {
    id: String(item.key || item.refNum || link),
    link,
    title: item.title || "",
    companyName: item.employer?.name || "",
    location: locParts,
    salary,
    postedAt: item.datePublished || item.dateOnIndeed || "",
    descriptionText: jd,
    applicantsCount: "",
    applyUrl: link,
    seniorityLevel: "",
    employmentType: Array.isArray(item.jobTypes) ? item.jobTypes.join(", ") : "",
    source: "indeed",
  };
}

function hasRequiredFields(job: LinkedInJob): boolean {
  return !!(job.title && job.companyName && job.link);
}

// ──────────────────────────────────────────────────────────────────────
// Upwork - Apify actor upwork-vibe~upwork-job-scraper
//
// Different beast from Indeed/LinkedIn: Upwork has freelance / contract
// gigs, not full-time roles. Useful for users hunting contract work
// alongside full-time roles. Disabled by default (SCRAPE_UPWORK=false)
// because mixing freelance and full-time pollutes the AI relevance
// scoring's seniority_fit + compensation dimensions for users who
// only want full-time.
//
// Input shape (per actor docs):
//   limit, includeKeywords.{keywords[], matchTitle/Description/Skills},
//   vendor.experienceLevel (BEGINNER/INTERMEDIATE/EXPERT), fromDate
// Output: uid, title, description, externalLink, skills[], category,
//   budget.{hourlyRate,fixedBudget}, client.{industry,countryCode,stats}
// ──────────────────────────────────────────────────────────────────────

/**
 * Map the dashboard's LINKEDIN_EXPERIENCE codes (LinkedIn's f_E values)
 * to Upwork's vendor.experienceLevel enum. Returns undefined when the
 * user picked no level (don't restrict the search).
 */
function upworkExperienceFromConfig(raw: string | undefined): string[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const codes = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const out = new Set<string>();
  for (const code of codes) {
    if (code === "1" || code === "2") out.add("BEGINNER");
    else if (code === "3" || code === "4") out.add("INTERMEDIATE");
    else if (code === "5" || code === "6") out.add("EXPERT");
  }
  return out.size > 0 ? Array.from(out) : undefined;
}

export async function scrapeUpworkViaApify(count: number): Promise<LinkedInJob[]> {
  const keywords = pickScraperKeywords(config.SEARCH_KEYWORDS);
  if (keywords.length === 0) {
    log.warn("  Upwork: SEARCH_KEYWORDS is empty, skipping");
    return [];
  }

  const experienceLevels = upworkExperienceFromConfig(config.LINKEDIN_EXPERIENCE);
  // Upwork supports a `fromDate` ISO filter - mirror LINKEDIN_TIME_FILTER
  // so the user's "last week" preference flows here too.
  let fromDate: string | undefined;
  if (config.LINKEDIN_TIME_FILTER === "r86400")  fromDate = new Date(Date.now() - 86_400_000).toISOString();
  else if (config.LINKEDIN_TIME_FILTER === "r604800") fromDate = new Date(Date.now() - 604_800_000).toISOString();
  else if (config.LINKEDIN_TIME_FILTER === "r2592000") fromDate = new Date(Date.now() - 2_592_000_000).toISOString();

  return runApifyActorMultiKeyword(
    config.APIFY_UPWORK_ACTOR_ID,
    keywords,
    count,
    "Upwork",
    (kw, perKw) => {
      const input: Record<string, any> = {
        limit: Math.max(10, perKw),
        // Search title + description + skills so "ai" matches gigs
        // titled "Build me an LLM agent" with "AI" in the skills array.
        includeKeywords: {
          keywords: [kw],
          matchTitle: true,
          matchDescription: true,
          matchSkills: true,
        },
      };
      if (experienceLevels) input.vendor = { experienceLevel: experienceLevels };
      if (fromDate) input.fromDate = fromDate;
      return input;
    },
    normalizeUpworkJob,
  );
}

/**
 * Normalize an upwork-vibe/upwork-job-scraper item.
 *
 * The "company" concept doesn't quite map - Upwork clients are often
 * anonymous individuals. We synthesize a readable companyName from
 * the client's industry + country so the kanban card has something
 * informative to display. Falls back to "Upwork Client" if neither
 * field is present.
 */
function normalizeUpworkJob(item: any): LinkedInJob {
  const link = item.externalLink || item.url || "";
  const clientIndustry = item.client?.industry || "";
  const clientCountry = item.client?.countryCode || "";
  const companyName =
    (clientIndustry || clientCountry)
      ? `Upwork · ${[clientIndustry, clientCountry].filter(Boolean).join(", ")}`
      : "Upwork Client";

  let salary = "";
  if (item.budget?.hourlyRate?.min || item.budget?.hourlyRate?.max) {
    salary = `$${item.budget.hourlyRate.min || "?"}-${item.budget.hourlyRate.max || "?"}/hr USD`;
  } else if (item.budget?.fixedBudget) {
    salary = `$${item.budget.fixedBudget} fixed`;
  }

  return {
    id: String(item.uid || link),
    link,
    title: item.title || "",
    companyName,
    location: clientCountry || "Remote (Upwork)",
    salary,
    postedAt: item.createdAt || "",
    descriptionText: String(item.description || ""),
    applicantsCount: item.activity?.totalApplicants
      ? String(item.activity.totalApplicants)
      : "",
    applyUrl: link,
    seniorityLevel: item.vendor?.experienceLevel || "",
    employmentType: "Contract",
    source: "upwork",
    tags: Array.isArray(item.skills) ? item.skills : undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Truefetch best-job-listing - aggregator across Indeed/LinkedIn/Glassdoor
// Actor:  truefetch~best-job-listing
// Docs:   https://apify.com/truefetch/best-job-listing
//
// Why we added this: it's an aggregator that pulls from multiple sources
// in one call, which broadens the candidate pool the AI relevance filter
// scores against. Per the user's complaint that they pick "entry-level"
// and only see senior roles, more raw sources = more chance the AI sees
// a legitimately entry-level posting to score well.
//
// Input shape (per actor docs):
//   keyword (req), country (req), max_results (req, min 10),
//   location?, job_type?, posted_since?, remote_only?, currency?
//
// Output fields we map:
//   title, company_name, platform_url|official_url (→ link),
//   location, is_remote, job_type, job_level (→ seniorityLevel),
//   description, posted_date, salary_minimum/maximum/currency
// ──────────────────────────────────────────────────────────────────────

/**
 * Maps the dashboard's TARGET_COUNTRIES code to the human country name
 * truefetch expects. We do this conservatively (whitelist) - if the user
 * picks a country we haven't mapped, skip the scrape rather than guess.
 */
function truefetchCountryName(code: string): string | null {
  const map: Record<string, string> = {
    ireland: "Ireland",
    uk: "United Kingdom",
    netherlands: "Netherlands",
    india: "India",
    newzealand: "New Zealand",
    usa: "United States",
    us: "United States",
  };
  return map[code.toLowerCase()] || null;
}

export async function scrapeTruefetchViaApify(count: number): Promise<LinkedInJob[]> {
  const keywords = pickScraperKeywords(config.SEARCH_KEYWORDS);
  if (keywords.length === 0) {
    log.warn("  Truefetch: SEARCH_KEYWORDS is empty, skipping");
    return [];
  }
  const firstCountry = config.TARGET_COUNTRIES.split(",")[0]?.trim().toLowerCase() || "";
  const countryName = truefetchCountryName(firstCountry);
  if (!countryName) {
    log.warn(
      `  Truefetch: TARGET_COUNTRIES="${firstCountry}" has no country-name mapping - skipping. ` +
      "Supported: ireland, uk, netherlands, india, newzealand, usa."
    );
    return [];
  }

  // Map LINKEDIN_TIME_FILTER codes once outside the loop.
  let postedSince: string | undefined;
  if (config.LINKEDIN_TIME_FILTER === "r86400") postedSince = "1 day";
  else if (config.LINKEDIN_TIME_FILTER === "r604800") postedSince = "1 week";
  else if (config.LINKEDIN_TIME_FILTER === "r2592000") postedSince = "30 days";

  return runApifyActorMultiKeyword(
    config.APIFY_TRUEFETCH_ACTOR_ID,
    keywords,
    count,
    "Truefetch",
    (kw, perKw) => {
      const input: Record<string, any> = {
        keyword: kw,
        country: countryName,
        // Actor requires min 10; over-scrape so the AI filter has room.
        max_results: Math.max(10, perKw),
      };
      if (postedSince) input.posted_since = postedSince;
      return input;
    },
    normalizeTruefetchJob,
  );
}

/**
 * Normalize a truefetch/best-job-listing item into our LinkedInJob shape.
 * Field names per the actor docs (truefetch uses snake_case).
 */
function normalizeTruefetchJob(item: any): LinkedInJob {
  const link = item.platform_url || item.official_url || item.url || "";
  const salaryParts: string[] = [];
  if (item.salary_minimum) salaryParts.push(String(item.salary_minimum));
  if (item.salary_maximum) salaryParts.push(String(item.salary_maximum));
  const salary = salaryParts.length > 0
    ? salaryParts.join("-") + (item.salary_currency ? ` ${item.salary_currency}` : "")
    : "";
  return {
    id: String(item.id || item.platform_url || link),
    link,
    title: item.title || "",
    companyName: item.company_name || "",
    location: item.location || "",
    salary,
    postedAt: item.posted_date || "",
    descriptionText: String(item.description || ""),
    applicantsCount: "",
    applyUrl: link,
    seniorityLevel: item.job_level || item.experience_range || "",
    employmentType: item.job_type || "",
    source: "truefetch",
  };
}
