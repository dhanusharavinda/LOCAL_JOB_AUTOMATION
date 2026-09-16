import "dotenv/config";
import path from "path";
import crypto from "crypto";
// We no longer inherit config from pipeline/.env. All per-user config
// lives in Supabase Postgres (public.user_settings) and the pipeline
// subprocess gets its environment injected at spawn time by pipeline.ts.
// Shared secrets (API keys) live only in server/.env.

// Generate a one-shot internal token for server↔pipeline M2M auth if the
// operator hasn't set one explicitly. This lives only in memory, so a
// fresh random token is created on every server restart - subprocesses
// spawned after boot pick it up from inherited env. For multi-host
// deploys (k8s replicas etc.) the operator should set this explicitly
// so both replicas agree.
if (!process.env.PIPELINE_INTERNAL_TOKEN) {
  process.env.PIPELINE_INTERNAL_TOKEN = crypto.randomBytes(32).toString("hex");
}

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import jobsRouter from "./routes/jobs";
import skillsRouter from "./routes/skills";
import eventsRouter from "./routes/events";
import settingsRouter from "./routes/settings";
import resumeAnalyzeRouter from "./routes/resume-analyze";
import projectBankRouter from "./routes/project-bank";
import resumeProfilesRouter from "./routes/resume-profiles";
import expiryRouter from "./routes/expiry-check";
import pipelineRouter from "./routes/pipeline";
import authRouter from "./routes/auth";
import candidatesRouter from "./routes/candidates";
import storyBankRouter from "./routes/story-bank";
import targetCompaniesRouter from "./routes/target-companies";
import coverLetterRouter from "./routes/cover-letter";
import freeTailorRouter from "./routes/free-tailor";
import applyRouter from "./routes/apply";
import interviewRouter from "./routes/interview";
import careerCoachRouter from "./routes/career-coach";
import jobMatchesRouter from "./routes/job-matches";
import feedbackRouter from "./routes/feedback";
import { generateLocalPdf } from "./pdf";
import { parsePdfWithLinks, parseDocxWithLinks } from "./parse-links";
import { requireAuth } from "./middleware/auth";
import { ensureDbConnection, sql } from "./db";
import { startSupabaseKeepalive } from "./keepalive";
import { requireLaunchAccess } from "./access";
import invitesRouter, { checkInviteHandler } from "./routes/invites";

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ────────────────────────────────────────────────────────────
// Allow-list is CLIENT_URL (CSV of exact origins) plus any Vercel
// preview that belongs to the same project. Vercel preview URLs look
// like `<project>-git-<branch>-<team-slug>.vercel.app` and rotate on
// every branch push - listing them individually is a maintenance
// nightmare, so we derive the project prefix from the production
// URL and auto-admit preview siblings. Non-browser clients (curl, the
// pipeline subprocess, health checks) send no Origin and are let
// through - auth middleware still gates them.
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Extract the Vercel project prefixes from CLIENT_URL. Matches
// `<prefix>.vercel.app` so `<prefix>-git-<anything>.vercel.app` and
// `<prefix>-<commit-hash>-<team>.vercel.app` previews come along.
const vercelProjectPrefixes = allowedOrigins
  .map((o) => {
    try {
      const u = new URL(o);
      const m = u.host.match(/^([a-z0-9-]+)\.vercel\.app$/i);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  })
  .filter((p): p is string => !!p);

function isAllowedVercelPreview(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (!/\.vercel\.app$/i.test(u.host)) return false;
    return vercelProjectPrefixes.some(
      (prefix) => u.host === `${prefix}.vercel.app` || u.host.startsWith(`${prefix}-`)
    );
  } catch {
    return false;
  }
}

