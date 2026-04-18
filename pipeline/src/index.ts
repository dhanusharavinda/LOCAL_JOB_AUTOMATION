import path from "path";
import fs from "fs";
import { config, validateConfig } from "./config";
import { log } from "./logger";
import { PipelineStats, LinkedInJob } from "./types";
import { scrapeLinkedInJobs } from "./services/apify";
import { filterByLocation } from "./services/location-filter";
import { checkJobRelevance, customizeResume } from "./services/openai";
import { generateCoverLetter } from "./services/outreach-email";
import { generatePdf, warmUpPdfBackend } from "./services/pdf-generator";
import {
  checkDuplicatesBatch,
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
import { scrapeAllFreeSources } from "./services/scrapers/orchestrator";
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

  // ── Step 1: Scrape LinkedIn jobs via Apify ──
  // APIFY_JOB_COUNT is the user's TARGET for relevant jobs AFTER the AI
  // filter. We over-scrape 2.5× upfront so the filter has enough raw
  // candidates to realistically hit that target without burning the budget.
  const OVERSCRAPE_MULTIPLIER = 2.5;
  const targetRelevantJobs = config.APIFY_JOB_COUNT;
  const effectiveScrapeCount = Math.ceil(targetRelevantJobs * OVERSCRAPE_MULTIPLIER);
  log.step(`Scraping LinkedIn jobs via Apify (target ${targetRelevantJobs} relevant → requesting ${effectiveScrapeCount} raw, ${OVERSCRAPE_MULTIPLIER}× over-scrape)...`);
  let allJobs;
  try {
    allJobs = await scrapeLinkedInJobs(effectiveScrapeCount);
    stats.scraped = allJobs.length;
    log.success(`Scraped ${allJobs.length} jobs from LinkedIn`);
  } catch (err: any) {
    log.error(`Scraping failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 1b: Scrape Indeed + Naukri (if India) via Apify ──
  // Same 3× over-scrape factor as LinkedIn so the AI relevance filter
  // (Phase 1) has enough candidates from every source to hit the target.
  log.step("Scraping Indeed + Naukri (if India selected) via Apify...");
  let freeJobs: LinkedInJob[] = [];
  try {
    freeJobs = await scrapeAllFreeSources(effectiveScrapeCount);
    log.success(`Apify scrapers (Indeed/Naukri): ${freeJobs.length} unique jobs`);
  } catch (err: any) {
    log.warn(`Indeed/Naukri scrapers failed: ${err.message} — continuing with LinkedIn only`);
  }

  // ── Step 1b.2: Scan target company portals (Feature 4) ──
  log.step("Scanning target company careers portals...");
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
    log.success(`Portal scanner: ${portalJobs.length} jobs from company careers pages`);
  } catch (err: any) {
    log.warn(`Portal scanner failed: ${err.message} — continuing without portal jobs`);
  }

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
  log.step("Checking for duplicates against tracker...");
  const allLinks = mergedJobs.filter((j) => j.link).map((j) => j.link);
  const duplicateSet = await checkDuplicatesBatch(allLinks);
  let dedupedJobs: LinkedInJob[];
  if (duplicateSet === null) {
    log.warn("Tracker unreachable for batch dedup — skipping all jobs to prevent duplicates");
    log.summary(stats);
    return;
  }
  const dupCount = duplicateSet.size;
  dedupedJobs = mergedJobs.filter((j) => !j.link || !duplicateSet.has(j.link));
  stats.skipped += dupCount;
  log.success(`${dedupedJobs.length} new jobs (${dupCount} duplicates already in tracker)`);

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
  let completedCount = 0;

  await mapConcurrent(locationFiltered, PHASE1_CONCURRENCY, async (job) => {
    try {
      // ── 4a: Check job relevance via OpenAI ──
      // Note: system prompt = framework + resume (cached across all calls);
      // user prompt = just the JD. Prefix caching billed at 50%.
      const verdict = await checkJobRelevance(resumeText, job.descriptionText, config.TARGET_ROLE);

      // Log completion order (not input order) — jobs finish out-of-order
      // due to concurrency, so we count completions and show `n/total`.
      const n = ++completedCount;
      log.job(n, locationFiltered.length, job.title, job.companyName);

      if (verdict.score < config.RELEVANCE_SCORE_THRESHOLD) {
        log.skip(`Not relevant (score: ${verdict.score}/10): ${verdict.reason}`);
        return;
      }

      // Cap relevant jobs at the user's budget (APIFY_JOB_COUNT, already
      // clamped to the remaining daily quota by the server). Without this,
      // the 2.5× over-scrape could push 80+ relevant jobs to the tracker
      // when the plan only allows 50/day.
      if (stats.relevant >= targetRelevantJobs) {
        log.skip(`Daily budget reached (${targetRelevantJobs} relevant jobs) — not posting to tracker`);
        return;
      }

      const reachTag = verdict.is_reach ? " [REACH]" : "";
      log.success(`Relevant (score: ${verdict.score}/10${reachTag}): ${verdict.reason}`);
      stats.relevant++;

      // ── 4b.1: Telegram alert for high-score jobs ──
      if (verdict.score >= config.TELEGRAM_ALERT_THRESHOLD) {
        sendTelegramAlert(job, verdict.score, verdict.reason).catch((err) => {
          log.warn(`Telegram alert failed: ${err.message}`);
        });
      }

      // ── 4c: Post ALL relevant jobs to tracker (so user sees everything) ──
      const jobCategory = detectJobCategory(job.title, job.descriptionText || "");
      try {
        await postFilteredJob(
          job, verdict.score, verdict.reason, verdict.is_reach, jobCategory,
          verdict.score_breakdown, verdict.detected_role_type
        );
        log.success("Posted to tracker (filtered)");
      } catch (err: any) {
        log.warn(`Job tracker post failed: ${err.message}`);
      }

      scoredJobs.push({ job, verdict, jobCategory });
    } catch (err: any) {
      log.error(`Unexpected error scoring ${job.title} @ ${job.companyName}: ${err.message}`);
      stats.errors++;
    }
  });

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
        resumeData = await customizeResume(baseResumeText, job.descriptionText, config.TARGET_ROLE);
        log.success("Resume customized");
      } catch (err: any) {
        log.error(`Resume customization failed: ${err.message}`);
        stats.errors++;
        continue;
      }

      // ── Generate PDF ──
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await generatePdf(resumeData);
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

      // ── Generate cover letter + why I'm a fit (each can be toggled off) ──
      // "Generate once" policy: check whether the tracker already has these
      // assets for this job (by job_link). If both exist, skip the OpenAI
      // call entirely and reuse what's stored. If only one is missing, we
      // still do a single call (the prompt returns both together) and only
      // the missing field gets written. This prevents duplicate spend if a
      // job ever re-enters the pipeline and preserves any manual regens.
      let coverLetter = "";
      let whyImAFit = "";
      const existingAssets = job.link
        ? await fetchJobAssetStatus(job.link)
        : { exists: false, hasCoverLetter: false, hasWhyFit: false };
      const needCoverLetter = config.ENABLE_COVER_LETTER && !existingAssets.hasCoverLetter;
      const needWhyFit      = config.ENABLE_WHY_FIT      && !existingAssets.hasWhyFit;

      if (needCoverLetter || needWhyFit) {
        try {
          const candidateSkills = extractSkillsList(resumeData);
          const candidateName = resumeData.resumeData?.personalInfo?.name || "";
          const result = await generateCoverLetter(
            job.companyName,
            job.title,
            candidateSkills,
            job.descriptionText,
            candidateName
          );
          coverLetter = needCoverLetter ? result.coverLetter : "";
          whyImAFit   = needWhyFit      ? result.whyImAFit   : "";
          const parts: string[] = [];
          if (needCoverLetter) parts.push("cover letter");
          if (needWhyFit)      parts.push("why-I'm-a-fit");
          log.success(`Generated ${parts.join(" + ")}`);
        } catch (err: any) {
          log.error(`Cover letter generation failed: ${err.message}`);
        }
      } else if (!config.ENABLE_COVER_LETTER && !config.ENABLE_WHY_FIT) {
        log.info("  Cover letter + why-I'm-a-fit disabled in settings — skipped");
      } else {
        log.info("  Cover letter + why-I'm-a-fit already generated for this job — skipped (one-time policy)");
      }

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
