import crypto from "crypto";
import { ScrapedJob, LinkedInJob } from "../../types";

// User-Agent is country-agnostic — the old "DublinJobAgent" string was a
// leftover from the Ireland-only era and falsely signalled geographic
// context to servers that rate-limit by UA string.
export const SCRAPER_UA = "Mozilla/5.0 (compatible; JobTrackerBot/1.0; +https://github.com/user/job-tracker)";

export const HEADERS = {
  "User-Agent": SCRAPER_UA,
  Accept: "application/json, text/html, */*",
  // English-preferred with a generous fallback; no country lock. Sites
  // that serve region-specific HTML decide what to return based on
  // their own geolocation, not on this header alone.
  "Accept-Language": "en;q=0.9,*;q=0.5",
};

/** Compute SHA-256 hash for deduplication */
export function contentHash(title: string, company: string, location?: string): string {
  const raw = `${title.toLowerCase().trim()}|${company.toLowerCase().trim()}|${(location || "").toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** Compute freshness score (0–1) from a date string. 1 = posted today, 0 = 30+ days old */
export function freshnessScore(postedAt?: string): number {
  if (!postedAt) return 0.5;
  try {
    const posted = new Date(postedAt);
    if (isNaN(posted.getTime())) return 0.5;
    const daysOld = (Date.now() - posted.getTime()) / 86400000;
    if (daysOld <= 1) return 1.0;
    if (daysOld <= 3) return 0.9;
    if (daysOld <= 7) return 0.75;
    if (daysOld <= 14) return 0.55;
    if (daysOld <= 30) return 0.3;
    return 0.1;
  } catch { return 0.5; }
}

/** Fetch with timeout and user-agent */
export async function politeGet(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: HEADERS, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * If companyName is empty but the title contains "Company: Job Title" format,
 * split them apart. Many RSS feeds (WWR, RemoteOK, etc.) use this pattern.
 */
function splitTitleCompany(title: string, companyName: string): { title: string; companyName: string } {
  if (companyName && companyName.trim()) return { title, companyName };
  // Match "Company: Job Title" or "Company - Job Title" (but not "Sr. Engineer - Remote")
  const colonMatch = title.match(/^([^:]+):\s+(.+)$/);
  if (colonMatch && colonMatch[1].length <= 40) {
    return { title: colonMatch[2].trim(), companyName: colonMatch[1].trim() };
  }
  return { title, companyName: companyName || "Unknown" };
}

/** Convert a ScrapedJob to the LinkedInJob format used by the rest of the pipeline */
export function toLinkedInJob(j: ScrapedJob, hash: string, fresh: number): LinkedInJob {
  const { title, companyName } = splitTitleCompany(j.title, j.companyName);
  return {
    id: j.externalId || hash,
    link: j.link || "",
    title,
    companyName,
    companyWebsite: j.companyWebsite,
    companyLogo: j.companyLogo,
    location: j.location || "",
    salary: j.salary || "",
    postedAt: j.postedAt || "",
    descriptionText: j.descriptionText || "",
    applicantsCount: j.applicantsCount || "",
    applyUrl: j.applyUrl || j.link || "",
    seniorityLevel: j.seniorityLevel || "",
    employmentType: Array.isArray(j.employmentType) ? j.employmentType.join(", ") : String(j.employmentType || ""),
    source: j.source,
    sources: [j.source],
    contentHash: hash,
    tags: j.tags,
    freshnessScore: fresh,
  };
}

/** Check if a job was posted within the last N days (default 14). Returns true if recent or unknown. */
export function isRecentJob(postedAt?: string, maxDays = 14): boolean {
  if (!postedAt) return true; // unknown date — keep it, let the pipeline decide
  try {
    const posted = new Date(postedAt);
    if (isNaN(posted.getTime())) return true;
    const daysOld = (Date.now() - posted.getTime()) / 86400000;
    return daysOld <= maxDays;
  } catch { return true; }
}

/**
 * Country-aware location relevance for scraper-level pre-filtering.
 * Reads TARGET_COUNTRIES from config to decide what's relevant.
 * Accepts: jobs in selected countries, worldwide/global remote.
 * Rejects: jobs explicitly in non-selected countries.
 */
export function isLocationRelevant(location?: string, description?: string): boolean {
  if (!location && !description) return true; // unknown = let pipeline location filter decide

  const { config: pipeConfig } = require("../../config");
  const countries = (pipeConfig.TARGET_COUNTRIES || "ireland").split(",").map((c: string) => c.trim().toLowerCase());

  const locLower = (location || "").toLowerCase();
  const desc = (description || "").slice(0, 2000).toLowerCase();
  const combined = `${locLower} ${desc.slice(0, 500)}`;

  // Country-specific location patterns
  const COUNTRY_PATTERNS: Record<string, RegExp> = {
    ireland: /dublin|ireland|cork|galway|limerick|waterford|belfast|united kingdom|\buk\b|england|scotland|wales|london|manchester|birmingham|edinburgh|glasgow|europe|\beu\b|emea|netherlands|germany|france|spain|italy|portugal|belgium|austria|switzerland|sweden|denmark|norway|finland|poland|czech|amsterdam|berlin|munich|paris|barcelona|madrid|lisbon|brussels|vienna|zurich|stockholm|copenhagen/,
    india: /india|bangalore|bengaluru|hyderabad|mumbai|pune|chennai|delhi|new delhi|noida|gurgaon|gurugram|kolkata|ahmedabad|jaipur|kochi|coimbatore|chandigarh|indore/,
  };

  // Check if location matches any selected country
  for (const c of countries) {
    const pattern = COUNTRY_PATTERNS[c];
    if (pattern && pattern.test(combined)) return true;
  }

  // Remote/hybrid — accept if worldwide/global
  if (/remote|hybrid|wfh|work from home/i.test(combined)) {
    if (/worldwide|global|anywhere/i.test(combined)) return true;

    // Check for positive signals matching selected countries
    for (const c of countries) {
      const pattern = COUNTRY_PATTERNS[c];
      if (pattern && pattern.test(desc)) return true;
    }

    // Bare "Remote" with no signal — keep it, let the pipeline filter decide
    return true;
  }

  // No match — still keep for pipeline-level filtering (scraper pre-filter is lenient)
  return true;
}
