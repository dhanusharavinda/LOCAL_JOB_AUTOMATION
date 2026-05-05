import { Job, JobStatus, CareerEvent, SkillData } from "./types";

const API_BASE = "/api/jobs";

export async function fetchJobs(): Promise<Job[]> {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function updateJobStatus(id: number, status: JobStatus): Promise<Job> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    // Pull the server's error envelope so the toast/banner can show
    // something useful ("Session expired. Please sign in again.")
    // instead of the generic "Failed to update job" that hid auth
    // failures behind a confusing snap-back UX.
    const errBody = await res.json().catch(() => null as any);
    if (res.status === 401) {
      throw new Error("Session expired. Sign in again to update the board.");
    }
    throw new Error(errBody?.error || `Failed to update job (HTTP ${res.status})`);
  }
  return res.json();
}

export async function updateJobNotes(id: number, notes: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error("Failed to update notes");
  return res.json();
}

export async function deleteJob(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete job");
}

export async function batchDeleteJobs(ids: number[]): Promise<{ deleted: number }> {
  const res = await fetch(`${API_BASE}/batch`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Failed to batch delete jobs");
  return res.json();
}

export async function toggleJobFlag(id: number, flagged: boolean): Promise<Job> {
  const res = await fetch(`${API_BASE}/${id}/flag`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flagged }),
  });
  if (!res.ok) throw new Error("Failed to toggle flag");
  return res.json();
}

export async function fetchFlaggedJobs(): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/flagged/list`);
  if (!res.ok) throw new Error("Failed to fetch flagged jobs");
  return res.json();
}

// ─── Timeline ──────────────────────────────────────────────────────────
export interface StatusHistoryEntry {
  id: number;
  job_id: number;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

export async function fetchJobTimeline(jobId: number): Promise<StatusHistoryEntry[]> {
  const res = await fetch(`${API_BASE}/${jobId}/timeline`);
  if (!res.ok) throw new Error("Failed to fetch timeline");
  return res.json();
}

// ─── Interview Prep ────────────────────────────────────────────────────
export interface StudyTopic {
  topic: string;
  why: string;
  depth: "surface" | "working" | "deep";
}

export interface StarStory {
  scenario: string;
  maps_to: string;
  tip: string;
}

export interface InterviewPrep {
  roleKeyThemes?: string[];
  topicsToStudy?: StudyTopic[];
  starStories?: StarStory[];
  companyIntel?: {
    whatTheyDo: string;
    whyThisRole: string;
    sharpQuestions: string[];
  };
  opener?: string;
  closerQuestions?: string[];
  // Legacy fields
  questions?: { question: string; type: string; tip: string }[];
  topics?: string[];
  talkingPoints?: string[];
}

export async function fetchInterviewPrep(jobId: number): Promise<InterviewPrep | null> {
  const res = await fetch(`${API_BASE}/${jobId}/interview-prep`);
  if (!res.ok) throw new Error("Failed to fetch interview prep");
  const data = await res.json();
  return data.interview_prep;
}

export async function regenerateInterviewPrep(jobId: number): Promise<InterviewPrep | null> {
  const res = await fetch(`${API_BASE}/${jobId}/interview-prep`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to generate interview prep");
  const data = await res.json();
  return data.interview_prep;
}

export async function regenerateCoverLetter(jobId: number): Promise<string> {
  const res = await fetch(`${API_BASE}/${jobId}/cover-letter`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to generate cover letter" }));
    throw new Error(err.error || "Failed to generate cover letter");
  }
  const data = await res.json();
  return data.cover_letter || "";
}

export async function regenerateWhyFit(jobId: number): Promise<string> {
  const res = await fetch(`${API_BASE}/${jobId}/why-fit`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to generate why-I'm-a-fit" }));
    throw new Error(err.error || "Failed to generate why-I'm-a-fit");
  }
  const data = await res.json();
  return data.hiring_message || "";
}

// ─── Expiry Check ──────────────────────────────────────────────────────
export async function checkExpiry(ids?: number[]): Promise<{ checked: number; expired: number; still_active: number }> {
  const res = await fetch(`${API_BASE}/check-expiry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  if (!res.ok) throw new Error("Failed to check expiry");
  return res.json();
}

