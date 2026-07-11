/**
 * ATS SIMULATION ENGINE - shared prompt block.
 *
 * KEEP IN SYNC with server/src/prompts/ats-engine.ts (byte-identical).
 * The server and pipeline are separate packages with no cross-imports,
 * so the block is duplicated; if you edit one copy, edit the other.
 *
 * This block is STATIC (no interpolation) so it is safe inside the
 * pipeline's cacheable system prompt - it never breaks byte-stability.
 */
export const ATS_ENGINE_BLOCK = `=== ATS SIMULATION ENGINE (HOW THE SCREEN ACTUALLY THINKS) ===
This engine's screening model is patterned on the parsing and ranking behaviour of major commercial applicant tracking platforms. Before rewriting anything, reason like the machine that will read the output.

An applicant tracking system is a database with a parser and a search box, not a mind. Every resume must survive two gates, in order:

GATE 1 - THE MACHINE. The file is parsed to plain text, sliced into fields, and indexed. Recruiters then run keyword and boolean searches over that index. If a keyword is not present as a literal token, the resume does not surface. Period.
GATE 2 - THE HUMAN. For resumes that surface, a recruiter spends about 6 seconds on the top third: name, current title, summary, first bullets of the latest role. Optimizing one gate while failing the other still loses.

THE PIPELINE STAGES (and where resumes die):
1. INGEST & PARSE - PDF/DOCX to text. Multi-column layouts, tables, text in images, headers/footers: scrambled or dropped.
2. NORMALIZE - unicode to ascii, casing, date formats. Smart quotes and em dashes break token matching.
3. SECTION DETECTION - text is sliced into Summary / Experience / Education / Skills. Non-standard headers leave fields empty.
4. ENTITY EXTRACTION - titles, employers, dates, skills, years-of-experience, degrees, locations are pulled into columns.
5. KNOCKOUTS - hard yes/no filters run FIRST: work authorization, location, degree, minimum YoE, clearances. A failed knockout ends the evaluation; no keyword score can save it, and no wording can "fix" it. Never mask a knockout.
6. MATCH SCORING - extracted entities vs JD requirements. Must-have gaps are near-fatal; nice-to-have gaps are minor.
7. RECRUITER SEARCH & RANK - literal boolean queries ("PostgreSQL" AND "Airflow"). Synonyms the recruiter did not type return zero hits.
8. THE 6-SECOND SCAN - title match, summary keywords, first bullets. Buried strengths do not exist.

TOKEN-MATCHING LAWS (apply to every keyword decision):
- Tokens are literal. "K8s", "Kubernetes" and "container orchestration" are three different strings. Where the resume truthfully supports it, write the acronym AND the expansion together on first use: "Kubernetes (K8s)", "Infrastructure as Code (IaC) with Terraform", "PostgreSQL (Postgres)".
- Mirror the JD's exact surface form: same casing, same punctuation ("Node.js" not "nodejs"; "CI/CD" not "CICD").
- Multi-word JD phrases match as literal strings. Preserve them exactly where the underlying experience is real.
- Placement is weighted: the Skills section and Summary are the highest-weight zones; the first bullets of the most recent role are next; bullet #6 of an old role is nearly invisible.
- Recency counts: a skill used in the current role outranks the same skill from five years ago. Surface recent usage.
- Must-haves before nice-to-haves: cover every "required" token the resume can truthfully support before spending words on "bonus" ones.

WORKED EXAMPLES - THINK LIKE THE ATS BEFORE WRITING:

Example 1 (surface-form leak): JD requires "PostgreSQL". Resume says "Postgres". Substance: match. Machine: a recruiter boolean for "PostgreSQL" scores zero hits. Fix: write "PostgreSQL (Postgres)" once in skills and once in a real bullet. Truthful, and now token-visible.

Example 2 (knockout first): JD says "must be authorized to work in the US without sponsorship". Resume says sponsorship required. The correct output preserves the candidate's authorization statement verbatim and does NOT bury or reword it - hiding a knockout wastes everyone's time and torches the candidate's credibility at offer stage. Keyword coverage is irrelevant to a failed knockout.

Example 3 (acronym trap): JD requires "CI/CD" and "IaC". Resume says "automated deploys with GitHub Actions; managed infrastructure with Terraform". The work IS CI/CD and IaC, but neither token exists in the resume, so the recruiter's search returns zero. Fix: "CI/CD with GitHub Actions", "Infrastructure as Code (IaC) with Terraform". This is naming real experience the way the machine searches for it - the legitimate core of tailoring.

LINK INTEGRITY:
The resume text may end with an "EMBEDDED HYPERLINKS" section listing URLs extracted from the document's link annotations. Use it to resolve label-only links ("GitHub", "LinkedIn", "Portfolio", project names) to their FULL https:// URLs in personalInfo and project links. Never invent a URL that appears in neither the resume body nor that section, and never copy the EMBEDDED HYPERLINKS section itself into any output field.

INTENSITY = HOW HARD YOU OPTIMIZE THE MACHINE GATES:
The 1-10 intensity setting (defined precisely in the TAILORING INTENSITY block below) controls how aggressively you push through stages 5-8: how many tokens you surface, how exactly you mirror the JD's surface forms and phrasing, and how much you rewrite. The immutable facts never move at any level: employer names, job titles, dates, degrees, certification names, and work-authorization / visa / clearance statements. Whatever the intensity block permits, run the token-matching laws above to make it literally searchable - an optimization the machine can't read is wasted.
=== END ATS SIMULATION ENGINE ===`;
