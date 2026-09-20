/**
 * Cap free-text to a maximum number of whitespace-delimited words.
 * ───────────────────────────────────────────────────────────────
 * Used to bound job-description input before it's sent to the resume
 * tailoring model so prompts (and token cost) stay predictable. Returns the
 * original text (trimmed) when it's already within the limit; otherwise
 * keeps the first `maxWords` words joined by single spaces.
 */
export function capWords(text: string | null | undefined, maxWords: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(" ");
}

/** Max words of a job description fed into the resume tailoring prompts. */
export const JD_WORD_CAP = 1000;

/**
 * Max words of free-form steering ("custom instructions") a user may add
 * to a tailor run. Steering points the model at keywords it should lean
 * on, which takes a sentence or two; anything longer is either a pasted
 * second job description or an attempt to rewrite the system prompt, and
 * both are paid for by us.
 */
export const INSTRUCTIONS_WORD_CAP = 80;

/** Hard character stop behind the word cap, for pathological input. */
export const INSTRUCTIONS_CHAR_CAP = 600;

/** Count whitespace-delimited words. */
export function countWords(text: string | null | undefined): number {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Make user-supplied text safe to interpolate into a prompt.
 *
 * The steering block embeds this inside quotes, so a quote character or
 * a `===` section marker lets the text escape its block and address the
 * model as if it were the system prompt. Stripping the delimiters is
 * what actually prevents that; asking the model to ignore such attempts
 * (which the prompt also does) is a second line, not the first.
 *
 * Also collapses control characters and whitespace so a wall of newlines
 * cannot pad the prompt, and drops the common override preambles.
 */
export function sanitizeForPrompt(text: string | null | undefined): string {
  return (text || "")
    .replace(/\p{Cc}+/gu, " ")
    // Prompt-structure delimiters: quotes, backticks, section rules, and
    // the chat role markers a model might honour.
    .replace(/["'`“”‘’]/g, "")
    .replace(/={2,}|-{3,}|#{2,}|\*{2,}/g, " ")
    // Not anchored to line start: stripping the delimiters above joins
    // lines, which would otherwise carry a role marker into mid-string
    // where an anchored pattern no longer sees it.
    .replace(/\b(system|assistant|user|developer)\s*:/gi, " ")
    // Explicit override attempts, in the phrasings that actually show up.
    .replace(/\b(ignore|disregard|forget|override|bypass)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|preceding|system|these|your)\s+(instructions?|rules?|prompts?|constraints?|guidelines?)/gi, " ")
    .replace(/\byou\s+are\s+now\b|\bnew\s+instructions?\s*:/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
