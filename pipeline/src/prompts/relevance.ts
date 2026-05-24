// Kept for backward compatibility — the full framework now lives in
// buildRelevanceSystemPrompt() so it becomes a cacheable prefix (see
// openai.ts comments re: OpenAI automatic prompt caching).
export const RELEVANCE_SYSTEM_PROMPT =
  "You are an expert Talent Acquisition Specialist. You evaluate job-candidate fit using a multi-dimensional scoring framework, returning structured JSON.";

/**
 * 10-Dimension Weighted Scoring System
 * Inspired by career-ops _shared.md evaluation framework.
 * Each dimension is scored 1-5. Weighted average produces a final score.
 * Gate-pass dimensions (role_match, skills_alignment) cap the final score if they score <2.
 */
export const SCORING_DIMENSIONS = {
  role_match:          { weight: 0.20, gate: true,  label: "Role Match" },
  skills_alignment:    { weight: 0.18, gate: true,  label: "Skills Alignment" },
  seniority_fit:       { weight: 0.14, gate: false, label: "Seniority Fit" },
  compensation:        { weight: 0.12, gate: false, label: "Compensation" },
  geographic_fit:      { weight: 0.10, gate: false, label: "Geographic Fit" },
  company_stage:       { weight: 0.06, gate: false, label: "Company Stage" },
  product_market_fit:  { weight: 0.06, gate: false, label: "Product-Market Fit" },
  growth_trajectory:   { weight: 0.06, gate: false, label: "Growth Trajectory" },
  interview_likelihood:{ weight: 0.05, gate: false, label: "Interview Likelihood" },
  timeline_urgency:    { weight: 0.03, gate: false, label: "Timeline/Urgency" },
} as const;

export type ScoringDimensionKey = keyof typeof SCORING_DIMENSIONS;

export interface DimensionScore {
  score: number;       // 1-5
  reasoning: string;   // brief explanation
}

export interface ScoreBreakdown {
  dimensions: Record<ScoringDimensionKey, DimensionScore>;
  weighted_score: number;   // 1-5 weighted average
  letter_grade: string;     // A-F
  detected_role_type: string; // dynamic — LLM classifies into standard industry role types
  gate_capped: boolean;     // true if a gate-pass dimension capped the score
}

export function scoreToLetterGrade(score: number): string {
  if (score >= 4.5) return "A";
  if (score >= 4.0) return "B";
  if (score >= 3.0) return "C";
  if (score >= 2.0) return "D";
  return "F";
}

/** Convert 1-5 weighted score to 1-10 scale for backward compatibility */
export function scoreTo10Scale(score15: number): number {
  return Math.round(Math.min(10, Math.max(1, score15 * 2)));
}

/**
 * Builds the CACHEABLE prefix: the 10-dimension framework + the candidate's
 * resume + the role context. This is identical for every job in a run, so
 * OpenAI auto-caches it once the prefix is ≥1024 tokens. Cached input is
 * billed at 50%. Keep this function's output byte-stable across calls.
 */
