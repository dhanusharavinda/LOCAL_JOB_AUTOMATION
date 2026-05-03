import { LinkedInJob } from "../../types";
import { config } from "../../config";
import { log } from "../../logger";
import { deduplicateJobs } from "../deduplicator";
import { scrapeNaukriViaApify, scrapeIndeedViaApify } from "../apify";

/** Source display names for logging and UI labels */
export const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  naukri: "Naukri",
  indeed: "Indeed",
  company_portal: "Portal",
};

/**
 * Run the enabled Apify-backed scrapers (Naukri, Indeed) in parallel and
 * return deduplicated LinkedInJob[]. LinkedIn itself is scraped separately
 * from index.ts via scrapeLinkedInJobs — it uses a different actor and has
 * its own count/URL-building logic.
 *
 * Free scrapers (RemoteOK, Jobicy, Arbeitnow, CareerJet, Glassdoor,
 * Jobs.ie, IrishJobs, GradIreland, Instahyre, etc.) have been removed —
 * they were unreliable (HTML scraping breaks constantly) and their
 * low-quality output was polluting the AI relevance scoring step.
 */
export async function scrapeAllFreeSources(totalBudget?: number): Promise<LinkedInJob[]> {
  // Derive a usable keyword list with FOUR layers of fallback:
  //   1. SEARCH_KEYWORDS (explicit free-scraper config)
  //   2. LINKEDIN_KEYWORDS (filled via the role expander)
  //   3. TARGET_ROLE (the role string the user typed in)
  //   4. keywords param parsed out of LINKEDIN_SEARCH_URL — covers
  //      URL-mode users who never filled any keyword field
  const fromSearch = config.SEARCH_KEYWORDS.split(",").map((k) => k.trim()).filter(Boolean);
  const fromLinkedIn = config.LINKEDIN_KEYWORDS.split(",").map((k) => k.trim()).filter(Boolean);
  const fromTargetRole = config.TARGET_ROLE.trim() ? [config.TARGET_ROLE.trim()] : [];
  const fromUrl = (() => {
    if (!config.LINKEDIN_SEARCH_URL) return [] as string[];
    try {
      const u = new URL(config.LINKEDIN_SEARCH_URL);
      const raw = (u.searchParams.get("keywords") || "").trim();
      if (!raw) return [];
      // LinkedIn URLs use UPPERCASE OR as the boolean. Split on it (and
      // its lowercase variant in case the user typed naturally) plus
      // commas so each phrase becomes a separate Indeed search term.
      return raw
        .split(/\s+OR\s+|\s+or\s+|,/)
        .map((k) => k.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  })();

  let keywords = fromSearch;
  if (keywords.length === 0 && fromLinkedIn.length > 0) {
    log.info(`  SEARCH_KEYWORDS empty — falling back to LINKEDIN_KEYWORDS (${fromLinkedIn.slice(0, 3).join(", ")}...)`);
    keywords = fromLinkedIn;
  }
  if (keywords.length === 0 && fromTargetRole.length > 0) {
    log.info(`  SEARCH_KEYWORDS + LINKEDIN_KEYWORDS empty — falling back to TARGET_ROLE ("${fromTargetRole[0]}")`);
    keywords = fromTargetRole;
  }
  if (keywords.length === 0 && fromUrl.length > 0) {
    log.info(`  All keyword fields empty — extracted from pasted URL: ${fromUrl.slice(0, 3).join(", ")}`);
    keywords = fromUrl;
  }
  if (keywords.length === 0) {
    log.warn("SEARCH_KEYWORDS, LINKEDIN_KEYWORDS, TARGET_ROLE, and URL keywords are all empty — secondary scrapers can't run. Fill in at least one in your settings.");
    return [];
  }

  const targetCountries = config.TARGET_COUNTRIES.split(",").map((c: string) => c.trim().toLowerCase()).filter(Boolean);
  const wantsIndia = targetCountries.includes("india");

  log.step(`Scraping Indeed${wantsIndia ? " + Naukri" : ""} via Apify for keywords: ${keywords.slice(0, 5).join(", ")}...`);
  log.info(`  Target countries: ${targetCountries.join(", ") || "(none)"}`);

  // Split the raw-scrape budget evenly across active Apify sources so the
  // AI relevance filter (Phase 1) sees a comparable pool from each. Caller
  // passes the over-scraped budget (APIFY_JOB_COUNT * 2.5) so each source
  // returns enough candidates to survive the AI cut.
  const budget = totalBudget ?? Math.ceil(config.APIFY_JOB_COUNT * 2.5);
  const activeSources = wantsIndia ? 2 : 1; // Indeed always + Naukri when India
  const perSource = Math.max(10, Math.floor(budget / activeSources));

  const scraperTasks: Promise<LinkedInJob[]>[] = [];

  function withLog(name: string, p: Promise<LinkedInJob[]>): Promise<LinkedInJob[]> {
    return p.catch((err) => {
      log.warn(`Scraper [${name}] failed: ${err.message}`);
      return [];
    });
  }

  // Indeed always runs — the country flag inside scrapeIndeedViaApify picks
  // the right Indeed domain (IE, GB, NL, IN) based on TARGET_COUNTRIES.
  scraperTasks.push(withLog("Indeed", scrapeIndeedViaApify(perSource)));

  // Naukri only runs when India is selected — it's India-specific.
  if (wantsIndia) {
    scraperTasks.push(withLog("Naukri", scrapeNaukriViaApify(perSource)));
    log.info("  Naukri enabled (india in TARGET_COUNTRIES)");
  } else {
    log.info("  Naukri skipped (india not in TARGET_COUNTRIES)");
  }

  const results = await Promise.allSettled(scraperTasks);
  const allJobs: LinkedInJob[] = [];
  const sourceCounts: Record<string, number> = {};

  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const j of r.value) {
        allJobs.push(j);
        const src = (j as any).source || "unknown";
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      }
    }
  }

  for (const [src, cnt] of Object.entries(sourceCounts)) {
    log.info(`  ${SOURCE_LABELS[src] || src}: ${cnt} jobs`);
  }

  const deduped = deduplicateJobs(allJobs as any) as LinkedInJob[];

  log.success(`Apify scrapers: ${allJobs.length} raw → ${deduped.length} unique jobs`);
  return deduped;
}
