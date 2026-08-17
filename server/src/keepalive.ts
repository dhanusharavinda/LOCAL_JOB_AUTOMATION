import { sql } from "./db";

/**
 * Supabase keep-alive heartbeat.
 *
 * Supabase pauses free-tier projects after ~7 days without activity,
 * which takes the whole app down (auth DNS stops resolving, the DB
 * pooler rejects the tenant, login shows "Failed to fetch"). This
 * server runs 24/7 on Railway, so a periodic ping is enough to keep
 * the project permanently active.
 *
 * Two pings per beat, because Supabase's inactivity tracking has been
 * observed to key off different signals over time:
 *   1. A trivial Postgres query through the pooler (database activity).
 *   2. A REST call to the project's API gateway (API activity), using
 *      the service-role key if present, else the anon key.
 *
 * Every 6 hours = ~28 beats per pause window. Failures are logged and
 * swallowed; the next beat retries. Nothing here can crash the server.
 */

const BEAT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FIRST_BEAT_DELAY_MS = 60 * 1000;       // 1 min after boot (let DB settle)

async function beat(): Promise<void> {
  // 1. Database activity.
  try {
    await sql`SELECT 1`;
  } catch (err: any) {
    console.warn("[keepalive] DB ping failed:", err?.message || err);
  }

  // 2. API-gateway activity. auth/v1/health is unauthenticated-friendly,
  //    cheap, and still counts as a request to the project.
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (base && key) {
    try {
      const res = await fetch(`${base}/auth/v1/health`, {
        headers: { apikey: key },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) console.warn(`[keepalive] API ping returned HTTP ${res.status}`);
    } catch (err: any) {
      console.warn("[keepalive] API ping failed:", err?.message || err);
    }
  }
}

export function startSupabaseKeepalive(): void {
  setTimeout(() => {
    beat().then(() => console.log("[keepalive] Supabase heartbeat started (every 6h)"));
    // .unref() so an idle interval never blocks a clean process exit.
    setInterval(beat, BEAT_INTERVAL_MS).unref();
  }, FIRST_BEAT_DELAY_MS).unref();
}
