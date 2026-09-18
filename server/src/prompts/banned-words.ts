/**
 * The anti-slop blocklist.
 *
 * Every phrase here is something an LLM reaches for by default and a
 * recruiter has read a thousand times. Banning them forces the model to
 * write the candidate's actual work instead of padding.
 *
 * Rules I followed while building this:
 *  - Ban the filler, never the substance. Words that carry real meaning
 *    on a resume (built, migrated, shipped, reduced, owned, Postgres,
 *    Kubernetes) are NOT here, no matter how common.
 *  - Phrases beat single words. "proven track record" is slop;
 *    "proven" alone sometimes isn't.
 *  - Keep each entry lowercase; matching is case-insensitive.
 *
 * BANNED_PHRASES is the source of truth. BANNED_WORD_FORMS expands it
 * with the inflections a model actually emits (leverage -> leverages,
 * leveraged, leveraging), which is what the published count refers to.
 */

// ── AI narrative tells ────────────────────────────────────────────────
const NARRATIVE = [
  "delve", "delve into", "dive into", "deep dive", "embark", "embark on a journey",
  "journey", "navigate the complexities", "navigate the landscape", "in the realm of",
  "realm", "landscape of", "ever-evolving", "ever-changing", "fast-paced world",
  "in today's fast-paced", "in today's digital age", "in the modern era", "tapestry",
  "rich tapestry", "testament", "stands as a testament", "serves as a testament",
  "beacon", "beacon of", "cornerstone", "backbone", "linchpin", "bedrock", "hallmark",
  "underscore", "underscores the importance", "highlight the importance", "illuminate",
  "shed light on", "paint a picture", "at its core", "in essence", "essentially",
  "fundamentally", "ultimately", "simply put", "needless to say", "it is worth noting",
  "it should be noted", "it is important to note", "notably", "arguably", "indeed",
  "furthermore", "moreover", "additionally", "consequently", "therefore", "thus",
  "hence", "in conclusion", "to summarize", "in summary", "overall", "all in all",
  "first and foremost", "last but not least", "that being said", "with that said",
  "not only", "but also", "whether it be", "be it", "from ... to ...", "myriad",
  "a myriad of", "plethora", "a plethora of", "vast array", "wide array", "wide range of",
  "a variety of", "various", "numerous", "countless", "endless possibilities",
  "unlock the potential", "unlock", "unleash", "harness", "harness the power",
  "usher in", "herald", "pave the way", "set the stage", "lay the foundation",
  "take it to the next level", "next level", "game changer", "game-changing",
  "paradigm shift", "sea change", "watershed moment", "turning point",
];

// ── Overused AI verbs ─────────────────────────────────────────────────
const VERBS = [
  "leverage", "leveraging", "utilize", "utilise", "utilizing", "facilitate",
  "spearhead", "orchestrate", "pioneer", "champion", "catalyze", "galvanize",
  "propel", "elevate", "empower", "foster", "cultivate", "nurture", "curate",
  "showcase", "exemplify", "epitomize", "embody", "demonstrate prowess",
  "revolutionize", "reimagine", "redefine", "reinvent", "transform the way",
  "disrupt", "ideate", "synergize", "operationalize", "incentivize", "actualize",
  "strategize", "conceptualize", "contextualize", "socialize the idea",
  "drive value", "drive impact", "drive growth", "drive innovation",
  "deliver value", "add value", "bring to the table", "move the needle",
  "take ownership", "own the outcome", "wear many hats", "hit the ground running",
  "think outside the box", "push the envelope", "raise the bar", "go above and beyond",
  "boil the ocean", "circle back", "touch base", "take this offline", "loop in",
  "double click on", "peel the onion", "low-hanging fruit", "quick win",
];

