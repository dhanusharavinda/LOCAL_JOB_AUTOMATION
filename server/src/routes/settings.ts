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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth");

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
  // Defaults widened: empty experience filter (no level restriction)
  // and 1-week time window. Old defaults ("1,2,3" + "r86400") silently
  // excluded mid-senior listings and limited to last 24h, which produced
  // 0-3 jobs per run in slow markets. Users can still narrow these via
  // the dashboard.
  LINKEDIN_EXPERIENCE: "",
  LINKEDIN_TIME_FILTER: "r604800",
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
        // Mammoth handles .docx fine; .doc (legacy binary format, pre-2007)
        // is unsupported by mammoth — we still try, and if it fails we
        // return a clear error rather than the previous "coming soon" lie.
        try {
          const result = await mammoth.extractRawText({ buffer: req.file.buffer });
          text = String(result?.value || "").trim();
          await uploadResumeOriginal(
            userId,
            req.file.buffer,
            ext,
            ext === ".docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "application/msword",
          );
        } catch (err: any) {
          console.error("[settings/resume] DOCX parse failed:", err?.message || err);
          res.status(400).json({
            error: ext === ".doc"
              ? "Legacy .doc files aren't supported. Save your resume as .docx or PDF and try again."
              : "Couldn't read this DOCX. Re-export it from Word or save as PDF and try again.",
          });
          return;
        }
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

