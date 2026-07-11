import { AtsSubmitInput, AtsSubmitResult, fetchResumePdfBuffer } from "./index";

/**
 * Greenhouse Boards - public job board API.
 *
 * URL shapes we accept:
 *   - boards.greenhouse.io/<board_token>/jobs/<job_id>
 *   - job-boards.greenhouse.io/<board_token>/jobs/<job_id>
 *   - <company>.greenhouse.io/jobs/<job_id>  (less common, modern format)
 *
 * Submission endpoint:
 *   POST https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}
 *
 * Required form-data fields per Greenhouse spec:
 *   first_name, last_name, email, resume (file)
 *
 * Notes:
 *   - Greenhouse exposes a public submission endpoint that does NOT
 *     require API keys - applications are public-facing by design.
 *   - The endpoint accepts multipart/form-data with the resume as a
 *     file blob. Custom-question answers are encoded as
 *     question_<id>=<answer> but their ids are board-specific and we'd
 *     need to fetch /v1/boards/{token}/jobs/{id}?questions=true first
 *     to discover them. For v1 we send the core fields and rely on the
 *     extension flow for boards that have required custom questions.
 */
export async function submitGreenhouse(input: AtsSubmitInput): Promise<AtsSubmitResult> {
  const { job, profile } = input;
  const url = job.apply_url || job.job_link || "";
  const ids = parseGreenhouseUrl(url);
  if (!ids) return { ok: false, error: "Could not parse Greenhouse board/job from URL" };

  const fullName = String(profile.full_name || "").trim();
  const [firstName, ...lastParts] = fullName.split(/\s+/);
  const lastName = lastParts.join(" ") || firstName;

  if (!firstName || !profile.email) {
    return { ok: false, error: "Apply profile is missing name or email." };
  }

  // Resolve the resume_url filename so we can re-sign and fetch it.
  let resumeFilename: string | null = null;
  if (job.resume_url) {
    try {
      const u = new URL(job.resume_url);
      const last = u.pathname.split("/").pop() || "";
      resumeFilename = decodeURIComponent(last) || null;
    } catch {
      resumeFilename = null;
    }
  }

  // Caller (routes/apply.ts) is responsible for stamping job.user_id from
  // the authenticated session. Refuse to proceed if it's missing rather
  // than silently looking up the row's owner - that path would let a
  // future caller accidentally post one user's resume to an ATS while
  // authenticated as someone else.
  if (!job.user_id) {
    return { ok: false, error: "Internal: missing user_id on job context" };
  }
  const resume = resumeFilename
    ? await fetchResumePdfBuffer(job.user_id, resumeFilename)
    : null;
  if (!resume) {
    return { ok: false, error: "No tailored resume PDF found for this job." };
  }

  const fd = new FormData();
  fd.append("first_name", firstName);
  fd.append("last_name", lastName);
  fd.append("email", String(profile.email));
  if (profile.phone) fd.append("phone", String(profile.phone));
  if (input.coverLetter && input.coverLetter.trim()) {
    fd.append("cover_letter_text", input.coverLetter.slice(0, 5000));
  }
  if (profile.linkedin_url) fd.append("linkedin", profile.linkedin_url);
  if (profile.github_url)   fd.append("github",   profile.github_url);
  if (profile.portfolio_url) fd.append("website",  profile.portfolio_url);

  // Convert Node Buffer → Uint8Array view so it satisfies BlobPart
  // (Node's Buffer types use ArrayBufferLike which TS narrows away from
  // Blob's ArrayBuffer requirement).
  const blob = new Blob([new Uint8Array(resume.buffer)], { type: "application/pdf" });
  fd.append("resume", blob, resume.filename);

  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ids.board)}/jobs/${encodeURIComponent(ids.jobId)}`;
  try {
    const r = await fetch(endpoint, { method: "POST", body: fd });
    const txt = await r.text();
    if (!r.ok) {
      return { ok: false, error: `Greenhouse responded ${r.status}: ${txt.slice(0, 300)}` };
    }
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { parsed = txt; }
    return { ok: true, response: parsed };
  } catch (err: any) {
    return { ok: false, error: `Greenhouse request failed: ${err?.message || err}` };
  }
}

function parseGreenhouseUrl(url: string): { board: string; jobId: string } | null {
  try {
    const u = new URL(url);
    // boards.greenhouse.io/<board>/jobs/<id> or job-boards.greenhouse.io/<board>/jobs/<id>
    const parts = u.pathname.split("/").filter(Boolean);
    const jobsIdx = parts.indexOf("jobs");
    if (jobsIdx > 0 && parts[jobsIdx + 1]) {
      return { board: parts[jobsIdx - 1], jobId: parts[jobsIdx + 1] };
    }
    return null;
  } catch {
    return null;
  }
}

