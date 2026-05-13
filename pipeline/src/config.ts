import dotenv from "dotenv";
import path from "path";
import { COUNTRY_REGISTRY } from "./countries";
import { log } from "./logger";

// override:FALSE — the server spawns the pipeline as a subprocess and
// injects per-user config (APIFY_JOB_COUNT, LINKEDIN_KEYWORDS, TARGET_ROLE,
// etc.) read from the user's `user_settings.config_json` row in Postgres.
// Those injected values MUST win. pipeline/.env is now only a dev fallback
// for shared secrets (APIFY_API_TOKEN, OPENAI_API_KEY) that haven't been
// moved to per-user storage yet — it only fills in keys that aren't already
// present in process.env.
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: false });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  // Apify actors
  APIFY_API_TOKEN: required("APIFY_API_TOKEN"),
  APIFY_ACTOR_ID: optional("APIFY_ACTOR_ID", "hKByXkMQaC5Qt9UMN"),          // LinkedIn
  APIFY_NAUKRI_ACTOR_ID: optional("APIFY_NAUKRI_ACTOR_ID", "muhammetakkurtt~naukri-job-scraper"),
  APIFY_INDEED_ACTOR_ID: optional("APIFY_INDEED_ACTOR_ID", "valig~indeed-jobs-scraper"),
  // Truefetch best-job-listing — multi-source aggregator. Used to
  // broaden the candidate pool the AI relevance filter scores against.
  APIFY_TRUEFETCH_ACTOR_ID: optional("APIFY_TRUEFETCH_ACTOR_ID", "truefetch~best-job-listing"),
  SCRAPE_TRUEFETCH: optional("SCRAPE_TRUEFETCH", "true") !== "false",
  // Upwork freelance / contract gigs. Disabled by default because mixing
  // contract gigs with full-time roles pollutes the AI relevance scoring
  // for users hunting only full-time. Flip SCRAPE_UPWORK=true to enable.
  APIFY_UPWORK_ACTOR_ID: optional("APIFY_UPWORK_ACTOR_ID", "upwork-vibe~upwork-job-scraper"),
  SCRAPE_UPWORK: optional("SCRAPE_UPWORK", "false") !== "false",
  // How many keywords each Apify scraper fans out over (Indeed/Naukri/
  // Truefetch). Before this, all three scrapers used keywords[0] only,
  // so a CSV like "ai engineer, ml engineer, data scientist" silently
  // dropped 2/3 of the user's interest. With this set to 3, each
  // scraper runs THREE parallel passes (one per keyword) and dedups
  // by link. LinkedIn ignores this setting — it already joins all
  // keywords with OR in a single URL.
  MAX_KEYWORDS_PER_SCRAPER: parseInt(optional("MAX_KEYWORDS_PER_SCRAPER", "3"), 10),
  // LLM-driven keyword expansion. When true, the pipeline runs one
  // gpt-4o-mini call at startup to expand the user's role keywords
  // into closely-related titles recruiters actually use (e.g.
  // "data engineer" → "data engineer, etl engineer, analytics engineer,
  // data platform engineer"). This catches listings where the company
  // uses a synonymous title.
  //
  // Set false for strict literal matching (no expansion).
  EXPAND_KEYWORDS: optional("EXPAND_KEYWORDS", "true") !== "false",

  // OpenAI
  OPENAI_API_KEY: required("OPENAI_API_KEY"),

  // Job Tracker
  JOB_TRACKER_URL: optional("JOB_TRACKER_URL", "http://localhost:3001"),

  // PDF Backend
  PDF_BACKEND_URL: optional(
    "PDF_BACKEND_URL",
    "https://rewrite-backend-b5wj.onrender.com/v1/get-resume"
  ),

  // LinkedIn Search (dynamic URL builder)
  // Empty default — the user's role-expander on the landing page fills
  // this. Hardcoding a software default biased every new account toward
  // engineering jobs irrespective of their actual target role.
  LINKEDIN_KEYWORDS: optional("LINKEDIN_KEYWORDS", ""),
  LINKEDIN_SKILLS: optional("LINKEDIN_SKILLS", ""),
  LINKEDIN_GEO_ID: optional("LINKEDIN_GEO_ID", "104738515"),
  // Defaults widened from r86400 (24h) → r604800 (1 week) and from
  // "1,2,3" (intern+entry+associate) → "" (all levels). The narrow
  // defaults silently restricted searches in slow markets and excluded
  // mid-senior listings that make up the bulk of real openings.
  // Existing users keep whatever they have in user_settings; only
  // brand-new accounts inherit these.
  LINKEDIN_TIME_FILTER: optional("LINKEDIN_TIME_FILTER", "r604800"),
  LINKEDIN_EXPERIENCE: optional("LINKEDIN_EXPERIENCE", ""),
  LINKEDIN_WORK_TYPE: optional("LINKEDIN_WORK_TYPE", ""),
  LINKEDIN_JOB_TYPE: optional("LINKEDIN_JOB_TYPE", ""),
  LINKEDIN_SORT: optional("LINKEDIN_SORT", "DD"),
  // Whether to send LINKEDIN_EXPERIENCE as a HARD scrape-side filter
  // (f_E param on LinkedIn) or treat it as a SOFT preference fed into
  // the AI relevance prompt.
  //
  // Default OFF: scrape broadly + let the AI scorer's seniority_fit
  // dimension penalise mismatches in scoring. Reason: LinkedIn's f_E
  // is brittle (returns 0 results on slow markets, blocks "entry +
  // associate" combos), and the user's complaint was "I pick entry
  // and only see senior" — which happened because (a) LinkedIn had
  // no entry roles that week and (b) the apify.ts auto-broadener
  // dropped f_E silently, leaving the AI scorer with no signal that
  // the user actually wanted entry-level.
  STRICT_SENIORITY_FILTER: optional("STRICT_SENIORITY_FILTER", "false") === "true",
  // Built URL (or manual override)
  LINKEDIN_SEARCH_URL: process.env.LINKEDIN_SEARCH_URL || "",

  // Settings
  BATCH_DELAY_MS: parseInt(optional("BATCH_DELAY_MS", "2000"), 10),
  APIFY_JOB_COUNT: parseInt(optional("APIFY_JOB_COUNT", "100"), 10),
  RELEVANCE_SCORE_THRESHOLD: parseInt(optional("RELEVANCE_SCORE_THRESHOLD", "5"), 10),
  // How aggressively to tailor resume to JD (1-10). 1=light touch, 5=balanced, 10=aggressive rewrite
  TAILORING_INTENSITY: parseInt(optional("TAILORING_INTENSITY", "5"), 10),
  // The user's target role — used for relevancy scoring and resume tailoring
  TARGET_ROLE: optional("TARGET_ROLE", ""),
  APIFY_MAX_POLL_MINUTES: parseInt(optional("APIFY_MAX_POLL_MINUTES", "10"), 10),
  MAX_TAILOR_COUNT: parseInt(optional("MAX_TAILOR_COUNT", "20"), 10),

  // Telegram alerts (optional — alerts fired when match_score >= TELEGRAM_ALERT_THRESHOLD)
  TELEGRAM_BOT_TOKEN: optional("TELEGRAM_BOT_TOKEN", ""),
  TELEGRAM_CHAT_ID: optional("TELEGRAM_CHAT_ID", ""),
  TELEGRAM_ALERT_THRESHOLD: parseInt(optional("TELEGRAM_ALERT_THRESHOLD", "8"), 10),

  // Free scrapers toggle (set to "false" to disable individual sources)
  SCRAPE_REMOTEOK: optional("SCRAPE_REMOTEOK", "true") !== "false",
  SCRAPE_JOBICY: optional("SCRAPE_JOBICY", "true") !== "false",
  SCRAPE_HN: optional("SCRAPE_HN", "true") !== "false",
  SCRAPE_WWR: optional("SCRAPE_WWR", "true") !== "false",
  SCRAPE_ARBEITNOW: optional("SCRAPE_ARBEITNOW", "true") !== "false",
  SCRAPE_REMOTIVE: optional("SCRAPE_REMOTIVE", "true") !== "false",
  SCRAPE_DEVTO: optional("SCRAPE_DEVTO", "true") !== "false",
  SCRAPE_JOBSIE: optional("SCRAPE_JOBSIE", "true") !== "false",
  SCRAPE_IRISHJOBS: optional("SCRAPE_IRISHJOBS", "true") !== "false",
  SCRAPE_INDEED_IE: optional("SCRAPE_INDEED_IE", "true") !== "false",
  SCRAPE_GRADIRELAND: optional("SCRAPE_GRADIRELAND", "true") !== "false",
  SCRAPE_CAREERJET: optional("SCRAPE_CAREERJET", "true") !== "false",
  SCRAPE_GLASSDOOR: optional("SCRAPE_GLASSDOOR", "false") !== "false", // disabled by default — Glassdoor blocks non-browser requests
  CAREERJET_AFFILIATE_ID: optional("CAREERJET_AFFILIATE_ID", ""),

  // Keywords used for free scrapers (comma-separated)
  // Empty default — same reasoning as LINKEDIN_KEYWORDS above. The
  // landing page's role-expander populates this, and the server's
  // /api/settings handler keeps its own DEFAULT_CONFIG empty so saved
  // configs reflect the user's actual role.
  SEARCH_KEYWORDS: optional("SEARCH_KEYWORDS", ""),

  // Max age for scraped jobs in days
  MAX_AGE_DAYS: parseInt(optional("MAX_AGE_DAYS", "14"), 10),
  // Cap how many jobs the portal scanner accepts from a SINGLE target
  // company in one run. Without this, a big employer like Vercel
  // (~80 open Greenhouse postings) can flood the AI relevance pass
  // and outweigh every other source in the kanban. 15 is enough to
  // surface the company's most relevant + freshest openings without
  // letting them dominate the run.
  MAX_JOBS_PER_PORTAL_COMPANY: parseInt(optional("MAX_JOBS_PER_PORTAL_COMPANY", "15"), 10),

  // Companies the portal scanner must skip entirely, regardless of whether
  // they're active in target_companies. Comma-separated, case-insensitive.
  // Use when a company keeps flooding the AI pool with off-target postings
  // (e.g. Cloudflare's worldwide sales/account-exec roles dominating a
  // Dublin engineering search).
  BANNED_PORTAL_COMPANIES: optional("BANNED_PORTAL_COMPANIES", ""),

  // Title substrings that always disqualify a portal-scanner job, applied
  // BEFORE the per-company title_keywords filter. Used to drop obvious
  // non-engineering roles (sales, marketing, account executives) at scrape
  // time so the AI relevance pass never sees them and can't hallucinate
  // them as "strong fit". Case-insensitive substring match.
  GLOBAL_PORTAL_NEGATIVE_KEYWORDS: optional(
    "GLOBAL_PORTAL_NEGATIVE_KEYWORDS",
    "account executive,account exec,sales manager,sales director,sales engineer," +
    "sales development,sdr,bdr,gtm,go-to-market,partner strategy,partner manager," +
    "channel manager,customer success,marketing manager,marketing director," +
    "product marketing,brand marketing,community marketing,recruiter,talent acquisition," +
    "field solutions,solutions architect,solutions engineer,solutions consultant," +
    "named account,majors account,territory account,enterprise sales," +
    "commercial account,strategic account,front desk,executive assistant"
  ),

  // If true, the portal scanner only keeps jobs whose location string names
  // one of TARGET_COUNTRIES (or is empty/remote). When false, all jobs the
  // company portal returns are kept and the downstream location-filter
  // decides. Default true because foreign-office sales roles from companies
  // with a tiny Ireland office (Cloudflare, Datadog) were flooding the pool.
  PORTAL_STRICT_LOCATION: optional("PORTAL_STRICT_LOCATION", "true") !== "false",

  // Location regions — comma-separated: ireland,uk,eu (default), us,canada, all, or custom:city1,city2
  LOCATION_REGIONS: optional("LOCATION_REGIONS", "ireland,uk,eu"),

  // When true, bare-remote jobs (location tagged "Remote" with no country
  // clue) pass the location filter alongside country-specific jobs. When
  // false (default), only jobs physically in the selected country pass.
  INCLUDE_REMOTE: optional("INCLUDE_REMOTE", "false").toLowerCase() === "true",

  // Target countries — which countries to scrape jobs from (comma-separated country codes)
  // Available: ireland, uk, netherlands, india
  // Each country enables its own scrapers and sets LinkedIn geoId
  TARGET_COUNTRIES: optional("TARGET_COUNTRIES", "ireland"),

  // India-specific scrapers (only run when india is in TARGET_COUNTRIES)
  SCRAPE_NAUKRI: optional("SCRAPE_NAUKRI", "true") !== "false",
  SCRAPE_INSTAHYRE: optional("SCRAPE_INSTAHYRE", "true") !== "false",
  SCRAPE_INDEED_IN: optional("SCRAPE_INDEED_IN", "true") !== "false",

  // UK / Netherlands Indeed scrapers (gated on TARGET_COUNTRIES)
  SCRAPE_INDEED_UK: optional("SCRAPE_INDEED_UK", "true") !== "false",
  SCRAPE_INDEED_NL: optional("SCRAPE_INDEED_NL", "true") !== "false",

  // Optional focus on a single target company per run. When set, the portal
  // scanner ignores all other active companies and scans only this one. The
  // landing-page dropdown writes this value; leave blank to scan the full
  // active list as before.
  TARGET_COMPANY_ID: optional("TARGET_COMPANY_ID", "") || null as string | null,

  // Optional generation toggles — off by default so cover letter + why-fit
  // are on-demand only (generated from the job detail modal). Set to "true"
  // in .env to auto-generate during pipeline runs.
  ENABLE_COVER_LETTER: optional("ENABLE_COVER_LETTER", "false") === "true",
  ENABLE_WHY_FIT:      optional("ENABLE_WHY_FIT",      "false") === "true",
};

