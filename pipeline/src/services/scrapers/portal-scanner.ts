/**
 * Portal Scanner — scrapes target company careers pages directly.
 * Supports Greenhouse (JSON API), Lever (JSON API), Ashby (HTML), and generic.
 * Inspired by career-ops scan.md.
 */

import { ScrapedJob } from "../../types";
import { log } from "../../logger";
import { config } from "../../config";
import { internalAuthHeaders } from "../job-tracker";

interface TargetCompany {
  id: number;
  company_name: string;
  careers_url: string;
  ats_type: string;
  title_keywords: string[];
  negative_keywords: string[];
  active: number;
}

const FETCH_TIMEOUT = 15000;

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// Global negative keywords applied to every portal — disqualifies obvious
// non-engineering roles (sales, account exec, marketing) before they ever
// reach the AI relevance pass, where gpt-4o-mini was rubber-stamping them
// as 8/10 "strong fit for Data Engineer" due to title-word matching.
const GLOBAL_NEGATIVES = (config.GLOBAL_PORTAL_NEGATIVE_KEYWORDS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function matchesTitleFilter(title: string, keywords: string[], negatives: string[]): boolean {
  const lower = title.toLowerCase();
  // Global negatives win first — even if the company config positively
  // matches (e.g. Cloudflare with keyword "engineer" would catch "Sales
  // Engineer"), the global ban on sales/AE titles drops it.
  if (GLOBAL_NEGATIVES.some((k) => lower.includes(k))) return false;
  // Must match at least one positive keyword
  const posMatch = keywords.length === 0 || keywords.some((k) => lower.includes(k.toLowerCase()));
  // Must not match any negative keyword
  const negMatch = negatives.some((k) => lower.includes(k.toLowerCase()));
  return posMatch && !negMatch;
}

// Country-name tokens for TARGET_COUNTRIES — used by the portal-side
// location filter to drop obviously foreign postings (Cloudflare's
// "Senior Territory Account Executive - North China" etc.) before they
// reach the downstream location-filter.ts pass.
const COUNTRY_LOCATION_TOKENS: Record<string, string[]> = {
  ireland: ["ireland", "dublin", "cork", "galway", "limerick", "waterford", "belfast"],
  uk: ["united kingdom", "england", "scotland", "wales", "london", "manchester", "birmingham", "edinburgh"],
  netherlands: ["netherlands", "amsterdam", "rotterdam", "utrecht", "eindhoven"],
  india: ["india", "bangalore", "bengaluru", "hyderabad", "mumbai", "pune", "chennai", "delhi"],
  newzealand: ["new zealand", "auckland", "wellington"],
};

const SELECTED_LOCATION_TOKENS: string[] = (() => {
  const countries = (config.TARGET_COUNTRIES || "ireland")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const out: string[] = [];
  for (const c of countries) out.push(...(COUNTRY_LOCATION_TOKENS[c] || [c]));
  return out;
})();

// "Anywhere / Remote / Worldwide" strings — kept when PORTAL_STRICT_LOCATION
// is on, because they don't name a foreign office. The downstream
// location-filter then re-evaluates them.
const PORTAL_REMOTE_TOKENS = ["remote", "anywhere", "worldwide", "global", "emea", "europe"];

function locationLooksTargeted(loc: string): boolean {
  if (!config.PORTAL_STRICT_LOCATION) return true;
  const lower = (loc || "").toLowerCase().trim();
  if (!lower) return true; // empty → defer to downstream filter
  if (SELECTED_LOCATION_TOKENS.some((t) => lower.includes(t))) return true;
  if (PORTAL_REMOTE_TOKENS.some((t) => lower.includes(t))) return true;
  return false;
}

const BANNED_COMPANIES = (config.BANNED_PORTAL_COMPANIES || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isCompanyBanned(name: string): boolean {
  const lower = name.toLowerCase();
  return BANNED_COMPANIES.some((b) => lower === b || lower.includes(b));
}

// Path segments that are NEVER a real ATS slug — they appear when a user
// pastes the marketing careers page (e.g. atlassian.com/company/careers)
// instead of the ATS-internal URL (boards.greenhouse.io/atlassian).
const NON_SLUG_PATH_PARTS = new Set([
  "company", "careers", "career", "jobs", "job", "all-jobs",
  "about", "about-us", "openings", "positions", "work-with-us",
  "join", "join-us", "join-our-team", "team", "hire",
]);

const KNOWN_ATS_HOSTS: Record<string, string[]> = {
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  lever: ["jobs.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
};

/**
 * Resolve the ATS-internal slug for a target company.
 *
 * Happy path: the careers_url is an ATS URL (boards.greenhouse.io/<slug>,
 * jobs.lever.co/<slug>, jobs.ashbyhq.com/<slug>) — take the first
 * non-empty path segment.
 *
 * Fallback: the user pasted a marketing page (atlassian.com/company/
 * careers) — derive a guess by lowercasing the company name with
 * non-alphanumeric chars stripped. That's the slug for ~90% of companies
 * (Atlassian → atlassian, Datadog → datadog). We log loudly so the user
 * sees the guess in the pipeline log and can override if the company's
 * actual slug is non-obvious (e.g. Spotify uses "spotifyjobs").
 */
function resolveAtsSlug(careersUrl: string, companyName: string, atsType: string): string | null {
  const knownHosts = KNOWN_ATS_HOSTS[atsType] || [];
  try {
    const url = new URL(careersUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const firstPart = parts[0] || "";

    // Happy path: URL is a known ATS host and path[0] looks like a slug.
    if (knownHosts.includes(url.hostname) && firstPart && !NON_SLUG_PATH_PARTS.has(firstPart.toLowerCase())) {
      return firstPart;
    }

    // Marketing-page case: ATS host doesn't match OR path[0] is a generic
    // word like "careers". Fall back to a name-derived slug + warn.
    const guess = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (guess) {
      log.warn(
        `[PortalScanner] ${companyName}: careers_url "${careersUrl}" doesn't look like a ` +
        `${atsType} ATS endpoint. Guessing slug = "${guess}" from company name. ` +
        `If this is wrong, update the careers_url to e.g. ${knownHosts[0] ? `https://${knownHosts[0]}/<real-slug>` : "the ATS-internal URL"}.`
      );
      return guess;
    }
    return null;
  } catch {
    log.warn(`[PortalScanner] ${companyName}: careers_url "${careersUrl}" is not a valid URL`);
    return null;
  }
}

/**
 * Greenhouse API: GET https://boards.greenhouse.io/v1/boards/{slug}/jobs
 * or GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 */
async function scrapeGreenhouse(company: TargetCompany): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const slug = resolveAtsSlug(company.careers_url, company.company_name, "greenhouse");
  if (!slug) return jobs;

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  try {
    const res = await fetch(apiUrl, { signal: withTimeout(FETCH_TIMEOUT) });
    if (!res.ok) {
      // A 404 means the board doesn't exist — the company isn't on
      // Greenhouse (or the slug is wrong). Say so explicitly instead of
      // letting the run report a misleading "0 matching jobs".
      if (res.status === 404) {
        log.warn(
          `[PortalScanner] ${company.company_name}: no Greenhouse board at slug "${slug}" (HTTP 404). ` +
          `The company is likely not on Greenhouse — fix ats_type/careers_url in Settings, or re-click "Seed Defaults" to repair the row.`
        );
      }
      return jobs;
    }
    const data = (await res.json()) as { jobs: Array<{ title: string; absolute_url: string; location?: { name: string }; updated_at?: string }> };
    if (!Array.isArray(data.jobs)) return jobs;

    // Sort by updated_at DESC before filtering so the per-company cap
    // keeps the FRESHEST keyword-matching postings, not arbitrary ones.
    const sortedJobs = [...data.jobs].sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });

    const cap = Math.max(1, config.MAX_JOBS_PER_PORTAL_COMPANY);
    let totalMatched = 0;
    let droppedForeign = 0;
    for (const j of sortedJobs) {
      if (!matchesTitleFilter(j.title, company.title_keywords, company.negative_keywords)) continue;
      const jobLoc = j.location?.name || "";
      if (!locationLooksTargeted(jobLoc)) { droppedForeign++; continue; }
      totalMatched++;
      if (jobs.length >= cap) continue; // keep counting for the log, but don't push
      jobs.push({
        title: j.title,
        companyName: company.company_name,
        link: j.absolute_url,
        applyUrl: j.absolute_url,
        location: jobLoc,
        postedAt: j.updated_at || "",
        source: "company_portal",
        tags: ["greenhouse", company.company_name.toLowerCase()],
      });
    }
    if (droppedForeign > 0) {
      log.info(`  [PortalScanner] ${company.company_name}: dropped ${droppedForeign} non-targeted-country postings (PORTAL_STRICT_LOCATION=on)`);
    }
    if (totalMatched > cap) {
      log.info(`  [PortalScanner] ${company.company_name}: ${totalMatched} matched, capped to ${cap} freshest (raise MAX_JOBS_PER_PORTAL_COMPANY to widen)`);
    }
  } catch (err: any) {
    log.warn(`[PortalScanner] Greenhouse ${company.company_name} failed: ${err.message}`);
  }
  return jobs;
}

/**
 * Lever API: GET https://api.lever.co/v0/postings/{company}?mode=json
 */
async function scrapeLever(company: TargetCompany): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const slug = resolveAtsSlug(company.careers_url, company.company_name, "lever");
  if (!slug) return jobs;

  const apiUrl = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  try {
    const res = await fetch(apiUrl, { signal: withTimeout(FETCH_TIMEOUT) });
    if (!res.ok) {
      if (res.status === 404) {
        log.warn(
          `[PortalScanner] ${company.company_name}: no Lever board at slug "${slug}" (HTTP 404). ` +
          `The company is likely not on Lever — fix ats_type/careers_url in Settings, or re-click "Seed Defaults" to repair the row.`
        );
      }
      return jobs;
    }
    const data = (await res.json()) as Array<{ text: string; hostedUrl: string; categories?: { location?: string }; createdAt?: number }>;
    // Lever answers missing boards with 200 + {"ok":false,"error":"Document
    // not found"} instead of a 404 — catch that shape explicitly.
    if (!Array.isArray(data)) {
      log.warn(
        `[PortalScanner] ${company.company_name}: Lever returned no board for slug "${slug}" ` +
        `(${JSON.stringify(data).slice(0, 80)}). The company is likely not on Lever — fix ats_type/careers_url in Settings.`
      );
      return jobs;
    }

    // Newest first so the per-company cap keeps the freshest postings.
    const sortedData = [...data].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const cap = Math.max(1, config.MAX_JOBS_PER_PORTAL_COMPANY);
    let totalMatched = 0;
    let droppedForeign = 0;
    for (const j of sortedData) {
      if (!matchesTitleFilter(j.text, company.title_keywords, company.negative_keywords)) continue;
      const jobLoc = j.categories?.location || "";
      if (!locationLooksTargeted(jobLoc)) { droppedForeign++; continue; }
      totalMatched++;
      if (jobs.length >= cap) continue;
      jobs.push({
        title: j.text,
        companyName: company.company_name,
        link: j.hostedUrl,
        applyUrl: j.hostedUrl,
        location: jobLoc,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : "",
        source: "company_portal",
        tags: ["lever", company.company_name.toLowerCase()],
      });
    }
    if (droppedForeign > 0) {
      log.info(`  [PortalScanner] ${company.company_name}: dropped ${droppedForeign} non-targeted-country postings`);
    }
    if (totalMatched > cap) {
      log.info(`  [PortalScanner] ${company.company_name}: ${totalMatched} matched, capped to ${cap} freshest`);
    }
  } catch (err: any) {
    log.warn(`[PortalScanner] Lever ${company.company_name} failed: ${err.message}`);
  }
  return jobs;
}

