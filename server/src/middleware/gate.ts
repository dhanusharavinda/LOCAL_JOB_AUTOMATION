import { Request, Response, NextFunction } from "express";
import { sql } from "../db";

/**
 * Plan limits — DAILY for Free, per-run for Pro, per-candidate-per-day for Enterprise.
 *
 * Free:       5 jobs scraped/day,  1 tailored resume/day
 * Pro:       50 jobs scraped,     25 tailored resumes (per run, once daily pipeline)
 * Enterprise: per-candidate tiers (once per day per candidate):
 *   Tier 1:  20 scraped, 10 tailored
 *   Tier 2:  35 scraped, 20 tailored
 *   Tier 3:  50 scraped, 50 tailored
 */

// ── TEST MODE: set to false for production limits ──
// Production plan differentiation. The SaaS pricing page advertises real
// tiers, so we enforce them. Flip to true ONLY for throwaway debugging
// where you want every plan to collapse to the same generous ceiling.
const TEST_MODE = false;

export const PLAN_LIMITS = TEST_MODE ? {
  free: { jobs_scraped: 10, resumes_tailored: 5, gmail_sync: false, candidates: 0, pipeline: true },
  pro: { jobs_scraped: 10, resumes_tailored: 5, gmail_sync: true, candidates: 0, pipeline: true },
  enterprise: {
    gmail_sync: true, candidates: 9999, pipeline: true,
    tiers: { 1: { jobs_scraped: 10, resumes_tailored: 5 }, 2: { jobs_scraped: 10, resumes_tailored: 5 }, 3: { jobs_scraped: 10, resumes_tailored: 5 } },
  },
} as const : {
  free: { jobs_scraped: 5, resumes_tailored: 1, gmail_sync: false, candidates: 0, pipeline: true },
  pro: { jobs_scraped: 50, resumes_tailored: 25, gmail_sync: true, candidates: 0, pipeline: true },
  enterprise: {
    gmail_sync: true, candidates: 9999, pipeline: true,
    tiers: { 1: { jobs_scraped: 20, resumes_tailored: 10 }, 2: { jobs_scraped: 35, resumes_tailored: 20 }, 3: { jobs_scraped: 50, resumes_tailored: 50 } },
  },
} as const;

export type EnterpriseTier = 1 | 2 | 3;

/** Today's date as YYYY-MM-DD string */
function today(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Fetch today's usage counters for a user (optionally scoped to a
 * specific candidate for enterprise accounts). Returns zero values if
 * no row exists yet for today.
 */
export async function getUsage(userId: string, candidateId?: number | null) {
  const period = today();
  const rows = candidateId
    ? await sql<{ jobs_scraped: number; resumes_tailored: number; pipeline_runs: number }[]>`
        SELECT jobs_scraped, resumes_tailored, pipeline_runs
          FROM usage_tracking
         WHERE user_id = ${userId}
           AND candidate_id = ${candidateId}
           AND period = ${period}
         LIMIT 1
      `
    : await sql<{ jobs_scraped: number; resumes_tailored: number; pipeline_runs: number }[]>`
        SELECT jobs_scraped, resumes_tailored, pipeline_runs
          FROM usage_tracking
         WHERE user_id = ${userId}
           AND candidate_id IS NULL
           AND period = ${period}
         LIMIT 1
      `;
  const row = rows[0];
  return {
    jobs_scraped: row?.jobs_scraped ?? 0,
    resumes_tailored: row?.resumes_tailored ?? 0,
    pipeline_runs: row?.pipeline_runs ?? 0,
  };
}

/**
 * Atomically increment a usage counter. Uses a Postgres UPSERT so we
 * don't need a read-modify-write round trip.
 */
