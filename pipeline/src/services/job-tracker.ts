import { config } from "../config";
import { LinkedInJob, DuplicateCheckResult } from "../types";
import { log } from "../logger";

export interface ResumeProfile {
  id: number;
  name: string;
  role_type: string;
  resume_text: string;
  is_default: number;
}

/**
 * Upload a tailored-resume PDF buffer to Supabase Storage via the server.
 * The server handles the upload under the user's private folder and
 * returns a 7-day signed URL that we can attach to the job row for
 * the kanban UI to display.
 */
export async function uploadTailoredPdf(
  filename: string,
  pdfBuffer: Buffer,
  jobLink: string | null
): Promise<string | null> {
  try {
    const base64 = pdfBuffer.toString("base64");
    const res = await fetch(`${API_URL()}/upload-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
      signal: withTimeout(30000), // allow big PDFs
      body: JSON.stringify({ filename, base64, job_link: jobLink }),
    });
    if (!res.ok) {
      log.warn(`PDF upload failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { resume_url?: string };
    return data.resume_url || null;
  } catch (err: any) {
    log.warn(`PDF upload error: ${err.message}`);
    return null;
  }
}

/**
 * Fetch the authenticated user's uploaded resume text from the tracker API.
 * Returns an empty string if no resume has been uploaded. This is the sole
 * source of resume text in the pipeline now that Google Docs has been removed.
 */
export async function fetchResumeText(): Promise<string> {
  try {
    const res = await fetch(`${config.JOB_TRACKER_URL}/api/settings/resume/text`, {
      headers: internalAuthHeaders(),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { text?: string };
    return data.text || "";
  } catch (err: any) {
    log.warn(`Failed to fetch resume text: ${err.message}`);
    return "";
  }
}

/**
 * Fetch all resume profiles from the tracker API.
 */
export async function fetchResumeProfiles(): Promise<ResumeProfile[]> {
  try {
    const res = await fetch(`${config.JOB_TRACKER_URL}/api/resume-profiles`, {
      headers: internalAuthHeaders(),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return (await res.json()) as ResumeProfile[];
  } catch (err: any) {
    log.warn(`Failed to fetch resume profiles: ${err.message}`);
    return [];
  }
}

/**
 * Find the best matching resume profile for a detected role type.
 * Falls back to the default profile, then to null.
 */
export function matchResumeProfile(
  profiles: ResumeProfile[],
  detectedRoleType: string
): ResumeProfile | null {
  if (profiles.length === 0) return null;

  // Exact role_type match (case-insensitive)
  const exact = profiles.find(
    (p) => p.role_type.toLowerCase() === detectedRoleType.toLowerCase()
  );
  if (exact) return exact;

  // Fuzzy: check if detected role type is contained in profile role_type or vice versa
  const fuzzy = profiles.find((p) => {
    const pt = p.role_type.toLowerCase();
    const dt = detectedRoleType.toLowerCase();
    return pt.includes(dt) || dt.includes(pt);
  });
  if (fuzzy) return fuzzy;

  // Fall back to default
  const def = profiles.find((p) => p.is_default === 1);
  return def || profiles[0] || null;
}

const API_URL = () => `${config.JOB_TRACKER_URL}/api/jobs`;

const FETCH_TIMEOUT_MS = 10000; // 10 second timeout for all tracker calls

/**
 * Build the server-internal auth headers for every tracker call.
 *
 * The server/pipeline run on the same host; the pipeline subprocess
 * receives both values from its parent server via env vars (see
 * server/src/routes/pipeline.ts spawn site). Using a shared secret +
 * user id is how the pipeline impersonates the specific end user who
 * clicked "Run Pipeline", now that the old "default user id=1"
 * fallback has been removed for multi-tenant safety.
 *
 * The returned object is spread into every fetch() `headers`.
 */
export function internalAuthHeaders(): Record<string, string> {
  const token  = process.env.PIPELINE_INTERNAL_TOKEN;
  const userId = process.env.PIPELINE_USER_ID;
  if (!token || !userId) return {};
  return { Authorization: `Internal ${token}:${userId}` };
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Result of a batch duplicate probe. Callers should treat a job as
 * duplicate if EITHER its URL is in `links` OR its normalized
 * (title|company) key is in `titleCompanyKeys`. The second matching
 * surface catches re-published / re-tracked postings whose URL drifts
 * between scrape runs (UTM params, board re-publish, etc.) — without
 * it, applied/flagged jobs reappear with new URLs and the user sees
 * them as fresh candidates.
 */
export interface DuplicateBatchResult {
  links: Set<string>;
  titleCompanyKeys: Set<string>;
}

/**
 * Aggressive normalization for the title+company dedup key.
 *
 * Catches more near-duplicates than a simple lowercase+trim. Reasons:
 *
 *  - Job boards inconsistently append " (Galway)", "[Hybrid]", or
 *    "- Remote" to titles. The same role from two scrape sources
 *    looks different.
 *  - "Graduate Engineer-1" vs "Graduate Engineer 1" — punctuation
 *    drift between sources.
 *  - Trailing whitespace, em-dashes, special hyphens.
 *
 * After this normalizer, "Graduate Engineer-1 (Galway)" and
 * "Graduate Engineer 1" both collapse to "graduate engineer 1".
 *
 * IMPORTANT: keep this function in sync with the server's SQL
 * normalization in /api/jobs/exists-batch — drift between the two
 * silently breaks dedup.
 */
function normForKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")    // strip "(parens)" — "(Galway)", "(Remote)", etc.
    .replace(/\[[^\]]*\]/g, " ")   // strip "[brackets]" — "[Hybrid]", "[Full-time]", etc.
    .replace(/[^a-z0-9 ]/g, " ")   // collapse all punctuation (hyphens, em-dashes, slashes) to space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Batch duplicate check — sends URLs AND (title, company) pairs at
 * once, returns sets covering both matching surfaces. Returns null if
 * the tracker is unreachable so callers can decide whether to abort
 * (we'd rather skip the run than risk dupes).
 */
export async function checkDuplicatesBatch(
  jobs: Array<{ link: string; title: string; companyName: string }>,
): Promise<DuplicateBatchResult | null> {
  if (jobs.length === 0) return { links: new Set(), titleCompanyKeys: new Set() };
  // Extract the two matching surfaces. Some scrapers return jobs with
  // an empty link string; filter those out of the URL set but still
  // include their (title, company) for the secondary match.
  const links = jobs.map((j) => j.link).filter((l) => typeof l === "string" && l.length > 0);
  const titleCompanyPairs = jobs
    .filter((j) => j.title && j.companyName)
    .map((j) => ({ title: j.title, company: j.companyName }));

  try {
    const res = await fetch(`${API_URL()}/exists-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
      signal: withTimeout(15000), // slightly longer for batch
      body: JSON.stringify({ links, titleCompanyPairs }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      duplicates: string[];
      flagged?: string[];
      duplicateTitleCompanyKeys?: string[];
      flaggedTitleCompanyKeys?: string[];
    };
    // Merge duplicates + flagged into one URL set (both excluded).
    const linkSet = new Set(data.duplicates);
    if (data.flagged) data.flagged.forEach((l) => linkSet.add(l));
    // Same for the title+company key set.
    const tcKeySet = new Set(data.duplicateTitleCompanyKeys || []);
    if (data.flaggedTitleCompanyKeys) data.flaggedTitleCompanyKeys.forEach((k) => tcKeySet.add(k));
    return { links: linkSet, titleCompanyKeys: tcKeySet };
  } catch (err: any) {
    log.warn(`Batch duplicate check failed: ${err.message}`);
    return null;
  }
}

/** Build the same normalized (title|company) key the server returns. */
export function titleCompanyKey(title: string, company: string): string {
  return `${normForKey(title)}|${normForKey(company)}`;
}

/**
 * Returns true if job exists, false if not found, null if tracker is unreachable.
 * Callers must handle the null case explicitly to avoid duplicate applications.
 */
export async function checkDuplicate(jobLink: string): Promise<DuplicateCheckResult> {
  try {
    const res = await fetch(
      `${API_URL()}/exists?job_link=${encodeURIComponent(jobLink)}`,
      { headers: internalAuthHeaders(), signal: withTimeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) {
      log.warn(`Duplicate check returned HTTP ${res.status}`);
      return null; // Can't confirm either way
    }
    const data = (await res.json()) as any;
    return data.exists === true;
  } catch (err: any) {
    log.warn(`Job tracker unreachable for duplicate check: ${err.message}`);
    return null; // Service is down, can't confirm
  }
}

/**
 * Probe the tracker to see whether a job (by job_link) already has cover
 * letter / why-fit assets saved. Used by the pipeline to enforce a "generate
 * at most once per job" policy — if the assets exist, the expensive OpenAI
 * call is skipped entirely. Errors are treated as "not present" so a tracker
 * outage never silently blocks generation.
 */
export async function fetchJobAssetStatus(
  jobLink: string
): Promise<{ exists: boolean; hasCoverLetter: boolean; hasWhyFit: boolean }> {
  try {
    const res = await fetch(
      `${API_URL()}/exists?job_link=${encodeURIComponent(jobLink)}`,
      { headers: internalAuthHeaders(), signal: withTimeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return { exists: false, hasCoverLetter: false, hasWhyFit: false };
    const data = (await res.json()) as any;
    return {
      exists:         !!data.exists,
      hasCoverLetter: !!data.has_cover_letter,
      hasWhyFit:      !!data.has_why_fit,
    };
  } catch {
    return { exists: false, hasCoverLetter: false, hasWhyFit: false };
  }
}

export async function postFilteredJob(
  job: LinkedInJob,
  score?: number,
  matchReason?: string,
  isReach?: boolean,
  jobCategory?: string | null,
  scoreBreakdown?: any,
  detectedRoleType?: string
): Promise<void> {
  const res = await fetch(API_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
    signal: withTimeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      job_title: job.title,
      company_name: job.companyName,
      company_url: job.companyWebsite || null,
      job_link: job.link,
      location: job.location,
      salary: job.salary || null,
      seniority_level: job.seniorityLevel || null,
      applicants_count: job.applicantsCount || null,
      apply_url: job.applyUrl || null,
      description: job.descriptionText || null,
      match_score: score ?? null,
      match_reason: matchReason ?? null,
      notes: isReach ? "Reach role (senior/4+ years mentioned but still relevant)" : null,
      job_category: jobCategory ?? null,
      status: "filtered",
      applied_date: new Date().toISOString().split("T")[0],
      // Multi-source fields
      source: job.source || "linkedin",
      sources: job.sources ? JSON.stringify(job.sources) : null,
      source_count: job.sources ? job.sources.length : 1,
      content_hash: job.contentHash || null,
      posted_at: job.postedAt || null,
      freshness_score: job.freshnessScore ?? null,
      tags: job.tags ? JSON.stringify(job.tags) : null,
      score_breakdown: scoreBreakdown ? JSON.stringify(scoreBreakdown) : null,
      detected_role_type: detectedRoleType ?? null,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tracker POST failed: ${res.status} ${res.statusText} — ${body}`);
  }
}

/**
 * Attach resume URL, cover letter, and why-I'm-a-fit to the job — status stays "filtered".
 * Uses PATCH if the job already exists (found by job_link), otherwise falls back to POST.
 */
export async function attachJobAssets(
  job: LinkedInJob,
  resumeUrl: string,
  coverLetter: string,
  whyImAFit: string,
  jobCategory?: string | null,
  score?: number,
  matchReason?: string,
  resumeProfileId?: number,
  keywordMatchRate?: number
): Promise<void> {
  // First, try to find the existing job by job_link so we can PATCH it
  if (job.link) {
    try {
      const checkRes = await fetch(
        `${API_URL()}/exists?job_link=${encodeURIComponent(job.link)}`,
        { headers: internalAuthHeaders(), signal: withTimeout(FETCH_TIMEOUT_MS) }
      );
      if (checkRes.ok) {
        const data = (await checkRes.json()) as any;
        if (data.exists && data.id) {
          // Only include cover_letter / hiring_message in the PATCH if
          // we actually generated them this run. Sending nulls would
          // wipe values the user generated manually via the on-demand
          // Generate button — pipeline runs are now strictly on-demand-
          // skip for these fields.
          const patchBody: Record<string, unknown> = {
            resume_url: resumeUrl,
            match_score: score ?? null,
            match_reason: matchReason ?? null,
            job_category: jobCategory ?? null,
            resume_profile_id: resumeProfileId ?? null,
            keyword_match_rate: keywordMatchRate ?? null,
          };
          if (coverLetter) patchBody.cover_letter = coverLetter;
          if (whyImAFit) patchBody.hiring_message = whyImAFit;

          const patchRes = await fetch(`${API_URL()}/${data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
            signal: withTimeout(FETCH_TIMEOUT_MS),
            body: JSON.stringify(patchBody),
          });
          if (patchRes.ok) return;
        }
      }
    } catch {
      // Fall through to POST
    }
  }

  // Fallback: POST (upsert)
  const res = await fetch(API_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
    signal: withTimeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      job_title: job.title,
      company_name: job.companyName,
      company_url: job.companyWebsite || null,
      job_link: job.link,
      location: job.location,
      salary: job.salary || null,
      seniority_level: job.seniorityLevel || null,
      applicants_count: job.applicantsCount || null,
      apply_url: job.applyUrl || null,
      resume_url: resumeUrl,
      cover_letter: coverLetter || null,
      hiring_message: whyImAFit || null,
      description: job.descriptionText || null,
      match_score: score ?? null,
      match_reason: matchReason ?? null,
      job_category: jobCategory ?? null,
      status: "filtered",
      applied_date: new Date().toISOString().split("T")[0],
      source: job.source || "linkedin",
      sources: job.sources ? JSON.stringify(job.sources) : null,
      source_count: job.sources ? job.sources.length : 1,
      content_hash: job.contentHash || null,
      posted_at: job.postedAt || null,
      freshness_score: job.freshnessScore ?? null,
      tags: job.tags ? JSON.stringify(job.tags) : null,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tracker asset attach failed: ${res.status} ${res.statusText} — ${body}`);
  }
}
