import postgres from "postgres";

/**
 * Supabase Postgres client.
 * ─────────────────────────
 * Replaces the previous better-sqlite3 `jobs.db` file. All app data
 * (profiles, user_settings, jobs, skill_snapshots, etc.) lives in
 * Supabase Postgres now; `jobs.db` and `server/data/` are no longer used.
 *
 * Usage:
 *
 *   import { sql } from "./db";
 *
 *   const rows = await sql<Job[]>`
 *     SELECT id, job_title FROM jobs
 *      WHERE user_id = ${userId}
 *      ORDER BY created_at DESC
 *   `;
 *
 * postgres.js auto-parameterizes interpolated values in the tagged
 * template, so there's no need for `$1`, `$2` placeholders and no SQL
 * injection risk from passing values directly.
 *
 * Connection string comes from SUPABASE_DB_URL in the environment. See
 * server/.env.example for where to find it in the Supabase dashboard.
 *
 * Note on RLS: this client uses the Postgres superuser (the `postgres`
 * role), which bypasses Row Level Security. Tenant isolation is therefore
 * enforced at the application layer — every query MUST include a
 * `WHERE user_id = ${req.user.id}` clause. The schema also defines RLS
 * policies as a second line of defence for any future path that uses a
 * per-request JWT connection (e.g. edge functions).
 */

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error(
    "[db] SUPABASE_DB_URL is not set. The server cannot reach Supabase Postgres.\n" +
    "     Set it in server/.env to your project's connection string.\n" +
    "     Get it from: Supabase dashboard → Project Settings → Database →\n" +
    "     Connection string → 'URI' (use port 5432 / Session mode)."
  );
}

/**
 * A single shared postgres.js client. postgres.js maintains its own
 * connection pool internally (default max 10), so we only need one
 * instance for the whole server process.
 *
 * `prepare: false` is required when using Supabase's transaction pooler
 * (port 6543); on the session connection (port 5432) it's optional but
 * harmless. Leaving it off for max compatibility.
 *
 * `ssl: "require"` is mandatory — Supabase rejects unencrypted
 * connections. postgres.js uses the system root CA store to verify.
 */
export const sql = postgres(connectionString || "", {
  ssl: "require",
  prepare: false,
  connection: {
    application_name: "gocandid8-server",
  },
  // Fail fast during development if the DB is unreachable, rather than
  // hanging for minutes. In production you may want a longer timeout.
  connect_timeout: 10,
});

/**
 * Quick health check used at server boot. Logs a friendly error if the
 * connection string is wrong or the DB is unreachable.
 */
export async function ensureDbConnection(): Promise<boolean> {
  if (!connectionString) return false;
  try {
    await sql`select 1`;
    console.log("[db] Connected to Supabase Postgres");
    return true;
  } catch (err: any) {
    console.error(
      "[db] Failed to connect to Supabase Postgres:",
      err?.message || err
    );
    return false;
  }
}
