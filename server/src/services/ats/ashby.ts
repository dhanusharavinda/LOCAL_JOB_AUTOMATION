import { AtsSubmitInput, AtsSubmitResult, fetchResumePdfBuffer } from "./index";

/**
 * Ashby - public posting API.
 *
 * URL shape: https://jobs.ashbyhq.com/<org_slug>/<job_id>
 * Endpoint:  POST https://api.ashbyhq.com/posting-api/job-posting/submit-application/<job_id>
 *            multipart/form-data with `applicationForm` JSON + resumeFile.
 *
 * Ashby's public submit endpoint requires no API key. The application
 * form schema is per-posting and discoverable via GET on the same path,
 * but the core fields ("First Name", "Last Name", "Email", "Resume") are
 * standard across every Ashby posting.
 */
export async function submitAshby(input: AtsSubmitInput): Promise<AtsSubmitResult> {
  const { job, profile } = input;
  const url = job.apply_url || job.job_link || "";
  const ids = parseAshbyUrl(url);
  if (!ids) return { ok: false, error: "Could not parse Ashby job id from URL" };

  const fullName = String(profile.full_name || "").trim();
  const [firstName, ...lastParts] = fullName.split(/\s+/);
  const lastName = lastParts.join(" ") || firstName;
  if (!firstName || !profile.email) {
    return { ok: false, error: "Apply profile is missing name or email." };
  }

  let resumeFilename: string | null = null;
  if (job.resume_url) {
    try {
      const u = new URL(job.resume_url);
      resumeFilename = decodeURIComponent(u.pathname.split("/").pop() || "") || null;
    } catch { resumeFilename = null; }
  }
  // Caller (routes/apply.ts) stamps job.user_id from the authenticated
  // session. Refuse to fall back to an unscoped lookup of the row's
  // owner — that would risk posting one user's resume to an ATS under
  // a different user's session.
  if (!job.user_id) {
    return { ok: false, error: "Internal: missing user_id on job context" };
  }
  const resume = resumeFilename ? await fetchResumePdfBuffer(job.user_id, resumeFilename) : null;
  if (!resume) return { ok: false, error: "No tailored resume PDF found for this job." };

  const formObj: Record<string, any> = {
    "_systemfield_name": fullName,
    "_systemfield_email": String(profile.email),
  };
  if (profile.phone) formObj["_systemfield_phone"] = String(profile.phone);
  if (profile.linkedin_url) formObj["_systemfield_linkedin_url"] = profile.linkedin_url;
  if (profile.github_url)   formObj["_systemfield_github_url"]   = profile.github_url;
  if (profile.portfolio_url) formObj["_systemfield_portfolio_url"] = profile.portfolio_url;

  const fd = new FormData();
  fd.append("applicationForm", JSON.stringify({ fieldSubmissions: Object.entries(formObj).map(([path, value]) => ({ path, value })) }));
  fd.append(
    "_systemfield_resume",
    new Blob([new Uint8Array(resume.buffer)], { type: "application/pdf" }),
    resume.filename
  );
  if (input.coverLetter && input.coverLetter.trim()) {
    const coverBlob = new Blob([new Uint8Array(Buffer.from(input.coverLetter, "utf8"))], { type: "text/plain" });
    fd.append("_systemfield_cover_letter", coverBlob, "cover_letter.txt");
  }

  const endpoint = `https://api.ashbyhq.com/posting-api/job-posting/submit-application/${encodeURIComponent(ids.jobId)}`;
  try {
    const r = await fetch(endpoint, { method: "POST", body: fd });
    const txt = await r.text();
    if (!r.ok) {
      return { ok: false, error: `Ashby responded ${r.status}: ${txt.slice(0, 300)}` };
    }
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { parsed = txt; }
    return { ok: true, response: parsed };
  } catch (err: any) {
    return { ok: false, error: `Ashby request failed: ${err?.message || err}` };
  }
}

function parseAshbyUrl(url: string): { orgSlug: string; jobId: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { orgSlug: parts[0], jobId: parts[parts.length - 1] };
    return null;
  } catch { return null; }
}