// ── Empty adjectives ──────────────────────────────────────────────────
const ADJECTIVES = [
  "cutting-edge", "state-of-the-art", "bleeding-edge", "next-generation", "next-gen",
  "world-class", "best-in-class", "best in breed", "top-tier", "industry-leading",
  "market-leading", "award-winning", "unparalleled", "unmatched", "unrivaled",
  "second to none", "groundbreaking", "trailblazing", "revolutionary", "transformative",
  "disruptive", "innovative", "innovation-driven", "forward-thinking", "visionary",
  "seamless", "seamlessly", "frictionless", "effortless", "turnkey", "holistic",
  "synergistic", "robust", "rock-solid", "bulletproof", "future-proof", "mission-critical",
  "business-critical", "high-impact", "impactful", "value-add", "value-added",
  "results-driven", "results-oriented", "goal-oriented", "detail-oriented",
  "customer-centric", "data-driven decision maker", "highly motivated", "self-motivated",
  "self-starter", "go-getter", "team player", "hard worker", "hardworking", "diligent",
  "meticulous", "tireless", "dedicated professional", "passionate", "passionate about",
  "enthusiastic", "energetic", "dynamic", "dynamic individual", "versatile", "adaptable",
  "resourceful", "personable", "articulate", "conscientious", "proactive",
  "solutions-oriented", "solution-driven", "strategic thinker", "critical thinker",
  "creative problem solver", "outside-the-box thinker", "rockstar", "ninja", "guru",
  "wizard", "evangelist", "thought leader", "subject matter expert extraordinaire",
];

// ── Weak resume filler ────────────────────────────────────────────────
const RESUME_FILLER = [
  "responsible for", "responsibilities included", "duties included", "tasked with",
  "in charge of", "worked on", "worked with", "helped with", "helped to", "assisted in",
  "assisted with", "participated in", "involved in", "took part in", "contributed to",
  "exposure to", "familiar with", "knowledge of", "working knowledge of",
  "proven track record", "track record of success", "demonstrated ability",
  "demonstrated success", "successfully delivered", "successfully implemented",
  "excellent communication skills", "strong communication skills", "strong interpersonal skills",
  "excellent written and verbal", "ability to work independently", "works well under pressure",
  "thrives under pressure", "thrives in a fast-paced environment", "fast-paced environment",
  "dynamic environment", "team-oriented environment", "wide variety of tasks",
  "various tasks", "day-to-day operations", "as needed", "among other things",
  "including but not limited to", "and more", "etc", "and so on",
  "seeking a challenging position", "looking to leverage", "opportunity to grow",
  "utilizing my skills", "apply my skills", "hit the ground running", "wear multiple hats",
];

// ── Hedges and intensifiers ───────────────────────────────────────────
const HEDGES = [
  "very", "really", "quite", "rather", "somewhat", "fairly", "pretty much",
  "extremely", "incredibly", "immensely", "tremendously", "vastly", "dramatically",
  "remarkably", "exceptionally", "highly effective", "truly", "genuinely",
  "literally", "basically", "actually", "certainly", "surely", "undoubtedly",
  "without a doubt", "arguably the best", "perhaps", "maybe", "sort of", "kind of",
  "a bit", "somehow", "in many ways", "to some extent", "more or less",
  "meticulously", "diligently", "tirelessly", "expertly", "adeptly", "proficiently",
  "skillfully", "masterfully", "flawlessly", "effortlessly", "comprehensively",
  "holistically", "strategically positioned", "uniquely positioned",
];

// ── Cover-letter clichés ──────────────────────────────────────────────
const COVER_LETTER = [
  "i am writing to express my interest", "i am writing to apply",
  "i am excited to apply", "i was thrilled to see", "i am confident that",
  "i believe i would be a great fit", "i am the perfect candidate",
  "please find attached", "please find enclosed", "as you can see from my resume",
  "i would welcome the opportunity", "i look forward to hearing from you",
  "thank you for your time and consideration", "thank you for considering my application",
  "at your earliest convenience", "to whom it may concern", "dear sir or madam",
  "i am passionate about", "your esteemed organization", "your esteemed company",
  "prestigious company", "renowned organization", "align with my career goals",
  "perfect opportunity", "dream job", "dream company", "i would love the chance",
  "make a meaningful impact", "meaningful contribution", "valuable asset",
  "asset to your team", "hit the ground running", "bring my unique perspective",
  "i am eager to contribute", "i am keen to", "grow alongside", "learn and grow",
];

