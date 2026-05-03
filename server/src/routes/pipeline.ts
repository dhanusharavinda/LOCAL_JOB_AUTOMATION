import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import {
  checkJobsScrapedBudget,
  checkResumesTailoredBudget,
  incrementUsage,
  setLastRunStatus,
  getUsage,
} from "../middleware/gate";

/**
 * Pipeline routes (Postgres + per-user subprocess edition).
 * ─────────────────────────────────────────────────────────
 *
 * Previously the pipeline state lived in module-level `let` variables
 * (pipelineProcess, pipelineRunning, sseClients, pipelineLogs) which
 * meant only one pipeline could run across the entire server at a time,
 * and SSE clients couldn't reconnect across pods. This rewrite moves:
 *
 *   - Run state           → per-user Map keyed on user_id
 *   - Config for the run  → read from user_settings.config_json at spawn
 *                            time and injected into the subprocess env
 *   - SSE log streams     → per-user, attached to the same user_id key
 *
 * This isn't a perfect multi-node solution (the Map is still in-process,
 * so if you run two server instances the runs still don't share state
 * across them), but it DOES let multiple users run pipelines simultaneously
 * on a single server instance, which is the immediate SaaS requirement.
 *
 * A proper multi-node implementation would move the Map to a
 * `pipeline_runs` Postgres table + a Supabase Realtime broadcast for logs
 * — noted in MIGRATION_STATUS.md as future hardening.
 */

const router = Router();

interface PipelineLog {
  time: string;
  type: string;
  message: string;
  step?: string;
}

/**
 * Pattern-match a pipeline log line against the known step transitions
 * the client UI (LandingPage.tsx PIPELINE_STEPS) cares about. Returns the
 * step id if the line marks the start of a new step, or null otherwise.
 *
 * We parse here rather than inside the pipeline itself because the pipeline
 * logger is a plain text emitter; adding structured step events to every
 * `log.step(...)` call would require touching every scraper. Pattern
 * matching keeps the pipeline side untouched and localises the mapping.
 */
// Matches CSI SGR escapes like \x1b[36m, \x1b[0m, \x1b[1;32m, etc. The
// pipeline's logger hardcodes these constants (see pipeline/src/logger.ts)
// and doesn't honour FORCE_COLOR, so we have to strip them here before
// anything leaves the server for the browser.
// eslint-disable-next-line no-control-regex
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR_RE, "");
}

// Scraper / vendor names we never want to expose to the client — even in
// SSE log lines that originate from pipeline subprocess stdout. The
// redaction runs on every broadcast so a devtools Network tab watcher
// can't read off our scraping stack.
const SCRAPER_NAME_RE = new RegExp(
  "\\b(?:LinkedIn|Apify|Indeed(?:\\.[a-z]{2})?|Naukri|RemoteOK|Jobicy|Arbeitnow|Remotive|WeWorkRemotely|WWR|DevTo|Dev\\.to|CareerJet|IrishJobs|Jobs\\.ie|GradIreland|Instahyre|HackerNews|HN Hiring|Glassdoor|Google Docs|Google Drive|Google Sheets)\\b",
  "gi"
);
// Match any http(s) URL. Used to strip URLs from SSE logs entirely
// instead of letting the name regex mangle them into broken hostnames
// (e.g. linkedin.com → source.com produced an unclickable link in the
// log panel that a user could copy and wonder why it 404s).
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
function redactSensitive(s: string): string {
  // 1. Drop URLs first — debug-style search URLs in the log reveal the
  //    scraper anyway (geoId, host, path), and replacing scraper names
  //    inside a URL produces a working-looking but bogus link.
  // 2. THEN apply the user-friendly phrase substitutions.
  // 3. THEN catch any remaining bare scraper names with the wide regex.
  return s
    .replace(URL_RE, "[search url]")
    .replace(/Scraping LinkedIn jobs via Apify/gi, "Scraping primary source")
    .replace(/Scraping free job sources/gi, "Scraping secondary sources")
    .replace(/\bvia Apify\b/gi, "via source")
    .replace(SCRAPER_NAME_RE, "source");
}

