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
