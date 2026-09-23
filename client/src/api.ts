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
  // PATCH /api/jobs/:id (the generic editable-fields route) - there is no
  // dedicated /:id/flag endpoint on the server. The old client URL hit a
  // 404 silently, so flagging never persisted and the pipeline's
  // duplicate check never excluded user-blocked jobs. The generic PATCH
  // route whitelists `flagged` in EDITABLE_FIELDS so this just works.
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flagged }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to toggle flag" }));
    throw new Error(err.error || `Failed to toggle flag (HTTP ${res.status})`);
  }
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

/**
 * On-demand recruiter follow-up email. Sent AFTER the application
 * has been submitted; the AI prompt explicitly acknowledges that the
 * application is already in. Tldr-style opening + a short formal
 * letter body. No em-dashes, no AI-slop filler.
 */
export async function regenerateRecruiterFollowup(jobId: number): Promise<string> {
  const res = await fetch(`${API_BASE}/${jobId}/recruiter-followup`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to generate follow-up" }));
    throw new Error(err.error || "Failed to generate follow-up");
  }
  const data = await res.json();
  return data.recruiter_followup || "";
}

/**
 * On-demand resume regeneration tailored to one tracked job. Same pattern
 * as regenerateCoverLetter / regenerateWhyFit but produces a PDF instead
 * of a text field. The server uploads the PDF to storage AND returns the
 * base64 so the client can offer an immediate download without re-signing
 * the storage URL.
 */
export async function regenerateTailoredResume(
  jobId: number,
  opts?: { intensity?: number }
): Promise<{ resumeUrl: string; pdfBase64: string }> {
  const res = await fetch(`${API_BASE}/${jobId}/tailor-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ? { intensity: opts.intensity } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to regenerate resume" }));
    throw new Error(err.error || "Failed to regenerate resume");
  }
  const data = await res.json();
  return { resumeUrl: data.resume_url || "", pdfBase64: data.pdfBase64 || "" };
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
  // Server-side filter strips common company/brand names from keywords
  // (LinkedIn matches keywords against company names too, so 'Agoda' as
  // a keyword silently restricts the search to Agoda jobs only). The
  // dropped names are returned so the UI can warn the user.
  dropped_keywords?: string[];
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

// ─── Work Experience stories (Story Bank tab) ────────────────────────
// First-person narratives generated from the resume's work history.
// The AI never invents details: anything the resume doesn't answer
// comes back as a follow-up question, and answering follow-ups weaves
// the answers into the story via /refine.

export interface ExperienceFollowup {
  question: string;
  answer: string | null;
}

export interface ExperienceStory {
  id: number;
  company: string;
  title: string;
  date_range: string | null;
  monologue: string;
  day_in_life: string | null;
  how_it_felt: string | null;
  followups: ExperienceFollowup[];
  status: "draft" | "complete";
  created_at: string;
  updated_at: string;
}

export async function fetchExperienceStories(): Promise<ExperienceStory[]> {
  const res = await fetch("/api/story-bank/experience");
  if (!res.ok) throw new Error("Failed to load experience stories");
  return res.json();
}

export async function generateExperienceStories(): Promise<{ created: ExperienceStory[]; skipped: number }> {
  const res = await fetch("/api/story-bank/experience/generate", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || "Could not generate experience stories");
  }
  return res.json();
}

export async function refineExperienceStory(
  id: number,
  answers: Array<{ question: string; answer: string }>,
): Promise<ExperienceStory> {
  const res = await fetch(`/api/story-bank/experience/${id}/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || "Could not update the story");
  }
  return res.json();
}