// ─── POST /api/settings/parse-search ────────────────────────────────
// Natural-language search parser. Takes a free-form sentence like
//   "AI engineer or data engineer in Dublin, entry level, remote-friendly"
// and returns a structured config the client can apply to the pipeline
// settings panel. Pure parser — does NOT mutate user_settings; the
// client decides which fields to persist.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpenAILib = require("openai") as { default: any };
  const SUPPORTED_COUNTRIES = ["ireland", "uk", "netherlands", "india", "newzealand"];
  const TIME_FILTERS = ["r86400", "r604800", "r2592000"];

  router.post("/parse-search", requireAuth, async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (text.length < 5 || text.length > 500) {
      res.status(400).json({ error: "Describe your search in 5-500 characters." });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "AI parser is not configured on the server." });
      return;
    }
    try {
      const openai = new OpenAILib.default({ apiKey, maxRetries: 2 });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You convert a casual job-search description into a structured search config for a LinkedIn-style job board. " +
              "Return ONLY a JSON object — no prose, no markdown, no code fences. Schema:\n" +
              "{\n" +
              `  "keywords": [array of 1-6 generic ROLE-TITLE strings only],\n` +
              `  "country": "ireland" | "uk" | "netherlands" | "india" | "newzealand" | null,\n` +
              `  "experience_levels": [subset of ["1","2","3","4","5","6"] where 1=Intern, 2=Entry, 3=Associate, 4=Mid-Senior, 5=Director, 6=Executive] (empty array if not specified),\n` +
              `  "work_type": "1" | "2" | "3" | null  (1=on-site, 2=remote, 3=hybrid; null if not specified),\n` +
              `  "time_filter": "r86400" | "r604800" | "r2592000" | null  (24h | 1week | 1month; null if not specified)\n` +
              "}\n\n" +
              "CRITICAL — keywords MUST be generic role titles, never company names:\n" +
              "- ALLOWED in keywords: 'Software Engineer', 'AI Engineer', 'Data Scientist', 'Frontend Developer', 'Product Manager', 'Backend Engineer', 'DevOps Engineer', 'ML Engineer', 'Solutions Architect', etc.\n" +
              "- FORBIDDEN in keywords: any company name (Agoda, Google, Amazon, Stripe, Shopify, Booking.com, Microsoft, Apple, etc.) and any product/brand name. The keyword field on LinkedIn matches BOTH job title AND company name, so 'Agoda' as a keyword silently restricts the entire search to Agoda jobs only.\n" +
              "- If the user mentions a company they want to work at, IGNORE it for the keywords field. Only the role title matters for the search. (Future feature: company-specific filtering, not now.)\n" +
              "- If the user types only a company name with no role ('I want jobs at Stripe'), return keywords=[] — the parser couldn't extract a role to search for.\n\n" +
              "Other rules:\n" +
              "- Map any city/region to country code (Dublin → ireland, London → uk, Amsterdam → netherlands, Bangalore → india, Auckland → newzealand). Unsupported country → null.\n" +
              "- Split role titles on conjunctions ('or', 'and', 'also'), commas. Drop filler words.\n" +
              "- 'graduate' / 'junior' / 'fresher' / 'entry' → ['2']; 'mid' → ['4']; 'senior' / 'staff' → ['4']; 'lead' / 'principal' → ['4','5']; 'director' → ['5'].\n" +
              "- 'remote' / 'remote-friendly' / 'wfh' → work_type '2'; 'hybrid' → '3'; 'on-site' / 'in office' → '1'.\n" +
              "- 'this week' → r604800; 'today' / 'last 24h' → r86400; 'this month' → r2592000.\n" +
              "- If a field isn't mentioned, leave it null/empty. Do NOT invent defaults.\n\n" +
              "Examples:\n" +
              "Input: 'AI engineer or data engineer entry level in Dublin'\n" +
              "Output: {\"keywords\":[\"AI Engineer\",\"Data Engineer\"],\"country\":\"ireland\",\"experience_levels\":[\"2\"],\"work_type\":null,\"time_filter\":null}\n\n" +
              "Input: 'remote backend roles at Stripe or Shopify'\n" +
              "Output: {\"keywords\":[\"Backend Engineer\"],\"country\":null,\"experience_levels\":[],\"work_type\":\"2\",\"time_filter\":null}\n" +
              "(Stripe and Shopify dropped — they're company names, not role titles.)",
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });
      const raw = completion.choices[0]?.message?.content || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.status(500).json({ error: "AI returned invalid JSON. Try rephrasing your description." });
        return;
      }
      // Defensive list of common company/brand names. The prompt tells
      // the AI not to put these in keywords, but models occasionally
      // slip — so we strip them server-side as a second line of defence.
      // This is non-exhaustive on purpose: covers the obvious cases
      // (FAANG + popular tech employers) and the brand the user just
      // got bitten by. Better-quality role titles compose two+ words
      // ("Software Engineer", "Data Scientist") which are caught by the
      // shape check below.
      const COMPANY_BLACKLIST = new Set([
        "agoda", "booking", "booking.com", "expedia", "airbnb", "stripe", "shopify",
        "google", "alphabet", "meta", "facebook", "amazon", "apple", "microsoft",
        "netflix", "uber", "lyft", "twitter", "x", "linkedin", "tiktok", "bytedance",
        "salesforce", "oracle", "ibm", "intel", "nvidia", "amd", "tesla", "spacex",
        "openai", "anthropic", "deepmind", "huggingface", "mistral",
        "github", "gitlab", "atlassian", "slack", "zoom", "asana", "notion", "linear",
        "figma", "canva", "miro", "datadog", "newrelic", "splunk", "snowflake",
        "databricks", "mongodb", "elastic", "cloudflare", "fastly", "vercel", "netlify",
        "heroku", "digitalocean", "paypal", "square", "block", "klarna", "revolut",
        "wise", "n26", "monzo", "hubspot", "intercom", "zendesk", "twilio", "segment",
        "mixpanel", "amplitude", "shopee", "grab", "mercadolibre", "rappi", "didi",
      ]);
      const looksLikeCompanyName = (kw: string): boolean => {
        const lower = kw.toLowerCase().trim();
        if (COMPANY_BLACKLIST.has(lower)) return true;
        // Single capitalized token with no role-title words → almost
        // certainly a brand. Real role titles include words like
        // engineer / developer / manager / analyst / scientist /
        // designer / architect / lead / director / specialist.
        const words = kw.trim().split(/\s+/);
        if (words.length === 1) {
          const ROLE_NOUNS = /\b(engineer|developer|programmer|architect|manager|director|analyst|scientist|designer|lead|specialist|consultant|coordinator|administrator|officer|associate|intern|apprentice|writer|editor|recruiter|accountant|nurse|doctor|teacher|advisor|strategist|representative|executive|operator|technician|researcher|advocate)\b/i;
          if (!ROLE_NOUNS.test(lower)) return true;
        }
        return false;
      };

      // Validate + sanitize each field so a hallucinated country code
      // can't slip through into the user's saved config.
      const rawKeywords = Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((k: any) => typeof k === "string" && k.trim()).slice(0, 6).map((k: string) => k.trim())
        : [];
      const filtered: string[] = [];
      const dropped: string[] = [];
      for (const k of rawKeywords) {
        if (looksLikeCompanyName(k)) dropped.push(k);
        else filtered.push(k);
      }
      const keywords = filtered;
      if (dropped.length > 0) {
        console.info(`[parse-search] dropped ${dropped.length} company-name keywords: ${dropped.join(", ")}`);
      }
      const country = typeof parsed.country === "string" && SUPPORTED_COUNTRIES.includes(parsed.country)
        ? parsed.country
        : null;
      const experienceLevels = Array.isArray(parsed.experience_levels)
        ? parsed.experience_levels.filter((e: any) => typeof e === "string" && /^[1-6]$/.test(e))
        : [];
      const workType = typeof parsed.work_type === "string" && /^[1-3]$/.test(parsed.work_type)
        ? parsed.work_type
        : null;
      const timeFilter = typeof parsed.time_filter === "string" && TIME_FILTERS.includes(parsed.time_filter)
        ? parsed.time_filter
        : null;
      res.json({
        keywords,
        country,
        experience_levels: experienceLevels,
        work_type: workType,
        time_filter: timeFilter,
        dropped_keywords: dropped,
      });
    } catch (err: any) {
      console.error("[POST /api/settings/parse-search]", err?.message || err);
      res.status(500).json({ error: "AI parser failed. Please try again." });
    }
  });
}

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
