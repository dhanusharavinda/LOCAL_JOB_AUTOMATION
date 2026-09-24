/**
 * Normalises whatever shape the model returns into the one shape the PDF
 * renderer and the review editor read.
 *
 * The prompt asks for an exact schema and usually gets it, but "usually"
 * is not good enough when the failure mode is a resume that silently
 * arrives with no EXPERIENCE or CERTIFICATIONS section. The variants seen
 * in practice, any of which used to render as nothing:
 *
 *   certifications: ["AWS Certified Data Engineer, Amazon, 2024"]   (strings)
 *   workExperience: [...]                                           (other key)
 *   experience: [{ position, employer, responsibilities: [...] }]   (other fields)
 *   bulletPoints: ["Built ETL pipelines"]                           (strings)
 *
 * Everything here is lossless relabelling. Nothing is invented, and an
 * entry that carries no text at all is dropped rather than rendered as a
 * blank line.
 */

/** First non-empty string among the given keys. */
function pick(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

/** First array among the given keys. */
function pickArray(obj: any, keys: string[]): any[] {
  for (const k of keys) {
    const v = obj?.[k];
    if (Array.isArray(v) && v.length > 0) return v;
  }
  return [];
}

/** A bullet in the { original, improved, accepted } shape the editor edits. */
function normaliseBullet(bp: any): any | null {
  if (typeof bp === "string") {
    const text = bp.trim();
    return text ? { original: text, improved: null, accepted: false } : null;
  }
  if (!bp || typeof bp !== "object") return null;

  // Already the right shape.
  if (typeof bp.original === "string" || typeof bp.improved === "string") {
    const original = typeof bp.original === "string" ? bp.original : "";
    const improved = typeof bp.improved === "string" ? bp.improved : null;
    if (!original.trim() && !(improved || "").trim()) return null;
    return { ...bp, original, improved, accepted: bp.accepted !== false ? bp.accepted !== undefined ? bp.accepted : true : false };
  }

  // { text } / { description } / { point } variants.
  const text = pick(bp, ["text", "description", "point", "bullet", "content", "value"]);
  return text ? { original: text, improved: null, accepted: false } : null;
}

function normaliseBullets(entry: any): any[] {
  const raw = pickArray(entry, [
    "bulletPoints", "bullets", "responsibilities", "achievements",
    "highlights", "points", "details", "descriptions",
  ]);
  // A single description string in place of a bullet list.
  if (raw.length === 0) {
    const single = pick(entry, ["description", "summary", "details"]);
    // Only treat it as a bullet when there is no separate summary field
    // already carrying it, so the text is not printed twice.
    if (single && !entry?.summary) return [{ original: single, improved: null, accepted: false }];
    return [];
  }
  return raw.map(normaliseBullet).filter(Boolean) as any[];
}

function normaliseExperience(list: any[]): any[] {
  return list
    .map((e: any) => {
      if (typeof e === "string") {
        const text = e.trim();
        return text ? { title: text, company: "", date: "", location: null, bulletPoints: [] } : null;
      }
      if (!e || typeof e !== "object") return null;
      return {
        ...e,
        title: pick(e, ["title", "position", "role", "jobTitle", "job_title", "designation"]),
        company: pick(e, ["company", "employer", "organization", "organisation", "companyName", "company_name", "firm"]),
        date: pick(e, ["date", "dates", "duration", "period", "dateRange", "date_range", "timeframe"]),
        location: pick(e, ["location", "city", "place"]) || null,
        bulletPoints: normaliseBullets(e),
      };
    })
    .filter((e: any) => e && (e.title || e.company || e.bulletPoints.length > 0));
}

function normaliseProjects(list: any[]): any[] {
  return list
    .map((p: any) => {
      if (typeof p === "string") {
        const text = p.trim();
        return text ? { title: text, link: null, date: "", location: null, bulletPoints: [] } : null;
      }
      if (!p || typeof p !== "object") return null;
      return {
        ...p,
        title: pick(p, ["title", "name", "project", "projectName", "project_name"]),
        link: pick(p, ["link", "url", "href", "repo", "repository", "github"]) || null,
        date: pick(p, ["date", "dates", "duration", "period"]),
        location: pick(p, ["location"]) || null,
        bulletPoints: normaliseBullets(p),
      };
    })
    .filter((p: any) => p && (p.title || p.bulletPoints.length > 0));
}

function normaliseEducation(list: any[]): any[] {
  return list
    .map((e: any) => {
      if (typeof e === "string") {
        const text = e.trim();
        return text ? { institution: text, degree: "", date: "", gpa: null } : null;
      }
      if (!e || typeof e !== "object") return null;
      return {
        ...e,
        institution: pick(e, ["institution", "school", "university", "college", "name"]),
        degree: pick(e, ["degree", "qualification", "program", "course", "field", "fieldOfStudy", "field_of_study"]),
        date: pick(e, ["date", "dates", "year", "graduationDate", "graduation_date", "duration", "period"]),
        gpa: pick(e, ["gpa", "grade", "cgpa", "score"]) || null,
      };
    })
    .filter((e: any) => e && (e.institution || e.degree));
}

/**
 * Certification strings are the common case worth unpacking:
 * "AWS Certified Data Engineer, Amazon Web Services, 2024" carries an
 * issuer and a year that the resume should keep showing separately.
 */
function splitCertString(text: string): any {
  const parts = text.split(/\s*[,|]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) return { name: parts[0], issuer: null, date: null };

  let date: string | null = null;
  const last = parts[parts.length - 1];
  // A trailing year or month-year is a date, not an issuer.
  if (/^(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}$/.test(last) || /^(?:19|20)\d{2}\s*[-–]\s*(?:(?:19|20)\d{2}|present)$/i.test(last)) {
    date = parts.pop() as string;
  }
  const name = parts.shift() || text;
  const issuer = parts.length > 0 ? parts.join(", ") : null;
  return { name, issuer, date };
}

function normaliseCertifications(list: any[]): any[] {
  return list
    .map((c: any) => {
      if (typeof c === "string") {
        const text = c.trim();
        return text ? splitCertString(text) : null;
      }
      if (!c || typeof c !== "object") return null;
      const name = pick(c, ["name", "title", "certification", "certificate", "credential"]);
      if (!name) return null;
      return {
        ...c,
        name,
        issuer: pick(c, ["issuer", "organization", "organisation", "authority", "provider", "issuingOrganization", "issuing_organization", "vendor"]) || null,
        date: pick(c, ["date", "year", "issued", "issueDate", "issue_date", "dates"]) || null,
      };
    })
    .filter(Boolean);
}

function normaliseAwards(list: any[]): any[] {
  return list
    .map((a: any) => {
      if (typeof a === "string") {
        const text = a.trim();
        return text ? { title: text, issuer: null, date: null } : null;
      }
      if (!a || typeof a !== "object") return null;
      const title = pick(a, ["title", "name", "award", "honor", "honour"]);
      if (!title) return null;
      return {
        ...a,
        title,
        issuer: pick(a, ["issuer", "organization", "organisation", "authority", "provider"]) || null,
        date: pick(a, ["date", "year", "dates"]) || null,
      };
    })
    .filter(Boolean);
}

/**
 * Free-form sections: publications, volunteering, languages, patents,
 * anything the fixed fields cannot hold.
 *
 * Also rescues the case where the model invents its own top-level key
 * ("publications": [...]) instead of using additionalSections. Losing a
 * publication list because the model chose a different key would be the
 * same silent deletion the fixed sections used to suffer.
 */
const KNOWN_KEYS = new Set([
  "personalinfo", "summary", "objective", "skills", "education", "experience",
  "projects", "certifications", "awards", "additionalsections", "resumedata",
]);

function normaliseItems(list: any[]): any[] {
  return list
    .map((it: any) => {
      if (typeof it === "string") {
        const text = it.trim();
        return text ? { name: text, detail: null, date: null } : null;
      }
      if (!it || typeof it !== "object") return null;
      const name = pick(it, ["name", "title", "headline", "label", "text", "value"]);
      const detail = pick(it, ["detail", "description", "venue", "publisher", "journal", "organization", "organisation", "role", "proficiency", "level", "summary"]);
      const date = pick(it, ["date", "year", "dates", "period"]);
      if (!name && !detail) return null;
      return { ...it, name: name || detail, detail: name ? detail || null : null, date: date || null };
    })
    .filter(Boolean);
}

function normaliseAdditionalSections(data: any): any[] {
  const out: any[] = [];

  for (const sec of pickArray(data, ["additionalSections", "additional_sections", "otherSections", "other_sections", "extraSections"])) {
    if (!sec || typeof sec !== "object") continue;
    const title = pick(sec, ["title", "heading", "name", "section"]);
    const items = normaliseItems(pickArray(sec, ["items", "entries", "list", "values", "rows"]));
    if (title && items.length > 0) out.push({ title, items });
  }

  // A model that answered with its own key instead of the schema's.
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN_KEYS.has(key.toLowerCase())) continue;
    if (!Array.isArray(value) || value.length === 0) continue;
    const items = normaliseItems(value);
    if (items.length === 0) continue;
    const title = key
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim()
      .toUpperCase();
    if (out.some((s) => s.title.toUpperCase() === title)) continue;
    out.push({ title, items });
  }

  return out;
}