function detectStep(line: string): string | null {
  // ANSI escapes should already be gone by the time detectStep runs, but
  // strip defensively so regex matches aren't thrown off by stray codes.
  const clean = stripAnsi(line);
  if (/Scraping LinkedIn jobs via Apify/i.test(clean)) return "scrape-linkedin";
  if (/Scraping free job sources/i.test(clean))        return "scrape-free";
  if (/Checking for duplicates against tracker/i.test(clean)) return "dedup";
  if (/Filtering by location/i.test(clean))            return "location-filter";
  if (/Fetching uploaded resume from tracker/i.test(clean)) return "resume-fetch";
  if (/Phase 1: Scoring/i.test(clean))                 return "scoring";
  if (/Phase 2: Tailoring/i.test(clean))               return "tailoring";
  if (/Pipeline Summary|═══ Pipeline Summary/i.test(clean)) return "summary";
  return null;
}

interface RunState {
  process: ChildProcess | null;
  running: boolean;
  logs: PipelineLog[];
  sseClients: Response[];
}

// In-memory per-user state. Cleared when the run completes or the
// server restarts. For a multi-node deployment this should be Redis
// or a Postgres-backed queue.
const runs = new Map<string, RunState>();

function getRun(userId: string): RunState {
  let state = runs.get(userId);
  if (!state) {
    state = { process: null, running: false, logs: [], sseClients: [] };
    runs.set(userId, state);
  }
  return state;
}

function broadcast(userId: string, log: PipelineLog) {
  const state = getRun(userId);
  // Redact vendor/scraper names in the user-facing payload. The raw log
  // is still available in server stdout for debugging — only what we
  // hand to the browser goes through the filter.
  const safe: PipelineLog = {
    ...log,
    message: typeof log.message === "string" ? redactSensitive(log.message) : log.message,
  };
  state.logs.push(safe);
  // Cap the log buffer so a long-running pipeline doesn't leak memory
  if (state.logs.length > 2000) state.logs.shift();
  for (const client of state.sseClients) {
    try {
      client.write(`data: ${JSON.stringify(safe)}\n\n`);
    } catch {
      // Client disconnected; it'll be cleaned up on the next broadcast
    }
  }
}

// ─── GET /api/pipeline/status ────────────────────────────────────────
router.get("/status", requireAuth, (req: Request, res: Response) => {
  const state = getRun(req.user!.id);
  res.json({
    running: state.running,
    step: null,
    logs: state.logs.slice(-10),
  });
});

// ─── GET /api/pipeline/events ────────────────────────────────────────
// SSE stream of live pipeline logs for the caller.
router.get("/events", requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const state = getRun(userId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // nginx: don't buffer SSE
  });

  // Replay the buffer so a reconnecting client doesn't miss logs
  for (const log of state.logs) {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  }

  if (!state.running) {
    res.write(`data: ${JSON.stringify({ type: "status", message: "idle" })}\n\n`);
  }

  state.sseClients.push(res);

  req.on("close", () => {
    const idx = state.sseClients.indexOf(res);
    if (idx >= 0) state.sseClients.splice(idx, 1);
  });
});

