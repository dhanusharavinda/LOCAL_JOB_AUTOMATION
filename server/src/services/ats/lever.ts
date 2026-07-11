import { AtsSubmitInput, AtsSubmitResult, fetchResumePdfBuffer } from "./index";

/**
 * Lever - public posting submission API.
 *
 * URL shape: https://jobs.lever.co/<site>/<posting_id>
 * Endpoint:  POST https://api.lever.co/v0/postings/<site>/<posting_id>?key=public
 *            Multipart form with `resume` file + name/email fields.
 *
 * Lever exposes a public form-submit endpoint that mirrors what the
 * jobs.lever.co posting page POSTs to. No API key required.
 */
export async function submitLever(input: AtsSubmitInput): Promise<AtsSubmitResult> {
  const { job, profile } = input;
  const url = job.apply_url || job.job_link || "";
  const ids = parseLeverUrl(url);
  if (!ids) return { ok: false, error: "Could not parse Lever site/posting from URL" };

  const fullName = String(profile.full_name || "").trim();
  if (!fullName || !profile.email) {
    return { ok: false, error: "Apply profile is missing name or email." };
  }

  // Resume PDF
  let resumeFilename: string | null = null;
  if (job.resume_url) {
    try {
      const u = new URL(job.resume_url);
      resumeFilename = decodeURIComponent(u.pathname.split("/").pop() || "") || null;
    } catch { resumeFilename = null; }
  }
  // Caller (routes/apply.ts) stamps job.user_id from the authenticated
  // session. Refuse to fall back to an unscoped lookup of the row's
  // owner - that would risk posting one user's resume to an ATS under
  // a different user's session.
  if (!job.user_id) {
    return { ok: false, error: "Internal: missing user_id on job context" };
  }
  const resume = resumeFilename ? await fetchResumePdfBuffer(job.user_id, resumeFilename) : null;
  if (!resume) return { ok: false, error: "No tailored resume PDF found for this job." };

  const fd = new FormData();
  fd.append("name", fullName);
  fd.append("email", String(profile.email));
  if (profile.phone) fd.append("phone", String(profile.phone));
  if (profile.linkedin_url) fd.append("urls[LinkedIn]", profile.linkedin_url);
  if (profile.github_url)   fd.append("urls[GitHub]",   profile.github_url);
  if (profile.portfolio_url) fd.append("urls[Portfolio]", profile.portfolio_url);
  if (input.coverLetter && input.coverLetter.trim()) {
    fd.append("comments", input.coverLetter.slice(0, 5000));
  }
  fd.append("resume", new Blob([new Uint8Array(resume.buffer)], { type: "application/pdf" }), resume.filename);

  // Public submission goes through the jobs.lever.co domain (the api.lever.co
  // path requires authenticated employer credentials). Use the form-submit URL.
  const endpoint = `https://jobs.lever.co/${encodeURIComponent(ids.site)}/${encodeURIComponent(ids.postingId)}/apply`;
  try {
    const r = await fetch(endpoint, { method: "POST", body: fd, redirect: "follow" });
    const txt = await r.text();
    if (!r.ok) {
      return { ok: false, error: `Lever responded ${r.status}: ${txt.slice(0, 300)}` };
    }
    return { ok: true, response: txt.slice(0, 500) };
  } catch (err: any) {
    return { ok: false, error: `Lever request failed: ${err?.message || err}` };
  }
}

function parseLeverUrl(url: string): { site: string; postingId: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { site: parts[0], postingId: parts[1] };
    return null;
  } catch { return null; }
}