/**
 * Build LinkedIn search URL from individual env vars.
 * Combines keywords + skills into a single OR query for maximum coverage.
 * Strips session-specific params (currentJobId, origin) automatically.
 */
export function buildLinkedInUrl(): string {
  // Auto-set geoId from TARGET_COUNTRIES. Pulls from the shared COUNTRY_REGISTRY
  // so new countries only need to be added in ONE place (countries.ts) instead
  // of maintaining a parallel map here.
  const countries = config.TARGET_COUNTRIES.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const firstCountry = countries[0];
  const registryGeoId = firstCountry ? COUNTRY_REGISTRY[firstCountry]?.linkedinGeoId : undefined;
  const autoGeoId = registryGeoId || config.LINKEDIN_GEO_ID;
  // If the user picked a country we don't know about, the previous silent
  // fallback to LINKEDIN_GEO_ID (which defaults to Ireland) made it look
  // like UK/NZ runs were scraping Ireland for no obvious reason. Surface
  // the mismatch in the log instead — the run continues with Ireland's
  // geoId so the pipeline doesn't crash, but the user knows why.
  if (firstCountry && !registryGeoId) {
    // eslint-disable-next-line no-console
    console.warn(
      `[buildLinkedInUrl] TARGET_COUNTRIES="${firstCountry}" not in COUNTRY_REGISTRY — falling back to LINKEDIN_GEO_ID=${config.LINKEDIN_GEO_ID}. Add the country to pipeline/src/countries.ts to fix.`
    );
  }

  // Manual LINKEDIN_SEARCH_URL override. Honour the pasted URL but MERGE
  // in missing params from the user's other config — a URL with only
  // `?keywords=...` and no geoId returns 0 jobs from the Apify actor,
  // which silently breaks "URL mode" for the common copy-paste case
  // where users only kept the keywords portion. Filling in the gaps
  // from the rest of the config makes URL mode robust to partial input.
  if (config.LINKEDIN_SEARCH_URL && config.LINKEDIN_SEARCH_URL.trim()) {
    try {
      const url = new URL(config.LINKEDIN_SEARCH_URL);
      // Strip session-specific params LinkedIn adds when you copy the
      // URL while viewing a job — they pin the search to that job and
      // break the actor's pagination.
      url.searchParams.delete("currentJobId");
      url.searchParams.delete("origin");
      url.searchParams.delete("referralSearchId");
      url.searchParams.delete("start");
      // Salary filter (f_SAL) is the #1 cause of "0 jobs scraped" for
      // URL-mode users. LinkedIn encodes it like f_SA_id_227001:276001
      // (~$227k-$276k USD band), which is principal/staff-level only
      // in slow markets like Ireland and excludes 95% of postings that
      // don't disclose salary at all. Auto-strip it so a casual copy-
      // paste of a "filtered for me right now" URL doesn't accidentally
      // restrict the whole pipeline run.
      if (url.searchParams.has("f_SAL")) {
        url.searchParams.delete("f_SAL");
        log.info(
          "  Removed salary filter (f_SAL) from pasted URL — it dropped 95% of LinkedIn postings " +
          "(most don't disclose salary). If you actually want a salary cutoff, set it via the dashboard's filters instead."
        );
      }

      // Normalize the path. Users typically copy the URL while on
      // /jobs/search-results/ (the active-search page with a job
      // detail panel open) — but the Apify LinkedIn actor expects
      // the canonical /jobs/search/ path and silently returns 0 when
      // given the variant. Force the canonical path; the query string
      // is what actually drives the search.
      const originalPath = url.pathname;
      if (!/^\/jobs\/search\/?$/.test(originalPath)) {
        url.pathname = "/jobs/search/";
        log.info(`  Normalized pasted URL path from ${originalPath} → /jobs/search/ (the actor needs the canonical path)`);
      }

      const merged: string[] = [];

      // Inject keywords if missing — fall back through LINKEDIN_KEYWORDS,
      // then SEARCH_KEYWORDS, then TARGET_ROLE.
      const urlKeywords = (url.searchParams.get("keywords") || "").trim();
      if (!urlKeywords) {
        const fallbackKw =
          (config.LINKEDIN_KEYWORDS || "").trim() ||
          (config.SEARCH_KEYWORDS || "").trim() ||
          (config.TARGET_ROLE || "").trim();
        if (fallbackKw) {
          // Same OR-join LinkedIn expects when multiple keyword phrases
          // are provided.
          const joined = fallbackKw.split(",").map((k) => k.trim()).filter(Boolean).join(" OR ");
          url.searchParams.set("keywords", joined);
          merged.push(`keywords="${joined.slice(0, 60)}"`);
        }
      } else {
        // The user's URL has keywords. LinkedIn treats UPPERCASE OR as the
        // boolean operator and lowercase "or" as a literal search word. A
        // hand-typed "AI engineer or Data engineer" therefore matches
        // ~zero jobs (no listing has that literal phrase). Auto-uppercase
        // OR/AND/NOT so the user's natural-language keywords actually
        // work as boolean queries.
        const fixed = urlKeywords
          .replace(/\b(or|and|not)\b/g, (m) => m.toUpperCase());
        if (fixed !== urlKeywords) {
          url.searchParams.set("keywords", fixed);
          log.info(`  Uppercased boolean operators in URL keywords: "${urlKeywords.slice(0, 50)}" → "${fixed.slice(0, 50)}" (LinkedIn requires OR/AND/NOT in caps)`);
        }
      }

      // Inject geoId if missing — without it the Apify actor returns 0.
      if (!url.searchParams.get("geoId")) {
        url.searchParams.set("geoId", autoGeoId);
        merged.push(`geoId=${autoGeoId}`);
      } else if (url.searchParams.get("geoId") !== autoGeoId) {
        log.warn(
          `  Heads up: pasted URL geoId=${url.searchParams.get("geoId")} differs from country picker (${firstCountry || "default"} = ${autoGeoId}). ` +
          "Honouring the URL's geoId — clear the URL in Settings if you want the picker to drive the country."
        );
      }

      // Inject time filter if missing — honour the user's saved setting
      // verbatim (no auto-widen). If the URL itself specifies f_TPR we
      // skip this entirely (the user's URL choice wins). If the saved
      // setting is also empty we fall back to 1-week so the actor isn't
      // hit with an unbounded "all time" query.
      if (!url.searchParams.get("f_TPR")) {
        const tpr = config.LINKEDIN_TIME_FILTER || "r604800";
        url.searchParams.set("f_TPR", tpr);
        merged.push(`f_TPR=${tpr}`);
      }

      // Inject experience filter (f_E) ONLY when STRICT_SENIORITY_FILTER
      // is on. Otherwise we scrape broadly and let the AI relevance
      // scorer's seniority_fit dimension penalise mismatches in scoring
      // (the user's preference still reaches it via the prompt — see
      // buildRelevanceSystemPrompt's preferredSeniority arg).
      //
      // Why default off: f_E="2" (entry only) frequently returns 0
      // results in slow weeks, then apify.ts silently drops f_E on
      // retry — so the user picked entry-level but the AI never knew,
      // and the dashboard filled with senior roles with no explanation.
      if (
        config.STRICT_SENIORITY_FILTER &&
        !url.searchParams.get("f_E") &&
        config.LINKEDIN_EXPERIENCE &&
        config.LINKEDIN_EXPERIENCE.trim()
      ) {
        url.searchParams.set("f_E", config.LINKEDIN_EXPERIENCE);
        merged.push(`f_E=${config.LINKEDIN_EXPERIENCE}`);
      }

      // Sort by most recent if not already specified.
      if (!url.searchParams.get("sortBy")) {
        url.searchParams.set("sortBy", config.LINKEDIN_SORT || "DD");
      }

      if (merged.length > 0) {
        log.info(
          `  Pasted LinkedIn URL was missing params — auto-merged: ${merged.join(", ")}. ` +
          "If you want the URL used verbatim, paste a complete URL with geoId/f_TPR/f_E set."
        );
      }

      return url.toString();
    } catch {
      log.warn("  Pasted LINKEDIN_SEARCH_URL is malformed — falling back to keyword-mode URL builder.");
      // Fall through to fresh build below.
    }
  }

  // Keywords with three-layer fallback so URL-builder mode works even when
  // the user only filled TARGET_ROLE: LINKEDIN_KEYWORDS → SEARCH_KEYWORDS
  // → TARGET_ROLE. Without this, an empty LINKEDIN_KEYWORDS produced
  // keywords="" in the URL, which the actor accepts but returns 0 jobs.
  const linkedInKwSource =
    config.LINKEDIN_KEYWORDS.trim() ||
    config.SEARCH_KEYWORDS.trim() ||
    config.TARGET_ROLE.trim();
  const keywords = linkedInKwSource
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length === 0) {
    log.warn(
      "  buildLinkedInUrl: no keywords available — LINKEDIN_KEYWORDS, SEARCH_KEYWORDS, and TARGET_ROLE are all empty. " +
      "LinkedIn search will return 0 jobs. Type a role in the dashboard's Expected Role field."
    );
  }

  // Append skills as additional OR terms (e.g., "python developer", "sql developer")
  const skills = config.LINKEDIN_SKILLS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Combine: job titles first, then skills are added in parentheses for relevance boost
  // LinkedIn treats keywords as: (job titles) AND/OR (skills) — skills help rank results higher
  const allTerms = [...keywords];

  // Build keyword string: job titles joined with OR
  // Skills are added as a grouped OR clause to boost relevance without creating fake job titles
  let keywordString = allTerms.join(" OR ");
  if (skills.length > 0) {
    // Append skills so LinkedIn factors them into ranking
    // e.g., "data engineer OR ai engineer OR python OR sql OR aws"
    const skillTerms = skills.filter(
      (s) => !keywords.some((k) => k.toLowerCase().includes(s.toLowerCase()))
    );
    if (skillTerms.length > 0) {
      keywordString += " OR " + skillTerms.join(" OR ");
    }
  }

  const params = new URLSearchParams();
  params.set("keywords", keywordString);
  params.set("geoId", autoGeoId);
  params.set("f_TPR", config.LINKEDIN_TIME_FILTER);

  if (config.LINKEDIN_EXPERIENCE) {
    params.set("f_E", config.LINKEDIN_EXPERIENCE);
  }
  if (config.LINKEDIN_WORK_TYPE) {
    params.set("f_WT", config.LINKEDIN_WORK_TYPE);
  }
  if (config.LINKEDIN_JOB_TYPE) {
    params.set("f_JT", config.LINKEDIN_JOB_TYPE);
  }
  if (config.LINKEDIN_SORT) {
    params.set("sortBy", config.LINKEDIN_SORT);
  }

  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

export function validateConfig(): void {
  // Google Docs / Sheets / Drive integration was removed as part of the
  // SaaS migration. Resume text now comes exclusively from the server's
  // upload endpoint (which reads from Supabase Storage), and pipeline
  // outputs are written to Supabase rather than Google Sheets. Nothing
  // to validate here for now; left as a hook for future startup checks.
}
