import { AtsSubmitInput, AtsSubmitResult, fetchResumePdfBuffer } from "./index";

/**
 * Workable - public job posting submission.
 *
 * URL shape: https://apply.workable.com/<account_slug>/j/<shortcode>/
 * Endpoint:  POST https://apply.workable.com/api/v3/accounts/<slug>/jobs/<shortcode>/candidates
 *
 * Workable accepts JSON with the resume as a base64 string in the
 * candidate object. No API key required for public job postings.
 */
export async function submitWorkable(input: AtsSubmitInput): Promise<AtsSubmitResult> {
  const { job, profile } = input;
  const url = job.apply_url || job.job_link || "";
  const ids = parseWorkableUrl(url);
  if (!ids) return { ok: false, error: "Could not parse Workable account/shortcode from URL" };

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
  // owner - that would risk posting one user's resume to an ATS under
  // a different user's session.
  if (!job.user_id) {
    return { ok: false, error: "Internal: missing user_id on job context" };
  }
  const resume = resumeFilename ? await fetchResumePdfBuffer(job.user_id, resumeFilename) : null;
  if (!resume) return { ok: false, error: "No tailored resume PDF found for this job." };

  const body = {
    candidate: {
      firstname: firstName,
      lastname: lastName,
      email: String(profile.email),
      headline: job.job_title || "",
      phone: profile.phone || "",
      address: [profile.street, profile.city, profile.state_region, profile.postcode, profile.country].filter(Boolean).join(", "),
      summary: input.coverLetter ? input.coverLetter.slice(0, 5000) : "",
      cover_letter: input.coverLetter ? input.coverLetter.slice(0, 10000) : "",
      social_profiles: [
        profile.linkedin_url && { type: "linkedin", url: profile.linkedin_url, name: "LinkedIn" },
        profile.github_url   && { type: "github",   url: profile.github_url,   name: "GitHub" },
        profile.portfolio_url && { type: "personal_site", url: profile.portfolio_url, name: "Portfolio" },
      ].filter(Boolean),
      resume: {
        name: resume.filename,
        content: resume.buffer.toString("base64"),
      },
    },
  };

  const endpoint = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(ids.slug)}/jobs/${encodeURIComponent(ids.shortcode)}/candidates`;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) {
      return { ok: false, error: `Workable responded ${r.status}: ${txt.slice(0, 300)}` };
    }
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { parsed = txt; }
    return { ok: true, response: parsed };
  } catch (err: any) {
    return { ok: false, error: `Workable request failed: ${err?.message || err}` };
  }
}

function parseWorkableUrl(url: string): { slug: string; shortcode: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // Expected layout: /<slug>/j/<shortcode>
    const jIdx = parts.indexOf("j");
    if (jIdx > 0 && parts[jIdx + 1]) return { slug: parts[jIdx - 1], shortcode: parts[jIdx + 1] };
    // Fallback: /<slug>/<shortcode>
    if (parts.length >= 2) return { slug: parts[0], shortcode: parts[1] };
    return null;
  } catch { return null; }
}
