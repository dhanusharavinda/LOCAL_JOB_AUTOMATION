/**
 * Server API client (extension edition).
 *
 * Lives only in the background service worker - content scripts send
 * `chrome.runtime.sendMessage({ type: "api", ... })` and the background
 * routes the call through here. That keeps the JWT off the page side
 * (where any other content script could read it) and consolidates auth
 * refresh in one place.
 */

import { getStoredToken, refreshSession, clearSession } from "./auth";

// Resolve API base from build-time injection. Falls back to localhost
// for `npm run dev`.
declare const __API_URL__: string | undefined;
export const API_URL =
  (typeof __API_URL__ !== "undefined" && __API_URL__) ||
  (globalThis as any)?.__GO_CANDID8_API_URL ||
  "http://localhost:3001";

interface ApiOpts {
  method?: string;
  body?: any;
  query?: Record<string, string>;
  retryOn401?: boolean;
}

export async function apiFetch<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  const token = await getStoredToken();
  if (!token) throw new ApiError("not_signed_in", 401, "Sign in via the popup first.");

  const url = new URL(path.startsWith("http") ? path : API_URL + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }

  const init: RequestInit = {
    method: opts.method || "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  let r: Response;
  try {
    r = await fetch(url.toString(), init);
  } catch (err: any) {
    throw new ApiError("network", 0, err?.message || "Network error");
  }

  if (r.status === 401 && opts.retryOn401 !== false) {
    // Try a single refresh, then retry once.
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch<T>(path, { ...opts, retryOn401: false });
    await clearSession();
    throw new ApiError("unauthorized", 401, "Your session expired. Sign in again.");
  }

  let parsed: any = null;
  try { parsed = await r.json(); } catch { parsed = null; }

  if (!r.ok) {
    const msg = parsed?.error || `Request failed (${r.status})`;
    throw new ApiError("server", r.status, msg, parsed);
  }
  return parsed as T;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: any;
  constructor(code: string, status: number, message: string, details?: any) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ── Typed helpers used by content scripts (via background routing) ──────

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

export interface JobContext {
  // `job` is optional to support /page-context responses for untracked
  // pages - those return profile-only and skip the kanban fields.
  job?: {
    id: number | null;
    job_title: string | null;
    company_name: string | null;
    apply_url: string | null;
    resume_url: string | null;
    /** Where the resume_url came from. "tailored" = job-specific PDF
     *  the pipeline or manual Tailor generated; "main" = the user's
     *  uploaded original resume, used as a fallback; "none" = nothing
     *  to attach. The overlay surfaces this to the user so they know
     *  what's about to be uploaded. */
    resume_source?: "tailored" | "main" | "none";
    cover_letter: string | null;
    hiring_message: string | null;
    description: string | null;
    match_score: number | null;
    ats_score: number | null;
  } | null;
  profile: ApplyProfile;
  ats_type: string;
  /** Count of saved bank answers (apply_profiles.custom_answers) for the
   *  signed-in user. The overlay shows this as the 📚 chip so the user
   *  can see their bank growing with each application they submit. */
  cached_answers_count?: number;
}

export async function getApplyProfile(): Promise<{ profile: ApplyProfile; exists: boolean }> {
  return apiFetch("/api/apply/profile");
}

export async function lookupJobByUrl(url: string, externalId?: string): Promise<JobContext> {
  const q: Record<string, string> = { url };
  if (externalId) q.external_id = externalId;
  return apiFetch("/api/apply/job-context-by-url", { query: q });
}

export async function trackApply(input: {
  jobId: number;
  method: string;
  success: boolean;
  errorMessage?: string;
  fieldsFilled?: number;
}): Promise<{ ok: true; fieldsFilled: number | null }> {
  return apiFetch("/api/apply/track", { method: "POST", body: input });
}

export async function aiAnswer(input: {
  jobId?: number;
  question: string;
  maxWords?: number;
}): Promise<{ answer: string; cached: boolean }> {
  return apiFetch("/api/apply/answer", { method: "POST", body: input });
}

export type AssistantAction =
  | "followup"
  | "linkedin_connect"
  | "linkedin_comment"
  | "referral_request"
  | "cold_outreach"
  | "thank_you"
  | "custom";

export interface AssistantTextInput {
  actionType: AssistantAction;
  context?: string;
  recipientName?: string;
  recipientRole?: string;
  targetCompany?: string;
  targetRole?: string;
  customInstruction?: string;
}

/**
 * Personalised draft from the in-popup AI assistant. The server already
 * holds the user's resume + apply_profile, so we send only the action
 * type, the pasted context, and optional recipient hints.
 */
export async function generateAssistantText(
  input: AssistantTextInput
): Promise<{ text: string; action: string }> {
  return apiFetch("/api/apply/assistant-text", { method: "POST", body: input });
}