export async function deleteExperienceStory(id: number): Promise<void> {
  const res = await fetch(`/api/story-bank/experience/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete experience story");
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
  // Cover letters get their own daily allowance, the same size as the
  // resume one. Older servers omit these fields.
  coverQuota?: number;
  coverUsed?: number;
  coverRemaining?: number;
}

export interface FreeTailorResult {
  pdfBase64: string;
  pdfUrl: string | null;
  resumeData: any;
  // The page budget the server actually rendered to. The review editor
  // reuses it on re-render so an edited multi-page resume isn't silently
  // squeezed to one page. Optional for backward compatibility.
  targetPages?: number;
  // Optional cover-letter text. Populated only when the request set
  // `generateCoverLetter: true`. null when the flag was off, or when
  // the cover-letter call failed (the resume PDF still ships).
  coverLetter: string | null;
  // True when the cover letter was skipped because the user had already
  // used their daily cover-letter allowance.
  coverLetterSkipped?: boolean;
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

// Thrown when /api/free-tailor returns 401 - FreeTailorSection catches
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
  originalFilename?: string,
  // Set true to ALSO generate a cover letter alongside the tailored
  // resume. Off by default so the OpenAI cost stays at 1 call per
  // tailor for users who only want the resume.
  generateCoverLetter = false,
  // Free-form steering ("emphasise Databricks, drop GCP") that the
  // prompt treats as a high-priority keyword hint without overriding
  // immutable rules (job titles, certs, no fabrication).
  userInstructions?: string,
  // The uploaded resume's real page count (from the PDF parser). When set,
  // the tailored PDF is rendered to the same number of pages: 1 in -> 1 out,
  // 2 -> 2. Omitted for DOCX / pasted text, where the server estimates from
  // the resume's text length instead.
  targetPages?: number,
): Promise<FreeTailorResult> {
  const res = await fetch("/api/free-tailor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeText, jobDescription, intensity, originalFilename, generateCoverLetter, userInstructions, targetPages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Tailoring failed" }));
    if (res.status === 401) throw new AuthRequiredError(err.error || "Authentication required");
    throw new Error(err.error || "Tailoring failed");
  }
  return res.json();
}

// Re-render a PDF from (possibly user-edited) structured resume data.
// Used by the live review editor: the user accepts/rejects/edits the
// AI's changes, then we regenerate the PDF server-side WITHOUT another
// LLM call - so it never burns the daily tailor quota. Returns base64
// so the download path matches the original tailor result.
export async function renderResumePdf(
  resumeData: any,
  targetPages?: number,
): Promise<{ pdfBase64: string }> {
  const res = await fetch("/api/pdf/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeData, targetPages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "PDF generation failed" }));
    if (res.status === 401) throw new AuthRequiredError(err.error || "Authentication required");
    throw new Error(err.error || "PDF generation failed");
  }
  // The endpoint streams raw PDF bytes; convert to base64 via FileReader
  // (chunk-safe, unlike btoa over a giant binary string).
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { pdfBase64: dataUrl.split(",")[1] || "" };
}

// Stateless follow-up cover-letter generator. Used by the landing-page
// FreeTailor flow so users who didn't opt into the inline cover letter
// can still generate one AFTER the resume PDF lands, on the same
// resume + JD inputs. Doesn't burn the daily tailor quota.
export async function generateFreeTailorCoverLetter(
  resumeText: string,
  jobDescription: string,
): Promise<{ coverLetter: string }> {
  const res = await fetch("/api/free-tailor/cover-letter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeText, jobDescription }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Cover letter generation failed" }));
    if (res.status === 401) throw new AuthRequiredError(err.error || "Authentication required");
    throw new Error(err.error || "Cover letter generation failed");
  }
  return res.json();
}

// ─── Auth API ───────────────────────────────────────────────────────

// Patch window.fetch once to auto-inject the current Supabase access token
// on every /api/* request (except /api/auth/* which the server mounts
// before the auth middleware - those routes are reached either by the
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

// Deduplicate concurrent refresh attempts - if five API calls all 401
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

  // Happy path - token was valid (or route didn't need auth).
  if (firstResponse.status !== 401) return firstResponse;

  // 401 path - one retry after forcing a token refresh. Supabase's
  // autoRefreshToken normally handles this in the background, but the
  // refresh can fail silently (network blip, clock drift, etc.) and the
  // cached in-memory token stays stale. Rather than making the user
  // re-login, we give the refresh flow one explicit push here.
  //
  // Only refresh when the request was authenticated to begin with - 
  // unauth'd routes that reject with 401 (rare) shouldn't trigger
  // unnecessary Supabase traffic.
  if (!token) return firstResponse;

  const freshToken = await refreshTokenOnce();
  if (!freshToken) return firstResponse; // refresh failed; let caller see the 401

  // Retry with the new token. Only one retry - if it still 401s, the
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
  // Invite-only launch. access_state picks the screen the app shows:
  //   admin   - everything
  //   active  - early access (Resume Tailor), until access_expires_at
  //   expired - free early-access period ended
  //   invite_required / rejected - needs an invite link
  // The server enforces the same rules; these are display hints.
  access_state?: AccessState;
  access_expires_at?: string | null;
  // Null means access was never deliberately granted, so there is none.
  access_granted_at?: string | null;
  features?: LaunchFeatures;
}

export type AccessState = "admin" | "active" | "expired" | "invite_required" | "rejected";

export interface LaunchFeatures {
  tailor: boolean;
  pipeline: boolean;
  autoApply: boolean;
  interview: boolean;
  dashboard: boolean;
  storyBank: boolean;
  careerCoach: boolean;
}

// ─── Invite links (invite-only launch) ──────────────────────────────

export type InviteCheck =
  | { valid: true; access_days: number }
  | { valid: false; reason: "not_found" | "used" | "revoked" };

export async function checkInvite(token: string): Promise<InviteCheck> {
  const res = await fetch(`/api/invites/check/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error("Couldn't check this invite right now.");
  return res.json();
}

export async function redeemInvite(
  token: string,
): Promise<{ ok: true; alreadyHasAccess?: boolean; access_expires_at: string | null }> {
  const res = await fetch("/api/invites/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => null as any);
  if (!res.ok) {
    const e: any = new Error(body?.error || "Couldn't use this invite link.");
    e.code = body?.code;
    throw e;
  }
  return body;
}

export interface AdminInvite {
  id: number;
  token: string | null; // null once used or cancelled
  label: string | null;
  access_days: number;
  created_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
  redeemed_user_id: string | null;
  redeemed_email: string | null;
  redeemed_name: string | null;
  access_expires_at: string | null;
  // Only present once the link has been used (joined rows).
  approval_status?: "pending" | "approved" | "rejected" | null;
  tailor_limit?: number | null;   // null = the default daily allowance
  tailors_today?: number;
  tailors_total?: number;      // lifetime resumes tailored
  covers_today?: number;
  covers_total?: number;       // lifetime cover letters
  last_used_at?: string | null;
  cost_usd?: number;        // OpenAI spend: recorded where known, estimated otherwise
  costed_runs?: number;     // how many runs carry real token counts
  tokens_total?: number;    // recorded tokens (0 until runs start logging them)
}

async function adminJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null as any);
  if (!res.ok) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  return body as T;
}

