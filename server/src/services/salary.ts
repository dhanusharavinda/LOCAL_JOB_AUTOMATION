/**
 * Best-effort salary string parsing.
 * ──────────────────────────────────
 * `jobs.salary` is a free-text column populated by many different scrapers,
 * so the values are messy: "€55k - 65k", "$120,000/yr", "50000-70000 EUR",
 * "Competitive", "DOE", "£45,000 per annum". This module extracts a numeric
 * annual range + currency where possible and returns null when the string
 * carries no usable number. Used by the Career Coach (salary benchmarks) and
 * Realtime Job Matching (salary-fit alignment) so both read salaries the
 * same way.
 */

export interface ParsedSalary {
  min: number; // annual, in the detected currency
  max: number;
  currency: string; // ISO-ish symbol mapped to a code: USD | EUR | GBP | INR | ...
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
};

const CURRENCY_CODES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "NZD", "CHF", "SGD"];

/** Detect currency from a symbol or a 3-letter code anywhere in the string. */
function detectCurrency(raw: string): string {
  for (const sym of Object.keys(CURRENCY_BY_SYMBOL)) {
    if (raw.includes(sym)) return CURRENCY_BY_SYMBOL[sym];
  }
  const upper = raw.toUpperCase();
  for (const code of CURRENCY_CODES) {
    // Word-boundary match so "INR" doesn't fire inside another token.
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }
  return "USD";
}

/**
 * Pull every money-like number out of the string, expanding a trailing
 * "k"/"K" into thousands. Numbers below 1000 with no "k" suffix are treated
 * as "k" too (a JD that says "55-65" almost always means 55k-65k), while a
 * lone hourly-looking number (e.g. "25/hr") is annualized at 2080 hours.
 */
function extractAmounts(raw: string): number[] {
  const out: number[] = [];
  const isHourly = /\b(?:per hour|\/\s*h(?:r|our)?|hourly|an hour)\b/i.test(raw);
  // Match 1,200 / 1200 / 55k / 55.5k optionally with a k suffix.
  const re = /(\d[\d,]*\.?\d*)\s*(k)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const numericPart = m[1].replace(/,/g, "");
    if (!numericPart || numericPart === ".") continue;
    let value = parseFloat(numericPart);
    if (!Number.isFinite(value)) continue;
    const hasK = !!m[2];
    if (hasK) value *= 1000;
    else if (value < 1000 && !isHourly) value *= 1000; // "55" -> 55000
    if (isHourly && value < 1000) value *= 2080; // annualize hourly
    // Drop obviously non-salary numbers (years like 2024, tiny counts).
    if (value < 5000 || value > 5_000_000) continue;
    out.push(Math.round(value));
  }
  return out;
}

export function parseSalary(raw: string | null | undefined): ParsedSalary | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const amounts = extractAmounts(trimmed);
  if (amounts.length === 0) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return { min, max, currency: detectCurrency(trimmed) };
}

export interface SalaryBenchmark {
  currency: string;
  low: number; // p25 of midpoints
  median: number; // p50
  high: number; // p75
  sample_size: number;
}

/** Percentile (0-1) of a pre-sorted ascending array via linear interpolation. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/**
 * Aggregate a list of raw salary strings into a p25/p50/p75 benchmark using
 * each posting's midpoint. Only postings that share the most common currency
 * are counted, so we never average USD and INR into a nonsense number.
 * Returns null when fewer than 3 postings carry a usable salary.
 */
export function summarizeSalaries(rawSalaries: (string | null | undefined)[]): SalaryBenchmark | null {
  const parsed = rawSalaries
    .map(parseSalary)
    .filter((p): p is ParsedSalary => p !== null);
  if (parsed.length < 3) return null;

  // Pick the dominant currency so we don't mix scales.
  const byCurrency = new Map<string, ParsedSalary[]>();
  for (const p of parsed) {
    const list = byCurrency.get(p.currency) || [];
    list.push(p);
    byCurrency.set(p.currency, list);
  }
  let currency = "USD";
  let best: ParsedSalary[] = [];
  for (const [cur, list] of byCurrency) {
    if (list.length > best.length) {
      best = list;
      currency = cur;
    }
  }
  if (best.length < 3) return null;

  const midpoints = best.map((p) => Math.round((p.min + p.max) / 2)).sort((a, b) => a - b);
  return {
    currency,
    low: Math.round(percentile(midpoints, 0.25)),
    median: Math.round(percentile(midpoints, 0.5)),
    high: Math.round(percentile(midpoints, 0.75)),
    sample_size: midpoints.length,
  };
}

/** True when [aMin,aMax] overlaps [bMin,bMax]; tolerant of open-ended ranges. */
export function rangesOverlap(
  aMin: number | null | undefined,
  aMax: number | null | undefined,
  bMin: number | null | undefined,
  bMax: number | null | undefined,
): boolean {
  const lo1 = aMin ?? 0;
  const hi1 = aMax ?? Number.MAX_SAFE_INTEGER;
  const lo2 = bMin ?? 0;
  const hi2 = bMax ?? Number.MAX_SAFE_INTEGER;
  return lo1 <= hi2 && lo2 <= hi1;
}