export async function incrementUsage(
  userId: string,
  field: "jobs_scraped" | "resumes_tailored" | "pipeline_runs",
  amount: number,
  candidateId?: number | null
): Promise<void> {
  const period = today();
  // Build the SET clause dynamically since postgres.js doesn't interpolate
  // column identifiers. `field` is a TypeScript-restricted union, so this
  // is safe from SQL injection.
  if (candidateId) {
    if (field === "jobs_scraped") {
      await sql`
        INSERT INTO usage_tracking (user_id, candidate_id, period, jobs_scraped)
        VALUES (${userId}, ${candidateId}, ${period}, ${amount})
        ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
        DO UPDATE SET jobs_scraped = usage_tracking.jobs_scraped + ${amount},
                      updated_at = NOW()
      `;
    } else if (field === "resumes_tailored") {
      await sql`
        INSERT INTO usage_tracking (user_id, candidate_id, period, resumes_tailored)
        VALUES (${userId}, ${candidateId}, ${period}, ${amount})
        ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
        DO UPDATE SET resumes_tailored = usage_tracking.resumes_tailored + ${amount},
                      updated_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO usage_tracking (user_id, candidate_id, period, pipeline_runs)
        VALUES (${userId}, ${candidateId}, ${period}, ${amount})
        ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
        DO UPDATE SET pipeline_runs = usage_tracking.pipeline_runs + ${amount},
                      updated_at = NOW()
      `;
    }
  } else {
    if (field === "jobs_scraped") {
      await sql`
        INSERT INTO usage_tracking (user_id, period, jobs_scraped)
        VALUES (${userId}, ${period}, ${amount})
        ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
        DO UPDATE SET jobs_scraped = usage_tracking.jobs_scraped + ${amount},
                      updated_at = NOW()
      `;
    } else if (field === "resumes_tailored") {
      await sql`
        INSERT INTO usage_tracking (user_id, period, resumes_tailored)
        VALUES (${userId}, ${period}, ${amount})
        ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
        DO UPDATE SET resumes_tailored = usage_tracking.resumes_tailored + ${amount},
                      updated_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO usage_tracking (user_id, period, pipeline_runs)
        VALUES (${userId}, ${period}, ${amount})
        ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
        DO UPDATE SET pipeline_runs = usage_tracking.pipeline_runs + ${amount},
                      updated_at = NOW()
      `;
    }
  }
}

// Enterprise plan is disabled during the public test phase — Stripe + the
// per-candidate tier flow haven't shipped. Legacy enterprise accounts get
// pro-level caps until then so nobody gets a bigger budget than advertised.
export const ENTERPRISE_ENABLED = false;

/**
 * Normalize a raw plan string read from the DB. While ENTERPRISE_ENABLED
 * is off, any legacy 'enterprise' row is presented as 'pro' to downstream
 * code and UI — prevents the "logged in on pro but shown as enterprise"
 * bug when a profile was flipped to enterprise before the tier shipped.
 */
export function coercePlan(plan: string | null | undefined): "free" | "pro" | "enterprise" {
  if (plan === "pro") return "pro";
  if (plan === "enterprise") return ENTERPRISE_ENABLED ? "enterprise" : "pro";
  return "free";
}

export function getLimitsForUser(plan: string, candidateId?: number | null, tier?: EnterpriseTier) {
  if (plan === "enterprise") {
    if (!ENTERPRISE_ENABLED) {
      // Collapse to pro caps, not free — testers on legacy enterprise rows
      // should at least get the pro experience.
      void candidateId; void tier;
      return {
        jobs_scraped: PLAN_LIMITS.pro.jobs_scraped,
        resumes_tailored: PLAN_LIMITS.pro.resumes_tailored,
        gmail_sync: true,
      };
    }
    void candidateId;
    const t: EnterpriseTier = tier && [1, 2, 3].includes(tier) ? tier : 3;
    const tierLimits = PLAN_LIMITS.enterprise.tiers[t];
    return {
      jobs_scraped: tierLimits.jobs_scraped,
      resumes_tailored: tierLimits.resumes_tailored,
      gmail_sync: true,
    };
  }
  if (plan === "pro") {
    return { jobs_scraped: PLAN_LIMITS.pro.jobs_scraped, resumes_tailored: PLAN_LIMITS.pro.resumes_tailored, gmail_sync: true };
  }
  return { jobs_scraped: PLAN_LIMITS.free.jobs_scraped, resumes_tailored: PLAN_LIMITS.free.resumes_tailored, gmail_sync: false };
}

