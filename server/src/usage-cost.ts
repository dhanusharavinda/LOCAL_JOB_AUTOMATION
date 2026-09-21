/**
 * What each run actually costs in OpenAI spend.
 *
 * Two layers, because one of them can only ever be approximate:
 *
 *   1. Recorded. Every run writes the prompt/completion token counts the
 *      API itself reported, plus the dollar figure derived from them.
 *      This is exact for that run at the price in force when it ran.
 *   2. Estimated. Runs from before this existed have no token counts, so
 *      they fall back to a measured per-run average. Measured, not
 *      guessed: a real tailor call on a two-role resume at intensity 5
 *      reported 5,516 input and ~1,100 output tokens.
 *
 * The admin panel adds the two together and says which is which, so a
 * number built partly from averages never reads as a precise invoice.
 */
import { sql } from "./db";

/** USD per 1M tokens. Update when OpenAI changes list prices. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
};

/** Fallback when the model is not in the table: assume the cheap one. */
const DEFAULT_PRICING = PRICING["gpt-4o-mini"];

/**
 * Measured averages for rows with no recorded tokens, from a real run
 * against the production prompt.
 */
export const EST_TAILOR_USD = 0.00149;
export const EST_COVER_USD = 0.0004;

export function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[(model || "").trim()] || DEFAULT_PRICING;
  return (promptTokens / 1e6) * p.input + (completionTokens / 1e6) * p.output;
}

/**
 * Attach real token counts to a usage row. Never throws: a failure to
 * record accounting must not fail the user's actual request, which has
 * already succeeded by the time this runs.
 */
export async function recordUsage(
  logId: number | null | undefined,
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  if (!logId || (!promptTokens && !completionTokens)) return;
  const cost = costUsd(model, promptTokens, completionTokens);
  try {
    await sql`
      UPDATE free_tailor_log
         SET prompt_tokens = ${promptTokens},
             completion_tokens = ${completionTokens},
             cost_usd = ${cost.toFixed(6)}
       WHERE id = ${logId}
    `;
  } catch (err: any) {
    // 42703 = column missing, i.e. the schema add has not run yet.
    if (err?.code !== "42703") {
      console.warn("[usage-cost] could not record usage:", err?.message || err);
    }
  }
}