// ─── POST /api/pipeline/start ────────────────────────────────────────
router.post("/start", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const plan = req.user!.plan;
  const candidateId = typeof req.body?.candidate_id === "number" ? req.body.candidate_id : null;

  const state = getRun(userId);
  if (state.running) {
    res.status(409).json({ error: "Pipeline already running for this account" });
    return;
  }
  // CLAIM the slot immediately so a second concurrent /start can't slip past
  // the `state.running` check before this handler's `await` on the budget
  // query resolves. Every early-return path below must release the slot.
  state.running = true;
  let claimed = true;
  const release = () => {
    if (claimed) {
      claimed = false;
      state.running = false;
      state.process = null;
    }
  };

  // Load user config and resolve plan/tier once — we need these both for the
  // budget check AND for clamping. Doing it in one block keeps the two
  // consistent (same tier applied to gate + clamp).
  let configEnv: Record<string, string> = {};
  let userConfig: Record<string, any> = {};
  let enterpriseTier: 1 | 2 | 3 = 3;
  try {
    const settingsRows = await sql<{ config_json: Record<string, any> | null }[]>`
      SELECT config_json FROM user_settings WHERE user_id = ${userId} LIMIT 1
    `;
    userConfig = settingsRows[0]?.config_json ?? {};
    const rawTier = Number(userConfig.ENTERPRISE_TIER);
    enterpriseTier = (rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : 3) as 1 | 2 | 3;
  } catch (err: any) {
    console.error("[pipeline/start] config load failed", err?.message || err);
    release();
    res.status(500).json({ error: "Failed to load user settings" });
    return;
  }

  // Server-side mirror of the client validation: refuse to start a run
  // with zero searchable input. The client already blocks this, but the
  // server enforcement is the source of truth — guards against curl users
  // and stale client builds.
  const trimmedUrl = String(userConfig.LINKEDIN_SEARCH_URL || "").trim();
  const trimmedLinkedInKw = String(userConfig.LINKEDIN_KEYWORDS || "").trim();
  const trimmedSearchKw = String(userConfig.SEARCH_KEYWORDS || "").trim();
  if (!trimmedUrl && !trimmedLinkedInKw && !trimmedSearchKw) {
    release();
    res.status(400).json({
      error:
        "Add keywords OR paste a search URL before starting the pipeline. " +
        "Use Keywords mode to type roles like 'AI Engineer, Data Engineer', or URL mode to paste a LinkedIn search URL.",
    });
    return;
  }

  // Gate: remaining jobs-scraped budget for today. The user can run the
  // pipeline as many times as they want per day, but the total jobs scraped
  // across all runs is capped at their plan's daily limit.
  let budget: { canRun: boolean; remaining: number; limit: number; reason?: string };
  try {
    budget = await checkJobsScrapedBudget(userId, plan, enterpriseTier, candidateId);
    if (!budget.canRun) {
      release();
      res.status(429).json({ error: budget.reason });
      return;
    }
  } catch (err: any) {
    console.error("[pipeline/start] budget check failed", err?.message || err);
    release();
    res.status(500).json({ error: "Failed to check jobs-scraped budget" });
    return;
  }

  // Clamp the per-run scrape count to the REMAINING daily budget, not the
  // plan's full daily ceiling. Example: free plan cap is 5/day, user already
  // scraped 3 today, so the next run gets at most 2 jobs even if they set
  // APIFY_JOB_COUNT=50.
  //
  // Same enforcement for MAX_TAILOR_COUNT: the pipeline reports back the
  // number of resumes it actually tailored (see /report-tailored), so if
  // the user already used all 25 of their Pro-tier tailor slots today,
  // this run is capped at 0 — no sneaking past the cap by running twice.
  try {
    const tailorBudget = await checkResumesTailoredBudget(userId, plan, enterpriseTier, candidateId);

    if (userConfig.APIFY_JOB_COUNT != null) {
      userConfig.APIFY_JOB_COUNT = Math.min(Number(userConfig.APIFY_JOB_COUNT), budget.remaining);
    } else {
      userConfig.APIFY_JOB_COUNT = budget.remaining;
    }
    if (userConfig.MAX_TAILOR_COUNT != null) {
      userConfig.MAX_TAILOR_COUNT = Math.min(Number(userConfig.MAX_TAILOR_COUNT), tailorBudget.remaining);
    } else {
      userConfig.MAX_TAILOR_COUNT = tailorBudget.remaining;
    }
    userConfig.MAX_TAILOR_COUNT = Math.max(0, Number(userConfig.MAX_TAILOR_COUNT));

    // Stringify everything for the subprocess env. Skip null/undefined so
    // they don't serialize to the literal strings "null"/"undefined" — the
    // pipeline's config.ts uses `optional(key, "")` fallbacks that would
    // treat those as present values and break downstream comparisons
    // (e.g. TARGET_COMPANY_ID === "null" can't match any real id).
    for (const [k, v] of Object.entries(userConfig)) {
      if (v == null || v === "") continue;
      configEnv[k] = String(v);
    }
  } catch (err: any) {
    console.error("[pipeline/start] config load failed", err?.message || err);
    release();
    res.status(500).json({ error: "Failed to load user settings" });
    return;
  }

  // Reset state for this run. `state.running` was already claimed at the
  // top of the handler to close the concurrency window; nothing to flip.
  state.logs = [];

  try {
    await setLastRunStatus(userId, "running", candidateId);
    await incrementUsage(userId, "pipeline_runs", 1, candidateId);
  } catch (err: any) {
    console.error("[pipeline/start] usage bookkeeping failed", err?.message || err);
    // Non-fatal; continue the run
  }

  // Spawn node directly with tsx's CLI JS file as the entry. We deliberately
  // avoid two other paths that both break on Windows when the project path
  // contains spaces (e.g. "Project files"):
  //
  //   1. `spawn("npx", ["tsx", ...], { shell: true })`
  //       npx wraps the call in cmd.exe /c, which block-buffers stdout and
  //       also fails to quote the path properly so cmd splits at the space.
  //   2. `spawn(tsxBin, [...], { shell: true })` where tsxBin is .bin/tsx.cmd
  //       Same cmd.exe quoting bug: the .cmd's absolute path gets word-split.
  //
  // process.execPath is the current node.exe and is always a non-space path
  // on Windows (it's what launched the server). Args are handed to the child
  // via a C argv array with no shell parsing, so spaces in tsxCli/pipelineEntry
  // are completely safe. No shell, no cmd.exe, no buffering layer.
  const pipelineCwd = path.join(__dirname, "..", "..", "..", "pipeline");
  const repoRoot = path.join(__dirname, "..", "..", "..");
  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.cjs");
  const pipelineEntry = path.join("src", "index.ts");

  // Spawn the pipeline as a subprocess. Env is an ALLOWLIST, not the full
  // `process.env` — a prompt-injection or exfil bug in the pipeline must
  // not be able to exfiltrate unrelated secrets (Supabase service-role key,
  // Gmail client secret, DB URL, etc.). Only what the pipeline actually
  // needs to run ships through.
  const allowedParentKeys = [
    "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT",
    "OPENAI_API_KEY", "APIFY_API_TOKEN", "APIFY_ACTOR_ID", "GEMINI_API_KEY",
    "PIPELINE_INTERNAL_TOKEN", "JOB_TRACKER_URL",
    "PUPPETEER_EXECUTABLE_PATH", "PUPPETEER_SKIP_DOWNLOAD",
    "NODE_ENV", "TZ",
  ];
  const childEnv: Record<string, string> = {};
  for (const key of allowedParentKeys) {
    const v = process.env[key];
    if (v != null) childEnv[key] = v;
  }
  for (const [k, v] of Object.entries(configEnv)) childEnv[k] = v;
  childEnv.PIPELINE_USER_ID = userId;
  childEnv.FORCE_COLOR = "0";
  // Always point the pipeline at THIS server on localhost. On Railway the
  // server's listen port is whatever $PORT resolves to (Railway randomizes
  // it), not 3001 — so we cannot rely on the pipeline's default fallback
  // or an inherited JOB_TRACKER_URL that was set for local dev. Overriding
  // here makes the spawn work on any host without additional config.
  childEnv.JOB_TRACKER_URL = `http://127.0.0.1:${process.env.PORT || 3001}`;

  const child = spawn(process.execPath, [tsxCli, pipelineEntry], {
    cwd: pipelineCwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  state.process = child;

  const startTime = new Date().toISOString();
  broadcast(userId, { time: startTime, type: "status", message: "started" });
  // Seed the step tracker so the UI highlights "Initializing" immediately
  // even before the first stdout line arrives from the subprocess.
  broadcast(userId, { time: startTime, type: "step", step: "init", message: "Initializing pipeline..." });

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    for (const raw of text.split("\n")) {
      const trimmed = stripAnsi(raw).trim();
      if (!trimmed) continue;
      const now = new Date().toISOString();
      broadcast(userId, { time: now, type: "info", message: trimmed });

      // Also emit a structured step event if this line marks a step
      // transition, so the client's progress tracker advances past "init".
      const stepId = detectStep(trimmed);
      if (stepId) {
        broadcast(userId, { time: now, type: "step", step: stepId, message: trimmed });
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    for (const raw of text.split("\n")) {
      const trimmed = stripAnsi(raw).trim();
      if (!trimmed) continue;
      broadcast(userId, {
        time: new Date().toISOString(),
        type: "error",
        message: trimmed,
      });
    }
  });

  child.on("exit", async (code) => {
    const success = code === 0;
    // On failure, surface the error message FIRST so it shows in the
    // log panel...
    if (!success) {
      broadcast(userId, {
        time: new Date().toISOString(),
        type: "error",
        message: `Pipeline exited with code ${code}`,
      });
    }
    // ...then ALWAYS emit a `complete` event regardless of success so
    // the client's SSE handler resets `running=false`. The previous
    // behaviour broadcast `{type: "error"}` only on failure, which the
    // client treated as just another log line — the Stop button stayed
    // visible and the user couldn't start a fresh run without reloading.
    broadcast(userId, {
      time: new Date().toISOString(),
      type: "complete",
      message: success ? "Pipeline complete" : `Pipeline failed (exit code ${code})`,
    });
    state.running = false;
    state.process = null;
    try {
      await setLastRunStatus(userId, success ? "completed" : "failed", candidateId);
    } catch {}
    // Close SSE clients so the UI knows the run ended
    for (const client of state.sseClients) {
      try { client.end(); } catch {}
    }
    state.sseClients = [];
  });

  child.on("error", (err) => {
    broadcast(userId, {
      time: new Date().toISOString(),
      type: "error",
      message: `Pipeline spawn failed: ${err.message}`,
    });
    // Mirror the same "always emit complete" pattern so the client
    // resets after a spawn failure too. Without this, a botched spawn
    // (missing tsx, bad env, etc.) leaves the UI stuck on "running".
    broadcast(userId, {
      time: new Date().toISOString(),
      type: "complete",
      message: "Pipeline failed to start",
    });
    state.running = false;
    state.process = null;
    setLastRunStatus(userId, "failed", candidateId).catch(() => {});
  });

  res.json({ ok: true, message: "Pipeline started" });
});

// ─── POST /api/pipeline/stop ─────────────────────────────────────────
router.post("/stop", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const state = getRun(userId);
  if (!state.running || !state.process) {
    res.status(400).json({ error: "No pipeline is running" });
    return;
  }
  try {
    state.process.kill("SIGTERM");
  } catch (err: any) {
    console.error("[pipeline/stop] kill failed", err?.message || err);
  }
  state.running = false;
  try {
    await setLastRunStatus(userId, "stopped", null);
  } catch {}
  broadcast(userId, {
    time: new Date().toISOString(),
    type: "status",
    message: "stopped",
  });
  res.json({ ok: true });
});