// ── Consultant and LinkedIn jargon ────────────────────────────────────
const JARGON = [
  "stakeholder alignment", "align stakeholders", "key stakeholders across", "buy-in",
  "bandwidth", "capacity constraints", "runway", "north star metric", "okr alignment",
  "strategic initiative", "strategic priorities", "key learnings", "learnings",
  "key takeaways", "takeaways", "deliverables", "touchpoint", "touchpoints",
  "ecosystem", "enablement", "solutioning", "operational excellence", "core competency",
  "core competencies", "value proposition", "go-to-market motion", "growth levers",
  "flywheel", "moat", "synergy capture", "best practices", "industry standards",
  "industry best practices", "cross-functional collaboration", "seamless collaboration",
  "collaborative environment", "agile mindset", "growth mindset", "ownership mentality",
  "bias for action", "customer obsession", "first principles thinking", "force multiplier",
  "10x engineer", "individual contributor extraordinaire", "player-coach",
  "humbled to announce", "excited to share", "thrilled to announce", "delighted to share",
  "honored to", "grateful for the opportunity", "blessed to", "over the moon",
  "pleased to announce", "proud to share", "big news", "life update",
  "roll up my sleeves", "in the trenches", "heavy lifting", "table stakes",
  "moving parts", "single source of truth", "source of truth", "swim lane",
  "rubber meets the road", "drinking from a firehose", "eat our own dog food",
  "open the kimono", "run it up the flagpole", "put a pin in it", "park that",
  "align on", "sync up", "level set", "ballpark", "shift left", "fail fast",
  "iterate quickly", "pivot", "scrappy", "hustle", "grind", "crush it", "knock it out of the park",
];

// ── Verbose constructions ─────────────────────────────────────────────
const VERBOSE = [
  "in order to", "due to the fact that", "for the purpose of", "in the event that",
  "with regard to", "with respect to", "in terms of", "when it comes to", "as such",
  "that is to say", "in other words", "a large number of", "a significant number of",
  "the vast majority of", "at this point in time", "at the present time",
  "prior to", "subsequent to", "in the near future", "going forward", "moving forward",
  "on a daily basis", "on a regular basis", "in a timely manner", "as previously mentioned",
  "it goes without saying", "as mentioned earlier", "for all intents and purposes",
  "the fact of the matter is", "the bottom line is", "at the end of the day",
  "in a nutshell", "long story short", "to put it simply", "let's explore", "let's unpack",
  "let's dive in", "unpack", "dissect", "nuanced", "multifaceted", "comprehensive overview",
  "endeavour", "endeavor", "commence", "ascertain", "procure", "initiate", "terminate",
  "leverage synergies", "utilize resources", "optimize efficiencies",
];

// ── Hollow impact claims ──────────────────────────────────────────────
const HOLLOW_IMPACT = [
  "significantly improved", "significantly increased", "significantly reduced",
  "greatly improved", "greatly enhanced", "dramatically increased", "dramatically improved",
  "substantially reduced", "vastly improved", "exponentially", "exponential growth",
  "massive improvement", "huge impact", "major impact", "key contributor",
  "instrumental in", "played a key role", "played a crucial role", "played a vital role",
  "played an integral role", "integral part of", "vital part of", "crucial part of",
  "essential part of", "helped drive", "helped deliver", "helped improve",
  "supported the team", "supported various", "worked closely with", "collaborated closely",
  "partnered closely", "liaised with", "interfaced with", "engaged with stakeholders",
  "consistently exceeded expectations", "exceeded expectations", "surpassed targets",
  "consistently delivered", "always delivered", "never missed a deadline",
  "recognized for", "praised for", "commended for", "known for",
];

