import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { getUsage, getLimitsForUser } from "../middleware/gate";
import {
  uploadResumeText,
  uploadResumeOriginal,
  uploadResumeMeta,
  downloadResumeText,
  downloadResumeMeta,
  deleteResumeFiles,
} from "../storage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

/**
 * Settings routes (Postgres edition).
 *
 * Pipeline config is stored per-user in `public.user_settings.config_json`.
 * The old behavior of reading + writing `pipeline/.env` was a cross-tenant
 * leak: it meant the last user to save settings on the server wrote their
 * keywords/filters into a file that the next pipeline run would inherit
 * regardless of whose run it was. That file is now ignored for user
 * config; .env only holds shared secrets (API keys).
 *
 * Resume uploads still go to the server's local filesystem at
 * `server/data/{userId}/resume.txt`. That's pending migration to Supabase
 * Storage (see MIGRATION_STATUS.md) and is an explicit follow-up.
 */

const router = Router();

// ── Pipeline config defaults ──
// Inlined so the server never touches pipeline/.env for user preferences.
// Each user's overrides in user_settings.config_json take precedence.
const DEFAULT_CONFIG = {
  RELEVANCE_SCORE_THRESHOLD: 7,
  TAILORING_INTENSITY: 5,
  APIFY_JOB_COUNT: 20,
  BATCH_DELAY_MS: 2000,
  APIFY_MAX_POLL_MINUTES: 10,
  MAX_TAILOR_COUNT: 20,
  MAX_AGE_DAYS: 14,
  // Keyword fields start empty — they're filled by the role-expander on
  // the landing page once the user types their target role. Hardcoding
  // "data engineer,..." here meant every new user saw a software-job
  // pipeline regardless of what they actually wanted (management
  // consultant, accountant, nurse, etc.).
  SEARCH_KEYWORDS: "",
  LINKEDIN_KEYWORDS: "",
  LINKEDIN_SKILLS: "",
  LINKEDIN_SEARCH_URL: "",
  LINKEDIN_EXPERIENCE: "1,2,3",
  LINKEDIN_TIME_FILTER: "r86400",
  LINKEDIN_WORK_TYPE: "",
  LINKEDIN_JOB_TYPE: "",
  TARGET_ROLE: "",
  SCRAPE_LINKEDIN: true,
  SCRAPE_REMOTEOK: true,
  SCRAPE_JOBICY: true,
  SCRAPE_HN: true,
  SCRAPE_WWR: true,
  SCRAPE_ARBEITNOW: true,
  SCRAPE_REMOTIVE: true,
  SCRAPE_DEVTO: true,
  SCRAPE_JOBSIE: true,
  SCRAPE_IRISHJOBS: true,
  SCRAPE_INDEED_IE: true,
  SCRAPE_GRADIRELAND: true,
  SCRAPE_CAREERJET: true,
  SCRAPE_GLASSDOOR: false,
  SCRAPE_NAUKRI: true,
  SCRAPE_INSTAHYRE: true,
  SCRAPE_INDEED_IN: true,
  TARGET_COUNTRIES: "ireland",
  LOCATION_REGIONS: "ireland",
  // Off by default. When true, bare-remote jobs (no country in the
  // location field) pass the location filter alongside country matches.
  INCLUDE_REMOTE: false,
  // Enterprise-only preference. Values: 1, 2, 3. Non-enterprise plans
  // ignore this. Default to Tier 3 (50 scraped / 50 tailored, the most
  // generous tier) so upgrades don't land users on the lowest caps.
  ENTERPRISE_TIER: 3,
  // Cover letter + why-fit are ON-DEMAND only by default. The pipeline
  // skips both LLM calls during a run; users generate them per-job from
  // the JobDetailModal. Setting these to true here previously meant
  // every new account auto-generated both for every tailored job, which
  // contradicted the on-demand contract and burned OpenAI tokens for
  // assets the user might never read.
  ENABLE_COVER_LETTER: false,
  ENABLE_WHY_FIT: false,
};

const EDITABLE_KEYS = new Set(Object.keys(DEFAULT_CONFIG));

// Resume files live in Supabase Storage (bucket: `resumes`) under the
// path `{userId}/resume.txt`. See server/src/storage.ts for the helper
// functions. No filesystem writes anywhere.