/**
 * Ashby: GET https://jobs.ashbyhq.com/api/non-user-graphql (POST with job board query)
 * Fallback: scrape HTML from https://jobs.ashbyhq.com/{company}
 */
async function scrapeAshby(company: TargetCompany): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const slug = resolveAtsSlug(company.careers_url, company.company_name, "ashby");
  if (!slug) return jobs;

  // Ashby GraphQL API
  try {
    const res = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: withTimeout(FETCH_TIMEOUT),
      body: JSON.stringify({
        operationName: "ApiJobBoardWithTeams",
        variables: { organizationHostedJobsPageName: slug },
        query: `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
          jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
            jobPostings { id title locationName employmentType publishedDate }
          }
        }`,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const postings = data?.data?.jobBoard?.jobPostings;
      // Ashby answers unknown orgs with 200 + jobBoard:null — flag it
      // explicitly rather than reporting a misleading "0 matching jobs".
      if (!Array.isArray(postings)) {
        log.warn(
          `[PortalScanner] ${company.company_name}: no Ashby job board found for slug "${slug}". ` +
          `The company is likely not on Ashby — fix ats_type/careers_url in Settings.`
        );
        return jobs;
      }
      if (Array.isArray(postings)) {
        const sortedPostings = [...postings].sort((a, b) => {
          const ta = a.publishedDate ? new Date(a.publishedDate).getTime() : 0;
          const tb = b.publishedDate ? new Date(b.publishedDate).getTime() : 0;
          return tb - ta;
        });
        const cap = Math.max(1, config.MAX_JOBS_PER_PORTAL_COMPANY);
        let totalMatched = 0;
        let droppedForeign = 0;
        for (const j of sortedPostings) {
          if (!matchesTitleFilter(j.title, company.title_keywords, company.negative_keywords)) continue;
          const jobLoc = j.locationName || "";
          if (!locationLooksTargeted(jobLoc)) { droppedForeign++; continue; }
          totalMatched++;
          if (jobs.length >= cap) continue;
          jobs.push({
            title: j.title,
            companyName: company.company_name,
            link: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
            applyUrl: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
            location: jobLoc,
            postedAt: j.publishedDate || "",
            source: "company_portal",
            tags: ["ashby", company.company_name.toLowerCase()],
          });
        }
        if (droppedForeign > 0) {
          log.info(`  [PortalScanner] ${company.company_name}: dropped ${droppedForeign} non-targeted-country postings`);
        }
        if (totalMatched > cap) {
          log.info(`  [PortalScanner] ${company.company_name}: ${totalMatched} matched, capped to ${cap} freshest`);
        }
        return jobs;
      }
    }
  } catch (err: any) {
    log.warn(`[PortalScanner] Ashby API ${company.company_name} failed: ${err.message}`);
  }
  return jobs;
}