export async function adminListInvites(): Promise<AdminInvite[]> {
  const data = await adminJson<{ invites: AdminInvite[] }>("/api/invites");
  return data.invites;
}

export async function adminCreateInvites(input: { count: number; label?: string; days: number }): Promise<AdminInvite[]> {
  const data = await adminJson<{ invites: AdminInvite[] }>("/api/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.invites;
}

export async function adminRevokeInvite(id: number): Promise<void> {
  await adminJson(`/api/invites/${id}/revoke`, { method: "POST" });
}

export async function adminExtendAccess(userId: string, days: number): Promise<{ access_expires_at: string }> {
  return adminJson(`/api/invites/users/${userId}/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
}

export async function adminEndAccess(userId: string): Promise<{ access_expires_at: string }> {
  return adminJson(`/api/invites/users/${userId}/end`, { method: "POST" });
}

/** Daily resume + cover letter allowance for one person. null = default. */
export async function adminSetTailorLimit(userId: string, limit: number | null): Promise<{ tailor_limit: number | null }> {
  return adminJson(`/api/invites/users/${userId}/limit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit }),
  });
}

/** Block keeps the account but shuts off access until it is unblocked. */
export async function adminBlockUser(userId: string, blocked: boolean): Promise<{ approval_status: string }> {
  return adminJson(`/api/invites/users/${userId}/block`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocked }),
  });
}

export interface UsageInfo {
  jobs_scraped: number;
  resumes_tailored: number;
  pipeline_runs: number;
}

export interface LimitsInfo {
  jobs_scraped: number;
  resumes_tailored: number;
}

export interface MeResponse {
  user: AuthUser;
  usage: UsageInfo;
  limits: LimitsInfo;
  candidateCount: number;
}