// ─── GET /api/pipeline/logs ──────────────────────────────────────────
router.get("/logs", requireAuth, (req: Request, res: Response) => {
  const state = getRun(req.user!.id);
  res.json({ running: state.running, logs: state.logs });
});

// ─── POST /api/pipeline/report-scraped ───────────────────────────────
// Called by the pipeline subprocess when a run finishes. The pipeline
// reports the ACTUAL number of jobs it scraped (stats.scraped) and we
// charge that against the user's daily budget. Authenticated via the
// internal M2M token (Authorization: Internal <token>:<userId>) — the
// shared requireAuth middleware handles both Supabase JWTs and internal
// tokens, and since req.user.id is trusted from whichever mechanism
// matched, no separate route is needed.
router.post("/report-scraped", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const count = Number(req.body?.count);
  const candidateId = typeof req.body?.candidate_id === "number" ? req.body.candidate_id : null;

  if (!Number.isFinite(count) || count < 0 || count > 10000) {
    res.status(400).json({ error: "Invalid count" });
    return;
  }

  try {
    if (count > 0) {
      await incrementUsage(userId, "jobs_scraped", Math.floor(count), candidateId);
    }
    const usage = await getUsage(userId, candidateId);
    res.json({ ok: true, jobs_scraped: usage.jobs_scraped });
  } catch (err: any) {
    console.error("[pipeline/report-scraped] failed", err?.message || err);
    res.status(500).json({ error: "Failed to record scraped count" });
  }
});

// ─── POST /api/pipeline/report-tailored ──────────────────────────────
// Called by the pipeline subprocess after the tailoring phase with the
// count of resumes it actually produced. This accrues against the user's
// daily resumes_tailored budget so a second run in the same day can't
// push total tailors past the plan cap (Free=1, Pro=25).
router.post("/report-tailored", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const count = Number(req.body?.count);
  const candidateId = typeof req.body?.candidate_id === "number" ? req.body.candidate_id : null;

  if (!Number.isFinite(count) || count < 0 || count > 1000) {
    res.status(400).json({ error: "Invalid count" });
    return;
  }

  try {
    if (count > 0) {
      await incrementUsage(userId, "resumes_tailored", Math.floor(count), candidateId);
    }
    const usage = await getUsage(userId, candidateId);
    res.json({ ok: true, resumes_tailored: usage.resumes_tailored });
  } catch (err: any) {
    console.error("[pipeline/report-tailored] failed", err?.message || err);
    res.status(500).json({ error: "Failed to record tailored count" });
  }
});

export default router;
