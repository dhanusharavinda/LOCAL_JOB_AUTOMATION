import { config, buildLinkedInUrl } from "../config";
import { LinkedInJob } from "../types";
import { log } from "../logger";

const BASE_URL = "https://api.apify.com/v2";

async function apifyFetch(path: string, options?: RequestInit): Promise<any> {
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}token=${config.APIFY_API_TOKEN}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Apify API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generic Apify actor runner. Starts the actor with the given input,
 * polls until the run terminates, then returns the dataset items.
 * Used by LinkedIn, Naukri, and Indeed scrapers — each passes its own
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

export async function scrapeLinkedInJobs(explicitCount?: number): Promise<LinkedInJob[]> {
  // Step 1: Start the actor run
  const searchUrl = buildLinkedInUrl();
  // Caller can override the scrape volume — the pipeline uses this to
  // over-scrape 3× the user's target so the AI relevance filter has enough
  // raw candidates to hit the target after filtering. Falls back to the
  // user-facing APIFY_JOB_COUNT when called without an argument.
  const count = explicitCount ?? config.APIFY_JOB_COUNT;
  log.info("Starting Apify LinkedIn scraper...");
  log.info(`  Search URL: ${searchUrl}`);
  log.info(`  Requesting ${count} jobs from Apify`);
  const runResult = await apifyFetch(`/acts/${config.APIFY_ACTOR_ID}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      count,
      // scrapeCompany: false — halves actor compute cost by skipping the
      // per-job company profile fetch. We only used companyWebsite and
      // companyLinkedinUrl for the Google Sheets export, and both degrade
      // gracefully to empty cells. Scoring / tailoring never read them.
      scrapeCompany: false,
      urls: [searchUrl],
    }),
  });

  const runId = runResult.data.id;
  const datasetId = runResult.data.defaultDatasetId;
  log.info(`Actor run started (ID: ${runId})`);

  // Step 2: Poll until complete (with timeout)
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

    // Log EVERY poll so the SSE stream has a heartbeat and the UI
    // doesn't look frozen while Apify runs (used to log every 3rd).
    const elapsedSec = pollCount * (pollIntervalMs / 1000);
    log.info(`  Scraping in progress... (${elapsedSec}s elapsed, status: ${status})`);
  }

  if (status !== "SUCCEEDED") {
    throw new Error(`Apify actor run ${status}: ${runId}`);
  }

  // Step 3: Get dataset items
  log.success("Scraping complete, fetching results...");
  const dataset = await apifyFetch(`/datasets/${datasetId}/items`);

  // Validate that we got an array with data
  if (!Array.isArray(dataset)) {
    throw new Error("Apify returned unexpected format (expected array)");
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

  // Sanitize fields that Apify may return as objects/arrays instead of strings
  for (const job of validJobs) {
    if (job.employmentType && typeof job.employmentType !== "string") {
      job.employmentType = Array.isArray(job.employmentType)
        ? job.employmentType.join(", ")
        : String(job.employmentType);
    }
  }

  return validJobs as LinkedInJob[];
}

// ──────────────────────────────────────────────────────────────────────
// Naukri (India) — Apify actor muhammetakkurtt~naukri-job-scraper
// ──────────────────────────────────────────────────────────────────────

/**
 * Scrape Naukri.com for Indian jobs via Apify. Only runs when "india" is
 * in TARGET_COUNTRIES. Returns jobs in LinkedInJob shape so downstream
 * scoring/tailoring doesn't care which source a job came from.
 */
export async function scrapeNaukriViaApify(count: number): Promise<LinkedInJob[]> {
  const keywords = config.SEARCH_KEYWORDS.split(",").map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) {
    log.warn("  Naukri: SEARCH_KEYWORDS is empty, skipping");
    return [];
  }

  // Naukri actor expects `keyword` + `maxJobs` (min 50). `fetchDetails: true`
  // is required to get the job description text — without it the actor only
  // returns title + company and the AI relevance step has nothing to score.
  const items = await runApifyActor(
    config.APIFY_NAUKRI_ACTOR_ID,
    {
      keyword: keywords[0],
      maxJobs: Math.max(50, count),
      fetchDetails: true,
    },
    "Naukri"
  );

  return items.map((it: any) => normalizeNaukriJob(it)).filter(hasRequiredFields);
}

// ──────────────────────────────────────────────────────────────────────
// Indeed — Apify actor valig~indeed-jobs-scraper
// ──────────────────────────────────────────────────────────────────────

/**
 * Scrape Indeed via Apify. Runs for whichever country is in TARGET_COUNTRIES.
 * Country code maps to Indeed's domain (IE, UK, NL, IN, US, etc.).
 */
export async function scrapeIndeedViaApify(count: number): Promise<LinkedInJob[]> {
  const keywords = config.SEARCH_KEYWORDS.split(",").map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) {
    log.warn("  Indeed: SEARCH_KEYWORDS is empty, skipping");
    return [];
  }

  // Indeed country codes are lowercase ISO-3166-1 alpha-2 on this actor.
  // When a new country gets added to the dashboard picker, add its code
  // here too — the previous silent fallback to "ie" meant unknown
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
      `  Indeed: TARGET_COUNTRIES="${firstCountry}" has no country-code mapping — skipping Indeed scrape rather than silently scraping the wrong country. ` +
      "Supported: ireland, uk, netherlands, india, newzealand."
    );
    return [];
  }

  // valig/indeed-jobs-scraper expects `title` (not `position`) and `limit`
  // (not `maxItems`). Output items have nested employer/location/description
  // objects — normalized in normalizeIndeedJob below.
  const items = await runApifyActor(
    config.APIFY_INDEED_ACTOR_ID,
    { title: keywords[0], country, limit: count },
    "Indeed"
  );

  return items.map((it: any) => normalizeIndeedJob(it)).filter(hasRequiredFields);
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