// NOTE: email/password signup + signin no longer go through our Express
// backend - they run entirely on the client via supabase.auth in
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
  // Usage aggregates - populated server-side from usage_tracking +
  // free_tailor_log + jobs in a single query.
  jobs_scraped_today: number;
  resumes_tailored_today: number;
  pipeline_runs_today: number;
  jobs_scraped_total: number;
  resumes_tailored_total: number;
  pipeline_runs_total: number;
  total_jobs: number;
  manual_tailors_today: number;
  manual_tailors_total: number;
  last_active_date: string | null; // ISO date (YYYY-MM-DD) or null if never
  // Per-user daily allowance override. null = the site default.
  tailor_limit?: number | null;
  // Practice interviews per WEEK. null = the site default (1).
  interview_limit?: number | null;
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

// ─── Apply (auto-apply feature) ─────────────────────────────────────────
export interface ApplyProfile {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
  street?: string | null;
  city?: string | null;
  state_region?: string | null;
  postcode?: string | null;
  country?: string | null;
  work_auth_status?: string | null;
  requires_sponsorship?: boolean | null;
  willing_to_relocate?: boolean | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  years_experience?: number | null;
  highest_degree?: string | null;
  university?: string | null;
  graduation_year?: number | null;
  start_date?: string | null;
  ethnicity?: string | null;
  gender?: string | null;
  veteran_status?: string | null;
  disability_status?: string | null;
  pronouns?: string | null;
  why_interested?: string | null;
  greatest_achievement?: string | null;
  problem_solved?: string | null;
  unique_strength?: string | null;
  custom_answers?: Record<string, string>;
}

export async function getApplyProfile(): Promise<{ profile: ApplyProfile; exists: boolean }> {
  const res = await fetch("/api/apply/profile");
  if (!res.ok) throw new Error("Failed to load apply profile");
  return res.json();
}

export async function saveApplyProfile(profile: Partial<ApplyProfile>): Promise<{ profile: ApplyProfile }> {
  const res = await fetch("/api/apply/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || "Could not save apply profile");
  }
  return res.json();
}

