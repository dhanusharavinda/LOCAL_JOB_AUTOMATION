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

function matchesTitleFilter(title: string, keywords: string[], negatives: string[]): boolean {
  const lower = title.toLowerCase();
  // Must match at least one positive keyword
  const posMatch = keywords.length === 0 || keywords.some((k) => lower.includes(k.toLowerCase()));
  // Must not match any negative keyword
  const negMatch = negatives.some((k) => lower.includes(k.toLowerCase()));
  return posMatch && !negMatch;
}

/**
 * Greenhouse API: GET https://boards.greenhouse.io/v1/boards/{slug}/jobs
 * or GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 */
async function scrapeGreenhouse(company: TargetCompany): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  // Extract slug from URL patterns:
  // https://boards.greenhouse.io/{slug}
  // https://job-boards.greenhouse.io/{slug}
  let slug = "";
  try {
    const url = new URL(company.careers_url);
    const parts = url.pathname.split("/").filter(Boolean);
    slug = parts[0] || "";
  } catch {
    return jobs;
  }
  if (!slug) return jobs;

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  try {
    const res = await fetch(apiUrl, { signal: withTimeout(FETCH_TIMEOUT) });
    if (!res.ok) return jobs;
    const data = (await res.json()) as { jobs: Array<{ title: string; absolute_url: string; location?: { name: string }; updated_at?: string }> };
    if (!Array.isArray(data.jobs)) return jobs;

    for (const j of data.jobs) {
      if (!matchesTitleFilter(j.title, company.title_keywords, company.negative_keywords)) continue;
      jobs.push({
        title: j.title,
        companyName: company.company_name,
        link: j.absolute_url,
        applyUrl: j.absolute_url,
        location: j.location?.name || "",
        postedAt: j.updated_at || "",
        source: "company_portal",
        tags: ["greenhouse", company.company_name.toLowerCase()],
      });
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
  let slug = "";
  try {
    const url = new URL(company.careers_url);
    const parts = url.pathname.split("/").filter(Boolean);
    slug = parts[0] || "";
  } catch {
    return jobs;
  }
  if (!slug) return jobs;

  const apiUrl = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  try {
    const res = await fetch(apiUrl, { signal: withTimeout(FETCH_TIMEOUT) });
    if (!res.ok) return jobs;
    const data = (await res.json()) as Array<{ text: string; hostedUrl: string; categories?: { location?: string }; createdAt?: number }>;
    if (!Array.isArray(data)) return jobs;

    for (const j of data) {
      if (!matchesTitleFilter(j.text, company.title_keywords, company.negative_keywords)) continue;
      jobs.push({
        title: j.text,
        companyName: company.company_name,
        link: j.hostedUrl,
        applyUrl: j.hostedUrl,
        location: j.categories?.location || "",
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : "",
        source: "company_portal",
        tags: ["lever", company.company_name.toLowerCase()],
      });
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
  let slug = "";
  try {
    const url = new URL(company.careers_url);
    const parts = url.pathname.split("/").filter(Boolean);
    slug = parts[0] || "";
  } catch {
    return jobs;
  }
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
      if (Array.isArray(postings)) {
        for (const j of postings) {
          if (!matchesTitleFilter(j.title, company.title_keywords, company.negative_keywords)) continue;
          jobs.push({
            title: j.title,
            companyName: company.company_name,
            link: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
            applyUrl: `https://jobs.ashbyhq.com/${slug}/${j.id}`,
            location: j.locationName || "",
            postedAt: j.publishedDate || "",
            source: "company_portal",
            tags: ["ashby", company.company_name.toLowerCase()],
          });
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
          // Custom/generic — skip for now (would need Puppeteer or HTML parsing)
          log.info(`  [PortalScanner] ${company.company_name}: custom ATS, skipping automated scan`);
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
