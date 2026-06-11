import path from "path";
import fs from "fs";
import { config, validateConfig } from "./config";
import { log } from "./logger";
import { PipelineStats, LinkedInJob } from "./types";
import { scrapeLinkedInJobs } from "./services/apify";
import { filterByLocation } from "./services/location-filter";
import { checkJobRelevance, customizeResume } from "./services/openai";
import { expandKeywords } from "./services/keywordExpander";
import { generateCoverLetter } from "./services/outreach-email";
import { generatePdf, warmUpPdfBackend, estimateResumePages } from "./services/pdf-generator";
import {
  checkDuplicatesBatch,
  titleCompanyKey,
  postFilteredJob,
  attachJobAssets,
  fetchResumeProfiles,
  fetchResumeText,
  matchResumeProfile,
  fetchJobAssetStatus,
  internalAuthHeaders,
  uploadTailoredPdf,
  ResumeProfile,
} from "./services/job-tracker";
import { scrapeAllFreeSources, SOURCE_LABELS } from "./services/scrapers/orchestrator";
import { mergeWithLinkedIn, computePriority } from "./services/deduplicator";
import { sendTelegramAlert } from "./services/telegram";
import { scrapeGradIrelandEvents } from "./services/scrapers/grad-ireland";
import { scrapeAllExtraEvents } from "./services/scrapers/event-scrapers";
import { scanTargetCompanyPortals } from "./services/scrapers/portal-scanner";

// Tailored PDFs are uploaded to Supabase Storage via the tracker's
// /api/jobs/upload-pdf endpoint (see uploadTailoredPdf in job-tracker.ts).
// No local filesystem writes anymore — this file used to maintain a
// server/resumes/ directory but the SaaS migration moved everything to
// cloud storage.

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight at once.
 * Preserves result order. Errors are rethrown by the caller inside fn.
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Phase 1 scoring concurrency. gpt-4o-mini Tier-1 is 500 RPM; 8 concurrent
// × ~1-2s/call → 240-480 RPM, comfortably inside the limit.
const PHASE1_CONCURRENCY = 8;

/**
 * Detect job category from title and description.
 */
function detectJobCategory(title: string, description: string): string | null {
  const text = (title + " " + (description || "")).toLowerCase();
  if (/\bintern(ship)?\b/.test(text)) return "intern";
  if (/graduate programme|grad programme|graduate program|grad scheme|new grad|graduate\s+recruit|graduate\s+role/.test(text)) return "graduate";
  if (/\bstartup\b|seed.?stage|series\s+[a-z0-9]+|pre.?seed|early.?stage|scale.?up/i.test(text)) return "startup";
  return null;
}

/**
 * Extract a comma-separated skills string from the resume data for outreach emails.
 */
/**
 * Translate the LINKEDIN_EXPERIENCE codes the dashboard stores
 * (LinkedIn's f_E values: 1=Intern, 2=Entry, 3=Associate, 4=Mid-Senior,
 * 5=Director, 6=Executive) into a human phrase the AI relevance scorer
 * can reason about. Returns undefined when no preference was set, in
 * which case the scorer falls back to inferring level from the resume.
 *
 * Multi-select case: the config stores a CSV ("2,3") — we join the
 * labels with " or " so the AI knows either is acceptable.
 */
function seniorityLabelFromConfig(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const LABELS: Record<string, string> = {
    "1": "Internship",
    "2": "Entry-level (0-2 years)",
    "3": "Associate (2-4 years)",
    "4": "Mid-Senior (5-8 years)",
    "5": "Director",
    "6": "Executive",
  };
  const labels = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((code) => LABELS[code])
    .filter(Boolean);
  if (labels.length === 0) return undefined;
  return labels.length === 1 ? labels[0] : labels.join(" or ");
}

function extractSkillsList(resumeData: any): string {
  const skills = resumeData?.resumeData?.skills;
  if (!skills || typeof skills !== "object") return "";
  const parts: string[] = [];
  for (const value of Object.values(skills)) {
    if (value && typeof value === "string" && value.trim()) parts.push(value);
  }
  const combined = parts.join(", ");
  // Take first ~150 chars to keep email concise
  return combined.length > 150 ? combined.slice(0, 150).replace(/,\s*$/, "") : combined;
}