// Chrome extension origins. The browser extension's background service
// worker is the single point that talks to our API (content scripts on
// LinkedIn / Greenhouse / etc. send messages to the worker rather than
// fetching directly), so the only extra origin we need to admit is
// `chrome-extension://<id>`. Set EXTENSION_IDS to a CSV of approved IDs;
// every other chrome-extension origin is rejected.
const extensionIds = (process.env.EXTENSION_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedExtensionOrigin(origin: string): boolean {
  if (!origin.startsWith("chrome-extension://") && !origin.startsWith("moz-extension://")) return false;
  // If no IDs are configured, allow during local dev. In production
  // operators MUST set EXTENSION_IDS to lock down which extension can
  // call the API. The startup warning below makes this loud.
  if (extensionIds.length === 0) return process.env.NODE_ENV !== "production";
  try {
    const id = new URL(origin).host;
    return extensionIds.includes(id);
  } catch {
    return false;
  }
}
if (extensionIds.length === 0 && process.env.NODE_ENV === "production") {
  console.warn("[cors] EXTENSION_IDS is not set - the auto-apply extension will be rejected in production.");
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (isAllowedVercelPreview(origin)) return cb(null, true);
      if (isAllowedExtensionOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// Tight default body limit. Routes that legitimately need bigger payloads
// (PDF uploads, resume JSON) override this locally. Keeping the global
// default small blunts DoS via unbounded JSON bodies.
app.use(express.json({ limit: "1mb" }));

// ── Rate limiting ───────────────────────────────────────────────────
// Three tiers:
//   1. `apiLimiter` - relaxed, applied to most /api/* routes. Protects
//      against naive scraping / accidental runaway clients.
//   2. `authLimiter` - tight, applied only to /api/auth/*. Stops
//      brute-force / credential-stuffing attempts at the Express layer
//      (Supabase itself also rate-limits but defense in depth is cheap).
//   3. `llmLimiter` - tight, applied to routes that call OpenAI / any LLM.
//      Each request can cost real money, so we cap these aggressively to
//      prevent accidental loops or intentional cost abuse.
// Counters are keyed by the IP address extracted from x-forwarded-for
// when trust-proxy is on; when running directly this falls back to the
// socket IP. For multi-pod deploys use a shared store (Redis) here.
const apiLimiter = rateLimit({
  windowMs: 60_000,        // 1 minute
  limit: 120,              // 120 req/min/IP - enough for a busy dashboard
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down and try again in a minute." },
});
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,               // 20 auth attempts/min/IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many auth attempts. Try again in a minute." },
});
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,                 // 10 AI requests/min/IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please wait a minute before trying again." },
});
// Parse endpoints are authenticated but CPU-heavy (pdf-parse / mammoth) and
// attractive targets for OOM attacks - keep the per-IP limit well below
// the general apiLimiter and cap body size locally on each route.
const parseLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many parse requests. Please wait a minute." },
});
const parseBodyLimit = express.json({ limit: "3mb" });
app.set("trust proxy", 1); // required when behind a reverse proxy (Vercel, Fly, Render, nginx)

// NOTE: Resume PDFs used to be served from /resumes/<filename>.pdf off
// the local filesystem. That's gone - all tailored PDFs now live in the
// Supabase Storage `resume-pdfs` bucket, and the pipeline + client both
// use signed URLs that point directly at Supabase. No static file serving
// on this server anymore.

// Auth routes - the /me and /plan endpoints use requireAuth inline, so the
// router itself is mounted BEFORE the global requireAuth. Auth routes get
// the tighter authLimiter since they're the most commonly brute-forced.
app.use("/api/auth", authLimiter, authRouter);

// Feedback capture is PUBLIC (mounted before the global requireAuth) so the
// floating Contact button works for anonymous visitors too. Rate-limited to
// blunt spam.
app.use("/api/feedback", apiLimiter, feedbackRouter);

// Invite-link check is PUBLIC so the invite landing screen can tell a
// visitor "this link was already used" before they create an account.
app.get("/api/invites/check/:token", apiLimiter, checkInviteHandler);