export async function applyAtsSubmit(jobId: number): Promise<{ ok: boolean; ats?: string; response?: any; needsProfile?: boolean }> {
  const res = await fetch(`/api/apply/ats-submit/${jobId}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(body?.error || `ATS submit failed (HTTP ${res.status})`);
    err.needsProfile = !!body?.needsProfile;
    err.ats = body?.ats;
    throw err;
  }
  return body;
}

export interface ExtractedResumeContacts {
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  phone: string | null;
  email: string | null;
}

export async function extractResumeContacts(): Promise<ExtractedResumeContacts> {
  const res = await fetch("/api/apply/extract-from-resume", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || "Could not parse resume");
  }
  return res.json();
}

// ─── Interview practice ────────────────────────────────────────────────
export interface InterviewQuestion {
  idx: number;
  question: string;
  type: "behavioral" | "technical" | "jd_specific";
  rubric_target: string[];
  hidden_hint: string;
  expected_length: "short" | "medium" | "long";
}

export interface InterviewStartResponse {
  sessionId: number;
  mode: "behavioral" | "technical";
  questions: InterviewQuestion[];
  followupCap: number;
  sessionMaxMs: number;
}

export interface InterviewTurnResponse {
  action: "follow_up" | "next" | "wrap";
  followUpQuestion?: string;
  // Short spoken reaction to the answer ("Nice, that's concrete.")
  // played before the follow-up / next question so the conversation
  // feels human instead of an abrupt question machine.
  ack?: string;
}

export interface InterviewRubric {
  overall_readiness?: number;
  dimensions?: Record<string, number>;
  by_question?: Array<{ q_idx: number; score: number; strengths: string[]; gaps: string[]; pull_quote: string; model_answer?: string }>;
  weak_areas_to_prep?: string[];
  stories_used?: string[];
}

export interface InterviewMetrics {
  total_words: number;
  total_seconds: number;
  wpm: number;
  filler_count: number;
  filler_per_100w: number;
  hedging_count: number;
  self_correct_count: number;
  turn_count: number;
}

export type InterviewDifficulty = "easy" | "medium" | "hard";

export async function interviewStart(input: {
  jobId?: number;
  manualJd?: string;
  manualResumeText?: string;
  fineTuneFocus?: string;
  mode: "behavioral" | "technical";
  difficulty?: InterviewDifficulty;
}): Promise<InterviewStartResponse> {
  const res = await fetch("/api/interview/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || `Could not start interview (HTTP ${res.status})`);
  }
  return res.json();
}

export async function interviewTurn(input: {
  sessionId: number;
  qIdx: number;
  answer: string;
  followUpDepth: number;
}): Promise<InterviewTurnResponse> {
  // Bounded. The server already caps its own OpenAI call, but a stalled
  // connection would otherwise leave the candidate watching "Considering
  // your answer" with no way out, and the caller treats a failure here
  // as "move to the next question" rather than as a dead end.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch("/api/interview/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("The interviewer took too long to respond.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // Carry the real cause up. This error is now logged and surfaced when
    // a follow-up gets skipped, and "Decide step failed" told nobody
    // whether the token had expired, the rate limiter had tripped, or
    // OpenAI was down.
    const body = await res.json().catch(() => null as any);
    const detail = body?.error || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error("session expired, sign in again");
    if (res.status === 429) throw new Error("interview rate limit hit, wait a minute");
    throw new Error(detail);
  }
  return res.json();
}

export async function interviewScore(input: {
  sessionId: number;
  transcript: Array<{ qIdx: number; role: "ai" | "user"; text: string; t_start: number; t_end: number }>;
}): Promise<{ readiness_score: number; rubric: InterviewRubric; metrics: InterviewMetrics }> {
  const res = await fetch("/api/interview/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Scoring failed");
  return res.json();
}

export async function interviewTtsBlob(text: string, sessionId?: number): Promise<Blob> {
  // Bounded: the caller awaits this before it starts listening, so an
  // unbounded fetch here stalls the whole question. Failing fast just
  // means the question is read on screen instead of spoken.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch("/api/interview/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // sessionId lets the server bill the spoken characters to this
      // session so the admin panel can show what it cost.
      body: JSON.stringify({ text, sessionId }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error("TTS failed");
  return res.blob();
}

/**
 * Whisper-backed STT. Avoids Chrome's SpeechRecognition (which routes
 * through Google's servers and fails on corp / slow networks). The
 * blob is whatever MediaRecorder produced - typically audio/webm in
 * Chrome, audio/mp4 in Safari. Server uses the mimetype to pick the
 * right extension when forwarding to OpenAI.
 *
 * Hard 25s client-side timeout via AbortController. Whisper itself
 * is usually <3s for a typical answer; anything over 25s is either
 * the OpenAI endpoint having a bad day or a stuck network. Better to
 * fail loudly so the UI can show the typed-answer fallback than to
 * leave the user staring at "Transcribing..." forever.
 */
export async function interviewStt(
  blob: Blob,
  timeoutMs = 25_000,
  opts?: { sessionId?: number; seconds?: number },
): Promise<string> {
  const fd = new FormData();
  // Filename here is for our own logs; OpenAI cares about the mimetype.
  // .webm is Chrome's default MediaRecorder output.
  const ext = blob.type.includes("mp4") ? "mp4"
            : blob.type.includes("ogg") ? "ogg"
            : blob.type.includes("wav") ? "wav"
            : "webm";
  fd.append("audio", blob, `answer.${ext}`);
  // The server charges this clip against the session's voice budget.
  // Reporting the real length keeps that budget accurate; the server
  // estimates from the file size if it is missing or implausible.
  if (opts?.sessionId != null) fd.append("sessionId", String(opts.sessionId));
  if (opts?.seconds != null) fd.append("seconds", String(Math.round(opts.seconds)));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("/api/interview/stt", { method: "POST", body: fd, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("Transcription timed out. Type your answer below and click I'm done.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || `Transcription failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  return String(data.text || "");
}

export interface InterviewSessionRow {
  id: number;
  mode: "behavioral" | "technical";
  status: "active" | "completed" | "abandoned";
  started_at: string;
  ended_at: string | null;
  readiness_score: number | null;
  metrics: InterviewMetrics | null;
  job_id: number | null;
  job_title: string | null;
  company_name: string | null;
}

export async function interviewListSessions(): Promise<{ sessions: InterviewSessionRow[] }> {
  const res = await fetch("/api/interview/sessions");
  if (!res.ok) throw new Error("Could not list sessions");
  return res.json();
}

export async function interviewAbandon(sessionId: number): Promise<void> {
  await fetch(`/api/interview/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "abandoned" }),
  });
}

export async function clearApplyAnswerCache(key?: string): Promise<{ ok: true }> {
  const res = await fetch("/api/apply/answer-cache", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: key || "" }),
  });
  if (!res.ok) throw new Error("Could not clear answer cache");
  return res.json();
}

// ─── AI Career Coach ─────────────────────────────────────────────────

export interface CareerSkillGap {
  skill: string;
  why: string;
  priority: "high" | "medium" | "low";
}

export interface CareerLearningItem {
  title: string;
  detail: string;
  resource: string;
  timeframe: string;
}

export interface CareerSalaryBenchmark {
  role: string;
  currency: string;
  low: number;
  median: number;
  high: number;
  sample_size: number;
  note: string;
}

export interface CareerRoadmap {
  role_target: string;
  summary: string;
  skill_gaps: CareerSkillGap[];
  learning_plan: CareerLearningItem[];
  salary_benchmark: CareerSalaryBenchmark | null;
  action_items: string[];
  generated_at: string;
}

/** Latest stored roadmap, or null if the user has never generated one. */
export async function getCareerRoadmap(): Promise<CareerRoadmap | null> {
  const res = await fetch("/api/career-coach");
  if (!res.ok) throw new Error("Failed to load career roadmap");
  const data = await res.json();
  return data.roadmap ?? null;
}

/** Build a fresh roadmap from the user's resume + scored jobs + skills. */
export async function generateCareerRoadmap(): Promise<CareerRoadmap> {
  const res = await fetch("/api/career-coach/generate", { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to build roadmap" }));
    throw new Error(err.error || "Failed to build roadmap");
  }
  const data = await res.json();
  return data.roadmap;
}

// ─── Realtime Job Matching ───────────────────────────────────────────

export interface JobMatch {
  id: number;
  job_title: string;
  company_name: string;
  location: string | null;
  salary: string | null;
  seniority_level: string | null;
  match_score: number | null;
  match_reason: string | null;
  detected_role_type: string | null;
  letter_grade: string;
  apply_url: string | null;
  job_link: string | null;
  status: string;
  posted_at: string | null;
  salary_fit: boolean;
  city_fit: boolean;
}

export interface JobMatchesResponse {
  matches: JobMatch[];
  profile: {
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string;
    city: string | null;
  };
  generated_at: string;
}

/** Curated, already-scored jobs matched to the user's skills/salary/city. */
export async function fetchJobMatches(minScore = 6, limit = 50): Promise<JobMatchesResponse> {
  const params = new URLSearchParams({ min: String(minScore), limit: String(limit) });
  const res = await fetch(`/api/job-matches?${params}`);
  if (!res.ok) throw new Error("Failed to load job matches");
  return res.json();
}

// ─── Feedback ────────────────────────────────────────────────────────

/** Capture a bug report / feature request / note server-side. Public route. */
export async function submitFeedback(input: {
  category: string;
  message: string;
  email?: string;
  page?: string;
}): Promise<void> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Could not send feedback" }));
    throw new Error(err.error || "Could not send feedback");
  }
}

export interface InterviewQuota {
  used: number;
  quota: number;
  remaining: number;
  plan: string;
  period?: string;
  resets_at?: string;
}

/** Practice interviews left this week. */
export async function interviewQuota(): Promise<InterviewQuota> {
  const res = await fetch("/api/interview/quota");
  if (!res.ok) throw new Error("Could not load your interview allowance");
  return res.json();
}

/** Practice interviews per week for one user. null clears the override. */
export async function adminSetInterviewLimit(userId: string, limit: number | null): Promise<{ interview_limit: number | null }> {
  const res = await fetch(`/api/invites/users/${userId}/interview-limit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null as any);
    throw new Error(body?.error || "Could not update the interview limit");
  }
  return res.json();
}