async function main() {
  log.banner();
  const startTime = Date.now();

  // Validate configuration
  try {
    validateConfig();
    log.success("Configuration validated");
  } catch (err: any) {
    log.error(err.message);
    process.exit(1);
  }

  const stats: PipelineStats = {
    scraped: 0,
    locationFiltered: 0,
    relevant: 0,
    tailored: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
  };

  // ── Step 0: Expand role keywords semantically ──
  // Job boards do substring matching, so typing "data engineer" misses
  // "ETL Engineer" / "Analytics Engineer" listings even though they're
  // the same job. One small LLM call here expands the user's literal
  // input into the set of titles recruiters actually use, then mutates
  // config.SEARCH_KEYWORDS so every downstream scraper (Indeed,
  // Truefetch, LinkedIn URL builder, Naukri) picks up the broader set.
  //
  // Disabled by EXPAND_KEYWORDS=false for users who want strict literal
  // matching. Falls back to the raw input on any LLM failure — never
  // blocks the pipeline.
  if (config.EXPAND_KEYWORDS) {
    const rawSource = (config.SEARCH_KEYWORDS || config.TARGET_ROLE || "").trim();
    if (rawSource) {
      log.step("Expanding role keywords to catch synonymous titles...");
      const expanded = await expandKeywords(rawSource);
      if (expanded.length > 0) {
        // Mutation is contained: pipeline is a short-lived subprocess
        // per user run, config is module-scoped, and writing the
        // expanded string here means every reader downstream sees the
        // same broader set without threading a new arg through every
        // scraper signature.
        (config as any).SEARCH_KEYWORDS = expanded.join(", ");
      }
    }
  }

  // ── Step 1: Scrape LinkedIn jobs via Apify ──
  // APIFY_JOB_COUNT is the user's TARGET for relevant jobs AFTER the AI
  // filter. We over-scrape 2.5× upfront so the filter has enough raw
  // candidates to realistically hit that target without burning the budget.
  const OVERSCRAPE_MULTIPLIER = 2.5;
  const targetRelevantJobs = config.APIFY_JOB_COUNT;
  const effectiveScrapeCount = Math.ceil(targetRelevantJobs * OVERSCRAPE_MULTIPLIER);
  // User-facing log lines deliberately avoid mentioning "Apify" or
  // specific actor identifiers — those are implementation details the
  // job seeker doesn't need to think about. They see recognizable
  // job-board brands instead (LinkedIn / Indeed / Aggregator / etc.).
  log.step(`Scraping LinkedIn (target ${targetRelevantJobs} relevant → requesting ${effectiveScrapeCount} raw, ${OVERSCRAPE_MULTIPLIER}× over-scrape)...`);
  let allJobs;
  try {
    allJobs = await scrapeLinkedInJobs(effectiveScrapeCount);
    stats.scraped = allJobs.length;
    log.success(`LinkedIn: ${allJobs.length} jobs`);
  } catch (err: any) {
    log.error(`Scraping failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 1b: Scrape other boards (Indeed + Aggregator + Naukri if India + Upwork if enabled) ──
  // Same 3× over-scrape factor as LinkedIn so the AI relevance filter
  // (Phase 1) has enough candidates from every source to hit the target.
  log.step("Scraping other job boards...");
  let freeJobs: LinkedInJob[] = [];
  try {
    freeJobs = await scrapeAllFreeSources(effectiveScrapeCount);
    log.success(`Other boards: ${freeJobs.length} unique jobs (post-dedup within source group)`);
  } catch (err: any) {
    log.warn(`Other job boards failed: ${err.message} — continuing with LinkedIn only`);
  }

  // ── Step 1b.2: Scan target company portals (Feature 4) ──
  log.step("Scanning company careers portals...");
  let portalJobs: LinkedInJob[] = [];
  try {
    const scrapedPortals = await scanTargetCompanyPortals();
    // Convert ScrapedJob to LinkedInJob format
    portalJobs = scrapedPortals.map((j) => ({
      id: "",
      link: j.link || "",
      title: j.title,
      companyName: j.companyName,
      location: j.location || "",
      salary: j.salary || "",
      postedAt: j.postedAt || "",
      descriptionText: j.descriptionText || "",
      applicantsCount: "",
      applyUrl: j.applyUrl || j.link || "",
      seniorityLevel: j.seniorityLevel || "",
      employmentType: j.employmentType || "",
      source: "company_portal",
      sources: ["company_portal"],
      tags: j.tags,
    }));
    log.success(`Company Careers: ${portalJobs.length} jobs`);
  } catch (err: any) {
    log.warn(`Company portals failed: ${err.message} — continuing without portal jobs`);
  }

  // ── Step 1b.3: Per-source summary ──
  // One-glance recap of where the raw pool came from, so the user can
  // tell at a glance whether (e.g.) Indeed pulled its weight or
  // LinkedIn was carrying the run. We tally by `source` field which
  // every scraper stamps on its output rows.
  const allScraped = [...allJobs, ...freeJobs, ...portalJobs];
  const bySource: Record<string, number> = {};
  for (const j of allScraped) {
    const src = (j.source || "unknown");
    bySource[src] = (bySource[src] || 0) + 1;
  }
  // Stable order: anything in SOURCE_LABELS first (in its declared
  // order), then everything else alphabetically.
  const knownOrder = Object.keys(SOURCE_LABELS);
  const orderedSources = [
    ...knownOrder.filter((k) => bySource[k] != null),
    ...Object.keys(bySource).filter((k) => !knownOrder.includes(k)).sort(),
  ];
  log.info("Scrape source breakdown:");
  for (const src of orderedSources) {
    const label = SOURCE_LABELS[src] || src;
    log.info(`  ${label.padEnd(18)} ${bySource[src]} jobs`);
  }
  log.info(`  ${"Total raw".padEnd(18)} ${allScraped.length} jobs (before dedup across sources)`);

  // ── Step 1c: Merge LinkedIn + free sources + portal jobs (deduped) ──
  const mergedRaw = mergeWithLinkedIn(allJobs, [...freeJobs, ...portalJobs]);

  // ── Step 1c.1: Freshness cutoff — reject jobs older than configured max days ──
  const MAX_AGE_DAYS = config.MAX_AGE_DAYS;
  const cutoffMs = Date.now() - MAX_AGE_DAYS * 86400000;
  const mergedJobs = mergedRaw.filter((j) => {
    if (!j.postedAt) return true; // unknown date — keep
    try {
      const posted = new Date(j.postedAt);
      return isNaN(posted.getTime()) || posted.getTime() >= cutoffMs;
    } catch { return true; }
  });
  const staleDropped = mergedRaw.length - mergedJobs.length;
  log.success(`Merged total: ${mergedJobs.length} fresh jobs (${mergedRaw.length} raw, ${staleDropped} older than ${MAX_AGE_DAYS} days dropped)`);

  // ── Step 1c.2: Batch duplicate check — remove jobs already in tracker ──
  //
  // Two matching surfaces:
  //   1. URL match (job_link)
  //   2. Normalized (title, company) match
  //
  // The second catches postings whose URL drifts between scrape runs
  // (UTM tracking, re-publishes by the company, different scraper
  // sources surfacing the same role with different links). Without it,
  // a job moved to "applied" yesterday reappears as a fresh candidate
  // today if its tracking URL changed by a single query param.
  //
  // Flagged jobs are included in the duplicate set so user-blocked
  // postings stay out forever.
  log.step("Checking for duplicates against tracker (kanban dashboard)...");
  const probePayload = mergedJobs.map((j) => ({
    link: j.link || "",
    title: j.title || "",
    companyName: j.companyName || "",
  }));
  const dupResult = await checkDuplicatesBatch(probePayload);
  let dedupedJobs: LinkedInJob[];
  if (dupResult === null) {
    log.warn("Tracker unreachable for batch dedup — skipping all jobs to prevent duplicates");
    log.summary(stats);
    return;
  }
  const { links: dupLinks, titleCompanyKeys: dupTcKeys } = dupResult;

  // Two matching surfaces:
  //  - URL match (job_link exact)
  //  - normalized (title|company) match — handles re-published or
  //    cross-source dupes where the URL differs but it's clearly
  //    the same posting (e.g. user applied via the company's careers
  //    page yesterday, today the same role surfaces on Indeed).
  //
  // SAFETY: the title+company match is on the JOINED key
  // `${title}|${company}`, NOT on title OR company alone. So
  //   "Software Engineer" @ Google  vs  "Software Engineer" @ Stripe
  // never collide — they produce different keys ("software engineer|
  // google" vs "software engineer|stripe"). The server's SQL returns
  // the (title, company) PAIRS for each stored row, and the pipeline
  // checks `dupTcKeys.has(joinedKey)` on the SCRAPED job — so even
  // if the server query is over-permissive across rows (it ANDs two
  // ANY() arrays for index-friendliness), the client-side filter is
  // strict per-pair. Same role at different companies stays through.
  //
  // We log each filtered duplicate inline so the user can verify in
  // the run log exactly which "new" candidates got blocked by which
  // matching surface — the most-asked debugging question last week.
  const filteredOut: Array<{ job: LinkedInJob; reason: "url" | "title_company" }> = [];
  dedupedJobs = mergedJobs.filter((j) => {
    if (j.link && dupLinks.has(j.link)) {
      filteredOut.push({ job: j, reason: "url" });
      return false;
    }
    if (j.title && j.companyName && dupTcKeys.has(titleCompanyKey(j.title, j.companyName))) {
      filteredOut.push({ job: j, reason: "title_company" });
      return false;
    }
    return true;
  });
  const dupCount = filteredOut.length;
  stats.skipped += dupCount;
  if (dupCount > 0) {
    // Sample log the first ~6 so a 50-dupe run doesn't flood the log.
    const sample = filteredOut.slice(0, 6);
    for (const { job, reason } of sample) {
      log.skip(`  ↩ "${job.title}" @ ${job.companyName} (already in kanban, matched by ${reason})`);
    }
    if (filteredOut.length > sample.length) {
      log.info(`  …and ${filteredOut.length - sample.length} more dedup'd. See kanban for the matching rows.`);
    }
  }
  log.success(`${dedupedJobs.length} new jobs (${dupCount} duplicates filtered against kanban before AI scoring)`);

  // ── Step 1d: Archive ALL scraped jobs for historical skills analysis ──
  try {
    const archivePayload = dedupedJobs.map((j) => ({
      title: j.title,
      companyName: j.companyName,
      location: j.location,
      description: j.descriptionText,
      source: j.source || "linkedin",
      contentHash: j.contentHash || "",
    }));
    const archiveRes = await fetch(`${config.JOB_TRACKER_URL}/api/skills/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
      body: JSON.stringify({ jobs: archivePayload }),
    });
    // Previously we logged success unconditionally, so a 500 from the
    // server still printed "Archived N jobs" — making stale skills
    // trends extremely hard to debug. Now the success log only fires
    // when the archive actually succeeded.
    if (!archiveRes.ok) {
      const body = await archiveRes.text().catch(() => "");
      log.warn(`Job archive failed: HTTP ${archiveRes.status} ${body.slice(0, 200)}`);
    } else {
      log.success(`Archived ${dedupedJobs.length} jobs for skills analysis`);
    }
  } catch (err: any) {
    log.warn(`Job archive failed: ${err.message}`);
  }

  // ── Step 1e: Scrape career events — country-scoped ──
  // Each scraper is gated on the user's TARGET_COUNTRIES so a user on
  // India doesn't get flooded with Dublin-only events and vice versa.
  // GradIreland stays Ireland-only (it's a brand, not a source that
  // serves other regions); the generic extra sources (Meetup, TechMeetups)
  // fan out per country via scrapeAllExtraEvents(countries).
  try {
    const activeCountries = config.TARGET_COUNTRIES
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    // Thread the user's own search keywords into the event scrapers so
    // they filter events by the role the user actually cares about. A
    // management consultant no longer gets their events filtered by
    // tech-only keywords.
    const userEventKeywords = config.SEARCH_KEYWORDS
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const eventTasks: Array<Promise<any[]>> = [];
    if (activeCountries.includes("ireland")) {
      eventTasks.push(scrapeGradIrelandEvents(userEventKeywords));
    }
    eventTasks.push(scrapeAllExtraEvents(activeCountries, userEventKeywords));

    const eventResults = await Promise.all(eventTasks);
    const flat = eventResults.flat();

    // Merge and deduplicate by event_url
    const seenUrls = new Set<string>();
    const allEvents = flat.filter((e: any) => {
      if (seenUrls.has(e.event_url)) return false;
      seenUrls.add(e.event_url);
      return true;
    });

    if (allEvents.length > 0) {
      const evRes = await fetch(`${config.JOB_TRACKER_URL}/api/events/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
        body: JSON.stringify({ events: allEvents }),
      });
      const evData = await evRes.json() as { inserted?: number };
      log.success(`Career events for ${activeCountries.join(",") || "(none)"}: ${allEvents.length} scraped, ${evData.inserted ?? allEvents.length} new`);
    } else {
      log.info("  No new career events found");
    }
  } catch (err: any) {
    log.warn(`Career events scrape failed: ${err.message}`);
  }

  // ── Step 2: Filter by location ──
  log.step("Filtering by location (per TARGET_COUNTRIES / LOCATION_REGIONS)...");
  const locationFiltered = filterByLocation(dedupedJobs);
  stats.locationFiltered = locationFiltered.length;
  log.success(
    `${locationFiltered.length} jobs in target locations (filtered out ${dedupedJobs.length - locationFiltered.length})`
  );

  if (locationFiltered.length === 0) {
    log.warn("No jobs in target locations. Pipeline complete.");
    log.summary(stats);
    return;
  }

  // Sort by priority = freshness × 0.3 + score-placeholder × 0.7 (pre-AI sort; re-sort post-AI is done individually)
  // For now sort by freshnessScore descending so newest jobs are processed first
  locationFiltered.sort((a, b) => (b.freshnessScore ?? 0.5) - (a.freshnessScore ?? 0.5));

  // ── Step 3: Fetch resume text (once, reused for all jobs) ──
  // Sourced exclusively from the tracker's upload endpoint now that the
  // Google Docs fallback has been removed. Users must upload a resume via
  // the Settings modal before running the pipeline.
  log.step("Fetching uploaded resume from tracker...");
  let resumeText: string;
  try {
    resumeText = await fetchResumeText();
    if (!resumeText || resumeText.length < 100) {
      log.error(`No resume uploaded or too short (${resumeText?.length ?? 0} chars). Upload your resume in Settings → Resume before running the pipeline.`);
      process.exit(1);
    }
    log.success(`Resume loaded (${resumeText.length} chars)`);
  } catch (err: any) {
    log.error(`Failed to fetch resume: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3b: Wake up PDF backend before processing starts ──
  await warmUpPdfBackend();

  // ── Step 4 Phase 1: Score ALL jobs (concurrent) ──
  const intensityLabel =
    config.TAILORING_INTENSITY <= 3
      ? "LOW"
      : config.TAILORING_INTENSITY <= 6
        ? "MEDIUM"
        : config.TAILORING_INTENSITY <= 9
          ? "HIGH"
          : "MAXIMUM";
  log.step(`Phase 1: Scoring ${locationFiltered.length} jobs (target: ${targetRelevantJobs} relevant after filter, threshold: >= ${config.RELEVANCE_SCORE_THRESHOLD}, concurrency: ${PHASE1_CONCURRENCY})...\n`);

  interface ScoredJob {
    job: LinkedInJob;
    verdict: { verdict: boolean; score: number; reason: string; is_reach: boolean; score_breakdown?: any; detected_role_type?: string };
    jobCategory: string | null;
  }
  const scoredJobs: ScoredJob[] = [];
  // Track every score (including rejected ones) so we can show the user
  // a distribution histogram at the end. Lets them calibrate the
  // threshold based on what their actual scrape returned, instead of
  // guessing from a generic warning.
  const allScores: number[] = [];
  // Track jobs whose final score was gate-capped (role_match=1 AND
  // skills_alignment=1 → score forced down to 4/10 regardless of other
  // dimensions). High gate-cap counts mean the keyword search is pulling
  // off-target jobs; the AI scorer is doing its job but the scrapers
  // aren't. Adjacent tech roles (Data Scientist for a Data Engineer
  // candidate) only flag one gate and bubble up on their merits now.
  let gateCappedCount = 0;
  let completedCount = 0;

  // Phase 1a: score EVERY job in parallel. No budget cap inside this
  // loop — that was the old bug. The previous code applied the cap
  // inline, so the FIRST N jobs to finish in the concurrent pool got
  // persisted while later (potentially higher-scoring) jobs were
  // discarded as "Daily budget reached". With the loop completing in
  // a non-deterministic order, the final 50 weren't the best 50 —
  // they were the first 50 to win the race. Same OpenAI cost either
  // way, so we now score everything, THEN sort + take the top N below.
  await mapConcurrent(locationFiltered, PHASE1_CONCURRENCY, async (job) => {
    try {
      // ── 4a: Check job relevance via OpenAI ──
      // Note: system prompt = framework + resume (cached across all calls);
      // user prompt = just the JD. Prefix caching billed at 50%.
      const verdict = await checkJobRelevance(
        resumeText,
        job.descriptionText,
        config.TARGET_ROLE,
        seniorityLabelFromConfig(config.LINKEDIN_EXPERIENCE),
      );

      // Log completion order (not input order) — jobs finish out-of-order
      // due to concurrency, so we count completions and show `n/total`.
      const n = ++completedCount;
      log.job(n, locationFiltered.length, job.title, job.companyName);

      // Track the score before any threshold gate so the histogram
      // includes everything we actually scored.
      allScores.push(verdict.score);
      if (verdict.score_breakdown?.gate_capped) gateCappedCount++;

      if (verdict.score < config.RELEVANCE_SCORE_THRESHOLD) {
        log.skip(`Not relevant (score: ${verdict.score}/10): ${verdict.reason}`);
        return;
      }

      // Just collect. We post + count + alert in the sort-and-take-top-N
      // pass after this mapConcurrent completes.
      const jobCategory = detectJobCategory(job.title, job.descriptionText || "");
      scoredJobs.push({ job, verdict, jobCategory });
    } catch (err: any) {
      log.error(`Unexpected error scoring ${job.title} @ ${job.companyName}: ${err.message}`);
      stats.errors++;
    }
  });

  // Phase 1b: rank by score DESC, then take the top N. This is the
  // selection step the old in-loop budget check was supposed to do but
  // got wrong. is_reach ties break by preferring NON-reach (so a 7/10
  // solid match beats a 7/10 stretch).
  scoredJobs.sort((a, b) => {
    if (b.verdict.score !== a.verdict.score) return b.verdict.score - a.verdict.score;
    // Tiebreak: prefer non-reach over reach when scores are equal.
    if (a.verdict.is_reach && !b.verdict.is_reach) return 1;
    if (!a.verdict.is_reach && b.verdict.is_reach) return -1;
    return 0;
  });
  const overflowCount = Math.max(0, scoredJobs.length - targetRelevantJobs);
  const topScored = scoredJobs.slice(0, targetRelevantJobs);
  const droppedToBudget = scoredJobs.slice(targetRelevantJobs);
  if (overflowCount > 0) {
    const dropMin = droppedToBudget[0]?.verdict.score ?? 0;
    const dropMax = droppedToBudget[droppedToBudget.length - 1]?.verdict.score ?? 0;
    log.info(
      `  ${overflowCount} relevant jobs exceeded the daily budget (${targetRelevantJobs}). ` +
      `Kept the top ${topScored.length} by score; dropped ${overflowCount} scoring ${dropMax}-${dropMin}/10.`
    );
  }
  // Replace scoredJobs with the topN so every downstream step (tailor,
  // tracker post, stats) only sees the kept set.
  scoredJobs.length = 0;
  scoredJobs.push(...topScored);

  // Phase 1c: persist the kept top-N to the tracker + fire telegram
  // alerts. Sequential intentionally — the tracker endpoint serialises
  // per-user inserts behind a unique-link constraint, so hammering it
  // in parallel just generates lock contention.
  for (const { job, verdict, jobCategory } of topScored) {
    const reachTag = verdict.is_reach ? " [REACH]" : "";
    log.success(`Relevant (score: ${verdict.score}/10${reachTag}): ${verdict.reason}`);
    stats.relevant++;
    if (verdict.score >= config.TELEGRAM_ALERT_THRESHOLD) {
      sendTelegramAlert(job, verdict.score, verdict.reason).catch((err) => {
        log.warn(`Telegram alert failed: ${err.message}`);
      });
    }
    try {
      await postFilteredJob(
        job, verdict.score, verdict.reason, verdict.is_reach, jobCategory,
        verdict.score_breakdown, verdict.detected_role_type,
      );
      log.success(`Posted: ${job.title} @ ${job.companyName}`);
    } catch (err: any) {
      log.warn(`Job tracker post failed for ${job.title}: ${err.message}`);
    }
  }

  // Quality-alert signal for the UI: if the filter yielded fewer relevant
  // jobs than the user's target, emit a structured warn line that the
  // landing-page completion card regexes against. Zero-case is already
  // handled below with its own warn; this branch only fires for
  // partial-match runs (1..target-1 relevant).
  if (scoredJobs.length > 0 && scoredJobs.length < targetRelevantJobs) {
    log.warn(
      `Only ${scoredJobs.length} quality job${scoredJobs.length === 1 ? "" : "s"} passed the AI filter for your role (target: ${targetRelevantJobs}).`
    );
  }

  // Always log the score distribution so the user can decide whether to
  // lower the threshold or refine their keywords. This is the actionable
  // diagnostic that was missing — previously the user just saw "Only 1
  // passed" with no way to know whether to drop threshold by 1 or 5.
  if (allScores.length > 0) {
    const buckets = {
      "9-10": allScores.filter((s) => s >= 9).length,
      "7-8":  allScores.filter((s) => s >= 7 && s < 9).length,
      "5-6":  allScores.filter((s) => s >= 5 && s < 7).length,
      "3-4":  allScores.filter((s) => s >= 3 && s < 5).length,
      "0-2":  allScores.filter((s) => s < 3).length,
    };
    log.info(
      `  Score distribution (out of ${allScores.length}): ` +
      `9-10: ${buckets["9-10"]} · 7-8: ${buckets["7-8"]} · 5-6: ${buckets["5-6"]} · 3-4: ${buckets["3-4"]} · 0-2: ${buckets["0-2"]}`
    );
    if (gateCappedCount > 0) {
      const pctCapped = Math.round((gateCappedCount / allScores.length) * 100);
      log.info(
        `  ${gateCappedCount} of ${allScores.length} jobs (${pctCapped}%) were gate-capped at 4/10 ` +
        "(role_match AND skills_alignment both scored 1 — the job is in a fundamentally different field, e.g. sales/marketing/HR for a tech candidate)."
      );
    }

    // Smart suggestion. Pick the right lever based on the histogram:
    //   - If most jobs are gate-capped → keywords are pulling off-target
    //     listings, lowering the threshold won't help quality.
    //   - If many borderline 5-6 jobs exist → lowering threshold actually
    //     helps; show by how much.
    if (scoredJobs.length < targetRelevantJobs) {
      const gateCapRatio = gateCappedCount / allScores.length;
      const borderline = buckets["5-6"];

      if (gateCapRatio >= 0.6) {
        // Majority of jobs were gate-capped → keyword problem, not threshold.
        log.warn(
          `  Most scraped jobs (${Math.round(gateCapRatio * 100)}%) were fundamentally off-role. ` +
          "Lowering the Minimum match score won't help — those gate-capped jobs would still be rejected as bad matches. " +
          "Tighten your LINKEDIN_KEYWORDS or paste a more specific search URL so LinkedIn returns on-target listings."
        );
      } else if (borderline > 0 && config.RELEVANCE_SCORE_THRESHOLD > 5) {
        // Plenty of borderline jobs sitting at 5-6 — lowering threshold
        // to 5 would unlock them.
        const wouldPassAt5 = allScores.filter((s) => s >= 5).length;
        log.info(
          `  Tip: lower the AI Tuning "Minimum match score" slider from ${config.RELEVANCE_SCORE_THRESHOLD} to 5 ` +
          `to capture ${wouldPassAt5} jobs next run (${borderline} extra borderline matches in the 5-6 range).`
        );
      } else {
        // Find the highest threshold that would yield the target count.
        let suggestedThreshold = config.RELEVANCE_SCORE_THRESHOLD;
        for (let t = config.RELEVANCE_SCORE_THRESHOLD - 1; t >= 1; t--) {
          const wouldPass = allScores.filter((s) => s >= t).length;
          suggestedThreshold = t;
          if (wouldPass >= targetRelevantJobs) break;
        }
        const wouldPassAtSuggested = allScores.filter((s) => s >= suggestedThreshold).length;
        if (suggestedThreshold < config.RELEVANCE_SCORE_THRESHOLD) {
          log.info(
            `  Tip: lower the AI Tuning "Minimum match score" slider from ${config.RELEVANCE_SCORE_THRESHOLD} to ${suggestedThreshold} ` +
            `to capture ${wouldPassAtSuggested} jobs next run.`
          );
        }
      }
    }
  }

  // ── Step 4 Phase 2: Select top N and tailor resumes ──
  // Sort by score descending, then take top MAX_TAILOR_COUNT
  scoredJobs.sort((a, b) => b.verdict.score - a.verdict.score);
  const topN = scoredJobs.slice(0, config.MAX_TAILOR_COUNT);

  if (topN.length === 0) {
    log.warn("No relevant jobs to tailor. Pipeline complete.");
    log.summary(stats);
    return;
  }

  // ── Fetch resume profiles for role-type matching (Feature 2) ──
  log.step("Fetching resume profiles for role-type matching...");
  const resumeProfiles = await fetchResumeProfiles();
  if (resumeProfiles.length > 0) {
    log.success(`Loaded ${resumeProfiles.length} resume profile(s): ${resumeProfiles.map(p => `${p.name} (${p.role_type})`).join(", ")}`);
  } else {
    log.info("  No resume profiles found — using default resume for all jobs");
  }

  log.step(`\nPhase 2: Tailoring top ${topN.length} of ${scoredJobs.length} relevant jobs (tailoring: ${intensityLabel} ${config.TAILORING_INTENSITY}/10, max: ${config.MAX_TAILOR_COUNT})...\n`);

  for (let i = 0; i < topN.length; i++) {
    const { job, verdict, jobCategory } = topN[i];
    log.job(i + 1, topN.length, job.title, job.companyName);
    log.info(`  Score: ${verdict.score}/10 — ${verdict.reason}`);

    // ── Feature 2: Select best resume profile for this job's detected role type ──
    const detectedRole = verdict.detected_role_type || "Other";
    const matchedProfile = matchResumeProfile(resumeProfiles, detectedRole);
    const baseResumeText = matchedProfile?.resume_text || resumeText;
    const profileId = matchedProfile?.id;
    if (matchedProfile) {
      log.info(`  Resume profile: "${matchedProfile.name}" (${matchedProfile.role_type}) for detected ${detectedRole}`);
    }

    try {
      // ── Customize resume via OpenAI ──
      let resumeData;
      try {
        // Cap the JD at 1000 words for the tailoring prompt so the resume
        // tailoring call stays token-bounded. Relevance scoring above still
        // sees the full description.
        const tailorJd = (job.descriptionText || "").trim().split(/\s+/).slice(0, 1000).join(" ");
        resumeData = await customizeResume(baseResumeText, tailorJd, config.TARGET_ROLE);
        log.success("Resume customized");
      } catch (err: any) {
        log.error(`Resume customization failed: ${err.message}`);
        stats.errors++;
        continue;
      }

      // ── Generate PDF ──
      // Match the tailored PDF's page count to the base resume's page count
      // (1 page in -> 1 page out, 2 -> 2), estimated from the resume text.
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await generatePdf(resumeData, estimateResumePages(baseResumeText));
        log.success(`PDF generated (${(pdfBuffer.length / 1024).toFixed(0)}KB)`);
      } catch (err: any) {
        log.error(`PDF generation failed: ${err.message}`);
        stats.errors++;
        continue;
      }

      // ── CV Sync Check: Extract keywords from JD for later verification ──
      const jdKeywords: string[] = [];
      try {
        // Extract tech keywords from JD (simple heuristic: words that appear in skills section or are common tech terms)
        const jdLower = job.descriptionText.toLowerCase();
        const techPatterns = /\b(python|sql|java|javascript|typescript|react|node|aws|azure|gcp|docker|kubernetes|terraform|spark|airflow|kafka|snowflake|databricks|dbt|postgresql|mysql|mongodb|redis|elasticsearch|graphql|rest|api|etl|ci\/cd|git|linux|pandas|numpy|scikit|pytorch|tensorflow|ml|ai|llm|rag|nlp|data\s*pipeline|machine\s*learning|deep\s*learning|cloud|devops|microservices|agile|scrum)\b/gi;
        const matches = jdLower.match(techPatterns);
        if (matches) {
          const unique = [...new Set(matches.map(m => m.toLowerCase().trim()))];
          jdKeywords.push(...unique);
        }
      } catch {}

      // ── Upload PDF to Supabase Storage ──
      const candidateName =
        resumeData.resumeData?.personalInfo?.name || "CANDIDATE";
      const rawNameParts = candidateName.toUpperCase().replace(/[^A-Z\s]/g, "").trim().split(/\s+/);
      const nameParts = rawNameParts.length > 0 ? rawNameParts : ["CANDIDATE"];
      const roleClean = (job.title.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")) || "ROLE";
      const companyClean = (job.companyName.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")) || "COMPANY";
      const pdfFileName = `${nameParts.join("_")}_${roleClean}_${companyClean}_RESUME.pdf`;
      const uploadedUrl = await uploadTailoredPdf(pdfFileName, pdfBuffer, job.link);
      if (!uploadedUrl) {
        log.error(`PDF upload failed for ${pdfFileName} — skipping asset attach`);
        stats.errors++;
        continue;
      }
      const resumeUrl = uploadedUrl;
      log.success(`PDF uploaded: ${pdfFileName}`);

      // ── CV Sync Check (Feature 5): Verify keywords made it into the PDF ──
      let keywordMatchRate: number | undefined;
      if (jdKeywords.length > 0) {
        try {
          // Parse the generated PDF via the server's parse-pdf endpoint
          const base64 = pdfBuffer.toString("base64");
          const parseRes = await fetch(`${config.JOB_TRACKER_URL}/api/parse-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
            body: JSON.stringify({ base64 }),
          });
          const parseData = (await parseRes.json()) as { text?: string };
          const pdfText = (parseData.text || "").toLowerCase();

          let found = 0;
          const missing: string[] = [];
          for (const kw of jdKeywords) {
            if (pdfText.includes(kw.toLowerCase())) {
              found++;
            } else {
              missing.push(kw);
            }
          }
          keywordMatchRate = jdKeywords.length > 0 ? found / jdKeywords.length : 1;
          const pct = Math.round(keywordMatchRate * 100);

          if (keywordMatchRate < 0.7) {
            log.warn(`CV Sync Check: ${pct}% keyword match (${found}/${jdKeywords.length}). Missing: ${missing.slice(0, 10).join(", ")}`);
          } else {
            log.success(`CV Sync Check: ${pct}% keyword match (${found}/${jdKeywords.length})`);
          }
        } catch (err: any) {
          log.warn(`CV Sync Check failed: ${err.message}`);
        }
      }

      // Cover letter + why-I'm-a-fit are STRICTLY on-demand now. The
      // pipeline never auto-generates these regardless of config.
      // ENABLE_COVER_LETTER / ENABLE_WHY_FIT settings — the user clicks
      // "Generate" inside the JobDetailModal when they actually want
      // them. Reasons:
      //   - Most users only care about CL/why-fit for jobs they're
      //     genuinely applying to, not the whole top-N pool.
      //   - Auto-gen burned OpenAI tokens on jobs the user later
      //     rejected, and overwrote manually-edited copies if a job
      //     re-entered the pipeline.
      //   - "Click to view" only appearing AFTER user-initiated
      //     generation is the contract the UI now expects.
      // Variables stay declared so attachJobAssets keeps the same
      // shape; both are sent as empty strings → null in the upsert.
      const coverLetter = "";
      const whyImAFit = "";

      // Google Sheets append was removed with the rest of the Google
      // integration. Tracker attachment below is now the sole output sink.

      // ── Attach assets to tracker job ──
      try {
        await attachJobAssets(job, resumeUrl, coverLetter, whyImAFit, jobCategory, verdict.score, verdict.reason, profileId, keywordMatchRate);
        log.success("Resume, cover letter, and fit summary attached to tracker");
      } catch (err: any) {
        log.warn(`Tracker asset attach failed: ${err.message}`);
      }

      stats.tailored++;
      stats.applied++;

      // Rate limiting between jobs
      if (i < topN.length - 1) {
        await delay(config.BATCH_DELAY_MS);
      }
    } catch (err: any) {
      log.error(`Unexpected error processing ${job.title} @ ${job.companyName}: ${err.message}`);
      stats.errors++;
    }
  }

  // ── Pipeline complete ──
  const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
  log.info(`Pipeline completed in ${elapsedMin} minutes`);
  log.summary(stats);

  // ── Report RELEVANT (delivered) count to the server so it charges the
  //    user's daily jobs-scraped budget. Previously this reported
  //    stats.scraped (the raw 2.5× over-scraped count), which meant a Pro
  //    user targeting 50 jobs would be charged ~125, blowing past the
  //    daily cap in a single run. Now we charge only the jobs that were
  //    actually delivered to the user's tracker (stats.relevant), which is
  //    already capped at targetRelevantJobs (the budget-clamped count).
  try {
    await fetch(`${config.JOB_TRACKER_URL}/api/pipeline/report-scraped`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
      body: JSON.stringify({ count: stats.relevant }),
    });
  } catch (err: any) {
    log.warn(`Failed to report scraped count to server: ${err.message}`);
  }

  // Report tailored count so the server accrues it against the user's
  // daily resumes_tailored budget. Without this, a Free user running
  // the pipeline twice could tailor 2 resumes even though their daily
  // cap is 1 (each individual run honors MAX_TAILOR_COUNT, but the
  // across-runs enforcement lives on the server side of the gate).
  try {
    await fetch(`${config.JOB_TRACKER_URL}/api/pipeline/report-tailored`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
      body: JSON.stringify({ count: stats.tailored }),
    });
  } catch (err: any) {
    log.warn(`Failed to report tailored count to server: ${err.message}`);
  }

  // Summary row used to be written to a Google Sheets "Summary" tab; that
  // step was dropped along with the rest of the Google integration. The
  // stats object is still logged to stdout above and persisted in the
  // tracker via the skills snapshot + usage tracking endpoints below.

  // ── Save skills snapshot for today ──
  try {
    const today = new Date().toISOString().split("T")[0];
    const skillsRes = await fetch(`${config.JOB_TRACKER_URL}/api/skills/current`, {
      headers: internalAuthHeaders(),
    });
    if (skillsRes.ok) {
      const skillsData = (await skillsRes.json()) as any;
      await fetch(`${config.JOB_TRACKER_URL}/api/skills/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
        body: JSON.stringify({ date: today, total_jobs: skillsData.total_jobs, skills: skillsData.skills }),
      });
      log.success("Skills snapshot saved");
    }
  } catch (err: any) {
    log.warn(`Skills snapshot failed: ${err.message}`);
  }
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
