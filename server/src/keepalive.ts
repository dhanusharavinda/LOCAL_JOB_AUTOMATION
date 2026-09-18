import { sql } from "./db";
import { pruneOldResumePdfs } from "./storage";

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

let beats = 0;

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

  // 3. Roughly once a day (every 4th six-hour beat), clear out tailored
  //    PDFs nobody can download any more. Supabase's free tier only has
  //    1GB of storage and each PDF is ~225KB, so without this a busy
  //    launch fills the bucket in days and uploads start failing.
  if (beats % 4 === 0) {
    try {
      const removed = await pruneOldResumePdfs();
      if (removed > 0) console.log(`[keepalive] pruned ${removed} expired resume PDFs`);
    } catch (err: any) {
      console.warn("[keepalive] PDF prune failed:", err?.message || err);
    }
  }
  beats++;
}

export function startSupabaseKeepalive(): void {
  setTimeout(() => {
    beat().then(() => console.log("[keepalive] Supabase heartbeat started (every 6h)"));
    // .unref() so an idle interval never blocks a clean process exit.
    setInterval(beat, BEAT_INTERVAL_MS).unref();
  }, FIRST_BEAT_DELAY_MS).unref();
}