// File-parsing utilities - these used to be public for the landing-page
// FreeTailor demo, but unauthenticated + CPU-heavy + pdf-parse = DoS bait.
// They now require auth, have a dedicated parseLimiter (10/min/IP) and a
// local 3MB body cap (well below the 10MB original).
// Max 2MB decoded payload protects against 1.3× base64 inflation attacks
// where a tiny compressed request balloons into a huge buffer in memory.
const MAX_PARSE_BUFFER_BYTES = 2 * 1024 * 1024;
app.post("/api/parse-pdf", parseLimiter, parseBodyLimit, requireAuth, requireLaunchAccess, async (req, res) => {
  try {
    const { base64 } = req.body || {};
    if (!base64 || typeof base64 !== "string") { res.status(400).json({ error: "Missing base64 PDF data" }); return; }
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0 || buffer.length > MAX_PARSE_BUFFER_BYTES) {
      res.status(413).json({ error: "PDF too large - max 2MB" });
      return;
    }
    // Link-aware parsing: also extracts the PDF's link-annotation targets
    // (the URL behind anchor text like "GitHub") and appends them as an
    // EMBEDDED HYPERLINKS section the tailoring prompt resolves labels from.
    const data = await parsePdfWithLinks(buffer, { maxPages: 5 });
    // `pages` is the PDF's true total page count (independent of maxPages,
    // which only caps text extraction). The client passes it back as
    // targetPages so a 2-page upload yields a 2-page tailored PDF.
    res.json({ text: data.text || "", pages: data.pages });
  } catch {
    res.status(500).json({ error: "Could not parse PDF. Please try a different file." });
  }
});

app.post("/api/parse-docx", parseLimiter, parseBodyLimit, requireAuth, requireLaunchAccess, async (req, res) => {
  try {
    const { base64 } = req.body || {};
    if (!base64 || typeof base64 !== "string") { res.status(400).json({ error: "Missing base64 DOCX data" }); return; }
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0 || buffer.length > MAX_PARSE_BUFFER_BYTES) {
      res.status(413).json({ error: "DOCX too large - max 2MB" });
      return;
    }
    // Quick magic-byte check: real .docx files are zip archives starting
    // with "PK". Legacy .doc binaries start with 0xD0CF11E0. Mammoth
    // silently produces empty / partial output for .doc, which then
    // cascades into the schema-leak bug downstream - fail fast instead.
    if (buffer.length >= 2 && (buffer[0] !== 0x50 || buffer[1] !== 0x4b)) {
      res.status(400).json({
        error: "This isn't a valid .docx (looks like a legacy .doc). Save as PDF or re-export as .docx and try again.",
      });
      return;
    }
    // Link-aware parsing: raw text stays the canonical extraction, but
    // hyperlink targets (href behind anchor text like "GitHub") are
    // harvested too and appended as an EMBEDDED HYPERLINKS section.
    const result = await parseDocxWithLinks(buffer);
    // Length check runs on the RAW text so appended links can never
    // sneak an effectively-empty document past the threshold.
    if (result.rawText.length < 50) {
      res.status(422).json({
        error:
          "Couldn't extract enough text from this DOCX. The document may be image-based or heavily formatted. Try saving as PDF.",
      });
      return;
    }
    res.json({ text: result.text });
  } catch (err: any) {
    console.error("[/api/parse-docx]", err?.message || err);
    res.status(500).json({ error: "Could not parse DOCX. Please try a different file." });
  }
});

// Every other /api/* route gets the normal apiLimiter + requireAuth.
// requireAuth is the multi-tenant enforcement point: removing the
// previous `optionalAuth` + `req.user?.id ?? 1` fallback pattern means
// we never silently attribute a request to a default user when the
// caller is anonymous.
//
// requireLaunchAccess is the server-side half of the invite-only gate
// (it replaces the earlier requireApproved, which it fully covers). The
// client's screens are only render decisions: a user still holds a valid
// JWT and could curl these routes directly, so every rule is enforced
// here. Admins pass through; invited users reach only the Resume Tailor
// endpoints (everything else answers 403 coming_soon); users without
// access can only redeem an invite, which is why this can't be a plain
// "approved or 403" check. /api/auth/me and /api/feedback are mounted
// above and stay reachable for everyone. Rules live in src/access.ts, so
// opening a feature later is a one-line change.
app.use("/api", apiLimiter, requireAuth, requireLaunchAccess);

app.use("/api/invites", invitesRouter);