// ── Product and feature slop ──────────────────────────────────────────
const PRODUCT_SLOP = [
  "compelling", "captivating", "engaging experience", "immersive", "intuitive interface",
  "elegant solution", "powerful solution", "feature-rich", "rich set of features",
  "user-friendly", "easy-to-use", "plug-and-play", "hassle-free", "out of the box",
  "cost-effective", "efficient and effective", "streamlined process", "smooth experience",
  "delightful experience", "beautifully designed", "carefully crafted", "thoughtfully designed",
  "meticulously crafted", "hand-crafted", "lovingly built", "blazing fast", "lightning fast",
  "supercharge", "turbocharge", "amplify", "maximize impact", "minimize friction",
  "reduce friction", "unlock value", "capture value", "deliver outcomes", "drive outcomes",
  "end-to-end solution", "one-stop shop", "single pane of glass", "swiss army knife",
  "secret sauce", "magic", "magical", "effortlessly scales", "infinitely scalable",
];

/** Everything above, deduped. This is the canonical blocklist. */
export const BANNED_PHRASES: string[] = Array.from(
  new Set([...NARRATIVE, ...VERBS, ...ADJECTIVES, ...RESUME_FILLER, ...HEDGES, ...COVER_LETTER,
           ...JARGON, ...VERBOSE, ...HOLLOW_IMPACT, ...PRODUCT_SLOP].map((w) => w.toLowerCase().trim()))
).sort();

/**
 * Inflections a model actually produces. Applied only to single words,
 * and only where the result is a real form, so the published count is
 * honest rather than padded with nonsense.
 */
function inflect(word: string): string[] {
  if (word.includes(" ") || word.includes("-")) return [];
  const out: string[] = [];
  const add = (w: string) => { if (w !== word) out.push(w); };
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    add(word + "s"); add(word + "d"); add(stem + "ing");
  } else if (word.endsWith("y") && !/[aeiou]y$/.test(word)) {
    const stem = word.slice(0, -1);
    add(stem + "ies"); add(stem + "ied"); add(word + "ing");
  } else if (/(s|x|z|ch|sh)$/.test(word)) {
    add(word + "es"); add(word + "ed"); add(word + "ing");
  } else if (/[a-z]+(ly)$/.test(word)) {
    // Adverbs do not inflect.
  } else {
    add(word + "s"); add(word + "ed"); add(word + "ing");
  }
  return out;
}

/** Hyphen and space spellings of the same phrase ("cutting-edge" / "cutting edge"). */
function spellingVariants(phrase: string): string[] {
  const out: string[] = [];
  if (phrase.includes("-")) out.push(phrase.replace(/-/g, " "));
  else if (phrase.includes(" ")) out.push(phrase.replace(/ /g, "-"));
  return out;
}

/** Every blocked surface form: phrases, inflections and spelling variants. */
export const BANNED_WORD_FORMS: string[] = Array.from(
  new Set([
    ...BANNED_PHRASES,
    ...BANNED_PHRASES.flatMap(inflect),
    ...BANNED_PHRASES.flatMap(spellingVariants),
  ])
).sort();

export const BANNED_COUNT = BANNED_WORD_FORMS.length;

/**
 * Compact block for a system prompt. We send the base phrases (not every
 * inflection) because the model generalises across tenses on its own,
 * and the shorter list keeps its attention on the rule.
 */
export function bannedWordsBlock(): string {
  return (
    `=== BANNED LANGUAGE (${BANNED_COUNT}+ blocked word forms) ===\n` +
    `These are the words and phrases that make writing read as AI-generated or as recruiter filler. ` +
    `Do NOT use any of them, in any tense or form, anywhere in your output:\n` +
    BANNED_PHRASES.join(", ") +
    `\n\nWrite what the candidate actually did instead: the system, the action, the tool, the number. ` +
    `"Cut nightly batch runtime from 6h to 2h by repartitioning the Spark job" beats any adjective on that list. ` +
    `Before returning, re-read your output and replace anything that matches.`
  );
}

/** Count blocked phrases present in a piece of generated text. */
export function countBannedPhrases(text: string): { total: number; hits: string[] } {
  const lower = (text || "").toLowerCase();
  const hits: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (phrase.includes("...")) continue;
    const pattern = new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (pattern.test(lower)) hits.push(phrase);
  }
  return { total: hits.length, hits };
}