/**
 * Fetch all target companies from the tracker API and scan them.
 */
export async function scanTargetCompanyPortals(): Promise<ScrapedJob[]> {
  // Fetch companies from tracker
  let companies: TargetCompany[] = [];
  try {
    const res = await fetch(`${config.JOB_TRACKER_URL}/api/target-companies`, {
      headers: internalAuthHeaders(),
      signal: withTimeout(FETCH_TIMEOUT),
    });
    if (!res.ok) {
      log.warn("[PortalScanner] Could not fetch target companies");
      return [];
    }
    companies = (await res.json()) as TargetCompany[];
  } catch (err: any) {
    log.warn(`[PortalScanner] Failed to fetch target companies: ${err.message}`);
    return [];
  }

  const active = companies.filter((c) => c.active);
  if (active.length === 0) {
    log.info("[PortalScanner] No active target companies configured");
    return [];
  }

  // Landing-page "Focus company" dropdown — when the user sets this on a
  // run, we narrow the scan to that one company. Everyone else's active
  // companies stay intact in the database; this is a per-run override.
  const focusId = config.TARGET_COMPANY_ID;
  const scanTargets = focusId
    ? active.filter((c) => String(c.id) === String(focusId))
    : active;

  if (focusId && scanTargets.length === 0) {
    log.warn(`[PortalScanner] TARGET_COMPANY_ID=${focusId} does not match any active company; skipping portal scan`);
    return [];
  }
  if (focusId) {
    log.info(`[PortalScanner] Focus mode: scanning only ${scanTargets[0].company_name} (id=${focusId})`);
  } else {
    log.info(`[PortalScanner] Scanning ${scanTargets.length} target company portals...`);
  }

  const allJobs: ScrapedJob[] = [];

  for (const company of scanTargets) {
    try {
      if (isCompanyBanned(company.company_name)) {
        log.info(`  [PortalScanner] ${company.company_name}: skipped (banned via BANNED_PORTAL_COMPANIES)`);
        continue;
      }
      let jobs: ScrapedJob[] = [];
      switch (company.ats_type) {
        case "greenhouse":
          jobs = await scrapeGreenhouse(company);
          break;
        case "lever":
          jobs = await scrapeLever(company);
          break;
        case "ashby":
          jobs = await scrapeAshby(company);
          break;
        default:
          // Custom/generic — no public ATS API to query, would need a
          // headless browser to scrape the marketing careers page. Kept
          // in the target_companies table so the company shows up in the
          // LinkedIn "Focus company" dropdown for narrowing LinkedIn
          // scrapes, but portal-scanner can't fetch jobs from them.
          log.info(
            `  [PortalScanner] ${company.company_name}: ats_type="custom" — no public API, skipped. ` +
            `(It's still useful as a LinkedIn focus filter.) ` +
            `If they actually use Greenhouse/Lever/Ashby, edit the row to set the right ats_type.`
          );
          continue;
      }
      if (jobs.length > 0) {
        log.success(`  [PortalScanner] ${company.company_name}: ${jobs.length} relevant jobs found`);
        allJobs.push(...jobs);
      } else {
        log.info(`  [PortalScanner] ${company.company_name}: 0 matching jobs`);
      }

      // Update last_scanned_at
      try {
        await fetch(`${config.JOB_TRACKER_URL}/api/target-companies/${company.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
          signal: withTimeout(5000),
          body: JSON.stringify({ last_scanned_at: new Date().toISOString() }),
        });
      } catch {}

      // Rate limit between companies
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err: any) {
      log.warn(`[PortalScanner] ${company.company_name} error: ${err.message}`);
    }
  }

  return allJobs;
}
