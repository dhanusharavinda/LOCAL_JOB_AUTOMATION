/**
 * ATS dispatcher.
 *
 * Detects which ATS hosts a given apply URL and routes server-side
 * direct-submission requests to the right handler. Each handler returns
 * { ok, error?, response? } so the calling route can persist the
 * outcome without having to know about ATS-specific details.
 *
 * Detection is hostname-based and intentionally conservative - when in
 * doubt we return 'unknown' and the caller falls back to the extension
 * flow rather than guessing wrong and silently failing the submit.
 */

import { submitGreenhouse } from "./greenhouse";
import { submitLever } from "./lever";
import { submitWorkable } from "./workable";
import { submitAshby } from "./ashby";
import { getResumePdfSignedUrl } from "../../storage";

export type AtsType =
  | "greenhouse"
  | "lever"
  | "workable"
  | "ashby"
  | "linkedin"
  | "workday"
  | "indeed"
  | "unknown";

/** Hostname → ATS classification. Mirrors pipeline/src/services/scrapers/portal-scanner.ts. */
export function detectAtsType(url: string): AtsType {
  if (!url || typeof url !== "string") return "unknown";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
  if (host.endsWith(".greenhouse.io") || host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") return "greenhouse";
  if (host === "jobs.lever.co" || host.endsWith(".lever.co")) return "lever";
  if (host === "apply.workable.com" || host.endsWith(".workable.com")) return "workable";
  if (host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com")) return "ashby";
  if (host === "www.linkedin.com" || host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host.endsWith(".myworkdayjobs.com") || host.endsWith(".workday.com")) return "workday";
  if (host.endsWith("indeed.com") || host.endsWith(".indeed.com")) return "indeed";
  return "unknown";
}

export interface AtsSubmitInput {
  ats: AtsType;
  job: any;                  // jobs row
  profile: any;              // apply_profiles row
  resumeText: string | null;
  coverLetter: string;
}

export interface AtsSubmitResult {
  ok: boolean;
  error?: string;
  response?: any;
}

/**
 * Resolve the user's tailored resume PDF as a Buffer for multipart
 * upload to ATS APIs. We re-sign the URL (rather than trusting whatever
 * was last persisted on jobs.resume_url) so an expired link doesn't
 * silently fail the submit.
 */
export async function fetchResumePdfBuffer(
  userId: string,
  filename: string | null
): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!filename) return null;
  const url = await getResumePdfSignedUrl(userId, filename);
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return { buffer: Buffer.from(ab), filename };
  } catch {
    return null;
  }
}

/** Dispatch to the right ATS handler. Falls through to a clear error. */
export async function submitToAts(input: AtsSubmitInput): Promise<AtsSubmitResult> {
  switch (input.ats) {
    case "greenhouse": return submitGreenhouse(input);
    case "lever":      return submitLever(input);
    case "workable":   return submitWorkable(input);
    case "ashby":      return submitAshby(input);
    case "linkedin":
    case "workday":
      return { ok: false, error: `${input.ats} requires the browser extension.` };
    default:
      return { ok: false, error: "Unknown ATS - try the browser extension instead." };
  }
}