/**
 * Returns a copy of the resume data with every section in the canonical
 * shape. Safe to call more than once and on already-correct data.
 */
export function normalizeResumeData(input: any): any {
  if (!input || typeof input !== "object") return input;
  const data = { ...input };

  data.experience = normaliseExperience(
    pickArray(data, ["experience", "workExperience", "work_experience", "employment", "employmentHistory", "work"]),
  );
  data.projects = normaliseProjects(pickArray(data, ["projects", "personalProjects", "personal_projects", "sideProjects"]));
  data.education = normaliseEducation(pickArray(data, ["education", "educationHistory", "academics", "qualifications"]));
  data.certifications = normaliseCertifications(
    pickArray(data, ["certifications", "certification", "certificates", "certs", "licenses", "licences", "credentials"]),
  );
  data.awards = normaliseAwards(pickArray(data, ["awards", "honors", "honours", "accomplishments"]));
  // Must run BEFORE the alias cleanup below, which deletes the stray
  // top-level keys this reads from.
  data.additionalSections = normaliseAdditionalSections(data);

  // Drop the aliases so nothing downstream reads a stale duplicate.
  for (const alias of [
    "workExperience", "work_experience", "employment", "employmentHistory", "work",
    "personalProjects", "personal_projects", "sideProjects",
    "educationHistory", "academics", "qualifications",
    "certification", "certificates", "certs", "licenses", "licences", "credentials",
    "honors", "honours", "accomplishments",
    "additional_sections", "otherSections", "other_sections", "extraSections",
  ]) {
    if (alias in data) delete data[alias];
  }

  return data;
}