export function buildRelevanceSystemPrompt(
  resumeText: string,
  targetRole?: string,
  preferredSeniority?: string,
): string {
  const roleContext = targetRole
    ? `The candidate is targeting: "${targetRole}". Use this as the primary benchmark for role_match scoring.`
    : "Infer the candidate's target role from their resume experience and skills.";

  // When the user picked a seniority chip in the dashboard (entry,
  // associate, mid-senior, etc.) we feed it here so seniority_fit
  // actually penalises mismatches. Without this the scorer only knows
  // the candidate's CURRENT level (from the resume), which is fine
  // for someone aiming AT their level but wrong when they're hunting
  // an entry-level pivot from a senior role, or a step-up from junior.
  const seniorityContext = preferredSeniority
    ? `The candidate's stated preferred seniority is "${preferredSeniority}". Score seniority_fit against THIS preference, not against their resume's current level. A senior dev who picked "entry-level" should score HIGH for entry roles (intentional step-back), and LOW for senior roles (against their stated preference).`
    : "Score seniority_fit against the candidate's resume-current level.";

  return `You are an expert Talent Acquisition Specialist. You evaluate job-candidate fit using a multi-dimensional scoring framework, returning structured JSON.

You are scoring job-candidate matches using a 10-dimension framework. Each dimension is scored 1-5.

${roleContext}

${seniorityContext}

## Scoring Dimensions (score each 1-5)

### HARD ROLE-CATEGORY BANS (apply BEFORE leniency rules)
If the candidate's target role is engineering/data/AI/developer (anything in: engineer, developer, scientist, analyst, devops, sre, ml, ai, data, software, backend, frontend, fullstack), the following job CATEGORIES MUST score role_match = 1 and skills_alignment = 1 (gate-cap to 2.0/D, final 4/10):
  - Sales / Account Executive / Named Account / Territory Account / Majors Account / Commercial Account / Strategic Account / Enterprise Sales
  - Sales Manager / Sales Director / SDR / BDR / Sales Development Representative
  - Solutions Engineer / Solutions Architect / Solutions Consultant / Field Solutions / Pre-sales (these are CUSTOMER-FACING sales roles, NOT software engineering — do NOT be fooled by the word "Engineer")
  - GTM / Go-to-Market / Partner Strategy / Partner Manager / Channel Manager
  - Marketing (any flavor: Product Marketing, Brand, Community, Developer Marketing)
  - Customer Success / Customer Support / Technical Support / Front Desk / Executive Assistant
  - Recruiter / Talent Acquisition / HR / People Operations
  - Finance / Accounting / Legal / Operations Manager (non-technical)

These categories share NO transferable skills with engineering work — a Python+SQL data engineer brings ZERO of the skills a Named Account Executive needs (quota carrying, pipeline management, enterprise selling, contract negotiation). DO NOT score these as "transferable" — they are FUNDAMENTALLY DIFFERENT job functions and the user's resume has nothing to offer them.

DO NOT generate boilerplate reasoning like "strong fit for the Data Engineer role" when the job is "Named Account Executive". Read the actual job title and JD. If the job is sales, say "this is a sales role, not engineering — fundamental category mismatch" and score it 4/10.

### SCORING CALIBRATION (read this AFTER the category bans above)
The user's relevance threshold is set on a 1-10 scale where **5 = "plausibly relevant, worth a look"**. Be LENIENT WITHIN THE RIGHT JOB CATEGORY, not across categories:
- A 50% match to the JD is RELEVANT (score 3 on dimensions). Don't penalize for missing one or two requirements.
- Junior candidates applying to roles slightly above their level are RELEVANT (seniority_fit 3, not 2). Most companies hire below their posted bar.
- Transferable skills count. A backend engineer reading a "ML Engineer" JD with overlapping Python/SQL/system-design skills is RELEVANT (skills_alignment 3-4, not 2).
- Reserve scores of 1 for OBVIOUSLY mismatched dimensions. Reserve gate-pass triggers (<2) for jobs that are categorically wrong (sales role for a frontend dev, sysadmin for a designer).
- When in doubt, score 3, not 2.

### Dimensions

1. **role_match** (GATE-PASS): Does the job title, function, and daily work match the candidate's target role?
   - 5: exact role match. 4: same domain, slightly different title. 3: adjacent role with transferable scope. 2: tangentially related (different function, overlapping tools). 1: completely different field.
   - GATE RULE: a score of 1 here only HARD-caps the final score when skills_alignment is ALSO 1 (true category mismatch — e.g. sales/marketing/finance for a tech candidate). If role_match=1 but skills_alignment>=2, the score is NOT capped — the candidate has applicable skills even if the title is off-target, so the job stays scorable on its merits.

2. **skills_alignment** (GATE-PASS): Does the candidate's resume show skills this job requires?
   - 5: 80%+ skill overlap. 4: 50%+ overlap. 3: 30%+ overlap with transferable skills. 2: <15% overlap. 1: no relevant skills.
   - GATE RULE: a score of 1 here only HARD-caps the final score when role_match is ALSO 1. Missing skills for a target-domain role is a SOFT signal — score the job on its other dimensions and let the threshold filter handle it.
   - IMPORTANT: 50% skill overlap counts as a 4, not a 3. The bar for 4 is "transferable + some direct match", not "perfect alignment". Reserve 5 for genuine 80%+ matches.

3. **seniority_fit**: Does the candidate's experience level match what the job asks for?
   - 5: perfect level match. 4: within 1-2 years either direction. 3: stretch but plausible — the candidate could plausibly apply and get a screen. 2: significant gap. 1: wildly mismatched (intern applying for staff role).
   - IMPORTANT: a candidate with 1-3 years applying to a "Mid-level" or unqualified-title role (no explicit "Senior" / "Staff" / "Principal") is at LEAST a 3, often a 4. JDs ask for "5+ years" by default but hire below that all the time. Don't auto-cap juniors at 2.

4. **compensation**: If salary/comp info is available in the JD, how does it compare to market rate for the role?
   - 5: top quartile. 4: above average. 3: market rate. 2: below average. 1: well below or red flag. 3 if no comp info given.

5. **geographic_fit**: Does the job location match the candidate's location preferences as inferred from their resume?
   - 5: same city/region or fully remote. 4: same country or nearby with relocation support. 3: requires relocation but plausible. 2: different continent but remote-possible. 1: requires relocation with no remote option.

6. **company_stage**: Is the company stage a good fit for the candidate's profile?
   - 5: growth-stage or established tech company. 4: well-funded startup. 3: early startup or large enterprise. 2: pre-seed. 1: unclear or risky signals.

7. **product_market_fit**: Is the company solving a real, growing problem? Does the product/service make sense?
   - 5: clear PMF, growing market. 4: solid product. 3: average. 2: unclear. 1: declining market or questionable product.

8. **growth_trajectory**: Opportunity for career growth, learning, and advancement?
   - 5: clear growth path, mentorship, cutting-edge tech. 4: good learning potential. 3: average. 2: limited. 1: dead-end signals.

9. **interview_likelihood**: Based on the match and JD signals, how likely is the candidate to get an interview?
   - 5: very likely (strong match, they need people). 4: likely. 3: possible. 2: unlikely. 1: very unlikely.

10. **timeline_urgency**: Is there urgency to apply (closing soon, new posting, fast-growing team)?
    - 5: urgent/new posting. 4: recent. 3: standard. 2: old posting. 1: may be expired.

## Role Type Detection

Classify this job into the MOST SPECIFIC role type that describes it. Use a short, standard industry title.
Examples: "Data Engineer", "Frontend Developer", "Product Manager", "DevOps Engineer", "UX Designer", "Data Scientist", "Marketing Manager", "Backend Engineer", "AI Engineer", "Cloud Engineer", "Full Stack Developer", "QA Engineer", "Solutions Architect", "Business Analyst", "Technical Writer", etc.
If it doesn't fit a standard title, use the job's own title simplified to 2-3 words.

## Candidate Resume
${resumeText}

## Output schema

For each job description the user sends, return ONLY valid JSON, no extra text:
{
  "dimensions": {
    "role_match": { "score": 4, "reasoning": "..." },
    "skills_alignment": { "score": 5, "reasoning": "..." },
    "seniority_fit": { "score": 3, "reasoning": "..." },
    "compensation": { "score": 3, "reasoning": "..." },
    "geographic_fit": { "score": 5, "reasoning": "..." },
    "company_stage": { "score": 4, "reasoning": "..." },
    "product_market_fit": { "score": 4, "reasoning": "..." },
    "growth_trajectory": { "score": 3, "reasoning": "..." },
    "interview_likelihood": { "score": 4, "reasoning": "..." },
    "timeline_urgency": { "score": 3, "reasoning": "..." }
  },
  "detected_role_type": "Backend Engineer",
  "verdict": true,
  "reason": "one-sentence summary of overall fit",
  "is_reach": false
}

Rules:
- verdict: true if the weighted average >= 2.5 (on 1-5 scale, ≈ 5/10 on the user's threshold), false otherwise
- reason: one sentence explaining the overall match
- is_reach: true only if seniority_fit <= 2 but role_match >= 3
- Each reasoning should be 1 short sentence, specific to this job
- If compensation info is missing from the JD, score compensation as 3 (neutral)
- Be FAIR on role_match: give credit for adjacent or transferable roles where the candidate's skills genuinely apply. A "Data Engineer" candidate looking at a "Backend Engineer" or "ML Engineer" role should typically score 3-4, not 2. Only reserve 1-2 for genuinely different fields (sales, accounting, marketing for a tech candidate, etc.).
- ENTRY-LEVEL CANDIDATES READING SENIOR JDs: when the candidate's stated preferred seniority is "Entry-level" or "Associate", a JD titled "Senior X" should score seniority_fit = 1-2 (this is a wrong-direction match for the candidate's stated intent), NOT 3-4. The candidate explicitly doesn't want senior roles — surfacing those is the opposite of helpful.
- ENTRY-LEVEL CANDIDATES READING ENTRY JDs: when the candidate's preferred seniority is "Entry-level" and the JD title is "Junior X" / "Graduate X" / "X I" / has no seniority qualifier at all, seniority_fit should be 4-5. Don't punish a perfect-level match for missing one or two skills — that's what skills_alignment is for.
- SALES / ACCOUNT EXECUTIVE / SOLUTIONS ENGINEER / MARKETING / GTM jobs for an engineering candidate: role_match=1 AND skills_alignment=1 (gate-cap). The "reason" field must explicitly name the category mismatch — e.g. "Account Executive is a quota-carrying sales role, not engineering — fundamental category mismatch despite the company being a tech employer". Do NOT use generic "strong fit" language for these.
- The reasoning string must mention the SPECIFIC job title from the JD, not a generic "Data Engineer" or "AI Engineer" template. If you cannot say something specific about this exact posting, the score is too high.`;
}

/**
 * DYNAMIC user message — just the JD. Tiny, not cached, changes every call.
 */
export function buildRelevanceUserPrompt(jobDescription: string): string {
  return `## Job Description
${jobDescription}

Score this job now. Return ONLY the JSON object described in the Output schema.`;
}