// Register expiry routes BEFORE jobs router so specific routes match first
app.use("/api/jobs", expiryRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/jobs", llmLimiter, resumeAnalyzeRouter);
app.use("/api/jobs", llmLimiter, coverLetterRouter);
app.use("/api/project-bank", projectBankRouter);
app.use("/api/resume-profiles", resumeProfilesRouter);
app.use("/api/pipeline", pipelineRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/story-bank", storyBankRouter);
app.use("/api/target-companies", targetCompaniesRouter);
app.use("/api/free-tailor", llmLimiter, freeTailorRouter);
// AI Career Coach. The /generate endpoint hits OpenAI, so the whole
// router gets the tight llmLimiter (the GET is cheap and rarely called).
app.use("/api/career-coach", llmLimiter, careerCoachRouter);
// Realtime job matching - a read-only curated view over already-scored
// jobs, so it rides the normal apiLimiter (no LLM call here).
app.use("/api/job-matches", jobMatchesRouter);
// Auto-apply endpoints. The router itself applies llmLimiter to the
// AI-answer endpoint inline; profile/track/job-context don't need it.
app.use("/api/apply", applyRouter);
// Interview practice. The router applies its own rate limiter (30/min)
// since every endpoint hits OpenAI. Body limit bumped to 5mb to fit
// long manual JD/resume paste from users without a tracked job.
app.use("/api/interview", express.json({ limit: "5mb" }), interviewRouter);

// Local PDF generation endpoint (replaces external Render backend)
app.post("/api/pdf/generate", async (req, res) => {
  try {
    // Accept either a raw resumeData object (legacy callers) or the newer
    // { resumeData, targetPages } envelope used to honor the input's page
    // count ("1 page in -> 1 page out, 2 -> 2").
    const body = req.body || {};
    const resumeData = body?.resumeData?.personalInfo ? body.resumeData : body;
    if (!resumeData?.personalInfo) {
      res.status(400).json({ error: "Invalid resume data - missing personalInfo" });
      return;
    }
    const rawTarget = Number(body?.targetPages);
    const targetPages = Number.isFinite(rawTarget) && rawTarget >= 1 ? rawTarget : undefined;
    const pdfBuffer = await generateLocalPdf(resumeData, { targetPages });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=resume.pdf");
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[PDF Generate]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Friendly root response. Hitting the bare API host in a browser used
// to return a confusing "Route not found: GET /" envelope; this keeps
// the same JSON shape but points the user at the dashboard.
app.get("/", (_req, res) => {
  res.json({
    name: "GO CANDID8 API",
    status: "ok",
    docs: "This is the API server. The dashboard runs separately.",
    dashboard_url: process.env.CLIENT_URL?.split(",")[0]?.trim() || "http://localhost:5173",
    health: "/health",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Unauthenticated keep-alive endpoint for external cron services
// (e.g. cron-job.org) to ping periodically, preventing Supabase's
// 7-day inactivity auto-pause by running a lightweight query.
app.get("/keep-alive", async (_req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({ status: "alive", db: "ok" });
  } catch {
    res.status(500).json({ status: "alive", db: "error" });
  }
});

// ── 404 handler ─────────────────────────────────────────────────────
// Every request that didn't match a route above lands here. We return
// JSON (not HTML) because every real caller is the SPA client or the
// pipeline subprocess, both of which expect JSON.
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Global error handler ────────────────────────────────────────────
// Never leaks Postgres messages or stack traces to clients - those can
// expose schema details and exact library versions. Explicit CORS errors
// still surface because they're actionable for the caller. Every other
// unhandled error becomes a generic 500.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.message?.startsWith("CORS:")) {
    res.status(400).json({ error: err.message });
    return;
  }
  // Body-parser surfaces its own errors (PayloadTooLargeError etc.) that
  // are safe and actionable; pass them through with their status code.
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large." });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({
    error: status < 500 ? (err?.message || "Bad request") : "Internal server error",
  });
});

const server = app.listen(PORT, async () => {
  console.log(`GO CANDID8 API running on http://localhost:${PORT}`);
  // Keep the Supabase free-tier project from auto-pausing (7-day
  // inactivity window): ping the DB + API gateway every 6 hours.
  startSupabaseKeepalive();
  // Fire the DB connectivity check in the background so the port binds
  // immediately (useful for health probes) but the operator sees a clear
  // log line if the Postgres connection is misconfigured.
  await ensureDbConnection();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the other process or use a different port:\n  npx kill-port ${PORT}\n  # or set PORT=3002 npm run dev`);
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown. postgres.js closes its pool when the process exits;
// we just need to stop accepting new HTTP connections and give in-flight
// requests a moment to finish.
function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