// Plan quotas are enforced by default. Set PIPELINE_LIMIT_DISABLED=true ONLY
// in local dev when iterating on the pipeline — never in production. Default
// is false so a missing env var cannot accidentally open the gate.
const PIPELINE_LIMIT_DISABLED =
  (process.env.PIPELINE_LIMIT_DISABLED ?? "false").toLowerCase() === "true";

/**
 * Check remaining resumes_tailored budget for today, mirroring
 * checkJobsScrapedBudget. Callers use `remaining` to clamp the run's
 * MAX_TAILOR_COUNT so running the pipeline multiple times in a day
 * can't exceed the plan's total daily tailor cap.
 */
export async function checkResumesTailoredBudget(
  userId: string,
  plan: string,
  tier: EnterpriseTier | undefined,
  candidateId?: number | null
): Promise<{ canRun: boolean; remaining: number; limit: number; reason?: string }> {
  const limits = getLimitsForUser(plan, candidateId, tier);
  const dailyCap = limits.resumes_tailored;

  if (PIPELINE_LIMIT_DISABLED) {
    return { canRun: true, remaining: dailyCap, limit: dailyCap };
  }

  const usage = await getUsage(userId, candidateId);
  const used = usage.resumes_tailored;
  const remaining = Math.max(0, dailyCap - used);
  return { canRun: true, remaining, limit: dailyCap };
}

/**
 * Check if the user has any remaining jobs_scraped budget for today.
 *
 * Policy: each plan has a daily jobs_scraped ceiling. Users can run the
 * pipeline as many times as they want in a day until the ceiling is
 * reached. Each run scrapes up to `min(userConfig.APIFY_JOB_COUNT, remaining)`
 * jobs, and the actual scraped count is reported back via /report-scraped.
 *
 * Returns { canRun, remaining, reason? }. Callers use `remaining` to
 * clamp the upcoming run's APIFY_JOB_COUNT.
 */
export async function checkJobsScrapedBudget(
  userId: string,
  plan: string,
  tier: EnterpriseTier | undefined,
  candidateId?: number | null
): Promise<{ canRun: boolean; remaining: number; limit: number; reason?: string }> {
  const limits = getLimitsForUser(plan, candidateId, tier);
  const dailyCap = limits.jobs_scraped;

  // Testing escape hatch — skip the quota check entirely.
  if (PIPELINE_LIMIT_DISABLED) {
    return { canRun: true, remaining: dailyCap, limit: dailyCap };
  }

  const usage = await getUsage(userId, candidateId);
  const used = usage.jobs_scraped;
  const remaining = Math.max(0, dailyCap - used);

  if (remaining <= 0) {
    return {
      canRun: false,
      remaining: 0,
      limit: dailyCap,
      reason: `Daily jobs-scraped limit reached (${used}/${dailyCap}). Your quota resets at midnight UTC.`,
    };
  }

  return { canRun: true, remaining, limit: dailyCap };
}

/**
 * Update the last run status for today's usage row.
 */
export async function setLastRunStatus(
  userId: string,
  status: "running" | "completed" | "stopped" | "failed",
  candidateId?: number | null
): Promise<void> {
  const period = today();
  if (candidateId) {
    await sql`
      INSERT INTO usage_tracking (user_id, candidate_id, period, last_run_status)
      VALUES (${userId}, ${candidateId}, ${period}, ${status})
      ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
      DO UPDATE SET last_run_status = ${status}, updated_at = NOW()
    `;
  } else {
    await sql`
      INSERT INTO usage_tracking (user_id, period, last_run_status)
      VALUES (${userId}, ${period}, ${status})
      ON CONFLICT (user_id, COALESCE(candidate_id, 0), period)
      DO UPDATE SET last_run_status = ${status}, updated_at = NOW()
    `;
  }
}

/**
 * Middleware: require a specific feature to be available on the user's plan.
 */
export function requireFeature(feature: "gmail_sync" | "pipeline") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const plan = req.user?.plan || "free";
    const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];

    if (feature === "gmail_sync" && !(limits as any).gmail_sync) {
      res.status(403).json({ error: "Gmail sync requires a Pro or Enterprise plan", upgrade: true });
      return;
    }

    next();
  };
}