export async function checkJobLink(jobId: number): Promise<{ expired: boolean; reason: string | null; statusCode: number }> {
  const res = await fetch(`${API_BASE}/${jobId}/check-link`);
  if (!res.ok) throw new Error("Failed to check link");
  return res.json();
}

export async function createJob(job: Partial<Job>): Promise<Job> {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (!res.ok) throw new Error("Failed to create job");
  return res.json();
}

export async function gmailStatus(): Promise<{ connected: boolean; lastSync: string | null }> {
  const res = await fetch("/api/gmail/status");
  if (!res.ok) throw new Error("Failed to get Gmail status");
  return res.json();
}

export async function gmailAuth(): Promise<{ url: string }> {
  const res = await fetch("/api/gmail/auth");
  if (!res.ok) throw new Error("Failed to get Gmail auth URL");
  return res.json();
}

export async function gmailDisconnect(): Promise<void> {
  const res = await fetch("/api/gmail/disconnect", { method: "POST" });
  if (!res.ok) throw new Error("Failed to disconnect Gmail");
}

export async function gmailSync(): Promise<{ synced: number; updates: any[]; scanned: number }> {
  const res = await fetch("/api/gmail/sync", { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Sync failed" }));
    throw new Error(err.error || "Sync failed");
  }
  return res.json();
}

export async function fetchCurrentSkills(
  filters?: { role?: string; location?: string; company?: string }
): Promise<{ total_jobs: number; skills: SkillData[] }> {
  const params = new URLSearchParams({ source: "archive" });
  if (filters?.role) params.set("role", filters.role);
  if (filters?.location) params.set("location", filters.location);
  if (filters?.company) params.set("company", filters.company);
  const res = await fetch(`/api/skills/current?${params}`);
  if (!res.ok) throw new Error("Failed to fetch skills");
  return res.json();
}

export interface SkillFilter {
  label: string;
  value: string;
  count: number;
}

export async function fetchSkillFilters(): Promise<{ roles: SkillFilter[]; locations: SkillFilter[]; companies: SkillFilter[] }> {
  const res = await fetch("/api/skills/filters");
  if (!res.ok) throw new Error("Failed to fetch skill filters");
  return res.json();
}

export async function fetchEvents(
  upcomingOnly = true,
  filters?: { location?: string; type?: string }
): Promise<CareerEvent[]> {
  const params = new URLSearchParams({ upcoming: String(upcomingOnly) });
  if (filters?.location) params.set("location", filters.location);
  if (filters?.type) params.set("type", filters.type);
  const res = await fetch(`/api/events?${params}`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}

// ─── Settings API ────────────────────────────────────────────────────

export interface ResumeStatus {
  uploaded: boolean;
  filename: string | null;
  charCount: number;
  preview: string;
}

export interface PipelineConfig {
  RELEVANCE_SCORE_THRESHOLD: number;
  TAILORING_INTENSITY: number;
  APIFY_JOB_COUNT: number;
  BATCH_DELAY_MS: number;
  APIFY_MAX_POLL_MINUTES: number;
  MAX_TAILOR_COUNT: number;
  MAX_AGE_DAYS: number;
  SEARCH_KEYWORDS: string;
  LINKEDIN_KEYWORDS: string;
  LINKEDIN_SKILLS: string;
  LINKEDIN_SEARCH_URL: string;
  LINKEDIN_EXPERIENCE: string;
  LINKEDIN_TIME_FILTER: string;
  LINKEDIN_WORK_TYPE: string;
  LINKEDIN_JOB_TYPE: string;
  TARGET_ROLE: string;
  SCRAPE_LINKEDIN: boolean;
  SCRAPE_REMOTEOK: boolean;
  SCRAPE_JOBICY: boolean;
  SCRAPE_HN: boolean;
  SCRAPE_WWR: boolean;
  SCRAPE_ARBEITNOW: boolean;
  SCRAPE_REMOTIVE: boolean;
  SCRAPE_DEVTO: boolean;
  SCRAPE_JOBSIE: boolean;
  SCRAPE_IRISHJOBS: boolean;
  SCRAPE_INDEED_IE: boolean;
  SCRAPE_GRADIRELAND: boolean;
  SCRAPE_CAREERJET: boolean;
  SCRAPE_GLASSDOOR: boolean;
  // India scrapers
  SCRAPE_NAUKRI: boolean;
  SCRAPE_INSTAHYRE: boolean;
  SCRAPE_INDEED_IN: boolean;
  // UK + Netherlands scrapers
  SCRAPE_INDEED_UK: boolean;
  SCRAPE_INDEED_NL: boolean;
  // Country selection
  TARGET_COUNTRIES: string;
  LOCATION_REGIONS: string;
  // When true, bare-remote listings (no country in the location) pass the
  // location filter alongside country-matched jobs. Off by default so
  // picking "Ireland" doesn't smuggle in remote-from-anywhere listings.
  INCLUDE_REMOTE: boolean;
  // Focus a single pipeline run on one target company from the Settings
  // → Portals library. null / empty scans all active companies as before.
  TARGET_COMPANY_ID: string | null;
  // Enterprise-only tier preference (1/2/3). Controls scrape + tailor
  // limits for enterprise accounts. Ignored for free/pro plans.
  ENTERPRISE_TIER: 1 | 2 | 3;
  // Optional generation toggles (pipeline will skip the LLM call when false)
  ENABLE_COVER_LETTER: boolean;
  ENABLE_WHY_FIT: boolean;
}

export interface SettingsData {
  resume: ResumeStatus;
  config: PipelineConfig;
  usage?: UsageInfo;
  limits?: LimitsInfo;
}

export async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(updates: Partial<PipelineConfig>): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update settings");
}

export async function uploadResume(file: File): Promise<ResumeStatus> {
  const form = new FormData();
  form.append("resume", file);
  const res = await fetch("/api/settings/resume", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}

export async function uploadResumeText(text: string): Promise<ResumeStatus> {
  const res = await fetch("/api/settings/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}

export async function deleteResume(): Promise<void> {
  const res = await fetch("/api/settings/resume", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete resume");
}

// ─── Natural-language search parser ──────────────────────────────────
export interface ParsedSearch {
  keywords: string[];
  country: "ireland" | "uk" | "netherlands" | "india" | "newzealand" | null;
  experience_levels: string[]; // subset of "1".."6"
  work_type: "1" | "2" | "3" | null;  // 1=on-site, 2=remote, 3=hybrid
  time_filter: "r86400" | "r604800" | "r2592000" | null;
}

export async function parseSearchText(text: string): Promise<ParsedSearch> {
  const res = await fetch("/api/settings/parse-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Parse failed" }));
    throw new Error(err.error || "Parse failed");
  }
  return res.json();
}

// ─── Resume Analysis (ReWrite) API ──────────────────────────────────

export interface BulletSuggestion {
  original: string;
  improved: string;
  addedKeywords: string[];
  accepted: boolean;
}

export interface OptimizationSection {
  section: string;
  role: string;
  company: string;
  date: string;
  bullets: BulletSuggestion[];
}

export interface ProjectSwap {
  removeProject: string;
  addProject: {
    title: string;
    summary: string;
    bullets: string[];
    reason: string;
  };
}

export interface ResumeAnalysis {
  jobId: number;
  jobTitle: string;
  companyName: string;
  matchScore: number;
  // ATS keyword-density score. The server returns both `matchScore`
  // (overall fit) and `atsScore` (keyword coverage). They're often the
  // same number, but for borderline JDs it's useful to see them split.
  atsScore?: number;
  analysis: {
    strengths: string[];
    foundKeywords: string[];
    addedKeywords: string[];
    missingKeywords: string[];
  };
  optimizations: OptimizationSection[];
  projectSwaps?: ProjectSwap[];
  skillsUpdate?: {
    languages: string;
    frameworks: string;
    tools: string;
  };
  summaryOriginal: string;
  summaryImproved: string;
  coverLetter?: string;
  hiringMessage?: string;
}

// ── Project Bank ──────────────────────────────────────────────────────────
export interface BankProject {
  id: number;
  title: string;
  link: string | null;
  date: string | null;
  location: string | null;
  summary: string | null;
  bulletPoints: string[];
  tags: string[];
}

export async function fetchProjectBank(): Promise<BankProject[]> {
  const res = await fetch("/api/project-bank");
  if (!res.ok) throw new Error("Failed to fetch project bank");
  return res.json();
}

export async function createBankProject(project: Omit<BankProject, "id">): Promise<BankProject> {
  const res = await fetch("/api/project-bank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return res.json();
}

export async function updateBankProject(id: number, project: Partial<BankProject>): Promise<BankProject> {
  const res = await fetch(`/api/project-bank/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json();
}

export async function deleteBankProject(id: number): Promise<void> {
  const res = await fetch(`/api/project-bank/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete project");
}

export async function analyzeResume(
  jobId: number,
  opts?: { resumeText?: string; customDescription?: string }
): Promise<ResumeAnalysis> {
  const res = await fetch(`/api/jobs/${jobId}/analyze-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Analysis failed" }));
    throw new Error(err.error || "Analysis failed");
  }
  return res.json();
}

export async function applySuggestions(
  jobId: number,
  optimizations: OptimizationSection[],
  summaryImproved?: string,
  resumeText?: string
): Promise<{ ok: boolean; resumeUrl: string }> {
  const res = await fetch(`/api/jobs/${jobId}/apply-suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optimizations, summaryImproved, resumeText }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Apply failed" }));
    throw new Error(err.error || "Apply failed");
  }
  return res.json();
}

// ─── Story Bank API ─────────────────────────────────────────────────

export interface StoryBankEntry {
  id: number;
  story_title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection: string | null;
  tags: string[];
  source_job_id: number | null;
  created_at: string;
}

export async function fetchStoryBank(): Promise<StoryBankEntry[]> {
  const res = await fetch("/api/story-bank");
  if (!res.ok) throw new Error("Failed to fetch story bank");
  return res.json();
}

export async function fetchStoriesByTag(tag: string): Promise<StoryBankEntry[]> {
  const res = await fetch(`/api/story-bank/by-tag/${encodeURIComponent(tag)}`);
  if (!res.ok) throw new Error("Failed to fetch stories by tag");
  return res.json();
}

export async function createStory(story: Omit<StoryBankEntry, "id" | "created_at">): Promise<StoryBankEntry> {
  const res = await fetch("/api/story-bank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(story),
  });
  if (!res.ok) throw new Error("Failed to create story");
  return res.json();
}

export async function deleteStory(id: number): Promise<void> {
  const res = await fetch(`/api/story-bank/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete story");
}

// ─── Target Companies API ───────────────────────────────────────────

export interface TargetCompany {
  id: number;
  company_name: string;
  careers_url: string;
  ats_type: string;
  title_keywords: string[];
  negative_keywords: string[];
  last_scanned_at: string | null;
  active: number;
}

export async function fetchTargetCompanies(): Promise<TargetCompany[]> {
  const res = await fetch("/api/target-companies");
  if (!res.ok) throw new Error("Failed to fetch target companies");
  return res.json();
}

export async function createTargetCompany(company: Partial<TargetCompany>): Promise<TargetCompany> {
  const res = await fetch("/api/target-companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(company),
  });
  if (!res.ok) throw new Error("Failed to create target company");
  return res.json();
}

export async function updateTargetCompany(id: number, company: Partial<TargetCompany>): Promise<TargetCompany> {
  const res = await fetch(`/api/target-companies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(company),
  });
  if (!res.ok) throw new Error("Failed to update target company");
  return res.json();
}

export async function deleteTargetCompany(id: number): Promise<void> {
  const res = await fetch(`/api/target-companies/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete target company");
}

// ─── Pipeline API ───────────────────────────────────────────────────

export async function startPipeline(config?: Partial<PipelineConfig>, candidateId?: number): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/pipeline/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, candidate_id: candidateId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to start pipeline" }));
    throw new Error(err.error || "Failed to start pipeline");
  }
  return res.json();
}

export async function stopPipeline(): Promise<void> {
  const res = await fetch("/api/pipeline/stop", { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop pipeline");
}

export async function pipelineStatus(): Promise<{ running: boolean; logCount: number }> {
  const res = await fetch("/api/pipeline/status");
  if (!res.ok) throw new Error("Failed to get pipeline status");
  return res.json();
}

// ─── Free Tailor API ────────────────────────────────────────────────

export interface FreeTailorStatus {
  plan: "free" | "pro" | "enterprise";
  quota: number;
  used: number;
  remaining: number;
}

export interface FreeTailorResult {
  pdfBase64: string;
  pdfUrl: string | null;
  resumeData: any;
  plan: "free" | "pro" | "enterprise";
  quota: number;
  used: number;
  remaining: number;
}

export async function checkFreeTailorStatus(): Promise<FreeTailorStatus> {
  const res = await fetch("/api/free-tailor/status");
  if (!res.ok) return { plan: "free", quota: 1, used: 0, remaining: 1 };
  return res.json();
}

// Thrown when /api/free-tailor returns 401 — FreeTailorSection catches
// this and re-opens the AuthModal instead of surfacing a red error banner.
export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export async function freeTailorResume(
  resumeText: string,
  jobDescription: string,
  intensity = 5,
  originalFilename?: string
): Promise<FreeTailorResult> {
  const res = await fetch("/api/free-tailor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeText, jobDescription, intensity, originalFilename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Tailoring failed" }));
    if (res.status === 401) throw new AuthRequiredError(err.error || "Authentication required");
    throw new Error(err.error || "Tailoring failed");
  }
  return res.json();
}

// ─── Auth API ───────────────────────────────────────────────────────

// Patch window.fetch once to auto-inject the current Supabase access token
// on every /api/* request (except /api/auth/* which the server mounts
// before the auth middleware — those routes are reached either by the
// auth middleware itself or are public). The token comes from the
// in-memory cache in supabaseClient.ts, which is kept in sync with
// supabase-js via onAuthStateChange.
//
// IMPORTANT: we intentionally avoid localStorage lookups here because
// (a) they're synchronous disk I/O and (b) they're brittle across
// supabase-js version bumps that change the persisted schema.
import { getCurrentAccessToken, supabase } from "./supabaseClient";

const _origFetch = window.fetch;

/** Inject the current Bearer token into the request headers, if any. */
function attachAuthHeader(init: RequestInit, token: string): RequestInit {
  const next: RequestInit = { ...init };
  if (next.headers instanceof Headers) {
    const h = new Headers(next.headers);
    h.set("Authorization", `Bearer ${token}`);
    next.headers = h;
  } else if (Array.isArray(next.headers)) {
    const filtered = next.headers.filter(([k]) => k.toLowerCase() !== "authorization");
    filtered.push(["Authorization", `Bearer ${token}`]);
    next.headers = filtered;
  } else if (typeof next.headers === "object" && next.headers) {
    next.headers = { ...(next.headers as Record<string, string>), Authorization: `Bearer ${token}` };
  } else {
    next.headers = { Authorization: `Bearer ${token}` };
  }
  return next;
}

// Deduplicate concurrent refresh attempts — if five API calls all 401
// at once (e.g. when the user returns to a tab after the token expired),
// we only hit supabase.auth.refreshSession() once and all five retries
// use the new token together.
let _refreshInflight: Promise<string | null> | null = null;
async function refreshTokenOnce(): Promise<string | null> {
  if (_refreshInflight) return _refreshInflight;
  _refreshInflight = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) return null;
      return data.session?.access_token ?? null;
    } catch {
      return null;
    } finally {
      // Clear the inflight marker in the next microtask so queued
      // retries all see the same resolved value.
      setTimeout(() => { _refreshInflight = null; }, 0);
    }
  })();
  return _refreshInflight;
}

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

  // Non-API calls bypass all auth wiring.
  if (!url.startsWith("/api") || url.startsWith("/api/auth/callback")) {
    return _origFetch.call(this, input, init);
  }

  const token = getCurrentAccessToken();
  let preparedInit = init || {};
  if (token) preparedInit = attachAuthHeader(preparedInit, token);

  const firstResponse = await _origFetch.call(this, input, preparedInit);

  // Happy path — token was valid (or route didn't need auth).
  if (firstResponse.status !== 401) return firstResponse;

  // 401 path — one retry after forcing a token refresh. Supabase's
  // autoRefreshToken normally handles this in the background, but the
  // refresh can fail silently (network blip, clock drift, etc.) and the
  // cached in-memory token stays stale. Rather than making the user
  // re-login, we give the refresh flow one explicit push here.
  //
  // Only refresh when the request was authenticated to begin with —
  // unauth'd routes that reject with 401 (rare) shouldn't trigger
  // unnecessary Supabase traffic.
  if (!token) return firstResponse;

  const freshToken = await refreshTokenOnce();
  if (!freshToken) return firstResponse; // refresh failed; let caller see the 401

  // Retry with the new token. Only one retry — if it still 401s, the
  // session is genuinely invalid (revoked, deleted user, etc.) and the
  // caller should treat it as a real auth failure.
  const retriedInit = attachAuthHeader(init || {}, freshToken);
  return _origFetch.call(this, input, retriedInit);
};

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  onboarded_at?: string | null;
  // Testers land as "pending" and see a waitlist screen until the owner
  // approves them from the admin panel. "approved" = full access,
  // "rejected" = access denied permanently.
  approval_status?: "pending" | "approved" | "rejected";
  // Server-side admin flag, derived from ADMIN_EMAILS env. The client
  // only uses this to show/hide the admin nav link; every admin endpoint
  // is re-verified server-side so tampering with this flag locally
  // doesn't grant any real access.
  is_admin?: boolean;
}

export interface UsageInfo {
  jobs_scraped: number;
  resumes_tailored: number;
  pipeline_runs: number;
}

export interface LimitsInfo {
  jobs_scraped: number;
  resumes_tailored: number;
  gmail_sync: boolean;
}

export interface MeResponse {
  user: AuthUser;
  usage: UsageInfo;
  limits: LimitsInfo;
  candidateCount: number;
}

// NOTE: email/password signup + signin no longer go through our Express
// backend — they run entirely on the client via supabase.auth in
// AuthPage.tsx. The server only exposes GET /api/auth/me and
// PUT /api/auth/plan now. See middleware/auth.ts for details.

/**
 * Fetches the current user's profile + usage from the server.
 * Requires a valid Supabase session (handled by the global fetch patch
 * above which injects the access token).
 */
export async function authMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

/**
 * Marks the signed-in user as having seen (or dismissed) the first-run
 * product tour. Server persists a timestamp; subsequent calls to /me will
 * return a non-null onboarded_at so the tour never re-fires.
 */
export async function authMarkOnboarded(): Promise<{ ok: boolean; onboarded_at: string }> {
  const res = await fetch("/api/auth/onboarded", { method: "POST" });
  if (!res.ok) throw new Error("Failed to mark onboarded");
  return res.json();
}

/**
 * Switch the signed-in user's plan (dev mode, pre-Stripe). The server
 * accepts "free" | "pro" | "enterprise" and simply writes the new plan
 * to the users row. When Stripe is wired up this endpoint will be
 * replaced by a webhook-driven flow and the client will instead hit a
 * `POST /api/billing/checkout-session` endpoint that redirects to
 * Stripe Checkout. Until then this is the "upgrade" button's backend.
 */
// ─── Admin: approval gate ───────────────────────────────────────────
// Owner-only endpoints. The server enforces admin identity via ADMIN_EMAILS
// env, so a non-admin calling these gets a 403.
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  approval_status: "pending" | "approved" | "rejected";
  approved_at: string | null;
  created_at: string;
  // Usage aggregates — populated server-side from usage_tracking +
  // free_tailor_log + jobs + gmail_tokens in a single query.
  jobs_scraped_today: number;
  resumes_tailored_today: number;
  pipeline_runs_today: number;
  jobs_scraped_total: number;
  resumes_tailored_total: number;
  pipeline_runs_total: number;
  total_jobs: number;
  manual_tailors_today: number;
  manual_tailors_total: number;
  gmail_connected: boolean;
  last_active_date: string | null; // ISO date (YYYY-MM-DD) or null if never
}

export async function adminListUsers(status?: "pending" | "approved" | "rejected"): Promise<AdminUserRow[]> {
  const qs = status ? `?status=${status}` : "";
  const res = await fetch(`/api/auth/admin/users${qs}`);
  if (!res.ok) {
    if (res.status === 403) throw new Error("Admin access required.");
    throw new Error(`Failed to list users (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.users as AdminUserRow[];
}

export async function adminSetApproval(
  userId: string,
  status: "pending" | "approved" | "rejected"
): Promise<{ ok: boolean; user: { id: string; email: string; approval_status: string } }> {
  const res = await fetch(`/api/auth/admin/approve/${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null as any);
    throw new Error(errBody?.error || `Failed to update approval (HTTP ${res.status})`);
  }
  return res.json();
}

export async function authSetPlan(plan: "free" | "pro" | "enterprise"): Promise<{ ok: boolean; plan: string }> {
  const res = await fetch("/api/auth/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    // Try to parse the server's JSON error envelope so the UI shows
    // "Invalid or expired token" etc. instead of the raw JSON blob.
    // Falls back to plain text when the body isn't JSON.
    const errBody = await res.json().catch(() => null as any);
    const fallback = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("Your session expired. Please sign in again to change plan.");
    }
    throw new Error(errBody?.error || fallback || `Failed to update plan (HTTP ${res.status})`);
  }
  return res.json();
}

// ─── Candidates API (Enterprise) ────────────────────────────────────

export interface Candidate {
  id: number;
  name: string;
  email: string | null;
  resume_text: string | null;
  resume_filename: string | null;
  notes: string | null;
  tier: 1 | 2 | 3;
  job_count: number;
  tailored_count: number;
  usage: UsageInfo;
  limits: LimitsInfo;
  canRunToday: boolean;
  dailyRunReason?: string;
  created_at: string;
}

export async function fetchCandidates(): Promise<Candidate[]> {
  const res = await fetch("/api/candidates");
  if (!res.ok) throw new Error("Failed to fetch candidates");
  return res.json();
}

export async function createCandidate(data: { name: string; email?: string; notes?: string }): Promise<Candidate> {
  const res = await fetch("/api/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create candidate");
  return res.json();
}

export async function updateCandidate(id: number, data: Partial<Candidate>): Promise<Candidate> {
  const res = await fetch(`/api/candidates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update candidate");
  return res.json();
}

export async function deleteCandidate(id: number): Promise<void> {
  const res = await fetch(`/api/candidates/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete candidate");
}
