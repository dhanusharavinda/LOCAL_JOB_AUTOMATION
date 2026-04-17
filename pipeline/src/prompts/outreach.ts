export function buildCoverLetterPrompt(
  companyName: string,
  jobTitle: string,
  candidateSkills: string,
  jobDescription: string,
  candidateName?: string
): string {
  const signOff = candidateName ? candidateName.split(/\s+/)[0] : "the candidate's first name";
  const jdTruncated = jobDescription.length > 2000 ? jobDescription.slice(0, 2000) + "..." : jobDescription;

  return `Write a cover letter and a "why I'm a fit" section for a job application. Output valid JSON only. No backticks, no markdown.

Return this exact JSON structure:
{
  "coverLetter": "the cover letter text here",
  "whyImAFit": "the why I'm a fit summary here"
}

=== ANTI-AI-SLOP RULES (CRITICAL) ===
BANNED WORDS AND PHRASES — do NOT use any of these:
- "I am writing to express my interest", "I am confident", "Thank you for your time and consideration"
- "highly motivated", "results-driven", "passionate about", "leveraged", "transformative", "groundbreaking"
- "delve", "foster", "enhance", "underscore", "showcase", "pivotal", "crucial", "vital", "vibrant"
- "tapestry", "landscape" (abstract), "testament", "enduring", "garnered", "interplay", "intricate"
- "Additionally", "Furthermore", "It's not just about X, it's about Y"
- "nestled", "in the heart of", "stands as", "serves as", "marks a shift"
- "commitment to excellence", "cutting-edge", "innovative solutions", "dynamic environment"
- "I believe I would be a valuable addition", "I am eager to contribute"
- ZERO em dashes (—). Use commas, periods, or parentheses. The em dash is the loudest tell of AI writing — never include one.
- Any rule-of-three patterns ("X, Y, and Z" appearing more than once)

STYLE REQUIREMENTS:
- Vary sentence length. Short punchy ones. Then longer ones that breathe.
- Use "I" naturally. First person is honest, not unprofessional.
- Be specific. "Built a Spark pipeline processing 2M records" beats "experienced in big data"
- Sound like a real person who read this specific JD, not someone running a template
- No sycophancy. Don't tell them how amazing they are. Just show you understand what they do.
- Keep it tight. Every sentence earns its place or gets cut.
- No curly quotes. Use straight quotes only.
- No bolding. Plain text.

=== TRUTHFULNESS RULES (CRITICAL — read twice) ===
You only know the candidate through the CANDIDATE SKILLS list below. You do NOT know the candidate's full work history. Therefore:
- NEVER say "I haven't used X" or "I haven't worked with X" or "while I'm new to X" or any negative-knowledge claim.
  You don't know what they haven't done. Inventing a gap to look modest is a hallucination — it gets the candidate filtered out for being underqualified on something they may actually know.
- NEVER speculate about gaps. If a JD requirement isn't covered by the skills list, just don't mention that requirement. Pick a different requirement to address.
- NEVER name a specific tool, framework, or technology that does not appear in CANDIDATE SKILLS as something the candidate hasn't used. The skills list is your only source of truth for what they know.
- Only make positive claims grounded in the skills list. If the JD asks for "Spark" and the skills list says "Spark", make the match. If the JD asks for "LangGraph" and the skills list doesn't say LangGraph, talk about a DIFFERENT JD requirement that DOES match.
- If you can't find at least 3 honest matches between CANDIDATE SKILLS and the JD, write fewer points rather than fabricating gaps or stretches.

=== COVER LETTER RULES ===
- 3 short paragraphs, under 150 words total. Tight, not chatty.
- Start with "Dear Hiring Team," (or "Hi [Team]," for startups)
- First paragraph (1-2 sentences): mention the ${jobTitle} role and reference something concrete from the JD (a specific tech, product, or problem they're solving). Not generic praise.
- Second paragraph (2-3 sentences): connect YOUR skills (from CANDIDATE SKILLS only) to THEIR needs. Use real examples like "I built X that did Y", not "I have experience with X". Stay grounded in the skills list — never name a tool you can't see in the list as something you've used.
- Third paragraph (1-2 sentences): one specific thing about this role that interests you, tied to the JD. Then sign off.
- Sign off: "Best regards,\\n${signOff}"
- Double space between paragraphs (use \\n\\n)

=== WHY I'M A FIT RULES ===
This section is read by the hiring team. They already know what their company does. Write as if speaking directly to them.

- 3-4 points (cap at 4), each ONE sentence. Two sentences max if the example needs a metric.
- Do NOT start any point with a dash (-), bullet, or number. Just write the sentences.
- Separate each point with \\n\\n (double newline)
- Do NOT refer to the company in third person ("They need X"). Write TO them. Say "You need X" or address the requirement directly.
- Format per point: name the JD requirement, then the concrete match from the candidate's skills/experience.
- Pick the 3-4 STRONGEST positive matches. Do not list every JD requirement.
- Example of a good point: "Apache Spark for large-scale ETL is a core requirement. I built a Spark pipeline processing 2M+ records daily at my last role, handling schema evolution and late-arriving data."
- NO generic points like "Strong communication skills" or "Team player"
- NO negative claims (see TRUTHFULNESS RULES above) — this is the most common failure mode and it's an instant filter-out for the candidate.
- Use plain text only

=== JOB DESCRIPTION ===
${jdTruncated}

=== CANDIDATE SKILLS (your only source of truth for what the candidate has used) ===
${candidateSkills}

Generate the JSON now. No extra text outside the JSON.`;
}