// Multer config — accept PDF, DOCX, TXT
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".txt", ".docx", ".doc"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Use PDF, TXT, or DOCX.`));
  },
});

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text.trim();
}

// ─── GET /api/settings ───────────────────────────────────────────────
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const settingsRows = await sql<{ config_json: Record<string, any> }[]>`
      SELECT config_json FROM user_settings WHERE user_id = ${userId} LIMIT 1
    `;
    const userOverrides = settingsRows[0]?.config_json ?? {};

    const config = { ...DEFAULT_CONFIG, ...userOverrides };

    let resumeStatus: { uploaded: boolean; filename: string | null; charCount: number; preview: string } = {
      uploaded: false,
      filename: null,
      charCount: 0,
      preview: "",
    };

    const text = await downloadResumeText(userId);
    if (text) {
      const filename = (await downloadResumeMeta(userId)) || "uploaded_resume";
      resumeStatus = { uploaded: true, filename, charCount: text.length, preview: text.slice(0, 300) };
    }

    const profiles = await sql<{
      id: number;
      name: string;
      role_type: string;
      is_default: boolean;
      char_count: number;
    }[]>`
      SELECT id, name, role_type, is_default, LENGTH(resume_text) AS char_count
        FROM resume_profiles
       WHERE user_id = ${userId}
       ORDER BY is_default DESC, updated_at DESC
    `;

    const usage = await getUsage(userId);
    // Enterprise tier is stored in config_json so the user's slider choice
    // (1/2/3) feeds back into the reported limits immediately. Falls back
    // to the highest tier so Enterprise never looks more restrictive than
    // the plan's marketing promises.
    const rawTier = Number(userOverrides.ENTERPRISE_TIER);
    const enterpriseTier = (rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : 3) as 1 | 2 | 3;
    const limits = getLimitsForUser(req.user?.plan || "free", null, enterpriseTier);

    res.json({
      resume: resumeStatus,
      profiles,
      usage,
      limits,
      config,
    });
  } catch (err: any) {
    console.error("[GET /api/settings]", err?.message || err);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// ─── PUT /api/settings ───────────────────────────────────────────────
router.put("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const updates = req.body;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  try {
    const existingRows = await sql<{ config_json: Record<string, any> }[]>`
      SELECT config_json FROM user_settings WHERE user_id = ${userId} LIMIT 1
    `;
    const currentConfig: Record<string, any> = existingRows[0]?.config_json ?? {};

    // Size caps per value type. The pipeline subprocess injects these as
    // env strings, and user_settings rows get shipped in JWTs/log lines,
    // so letting them grow unbounded would bloat both.
    const MAX_STRING_BYTES = 16 * 1024;         // 16KB per text field
    const MAX_ARRAY_ITEMS = 200;                // e.g. LINKEDIN_KEYWORDS
    const MAX_JSON_BYTES = 64 * 1024;           // total config JSON
    let changed = 0;
    for (const [key, value] of Object.entries(updates)) {
      if (!EDITABLE_KEYS.has(key)) continue;
      if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
        res.status(400).json({ error: `Value for ${key} is too large (max 16KB)` });
        return;
      }
      if (Array.isArray(value) && value.length > MAX_ARRAY_ITEMS) {
        res.status(400).json({ error: `${key} has too many items (max ${MAX_ARRAY_ITEMS})` });
        return;
      }
      currentConfig[key] = value;
      changed++;
    }
    if (Buffer.byteLength(JSON.stringify(currentConfig), "utf8") > MAX_JSON_BYTES) {
      res.status(400).json({ error: "Settings payload is too large. Trim keywords or skills lists." });
      return;
    }

    await sql`
      INSERT INTO user_settings (user_id, config_json, updated_at)
      VALUES (${userId}, ${sql.json(currentConfig)}, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET config_json = ${sql.json(currentConfig)},
            updated_at = NOW()
    `;

    res.json({ ok: true, changed });
  } catch (err: any) {
    console.error("[PUT /api/settings]", err?.message || err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// ─── POST /api/settings/resume ───────────────────────────────────────
// Uploads a resume file (PDF/TXT) or pasted text directly into Supabase
// Storage. Extracts plain text server-side so downstream consumers
// (pipeline, resume-analyze) can fetch a single canonical version.
router.post("/resume", requireAuth, upload.single("resume"), async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    let text = "";
    let filename = "pasted_text";

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      filename = req.file.originalname;

      if (ext === ".pdf") {
        text = await extractTextFromPdf(req.file.buffer);
        await uploadResumeOriginal(userId, req.file.buffer, ext, "application/pdf");
      } else if (ext === ".txt") {
        text = req.file.buffer.toString("utf-8").trim();
        await uploadResumeOriginal(userId, req.file.buffer, ext, "text/plain");
      } else if (ext === ".docx" || ext === ".doc") {
        res.status(400).json({ error: "DOCX support coming soon. Please upload a PDF or TXT file, or paste your resume text." });
        return;
      }
    } else if (req.body.text) {
      text = String(req.body.text).trim();
      filename = "pasted_text";
    } else {
      res.status(400).json({ error: "No file or text provided" });
      return;
    }

    if (text.length < 50) {
      res.status(400).json({ error: `Resume too short (${text.length} chars). Please upload a proper resume.` });
      return;
    }

    await uploadResumeText(userId, text);
    await uploadResumeMeta(userId, filename);

    res.json({ ok: true, filename, charCount: text.length, preview: text.slice(0, 300) });
  } catch (err: any) {
    console.error("[POST /api/settings/resume]", err?.message || err);
    res.status(500).json({ error: `Failed to process resume: ${err?.message || err}` });
  }
});

// ─── DELETE /api/settings/resume ─────────────────────────────────────
router.delete("/resume", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    await deleteResumeFiles(userId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[DELETE /api/settings/resume]", err?.message || err);
    res.status(500).json({ error: `Failed to delete resume: ${err?.message || err}` });
  }
});

// ─── GET /api/settings/resume/text ───────────────────────────────────
// Returns the full extracted resume text. Called by the pipeline
// subprocess via the internal auth header, and by resume-analyze.
router.get("/resume/text", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const text = await downloadResumeText(userId);
    if (!text) {
      res.status(404).json({ error: "No uploaded resume found" });
      return;
    }
    res.json({ text, charCount: text.length });
  } catch (err: any) {
    console.error("[GET /api/settings/resume/text]", err?.message || err);
    res.status(500).json({ error: "Failed to load resume" });
  }
});

export default router;
