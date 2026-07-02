import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchSettings,
  updateSettings,
  startPipeline,
  stopPipeline,
  pipelineStatus,
  uploadResume,
  fetchTargetCompanies,
  PipelineConfig,
  ResumeStatus,
  UsageInfo,
  LimitsInfo,
  AuthUser,
  TargetCompany,
  parseSearchText,
} from "../api";
import { getCurrentAccessToken } from "../supabaseClient";

// Hard fallback caps for when we don't yet know the user's plan (pre-auth
// or /me still loading). These must match the Free plan limits in
// server/src/middleware/gate.ts so an anonymous view of the config is
// never more permissive than a signed-in Free user.
const FALLBACK_MAX_JOBS = 5;
const FALLBACK_MAX_TAILOR = 1;
import SettingsModal from "./SettingsModal";
import FreeTailorSection from "./FreeTailorSection";
import { getTourState } from "../onboarding/tour";
import AuthModal from "./AuthModal";

interface PipelineLog {
  time: string;
  type: string;
  message: string;
  step?: string;
}

const PIPELINE_STEPS = [
  { id: "init", label: "Initializing", icon: "⚙" },
  { id: "scrape-linkedin", label: "Scraping primary source", icon: "🔍" },
  { id: "scrape-free", label: "Scraping secondary sources", icon: "🌐" },
  { id: "dedup", label: "Deduplication", icon: "🧹" },
  { id: "location-filter", label: "Location Filter", icon: "📍" },
  { id: "resume-fetch", label: "Loading Resume", icon: "📄" },
  { id: "scoring", label: "AI Scoring", icon: "🧠" },
  { id: "tailoring", label: "Resume Tailoring", icon: "✂️" },
  { id: "summary", label: "Complete", icon: "✓" },
];

const EXPERIENCE_OPTIONS = [
  { value: "1", label: "Internship" },
  { value: "2", label: "Entry Level" },
  { value: "3", label: "Associate" },
  { value: "4", label: "Mid-Senior" },
  { value: "5", label: "Director" },
  { value: "6", label: "Executive" },
];

const TIME_FILTER_OPTIONS = [
  { value: "r86400", label: "Past 24 hours" },
  { value: "r604800", label: "Past week" },
  { value: "r2592000", label: "Past month" },
];

const WORK_TYPE_OPTIONS = [
  { value: "", label: "Any" },
  { value: "1", label: "On-site" },
  { value: "2", label: "Remote" },
  { value: "3", label: "Hybrid" },
];

const JOB_TYPE_OPTIONS = [
  { value: "", label: "Any" },
  { value: "F", label: "Full-time" },
  { value: "P", label: "Part-time" },
  { value: "I", label: "Internship" },
  { value: "C", label: "Contract" },
];

const COUNTRY_OPTIONS = [
  { code: "ireland",     label: "Ireland",        flag: "IE", desc: "Roles based in Ireland" },
  { code: "uk",          label: "United Kingdom", flag: "GB", desc: "Roles across the UK" },
  { code: "netherlands", label: "Netherlands",    flag: "NL", desc: "Roles across the Netherlands" },
  { code: "india",       label: "India",          flag: "IN", desc: "Roles across India" },
  { code: "newzealand",  label: "New Zealand",    flag: "NZ", desc: "Roles across New Zealand" },
];

// ── Role → keyword expansion map ──
// Each key is a pattern (matched case-insensitively against the role input).
// Values are related search terms that cover alternate titles for the same
// role family. Patterns are matched with `input.includes(pattern) ||
// pattern.includes(input)` so short fragments still match (e.g. "consult"
// matches "consulting" + "consultant").
const ROLE_KEYWORD_MAP: Record<string, string[]> = {
  // ── Tech ──
  "software engineer": ["software engineer", "software developer", "backend developer", "frontend developer", "full stack developer", "web developer", "application developer", "SDE"],
  "data engineer": ["data engineer", "ETL developer", "data pipeline engineer", "analytics engineer", "big data engineer", "data infrastructure"],
  "data scientist": ["data scientist", "machine learning engineer", "ML engineer", "AI engineer", "research scientist", "applied scientist"],
  "data analyst": ["data analyst", "analytics analyst", "BI analyst", "reporting analyst", "insights analyst"],
  "business analyst": ["business analyst", "BA", "business systems analyst", "process analyst", "requirements analyst"],
  "devops": ["devops engineer", "SRE", "site reliability engineer", "platform engineer", "infrastructure engineer", "cloud engineer"],
  "cloud": ["cloud engineer", "cloud architect", "AWS engineer", "Azure engineer", "GCP engineer", "cloud infrastructure"],
  "designer": ["UX designer", "UI designer", "product designer", "visual designer", "interaction designer", "UX researcher", "graphic designer"],
  "qa": ["QA engineer", "test engineer", "SDET", "quality assurance", "automation tester", "QA analyst"],
  "security": ["security engineer", "cybersecurity", "information security", "SOC analyst", "penetration tester", "security analyst"],
  "mobile": ["mobile developer", "iOS developer", "Android developer", "React Native developer", "Flutter developer", "mobile engineer"],
  "embedded": ["embedded engineer", "firmware engineer", "embedded software", "RTOS engineer", "IoT engineer"],
  "game": ["game developer", "game designer", "Unity developer", "Unreal developer", "gameplay programmer"],

  // ── Product / project / management ──
  "product manager": ["product manager", "product owner", "associate product manager", "technical product manager", "senior product manager"],
  "project manager": ["project manager", "program manager", "scrum master", "delivery manager", "PMO", "project coordinator"],
  "program manager": ["program manager", "technical program manager", "delivery manager", "PMO lead"],

  // ── Consulting (NEW) ──
  "consultant": ["consultant", "management consultant", "strategy consultant", "business consultant", "associate consultant", "senior consultant", "principal consultant", "advisor"],
  "management consult": ["management consultant", "strategy consultant", "business consultant", "associate consultant", "engagement manager", "principal consultant", "senior consultant"],
  "strategy": ["strategy consultant", "strategy analyst", "corporate strategy", "strategy manager", "business strategist"],

  // ── Sales / marketing / growth ──
  "marketing": ["marketing manager", "marketing coordinator", "digital marketing", "growth marketing", "brand manager", "content marketing", "marketing specialist", "marketing lead"],
  "sales": ["sales representative", "account executive", "business development", "sales manager", "SDR", "account manager", "sales associate"],
  "growth": ["growth marketer", "growth manager", "performance marketing", "growth product manager", "growth analyst"],
  "seo": ["SEO specialist", "SEO manager", "search engine optimization", "SEO analyst", "technical SEO"],

  // ── People / HR / recruiting ──
  "human resources": ["HR manager", "HR coordinator", "people operations", "talent acquisition", "recruiter", "HR specialist", "HR business partner"],
  "recruiter": ["recruiter", "talent acquisition", "technical recruiter", "executive recruiter", "sourcing specialist"],

  // ── Finance / accounting (NEW expanded) ──
  "finance": ["financial analyst", "finance manager", "controller", "FP&A analyst", "treasury analyst", "corporate finance"],
  "accountant": ["accountant", "staff accountant", "senior accountant", "bookkeeper", "auditor", "tax accountant", "accounts payable", "accounts receivable"],
  "audit": ["auditor", "internal auditor", "external auditor", "audit associate", "audit manager", "compliance auditor"],
  "investment": ["investment analyst", "investment banker", "portfolio manager", "equity analyst", "research analyst"],
  "actuary": ["actuary", "actuarial analyst", "actuarial associate", "pricing actuary"],

  // ── Legal (NEW) ──
  "legal": ["lawyer", "attorney", "legal counsel", "paralegal", "compliance officer", "contracts manager", "legal advisor"],
  "lawyer": ["lawyer", "attorney", "solicitor", "barrister", "associate attorney", "in-house counsel"],
  "paralegal": ["paralegal", "legal assistant", "legal secretary", "legal coordinator"],

  // ── Healthcare (NEW expanded beyond just nurse) ──
  "nurse": ["nurse", "registered nurse", "RN", "nursing", "clinical nurse", "nurse practitioner", "staff nurse", "ICU nurse"],
  "doctor": ["doctor", "physician", "medical officer", "general practitioner", "GP", "consultant physician"],
  "pharmacist": ["pharmacist", "clinical pharmacist", "pharmacy technician", "dispensing pharmacist"],
  "therapist": ["therapist", "physiotherapist", "occupational therapist", "speech therapist", "psychologist"],
  "healthcare": ["healthcare assistant", "care worker", "medical assistant", "clinical coordinator"],

  // ── Education (NEW expanded) ──
  "teacher": ["teacher", "instructor", "lecturer", "educator", "tutor", "teaching assistant", "professor", "academic"],
  "professor": ["professor", "associate professor", "assistant professor", "lecturer", "research fellow"],

  // ── Operations / logistics (NEW expanded) ──
  "operations": ["operations manager", "operations analyst", "operations coordinator", "supply chain", "logistics", "warehouse manager"],
  "supply chain": ["supply chain analyst", "supply chain manager", "logistics coordinator", "procurement specialist", "demand planner"],
  "logistics": ["logistics coordinator", "logistics manager", "fleet manager", "warehouse supervisor", "freight coordinator"],
  "procurement": ["procurement specialist", "procurement manager", "buyer", "sourcing manager", "purchasing manager"],

  // ── Customer / support ──
  "customer": ["customer support", "customer success", "customer service", "support specialist", "help desk", "client relations", "customer experience"],
  "support": ["customer support", "technical support", "support engineer", "help desk", "service desk"],

  // ── Content / writing ──
  "content": ["content writer", "copywriter", "content strategist", "technical writer", "editor", "content creator", "content manager"],
  "writer": ["writer", "copywriter", "content writer", "editor", "journalist", "scriptwriter"],

  // ── Engineering (non-software) (NEW) ──
  "mechanical engineer": ["mechanical engineer", "design engineer", "manufacturing engineer", "process engineer", "maintenance engineer"],
  "electrical engineer": ["electrical engineer", "electronics engineer", "power engineer", "control engineer", "PLC engineer"],
  "civil engineer": ["civil engineer", "structural engineer", "site engineer", "construction engineer", "geotechnical engineer"],
  "chemical engineer": ["chemical engineer", "process engineer", "chemical process engineer", "petrochemical engineer"],

  // ── Hospitality / retail / service (NEW) ──
  "hospitality": ["hospitality manager", "hotel manager", "restaurant manager", "front office manager", "guest services"],
  "retail": ["retail manager", "store manager", "retail associate", "merchandiser", "buyer", "visual merchandiser"],
  "chef": ["chef", "head chef", "sous chef", "line cook", "pastry chef", "executive chef"],

  // ── Research / science ──
  "research": ["researcher", "research analyst", "research associate", "research scientist", "post doc"],
  "scientist": ["scientist", "research scientist", "applied scientist", "lab scientist", "biotech scientist"],

  // ── Internships / graduate (NEW) ──
  "intern": ["intern", "internship", "graduate intern", "summer intern", "trainee"],
  "graduate": ["graduate program", "graduate scheme", "trainee", "associate", "junior analyst", "graduate engineer"],
};

function expandRoleToKeywords(role: string): string {
  const input = role.toLowerCase().trim();
  const matches = new Set<string>();

  // Multiple comma-separated roles → expand each independently and merge.
  // Lets a user enter "data scientist, ML engineer" and get the union.
  const tokens = role.split(",").map((r) => r.trim()).filter(Boolean);

  for (const token of tokens) {
    const tokenLower = token.toLowerCase();
    let familyMatched = false;

    // Pattern matching: an entry hits if the user's token contains the
    // pattern OR the pattern contains the user's token. This covers
    // both "management consultant" → "management consult" pattern AND
    // "consult" → "consultant" pattern.
    for (const [pattern, keywords] of Object.entries(ROLE_KEYWORD_MAP)) {
      if (tokenLower.includes(pattern) || pattern.includes(tokenLower)) {
        keywords.forEach((k) => matches.add(k));
        familyMatched = true;
      }
    }

    // If no family matched this token, generate sensible variations
    // from the token itself.
    if (!familyMatched) {
      matches.add(token);
      const lower = tokenLower;

      // Strip leading seniority words to expose the core noun, then add
      // common seniority variants. Catches "head of X", "VP of X",
      // "director of X", "chief X officer" etc.
      const stripped = token.replace(/^(senior|junior|associate|principal|chief|head of|vp of|vice president of|director of|lead)\s+/i, "");
      if (stripped !== token) matches.add(stripped);

      if (/\bmanager\b/i.test(lower)) {
        matches.add(token.replace(/manager/i, "lead"));
        matches.add(token.replace(/manager/i, "coordinator"));
        matches.add(token.replace(/manager/i, "specialist"));
        matches.add(token.replace(/manager/i, "director"));
      } else if (/\bengineer\b/i.test(lower)) {
        matches.add(token.replace(/engineer/i, "developer"));
        matches.add("senior " + token);
        matches.add("lead " + token);
      } else if (/\banalyst\b/i.test(lower)) {
        matches.add(token.replace(/analyst/i, "specialist"));
        matches.add(token.replace(/analyst/i, "coordinator"));
        matches.add(token.replace(/analyst/i, "associate"));
      } else if (/\bconsultant\b/i.test(lower)) {
        // Catches "X consultant" patterns we didn't explicitly map.
        matches.add(token.replace(/consultant/i, "advisor"));
        matches.add(token.replace(/consultant/i, "specialist"));
        matches.add("senior " + token);
        matches.add("principal " + token);
      } else if (/\bdesigner\b/i.test(lower)) {
        matches.add(token.replace(/designer/i, "design lead"));
        matches.add("senior " + token);
      } else {
        // Generic: add "senior X", "junior X", "X specialist". Always
        // includes the bare token plus a couple of seniority variants so
        // niche roles still produce useful search keywords.
        matches.add("senior " + token);
        matches.add("junior " + token);
        matches.add(token + " specialist");
      }
    }
  }

  return Array.from(matches).join(",");
}

interface Props {
  currentUser: AuthUser | null;
  userLimits: LimitsInfo | null;
  onLogout: () => void | Promise<void>;
  onNavigateToDashboard: () => void;
  onNavigateToAuth: () => void;
  onNavigateToPricing: () => void;
}

export default function LandingPage({ currentUser, userLimits, onLogout, onNavigateToDashboard, onNavigateToAuth, onNavigateToPricing }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Landing has two views: a clean hero (page 1, just the headline + a
  // "Click Here" button) and the full configuration surface (page 2, every
  // feature in cards). The hero button flips to "configure"; a back button
  // returns to the hero. This replaces the old single long-scroll page.
  // Returning from the dashboard's "Back to Pipeline" sets a sessionStorage
  // flag so we open straight on the Job Hunt config instead of the hero.
  const landingTarget = (() => { try { return sessionStorage.getItem("gc8-landing-target"); } catch { return null; } })();
  const [view, setView] = useState<"hero" | "configure">(landingTarget === "hunt" ? "configure" : "hero");
  // During the first-run onboarding tour (driver.js) we render the original
  // single-scroll layout (hero + config together) so every tour step — the
  // hero nav AND the #config-start / start-pipeline targets — resolves.
  // Onboarded users never trigger it, so the poll is scoped to new users.
  const [tourActive, setTourActive] = useState<boolean>(() => !!getTourState());
  useEffect(() => {
    // Only the first-run tour (logged-in user who hasn't onboarded) needs the
    // single-scroll fallback, so anonymous visitors never poll.
    if (!currentUser || currentUser.onboarded_at) return;
    const id = setInterval(() => setTourActive(!!getTourState()), 800);
    return () => clearInterval(id);
  }, [currentUser, currentUser?.onboarded_at]);
  // Which configure section the columnar layout shows. The pipeline config
  // ("hunt") is logged-in only, so anonymous visitors are pinned to the
  // resume tailor regardless of selection.
  const [configSection, setConfigSection] = useState<"hunt" | "tailor">(landingTarget === "hunt" ? "hunt" : "tailor");
  const effectiveConfigSection: "hunt" | "tailor" = currentUser ? configSection : "tailor";
  // Consume the deep-link flag once so a later plain visit to the landing
  // page starts on the hero again.
  useEffect(() => { try { sessionStorage.removeItem("gc8-landing-target"); } catch { /* ignore */ } }, []);

  const [config, setConfig] = useState<PipelineConfig | null>(null);

  // Plan-derived slider ceilings. Falls back to the Free plan caps when
  // userLimits hasn't loaded yet so the UI is never more permissive than
  // the strictest plan during the brief /me roundtrip.
  //
  // Enterprise users pick a tier (1/2/3) on the Limits tab. The tier
  // overrides userLimits.jobs_scraped/resumes_tailored client-side so
  // the max input immediately reflects the slider without needing to
  // round-trip /me. Server re-clamps on the actual run, so this is
  // safe — the tier choice is persisted in user_settings too.
  const ENTERPRISE_TIER_CAPS: Record<1 | 2 | 3, { jobs: number; tailor: number }> = {
    1: { jobs: 20, tailor: 10 },
    2: { jobs: 35, tailor: 20 },
    3: { jobs: 50, tailor: 50 },
  };
  const isEnterprise = currentUser?.plan === "enterprise";
  const currentTier = (config?.ENTERPRISE_TIER ?? 3) as 1 | 2 | 3;
  const tierCap = ENTERPRISE_TIER_CAPS[currentTier];
  const maxJobsToScrape = isEnterprise
    ? tierCap.jobs
    : userLimits?.jobs_scraped ?? FALLBACK_MAX_JOBS;
  const maxResumesToTailor = isEnterprise
    ? tierCap.tailor
    : userLimits?.resumes_tailored ?? FALLBACK_MAX_TAILOR;
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [limits, setLimits] = useState<LimitsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  // Brief transitional state between "user clicked start" and "pipeline
  // has emitted its first SSE log". Without this, the button stays on
  // "Perform Job Hunt" for the 1-3s it takes to save settings + hit the
  // start endpoint + open the SSE stream, so users double-click.
  const [starting, setStarting] = useState(false);
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [showCompletionToast, setShowCompletionToast] = useState(false);
  const [showAdjustSettingsModal, setShowAdjustSettingsModal] = useState(false);
  const [authModal, setAuthModal] = useState<null | "login" | "signup">(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("search");
  // "manual" = keyword builder + filters; "url" = paste a full search URL.
  // Auto-detect mode on load from whether the saved config has a URL;
  // after that the user toggles explicitly.
  const [searchMode, setSearchMode] = useState<"manual" | "url" | "nl">("manual");
  // Natural-language search: free-form sentence the user types, parsed
  // by OpenAI into structured config (keywords, country, experience,
  // etc.) and applied to the saved settings on click. Two-step flow:
  // user clicks Parse → preview shows extracted fields → user clicks
  // Apply. Stops the AI from silently writing weird values into config.
  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlApplied, setNlApplied] = useState<string | null>(null);
  // Editable chips of the parsed result. null = nothing parsed yet
  // (show Parse button); object = preview shown with Apply / Re-parse.
  const [nlParsed, setNlParsed] = useState<{
    keywords: string[];
    country: string | null;
    experience_levels: string[];
    work_type: string | null;
    time_filter: string | null;
    dropped_keywords: string[];
  } | null>(null);
  // Resume & role state
  const [resumeStatus, setResumeStatus] = useState<ResumeStatus | null>(null);
  // Active target companies loaded from the user's Portals library. Used
  // to populate the Focus-company dropdown. Empty for anonymous visitors
  // and for logged-in users who haven't configured any companies yet.
  const [targetCompaniesList, setTargetCompaniesList] = useState<TargetCompany[]>([]);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [expectedRole, setExpectedRole] = useState("");
  const [uploadingResume, setUploadingResume] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Snapshot of the last value the role-expander wrote into the keyword
  // fields. We use it to decide "is the current keyword field content
  // still the auto-fill we put there, or has the user edited it since?"
  // and only overwrite when it's still our value. This is robust across
  // page reloads and treats persisted-but-stale defaults as overwritable.
  // Includes the legacy hardcoded server defaults as known auto-fill
  // sentinels so existing users with stale settings don't get their
  // role expansion blocked by leftover "data engineer,..." values.
  const lastExpansionRef = useRef<string>("");
  const KNOWN_AUTO_VALUES = new Set<string>([
    "",
    // Legacy defaults that used to ship from the server. Treated as
    // "still auto-filled" so role typing replaces them on first edit.
    "data engineer,software engineer",
    "data engineer,data analyst,python developer,sql developer",
  ]);
  function isAutoFillValue(current: string): boolean {
    return KNOWN_AUTO_VALUES.has(current) || current === lastExpansionRef.current;
  }
  // Once the user has manually typed in (or cleared) any keyword field,
  // we stop auto-overwriting those fields from the role-expansion logic.
  const userTouchedKeywordsRef = useRef(false);

  // Load settings on mount — only when the viewer is logged in. Anonymous
  // visitors on the landing page only see the FreeTailor bait; they
  // shouldn't trigger authenticated /api/settings or /api/pipeline calls.
  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    fetchSettings()
      .then((data) => {
        setConfig(data.config as PipelineConfig);
        if (data.usage) setUsage(data.usage);
        if (data.limits) setLimits(data.limits);
        if (data.resume) setResumeStatus(data.resume);
        // Restore expected role from saved config
        if (data.config?.TARGET_ROLE) setExpectedRole(data.config.TARGET_ROLE);
        // Auto-detect search mode: if the user previously saved a URL,
        // open the URL tab by default. Otherwise the keyword/filter tab.
        if (data.config?.LINKEDIN_SEARCH_URL?.trim()) setSearchMode("url");
      })
      .catch(() => {
        setError("Server not reachable — start the backend with: npm run dev:server");
        // Fall back to defaults so UI still renders
        setConfig({
          RELEVANCE_SCORE_THRESHOLD: 7, TAILORING_INTENSITY: 5, APIFY_JOB_COUNT: 20,
          BATCH_DELAY_MS: 2000, APIFY_MAX_POLL_MINUTES: 10, MAX_TAILOR_COUNT: 20, MAX_AGE_DAYS: 14,
          // Keyword fields start empty — populated by the role-expander
          // when the user types their target role. Hardcoded software
          // defaults previously crowded out non-tech users.
          SEARCH_KEYWORDS: "", LINKEDIN_KEYWORDS: "", LINKEDIN_SKILLS: "", LINKEDIN_SEARCH_URL: "",
          LINKEDIN_EXPERIENCE: "", LINKEDIN_TIME_FILTER: "r604800", LINKEDIN_WORK_TYPE: "", LINKEDIN_JOB_TYPE: "",
          TARGET_ROLE: "",
          SCRAPE_LINKEDIN: true, SCRAPE_REMOTEOK: true, SCRAPE_JOBICY: true, SCRAPE_HN: true,
          SCRAPE_WWR: true, SCRAPE_ARBEITNOW: true, SCRAPE_REMOTIVE: true, SCRAPE_DEVTO: true,
          SCRAPE_JOBSIE: true, SCRAPE_IRISHJOBS: true, SCRAPE_INDEED_IE: true, SCRAPE_GRADIRELAND: true,
          SCRAPE_CAREERJET: true, SCRAPE_GLASSDOOR: false,
          SCRAPE_NAUKRI: true, SCRAPE_INSTAHYRE: true, SCRAPE_INDEED_IN: true,
          SCRAPE_INDEED_UK: true, SCRAPE_INDEED_NL: true,
          TARGET_COUNTRIES: "ireland", LOCATION_REGIONS: "ireland,uk,eu",
          TARGET_COMPANY_ID: null,
          ENTERPRISE_TIER: 3,
          ENABLE_COVER_LETTER: false, ENABLE_WHY_FIT: false,
        } as PipelineConfig);
      })
      .finally(() => setLoading(false));

    // Fetch the user's target-company library so the Focus-company
    // dropdown can populate. Only active companies are useful here.
    fetchTargetCompanies()
      .then((list) => setTargetCompaniesList(list.filter((c) => c.active)))
      .catch(() => setTargetCompaniesList([]));

    // Restore pipeline state (running or completed logs from previous view)
    fetch("/api/pipeline/logs").then((r) => r.json()).then((data: any) => {
      if (data.running) {
        setRunning(true);
        connectSSE();
      } else if (data.logs?.length > 0) {
        // Restore previous run logs so summary persists after navigation
        setLogs(data.logs);
        const hasComplete = data.logs.some((l: any) => l.type === "complete");
        if (hasComplete) setPipelineComplete(true);
        // Restore current step from last step log
        const lastStep = [...data.logs].reverse().find((l: any) => l.type === "step" && l.step);
        if (lastStep) setCurrentStep(lastStep.step);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Auto-scroll on the pipeline log is intentionally OFF. Even the
  // smart "stick to bottom only if the user is already at the bottom"
  // version still pulled the page on the final "complete" log entry
  // and on rapid log bursts that crossed the 80px threshold. Users
  // can scroll the log manually; the log container is its own scroll
  // viewport so the rest of the page stays put.
  //
  // (`logEndRef` is left mounted in the JSX as a no-op anchor in case
  // we ever want to re-introduce a "Jump to bottom" button.)

  // Auto-clamp persisted config when the effective ceiling (plan × tier)
  // is tighter than what's stored. Fires on config load, plan switch,
  // OR enterprise-tier change. We use maxJobsToScrape / maxResumesToTailor
  // rather than raw userLimits so enterprise tier downgrades clamp too —
  // e.g. sliding from Tier 3 (50) to Tier 1 (20) trims APIFY_JOB_COUNT.
  useEffect(() => {
    if (!config) return;
    const tooManyJobs = config.APIFY_JOB_COUNT > maxJobsToScrape;
    const tooManyTailored = config.MAX_TAILOR_COUNT > maxResumesToTailor;
    if (!tooManyJobs && !tooManyTailored) return;
    const next: Partial<PipelineConfig> = {};
    if (tooManyJobs) next.APIFY_JOB_COUNT = maxJobsToScrape;
    if (tooManyTailored) next.MAX_TAILOR_COUNT = maxResumesToTailor;
    setConfig((prev) => (prev ? { ...prev, ...next } : prev));
    // Fire-and-forget server save. If it fails we'll retry on the next
    // effect run; worst case the server-side pipeline gate rejects the
    // oversized request anyway.
    updateSettings(next).catch(() => {});
  }, [config, maxJobsToScrape, maxResumesToTailor]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    // Browser EventSource can't set custom headers, so the access token
    // goes in the query string. Without this the server's requireAuth
    // middleware rejects the connection with 401 and the UI gets stuck
    // on "Initializing" because no step events ever arrive.
    const token = getCurrentAccessToken();
    const url = token
      ? `/api/pipeline/events?access_token=${encodeURIComponent(token)}`
      : "/api/pipeline/events";
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: PipelineLog = JSON.parse(event.data);

        if (data.type === "status" && data.message === "idle") return;

        if (data.type === "complete") {
          setRunning(false);
          setPipelineComplete(true);
          setShowCompletionToast(true);
          // The "adjust your search" nudge is scheduled by a separate effect
          // that only fires for under-delivered runs (see below) — not on
          // every completion, so a fully successful run isn't told it failed.
          es.close();
          eventSourceRef.current = null;
          setLogs((prev) => [...prev, data]);
          // Refresh usage + limits from server for accurate final numbers
          fetchSettings().then((s: any) => {
            if (s.usage) setUsage(s.usage);
            if (s.limits) setLimits(s.limits);
          }).catch(() => {});
          return;
        }

        if (data.step && data.type === "step") {
          setCurrentStep(data.step);
          // Step transition events drive the progress tracker only — they
          // carry no message body and must NOT be appended to the log
          // panel. The corresponding visible log line (also type "step"
          // but with a message and no `step` field) is broadcast just
          // before this one and renders normally. Without this early
          // return the panel rendered every phase header twice.
          return;
        }

        // Live-update the "Today's Usage" counters from the log stream so the
        // card moves during the run, tracking EXACTLY what the server charges:
        // one relevant job per "Relevant (score: …)" line (== stats.relevant,
        // capped at the target) and one tailored resume per "PDF uploaded"
        // line (== stats.tailored). Deriving from raw scrape totals overshot
        // the cap mid-run; deriving from "Resume customized" over-counted
        // failed PDFs. Authoritative totals are refetched on "complete".
        if (data.type === "success" && typeof data.message === "string") {
          if (data.message.includes("Relevant (score:")) {
            setUsage((prev) => prev ? { ...prev, jobs_scraped: prev.jobs_scraped + 1 } : prev);
          }
          if (data.message.includes("PDF uploaded")) {
            setUsage((prev) => prev ? { ...prev, resumes_tailored: prev.resumes_tailored + 1 } : prev);
          }
        }

        setLogs((prev) => [...prev, data]);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource fires onerror for BOTH transient hiccups (readyState
      // CONNECTING — the browser will auto-reconnect on its own) and terminal
      // closes (readyState CLOSED). Only tear down + warn on a terminal close,
      // so a brief network blip mid-run doesn't kill the live log/progress and
      // flash a scary banner while the pipeline is still running server-side.
      if (es.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
        setError((prev) => prev ?? "Live log stream dropped. Refresh to reconnect.");
      }
    };
  }, []);

  // Only nudge "adjust your search" when a completed run under-delivered
  // (zero matches, or fewer than target). Firing it on every completion made
  // even a fully successful run look like it failed. Reads the freshest logs
  // once the run completes.
  useEffect(() => {
    if (!pipelineComplete) return;
    const underDelivered = logs.some((l) => {
      const m = l.message || "";
      return m.includes("No relevant jobs to tailor")
        || m.includes("No jobs in target locations")
        || m.includes("no matching jobs found")
        || /Only \d+ quality jobs? passed the AI filter/.test(m);
    });
    if (!underDelivered) return;
    const t = setTimeout(() => setShowAdjustSettingsModal(true), 1200);
    return () => clearTimeout(t);
  }, [pipelineComplete]);

  function updateConfig<K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) {
    setConfig((prev) => prev ? { ...prev, [key]: value } : prev);
    // Auto-persist single-key changes so toggles/dropdowns survive a
    // page refresh even if the user never clicks "Save". Fire-and-forget:
    // a transient network error just means the change falls back to local
    // state until the next explicit save.
    updateSettings({ [key]: value } as Partial<PipelineConfig>).catch(() => {});
  }

  async function handleSaveConfig() {
    if (!config) return;
    setSaving(true);
    try {
      await updateSettings(config);
      setError(null);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleRoleChange(role: string) {
    setExpectedRole(role);
    if (!config) return;
    updateConfig("TARGET_ROLE", role.trim());

    // Skip auto-fill when the user has pasted a LinkedIn search URL —
    // that URL is the source of truth for the LinkedIn scrape, and
    // touching the keyword fields would just confuse the user.
    if (config.LINKEDIN_SEARCH_URL && config.LINKEDIN_SEARCH_URL.trim()) return;

    if (!role.trim()) return;

    const expanded = expandRoleToKeywords(role);

    // Per-field decision: only overwrite a keyword field if it's still
    // either empty, a known stale default ("data engineer,..."), or the
    // exact value we last auto-filled. If the user has hand-edited it,
    // the value won't match any of those — leave it alone. This handles
    // both new users (empty field) and existing users with leftover
    // hardcoded defaults persisted in user_settings.
    const linkedinIsAuto = isAutoFillValue(config.LINKEDIN_KEYWORDS || "");
    const searchIsAuto   = isAutoFillValue(config.SEARCH_KEYWORDS || "");

    // The touched-ref is a stronger signal than the value comparison —
    // if the user has typed in a keyword field this session we respect
    // that immediately, even if their current text happens to coincide
    // with a known auto-fill string.
    const respectTouched = userTouchedKeywordsRef.current;

    if (linkedinIsAuto && !respectTouched) updateConfig("LINKEDIN_KEYWORDS", expanded);
    if (searchIsAuto   && !respectTouched) updateConfig("SEARCH_KEYWORDS",   expanded);
    if ((linkedinIsAuto || searchIsAuto) && !respectTouched) updateConfig("LINKEDIN_SKILLS", "");

    lastExpansionRef.current = expanded;
  }

  async function handleResumeUpload(file: File) {
    setResumeFile(file);
    setUploadingResume(true);
    setError(null);
    try {
      const result = await uploadResume(file);
      // Upload response has {ok, filename, charCount, preview} — normalize to ResumeStatus
      setResumeStatus({
        uploaded: true,
        filename: result.filename,
        charCount: result.charCount,
        preview: result.preview,
      });
    } catch (err: any) {
      setError(err.message || "Resume upload failed");
      setResumeFile(null);
    } finally {
      setUploadingResume(false);
    }
  }

  async function handleStartPipeline() {
    if (!config) return;

    // Require resume
    if (!resumeStatus?.uploaded) {
      setError("Please upload your resume before starting the pipeline");
      return;
    }

    // STRICT requirement: the user must have either real keywords OR a
    // pasted URL. Previously we accepted "expected role only" because
    // the role auto-fills keywords, but that auto-fill silently fails
    // in some flows (URL mode toggle, settings reload, etc.) and
    // produced "0 jobs scraped" because the pipeline got nothing
    // searchable. Force explicit input here so the failure mode is
    // a visible "fill in a field" error instead of a silent zero run.
    const hasLinkedInUrl = !!config.LINKEDIN_SEARCH_URL && config.LINKEDIN_SEARCH_URL.trim().length > 0;
    const hasLinkedInKeywords = !!config.LINKEDIN_KEYWORDS && config.LINKEDIN_KEYWORDS.trim().length > 0;
    const hasFreeKeywords = !!config.SEARCH_KEYWORDS && config.SEARCH_KEYWORDS.trim().length > 0;
    if (!hasLinkedInUrl && !hasLinkedInKeywords && !hasFreeKeywords) {
      setError(
        "Add keywords OR paste a search URL before starting the pipeline. " +
        "Use Keywords mode to type roles like 'AI Engineer, Data Engineer', or URL mode to paste a LinkedIn search URL."
      );
      return;
    }

    setError(null);
    setLogs([]);
    setPipelineComplete(false);
    setCurrentStep("init");
    // Flip to 'starting' IMMEDIATELY so the button swaps to a spinner
    // within the same frame as the click. Without this, the button stays
    // on "Perform Job Hunt" for the full duration of updateSettings +
    // startPipeline + SSE connect (~2-3s on Railway cold starts) and the
    // user can't tell whether the click registered.
    setStarting(true);

    try {
      // Save config first, then start
      await updateSettings(config);
      await startPipeline(config);
      setRunning(true);
      connectSSE();
      // Do NOT auto-navigate. The user stays on the config to watch progress;
      // when the run completes, the completion toast + "Open Dashboard" CTA
      // guide them to the Pipeline Board. (A "View Dashboard Live" button is
      // also shown while running for those who want to switch early.)
    } catch (err: any) {
      setError(err.message || "Failed to start pipeline");
    } finally {
      setStarting(false);
    }
  }

  async function handleStopPipeline() {
    try {
      await stopPipeline();
      setRunning(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    } catch {
      setError("Failed to stop pipeline");
    }
  }

  function getStepStatus(stepId: string) {
    if (!currentStep) return "pending";
    const stepIdx = PIPELINE_STEPS.findIndex((s) => s.id === stepId);
    const currentIdx = PIPELINE_STEPS.findIndex((s) => s.id === currentStep);
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx) return running ? "active" : pipelineComplete ? "done" : "pending";
    return "pending";
  }

  function getLogColor(type: string) {
    switch (type) {
      case "step": return "text-cyan-400";
      case "success": return "text-emerald-400";
      case "warn": return "text-amber-400";
      case "error": return "text-red-400";
      case "job": return "text-blue-400";
      case "skip": return "text-gray-500";
      case "complete": return "text-[#c9a94e]";
      case "banner": return "text-cyan-300";
      default: return "text-gray-400";
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[var(--bg-base)] gap-3">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <p className="text-[var(--text-secondary)] text-sm font-body">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--bg-base)] relative">
      {/* ── Auth Modal (header Sign In) ── */}
      {authModal && (
        <AuthModal
          initialMode={authModal}
          onClose={() => setAuthModal(null)}
          onSuccess={() => setAuthModal(null)}
        />
      )}

      {/* ── Settings Modal ──
          Mounted at the top level (not inside the Job Hunt <main>, which only
          renders on the hunt section) so the nav's Settings button works from
          the hero and every configure section. */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* ── Pipeline Completion Toast ── */}
      {showCompletionToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-[slideDown_0.3s_ease-out]">
          <div className="flex items-center gap-3 bg-[#12151c] border border-[rgba(201,169,78,0.3)] rounded-xl px-5 py-3 shadow-2xl shadow-[rgba(201,169,78,0.08)]">
            <div className="w-2 h-2 rounded-full bg-[#c9a94e] animate-pulse shrink-0" />
            <span className="text-sm text-gray-200 font-medium">Pipeline finished. Your jobs are ready.</span>
            <button
              onClick={() => { setShowCompletionToast(false); onNavigateToDashboard(); }}
              className="font-mono text-xs font-semibold uppercase tracking-wider text-[#c9a94e] bg-[#c9a94e]/10 hover:bg-[#c9a94e]/20 border border-[#c9a94e]/30 px-3 py-1.5 rounded-lg transition-all shrink-0"
            >
              Open Dashboard
            </button>
            <button
              onClick={() => setShowCompletionToast(false)}
              className="text-gray-600 hover:text-gray-300 transition-colors shrink-0 ml-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Adjust Settings Modal (post-pipeline nudge) ── */}
      {showAdjustSettingsModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4 animate-[fadeIn_0.2s_ease-out]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowAdjustSettingsModal(false)}
          />
          <div className="relative bg-[#12151c] border border-[rgba(201,169,78,0.25)] rounded-2xl p-6 max-w-md w-full shadow-2xl shadow-[rgba(201,169,78,0.1)]">
            <button
              onClick={() => setShowAdjustSettingsModal(false)}
              className="absolute top-3 right-3 text-gray-600 hover:text-gray-300 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[rgba(201,169,78,0.1)] border border-[rgba(201,169,78,0.25)] flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#c9a94e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-100 mb-1">Can't find more jobs?</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Try adjusting your settings to broaden your search. Lower the relevancy threshold, expand keywords, or add more job sources.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  setShowAdjustSettingsModal(false);
                  setActiveSection("search");
                  setTimeout(() => document.getElementById("ai-tuning")?.scrollIntoView({ behavior: "smooth" }), 100);
                }}
                className="flex-1 rounded-xl py-2.5 px-4 font-medium text-sm bg-[rgba(201,169,78,0.12)] border border-[rgba(201,169,78,0.3)] text-[#c9a94e] hover:bg-[rgba(201,169,78,0.2)] transition-all"
              >
                Adjust Settings
              </button>
              <button
                onClick={() => setShowAdjustSettingsModal(false)}
                className="flex-1 rounded-xl py-2.5 px-4 font-medium text-sm bg-transparent border border-[var(--border-default)] text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-all"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Video Background ── */}
      {/* ── Video Background ──
           CONTROL: change --landing-video-opacity below (0 = hidden, 1 = full brightness)
           Default: 0.15 = subtle texture. Try 0.25 for more visible, 0.08 for barely there. */}
      <div className="fixed inset-0 z-0 overflow-hidden" style={{ ["--landing-video-opacity" as any]: "0.15" }}>
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: "var(--landing-video-opacity)" as any }}
        >
          <source src="/landing-bg.mp4" type="video/mp4" />
        </video>
        {/* Thin gradient at top/bottom edges only — NOT a full overlay */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[var(--bg-base)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--bg-base)] to-transparent" />
      </div>

      {/* ── Hero Section ── */}
      <header className="relative overflow-hidden z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(201,169,78,0.04)] to-transparent pointer-events-none" />
        <div className={`w-full px-8 md:px-16 lg:px-24 pt-8 relative flex flex-col ${(view === "hero" || tourActive) ? "min-h-screen" : ""}`}>
          {/* Nav — edge to edge */}
          <div className="flex items-center justify-between relative">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
                <span className="text-[var(--accent)] text-xl sm:text-2xl">◆</span>
              </div>
              <span className="font-display text-xl sm:text-2xl text-[var(--text-primary)] tracking-wide">GO CANDID8</span>
            </div>

            {/* Desktop nav (md+) — inline items */}
            <nav className="hidden md:flex items-center gap-6" data-tour="landing-nav">
              {currentUser && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-2 text-base text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
              )}
              <button onClick={onNavigateToPricing} className="text-base text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                Pricing
              </button>
              {currentUser && (
                <button onClick={onNavigateToDashboard} data-tour="nav-dashboard" className="text-base text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  Dashboard
                </button>
              )}
              {currentUser ? (
                <div className="flex items-center gap-3 pl-2 border-l border-[var(--border-subtle)]" data-tour="user-menu">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="text-sm text-[var(--text-primary)] font-medium max-w-[140px] truncate">{currentUser.name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                      currentUser.plan === "enterprise" ? "text-[var(--accent-blue)]" :
                      currentUser.plan === "pro" ? "text-[var(--accent)]" :
                      "text-[var(--text-tertiary)]"
                    }`}>
                      {currentUser.plan} plan
                    </span>
                  </div>
                  <button
                    onClick={() => onLogout()}
                    className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-transparent border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-red)] hover:border-[rgba(196,82,82,0.3)] transition-all"
                    title="Sign out"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAuthModal("login")}
                    className="text-base font-medium px-4 py-2.5 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => setAuthModal("signup")}
                    className="text-base font-semibold px-6 py-2.5 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] text-[var(--accent)] hover:bg-[rgba(201,169,78,0.18)] transition-all"
                  >
                    Get Started
                  </button>
                </div>
              )}
            </nav>

            {/* Mobile hamburger (below md) */}
            <button
              onClick={() => setMobileNavOpen((v) => !v)}
              className="md:hidden w-10 h-10 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Toggle menu"
              aria-expanded={mobileNavOpen}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {mobileNavOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            {/* Mobile dropdown (below md, toggled) */}
            {mobileNavOpen && (
              <div className="md:hidden absolute top-full right-0 mt-3 w-60 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl p-3 z-50 flex flex-col gap-1">
                {currentUser && (
                  <div className="px-3 py-2 border-b border-[var(--border-subtle)] mb-1">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">{currentUser.name}</div>
                    <div className={`text-[10px] font-semibold uppercase tracking-wider ${
                      currentUser.plan === "enterprise" ? "text-[var(--accent-blue)]" :
                      currentUser.plan === "pro" ? "text-[var(--accent)]" :
                      "text-[var(--text-tertiary)]"
                    }`}>
                      {currentUser.plan} plan
                    </div>
                  </div>
                )}
                {currentUser && (
                  <button
                    onClick={() => { setShowSettings(true); setMobileNavOpen(false); }}
                    className="text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 transition-colors"
                  >
                    Settings
                  </button>
                )}
                <button
                  onClick={() => { onNavigateToPricing(); setMobileNavOpen(false); }}
                  className="text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 transition-colors"
                >
                  Pricing
                </button>
                {currentUser && (
                  <button
                    onClick={() => { onNavigateToDashboard(); setMobileNavOpen(false); }}
                    className="text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 transition-colors"
                  >
                    Dashboard
                  </button>
                )}
                {currentUser ? (
                  <button
                    onClick={() => { onLogout(); setMobileNavOpen(false); }}
                    className="text-left text-sm text-[var(--accent-red)] hover:bg-[rgba(196,82,82,0.08)] rounded-lg px-3 py-2 transition-colors mt-1"
                  >
                    Sign out
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { setAuthModal("signup"); setMobileNavOpen(false); }}
                      className="text-left text-sm font-semibold text-[var(--accent)] bg-[var(--accent-muted)] rounded-lg px-3 py-2 transition-colors mt-1"
                    >
                      Get Started
                    </button>
                    <button
                      onClick={() => { setAuthModal("login"); setMobileNavOpen(false); }}
                      className="text-left text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 transition-colors"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Hero — vertically centered, massive type. Page 1 only (hidden on
              the configure view; shown during the tour for the original flow). */}
          {(view === "hero" || tourActive) && (
          <div className="flex-1 flex flex-col justify-center">
            <h1 className="font-display text-4xl md:text-5xl lg:text-[6.5rem] text-[var(--text-primary)] leading-[1.05] mb-8 tracking-tight">
              Your<br />
              <span className="text-[var(--accent)]">job search</span><br />
              on autopilot
            </h1>
            <p className="text-[var(--text-secondary)] text-xl md:text-2xl max-w-2xl leading-relaxed">
              Configure your preferences, hit start, and let AI scrape, score, and tailor resumes for the best-fit roles, all in one click.
            </p>
          </div>
          )}

          {/* Primary CTA. "Click Here" opens the configuration view (page 2)
              so the hero stays clean and scroll-free. During the onboarding
              tour we keep the original scroll indicator so the tour's
              #config-start step still resolves. */}
          {tourActive ? (
            <div className="flex flex-col items-center pb-10 animate-bounce">
              <button
                onClick={() => document.getElementById("config-start")?.scrollIntoView({ behavior: "smooth" })}
                className="text-[var(--text-ghost)] hover:text-[var(--accent)] transition-colors"
              >
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
              <span className="text-sm text-[var(--text-ghost)] mt-2">Scroll to configure</span>
            </div>
          ) : view === "hero" ? (
            <div className="flex flex-col items-center pb-16">
              <button
                id="landing-configure-cta"
                onClick={() => { setView("configure"); window.scrollTo({ top: 0 }); }}
                className="launch-btn inline-flex items-center gap-2 px-10 py-4 rounded-full font-semibold text-lg tracking-wide"
              >
                Set up my job hunt
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
              <span className="text-sm text-[var(--text-ghost)] mt-3">Upload your resume, set your targets, and let the AI run the hunt</span>
            </div>
          ) : null}
        </div>
      </header>

      {/* ── Configure surface (page 2) ──────────────────────────────────────
          Columnar layout: a left section rail + the active section's content,
          so users switch sections instead of scrolling one long page. During
          the onboarding tour the rail is dropped and every section renders
          stacked (the original single-scroll) so each tour step resolves. */}
      {(view === "configure" || tourActive) && (
      <div className={tourActive ? "relative z-10" : "flex relative z-10"}>

        {/* Left section rail (desktop) */}
        {!tourActive && (
          <aside className="hidden md:flex w-56 shrink-0 flex-col gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-5 sticky top-0 self-start max-h-screen overflow-y-auto">
            <button
              onClick={() => { setView("hero"); window.scrollTo({ top: 0 }); }}
              className="flex items-center gap-2 px-3 py-2 mb-1 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back to home
            </button>
            <div className="px-3 pt-2 pb-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Configure</div>
            <button
              onClick={() => setConfigSection("tailor")}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all border ${effectiveConfigSection === "tailor" ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(201,169,78,0.25)]" : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"}`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="flex-1 text-left">Resume Tailor</span>
            </button>
            {currentUser && (
              <button
                onClick={() => setConfigSection("hunt")}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all border ${effectiveConfigSection === "hunt" ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(201,169,78,0.25)]" : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"}`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h12" /></svg>
                <span className="flex-1 text-left">Job Hunt</span>
              </button>
            )}
            <div className="flex-1" />
            {currentUser && (
              <button
                onClick={onNavigateToDashboard}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border border-[rgba(201,169,78,0.2)] text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-all"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10h6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
                <span className="flex-1 text-left">Pipeline Board</span>
                <span>→</span>
              </button>
            )}
          </aside>
        )}

        {/* Content column */}
        <div className={tourActive ? "" : "flex-1 min-w-0"}>

          {/* Mobile section switcher (the rail is desktop-only) */}
          {!tourActive && (
            <div className="md:hidden flex items-center gap-2 px-4 pt-4 overflow-x-auto">
              <button onClick={() => { setView("hero"); window.scrollTo({ top: 0 }); }} className="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-subtle)] text-[var(--text-secondary)]">← Home</button>
              <button onClick={() => setConfigSection("tailor")} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs border ${effectiveConfigSection === "tailor" ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(201,169,78,0.3)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)]"}`}>Resume Tailor</button>
              {currentUser && (
                <button onClick={() => setConfigSection("hunt")} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs border ${effectiveConfigSection === "hunt" ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(201,169,78,0.3)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)]"}`}>Job Hunt</button>
              )}
              {currentUser && (
                <button onClick={onNavigateToDashboard} className="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-[rgba(201,169,78,0.2)] text-[var(--accent)]">Pipeline Board →</button>
              )}
            </div>
          )}

          {/* ── Resume Tailor section ── */}
          {(tourActive || effectiveConfigSection === "tailor") && (
          <div className="relative z-10">
            <FreeTailorSection
              currentUser={currentUser}
              onNavigateToPricing={onNavigateToPricing}
            />
          </div>
          )}

      {/* The full pipeline config + scraper controls are logged-in only.
          Anonymous visitors see the hero and the FreeTailor bait above,
          and nothing below this line. Once they sign up and return, the
          whole dashboard-configuration surface appears. */}
          {/* ── Job Hunt section (pipeline config + run) ── */}
          {currentUser && (tourActive || effectiveConfigSection === "hunt") && (
      <main id="config-start" className="max-w-7xl mx-auto px-8 md:px-16 lg:px-24 pb-20 relative z-10">
        {/* ── Error Banner ── */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-[var(--accent-red-muted)] border border-[rgba(196,82,82,0.2)] text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 ml-4">✕</button>
          </div>
        )}

        {/* ── Resume & Role ── */}
        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1 h-4 rounded-full bg-[var(--accent)] shrink-0" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">Resume & Target Role</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Resume Upload */}
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Upload Resume (PDF or TXT)</label>
              {resumeStatus?.uploaded ? (
                <div className="flex items-center gap-3 bg-[var(--bg-surface)] border border-emerald-500/20 rounded-lg px-4 py-3">
                  <span className="text-emerald-400 text-sm">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{resumeStatus.filename || "Resume uploaded"}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{resumeStatus.charCount.toLocaleString()} characters</p>
                  </div>
                  <label className="text-xs text-[var(--accent)] cursor-pointer hover:text-[var(--accent-light)] transition-colors shrink-0">
                    Replace
                    <input type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleResumeUpload(e.target.files[0])} />
                  </label>
                </div>
              ) : (
                <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg px-4 py-5 cursor-pointer transition-all ${
                  uploadingResume
                    ? "border-[var(--accent)]/30 bg-[var(--accent-muted)]"
                    : "border-[var(--border-subtle)] hover:border-[var(--accent)]/40 hover:bg-[var(--bg-surface)]"
                }`}>
                  {uploadingResume ? (
                    <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg className="w-6 h-6 text-[var(--text-ghost)] mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                      </svg>
                      <span className="text-xs text-[var(--text-tertiary)]">Drop PDF or TXT here</span>
                    </>
                  )}
                  <input type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleResumeUpload(e.target.files[0])} />
                </label>
              )}
            </div>

            {/* Expected Role */}
            {(() => {
              const hasUrl = !!config?.LINKEDIN_SEARCH_URL && config.LINKEDIN_SEARCH_URL.trim().length > 0;
              return (
                <div className={hasUrl ? "opacity-60" : ""}>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                    Expected Job Role
                    {hasUrl && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-[#6775a0]">
                        Optional · URL takes over
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={expectedRole}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    placeholder={hasUrl ? "Optional — your advanced URL drives the search" : "e.g. Software Engineer, Data Analyst"}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
                    {hasUrl
                      ? "Skipped because you've pasted an advanced URL below. Secondary sources will still use your keywords if set."
                      : "Auto-fills the keyword fields the first time. Comma-separate multiple roles."}
                  </p>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Target Countries ── */}
        {config && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-4 rounded-full bg-[var(--accent)] shrink-0" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">Target Countries</h3>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mb-4">Pick one country. Clicking a different one re-targets the pipeline to search jobs in that country.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {COUNTRY_OPTIONS.map(({ code, label, flag, desc }) => {
                // Single-select: only the first country in TARGET_COUNTRIES
                // wins for display. Legacy comma-separated values from older
                // saved configs still load without error — they collapse to
                // their first entry.
                const currentCode = (config.TARGET_COUNTRIES || "ireland").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)[0] || "ireland";
                const isActive = currentCode === code;
                return (
                  <button
                    key={code}
                    onClick={() => {
                      // Always replace — clicking a country makes it the
                      // sole selection. You can't deselect to empty.
                      if (isActive) return;
                      updateConfig("TARGET_COUNTRIES", code);
                      // Strict single-country selection. Selecting Ireland
                      // used to fan out to "ireland,uk,eu" which let UK and
                      // Netherlands jobs through. Now each country maps to
                      // ONLY itself — remote jobs are still accepted by the
                      // location filter regardless of which country is picked.
                      const regionMap: Record<string, string> = {
                        ireland:     "ireland",
                        uk:          "uk",
                        netherlands: "netherlands",
                        india:       "india",
                        newzealand:  "newzealand",
                      };
                      updateConfig("LOCATION_REGIONS", regionMap[code] || code);
                      // Don't auto-clear LINKEDIN_SEARCH_URL on country
                      // change. The pipeline now auto-merges the country's
                      // geoId into the pasted URL when the URL's geoId
                      // doesn't match (and warns the user), so silently
                      // wiping the URL surprises users who deliberately
                      // pasted a search and confuses 'why did my URL
                      // disappear when I clicked save'.
                    }}
                    className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                      isActive
                        ? "border-[var(--accent)]/40 bg-[var(--accent-muted)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]"
                    }`}
                  >
                    {/* Radio-style indicator for single-select */}
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isActive ? "border-[var(--accent)]" : "border-[var(--text-ghost)]"
                    }`}>
                      {isActive && <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-[var(--text-ghost)]">{flag}</span>
                        <span className={`text-sm font-semibold ${isActive ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>{label}</span>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── Include Remote toggle ── */}
            {/* Off by default. When off, the location filter rejects jobs
                tagged "Remote" with no country clue — only jobs physically
                located in the selected country pass. Flip on to also accept
                bare-remote listings that are open to candidates anywhere. */}
            <div className="mt-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <div>
                <div className="text-sm font-semibold text-[var(--text-secondary)]">Include remote jobs</div>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  When on, bare-remote listings (no country specified) are included alongside jobs in your selected country.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!config.INCLUDE_REMOTE}
                onClick={() => updateConfig("INCLUDE_REMOTE", !config.INCLUDE_REMOTE)}
                className={`relative shrink-0 w-11 h-6 rounded-full border transition-colors ${
                  config.INCLUDE_REMOTE
                    ? "bg-[var(--accent)] border-[var(--accent)]"
                    : "bg-[var(--bg-raised)] border-[var(--border-default)]"
                }`}
              >
                <span
                  className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    config.INCLUDE_REMOTE ? "left-[1.5rem]" : "left-[0.125rem]"
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* ── Focus Company (optional, per-run) ── */}
        {config && targetCompaniesList.length > 0 && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-4 rounded-full bg-[var(--accent)] shrink-0" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">Focus Company <span className="text-[10px] text-[var(--text-tertiary)] normal-case tracking-normal">(optional)</span></h3>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">
              Narrow this run to one company's portal. Leave on "All active" to scan every company in your library.
            </p>
            <select
              value={config.TARGET_COMPANY_ID ?? ""}
              onChange={(e) => updateConfig("TARGET_COMPANY_ID", e.target.value || (null as any))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            >
              <option value="">All active target companies ({targetCompaniesList.length})</option>
              {targetCompaniesList.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.company_name} — {c.ats_type}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--text-tertiary)] mt-2">
              Manage your library in <button onClick={() => setShowSettings(true)} className="text-[var(--accent)] hover:underline">Settings → Portals</button>.
            </p>
          </div>
        )}

        {/* Inline hint when no portals are configured yet */}
        {config && currentUser && targetCompaniesList.length === 0 && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-4 mb-6 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-tertiary)]">
              Want to focus runs on specific companies? Add them in Settings → Portals.
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
            >
              Open Settings →
            </button>
          </div>
        )}

        {/* ── Config Sections ──
            Stack into a single column until xl so the config + launch panels
            never get cramped in the narrowed (rail-offset) content area. */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          {/* Left Panel — Config */}
          <div className="xl:col-span-2 space-y-1">
            {/* Section Tabs */}
            <div className="flex gap-1 p-1 bg-[var(--bg-raised)] rounded-xl border border-[var(--border-subtle)] mb-4">
              {[
                { id: "search", label: "Search & AI" },
                { id: "limits", label: "Limits" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id)}
                  className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                    activeSection === tab.id
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {config && (
              <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6">
                {/* ── Search Section ── */}
                {activeSection === "search" && (
                  <div className="space-y-5 landing-section-enter">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-4">Search Configuration</h3>

                    {/* ── Search mode toggle ── */}
                    {/* Two mutually-exclusive ways to define the search:
                        manual = keyword builder + filters, url = paste a full
                        search URL. Only one mode's inputs (and its Apply
                        button) are shown at a time to avoid confusion. */}
                    <div className="flex gap-2 p-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
                      <button
                        type="button"
                        onClick={() => {
                          setSearchMode("manual");
                          // Don't auto-clear the URL when switching tabs —
                          // user might just be checking the keyword fields
                          // and switching back. URL persists; pipeline
                          // honors whichever (URL OR keywords) is set.
                        }}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                          searchMode === "manual"
                            ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm"
                            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        Keywords & Filters
                      </button>
                      <button
                        type="button"
                        onClick={() => setSearchMode("url")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                          searchMode === "url"
                            ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm"
                            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        Paste Search URL
                      </button>
                      <button
                        type="button"
                        onClick={() => setSearchMode("nl")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                          searchMode === "nl"
                            ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm"
                            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        }`}
                        title="Describe your search in plain English — AI populates the filters for you"
                      >
                        <span aria-hidden>✨</span> Ask AI
                      </button>
                    </div>

                    {/* ── Manual mode: keywords + filters ── */}
                    {searchMode === "manual" && (
                      <div className="space-y-5 landing-section-enter">
                        <div>
                          <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Search Keywords</label>
                          <input
                            type="text"
                            value={config.LINKEDIN_KEYWORDS}
                            onChange={(e) => {
                              userTouchedKeywordsRef.current = true;
                              updateConfig("LINKEDIN_KEYWORDS", e.target.value);
                              // Keep the secondary-source keywords in sync —
                              // they used to be a separate field, but the user
                              // should not have to maintain two keyword lists.
                              updateConfig("SEARCH_KEYWORDS", e.target.value);
                            }}
                            placeholder="data engineer, software engineer"
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                          />
                          <p className="text-xs text-[var(--text-tertiary)] mt-1">Comma-separated job titles to search for.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Time Filter</label>
                            <select
                              value={config.LINKEDIN_TIME_FILTER}
                              onChange={(e) => updateConfig("LINKEDIN_TIME_FILTER", e.target.value)}
                              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                            >
                              {TIME_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Work Type</label>
                            <select
                              value={config.LINKEDIN_WORK_TYPE}
                              onChange={(e) => updateConfig("LINKEDIN_WORK_TYPE", e.target.value)}
                              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                            >
                              {WORK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Job Type</label>
                            <select
                              value={config.LINKEDIN_JOB_TYPE}
                              onChange={(e) => updateConfig("LINKEDIN_JOB_TYPE", e.target.value)}
                              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                            >
                              {JOB_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Experience Levels</label>
                            <div className="flex flex-wrap gap-1.5">
                              {EXPERIENCE_OPTIONS.map((opt) => {
                                const selected = config.LINKEDIN_EXPERIENCE.split(",").includes(opt.value);
                                return (
                                  <button
                                    key={opt.value}
                                    onClick={() => {
                                      const current = config.LINKEDIN_EXPERIENCE.split(",").filter(Boolean);
                                      const next = selected
                                        ? current.filter((v) => v !== opt.value)
                                        : [...current, opt.value];
                                      updateConfig("LINKEDIN_EXPERIENCE", next.join(","));
                                    }}
                                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                                      selected
                                        ? "bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(201,169,78,0.3)]"
                                        : "bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)]"
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Natural-language mode ── */}
                    {searchMode === "nl" && (
                      <div className="space-y-3 landing-section-enter">
                        <div>
                          <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Describe your search</label>
                          <textarea
                            rows={3}
                            value={nlText}
                            onChange={(e) => { setNlText(e.target.value); setNlError(null); setNlApplied(null); setNlParsed(null); }}
                            placeholder={"e.g. AI engineer, AI solutions analyst, also data engineer for entry level in Dublin, remote-friendly"}
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors font-body resize-none"
                          />
                          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
                            Mention roles, location, experience level, work type. The AI extracts <strong>role titles only</strong> — company names are filtered out (they'd otherwise restrict the search to that company on LinkedIn).
                          </p>
                        </div>
                        {nlError && (
                          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                            {nlError}
                          </div>
                        )}
                        {nlApplied && (
                          <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                            {nlApplied}
                          </div>
                        )}

                        {/* Preview pane — shown after Parse, hidden again
                            after Apply. Lets the user remove rogue keywords
                            (e.g. a brand name the AI somehow let through)
                            BEFORE the values land in config + the pipeline
                            silently scrapes only that company. */}
                        {nlParsed && (
                          <div className="px-3 py-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2.5">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Preview — review before applying</div>

                            {nlParsed.dropped_keywords.length > 0 && (
                              <div className="px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]">
                                Dropped <span className="font-mono">{nlParsed.dropped_keywords.join(", ")}</span> — looked like company name(s). Add a real role title to your description and re-parse if you wanted to search by company.
                              </div>
                            )}

                            <div>
                              <div className="text-[11px] text-[var(--text-secondary)] mb-1">Keywords</div>
                              <div className="flex flex-wrap gap-1.5">
                                {nlParsed.keywords.length === 0 && (
                                  <span className="text-[11px] text-[var(--text-ghost)] italic">No role titles extracted — your description should mention at least one role.</span>
                                )}
                                {nlParsed.keywords.map((k, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(201,169,78,0.3)] text-[11px]">
                                    {k}
                                    <button
                                      type="button"
                                      onClick={() => setNlParsed((p) => p ? { ...p, keywords: p.keywords.filter((_, j) => j !== i) } : p)}
                                      className="text-[var(--accent)]/60 hover:text-[var(--accent)] text-xs"
                                      title="Remove this keyword"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                              <div>
                                <div className="text-[var(--text-secondary)] mb-0.5">Country</div>
                                <div className="text-[var(--text-primary)]">{nlParsed.country ?? <span className="text-[var(--text-ghost)] italic">(none)</span>}</div>
                              </div>
                              <div>
                                <div className="text-[var(--text-secondary)] mb-0.5">Experience</div>
                                <div className="text-[var(--text-primary)]">
                                  {nlParsed.experience_levels.length === 0
                                    ? <span className="text-[var(--text-ghost)] italic">(any)</span>
                                    : nlParsed.experience_levels.map((v) => ({ "1": "Intern", "2": "Entry", "3": "Associate", "4": "Mid-Senior", "5": "Director", "6": "Executive" } as Record<string, string>)[v] || v).join(", ")
                                  }
                                </div>
                              </div>
                              <div>
                                <div className="text-[var(--text-secondary)] mb-0.5">Work type</div>
                                <div className="text-[var(--text-primary)]">
                                  {nlParsed.work_type ? ({ "1": "On-site", "2": "Remote", "3": "Hybrid" } as Record<string, string>)[nlParsed.work_type] : <span className="text-[var(--text-ghost)] italic">(any)</span>}
                                </div>
                              </div>
                              <div>
                                <div className="text-[var(--text-secondary)] mb-0.5">Time</div>
                                <div className="text-[var(--text-primary)]">
                                  {nlParsed.time_filter ? ({ r86400: "Past 24h", r604800: "Past Week", r2592000: "Past Month" } as Record<string, string>)[nlParsed.time_filter] : <span className="text-[var(--text-ghost)] italic">(any)</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                disabled={nlParsed.keywords.length === 0}
                                onClick={() => {
                                  const p = nlParsed;
                                  if (p.keywords.length > 0) {
                                    const kw = p.keywords.join(", ");
                                    updateConfig("LINKEDIN_KEYWORDS", kw);
                                    updateConfig("SEARCH_KEYWORDS", kw);
                                  }
                                  if (p.country) {
                                    updateConfig("TARGET_COUNTRIES", p.country as PipelineConfig["TARGET_COUNTRIES"]);
                                    const regionMap: Record<string, string> = {
                                      ireland: "ireland", uk: "uk", netherlands: "netherlands",
                                      india: "india", newzealand: "newzealand",
                                    };
                                    updateConfig("LOCATION_REGIONS", regionMap[p.country] || p.country);
                                  }
                                  if (p.experience_levels.length > 0) {
                                    updateConfig("LINKEDIN_EXPERIENCE", p.experience_levels.join(","));
                                  }
                                  if (p.work_type) {
                                    updateConfig("LINKEDIN_WORK_TYPE", p.work_type);
                                  }
                                  if (p.time_filter) {
                                    updateConfig("LINKEDIN_TIME_FILTER", p.time_filter);
                                  }
                                  setNlApplied("Settings updated. Switch to Keywords & Filters tab to review the populated fields, or click Perform Job Hunt to start.");
                                  setNlParsed(null);
                                }}
                                className="flex-1 launch-btn rounded-xl py-2.5 px-4 font-medium text-sm transition-all disabled:opacity-50"
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                onClick={() => { setNlParsed(null); setNlApplied(null); setNlError(null); }}
                                className="px-4 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] text-sm transition-all"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {!nlParsed && (
                          <button
                            type="button"
                            disabled={nlParsing || !nlText.trim()}
                            onClick={async () => {
                              setNlParsing(true);
                              setNlError(null);
                              setNlApplied(null);
                              try {
                                const parsed = await parseSearchText(nlText);
                                setNlParsed({
                                  keywords: parsed.keywords,
                                  country: parsed.country,
                                  experience_levels: parsed.experience_levels,
                                  work_type: parsed.work_type,
                                  time_filter: parsed.time_filter,
                                  dropped_keywords: parsed.dropped_keywords ?? [],
                                });
                              } catch (err: any) {
                                setNlError(err?.message || "Parse failed. Try again.");
                              } finally {
                                setNlParsing(false);
                              }
                            }}
                            className="w-full launch-btn rounded-xl py-2.5 px-4 font-medium text-sm transition-all disabled:opacity-50"
                          >
                            {nlParsing ? "Parsing…" : "✨ Parse"}
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── URL mode: single paste field ── */}
                    {searchMode === "url" && (
                      <div className="space-y-3 landing-section-enter">
                        <div>
                          <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Search URL</label>
                          <input
                            type="text"
                            value={config.LINKEDIN_SEARCH_URL}
                            onChange={(e) => updateConfig("LINKEDIN_SEARCH_URL", e.target.value)}
                            placeholder="https://..."
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                          />
                          <p className="text-xs text-[var(--text-tertiary)] mt-1">
                            Paste a full job-search URL from your preferred job board. It will be used verbatim for the primary source — keywords and filters are ignored in this mode.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ── AI Tuning (merged into Search) ── */}
                    <div className="h-px bg-[var(--border-subtle)] my-6" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-4" id="ai-tuning">AI Tuning</h3>

                    {/* Relevancy Score Threshold */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-[var(--text-secondary)]">Minimum match score</label>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            config.RELEVANCE_SCORE_THRESHOLD <= 3 ? "bg-emerald-500/10 text-emerald-400" :
                            config.RELEVANCE_SCORE_THRESHOLD <= 6 ? "bg-amber-500/10 text-amber-400" :
                            "bg-orange-500/10 text-orange-400"
                          }`}>
                            {config.RELEVANCE_SCORE_THRESHOLD <= 3 ? "Loose" : config.RELEVANCE_SCORE_THRESHOLD <= 6 ? "Balanced" : "Strict"}
                          </span>
                          <span className="text-lg font-mono font-bold text-[var(--accent)]">{config.RELEVANCE_SCORE_THRESHOLD}</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={config.RELEVANCE_SCORE_THRESHOLD}
                        onChange={(e) => updateConfig("RELEVANCE_SCORE_THRESHOLD", parseInt(e.target.value))}
                        className="landing-slider w-full"
                      />
                      <div className="flex justify-between text-[10px] text-[var(--text-ghost)] mt-1">
                        <span>1 · show everything</span>
                        <span>5 · fair matches</span>
                        <span>10 · only perfect fits</span>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-2">
                        {config.RELEVANCE_SCORE_THRESHOLD <= 3
                          ? "You'll see almost every scraped job. Good for exploring a new market."
                          : config.RELEVANCE_SCORE_THRESHOLD <= 6
                          ? "Balanced filter. Keeps jobs that match at least half your criteria."
                          : "Only tightly-matching jobs pass. Fewer results, but each one is worth applying to."}
                      </p>
                    </div>

                    {/* Tailoring Intensity */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-[var(--text-secondary)]">Resume Tailoring Intensity</label>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            config.TAILORING_INTENSITY <= 3 ? "bg-emerald-500/10 text-emerald-400" :
                            config.TAILORING_INTENSITY <= 6 ? "bg-amber-500/10 text-amber-400" :
                            config.TAILORING_INTENSITY <= 9 ? "bg-orange-500/10 text-orange-400" :
                            "bg-red-500/10 text-red-400"
                          }`}>
                            {config.TAILORING_INTENSITY <= 3 ? "Light" : config.TAILORING_INTENSITY <= 6 ? "Balanced" : config.TAILORING_INTENSITY <= 9 ? "Aggressive" : "Mirror Mode"}
                          </span>
                          <span className="text-lg font-mono font-bold text-[var(--accent)]">{config.TAILORING_INTENSITY}</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={config.TAILORING_INTENSITY}
                        onChange={(e) => updateConfig("TAILORING_INTENSITY", parseInt(e.target.value))}
                        className="landing-slider w-full"
                      />
                      <div className="flex justify-between text-[10px] text-[var(--text-ghost)] mt-1">
                        <span>1 · gentle polish</span>
                        <span>5 · rewrite for the role</span>
                        <span>10 · mirror the JD</span>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-2">
                        {config.TAILORING_INTENSITY <= 3
                          ? "Keeps your wording almost as-is. Light keyword nudges only."
                          : config.TAILORING_INTENSITY <= 6
                          ? "Rewrites bullets in the job's language. Your voice stays intact."
                          : config.TAILORING_INTENSITY <= 9
                          ? "Heavy rewrite. Every bullet carries target keywords, skills section is reordered for the role."
                          : "Mirror mode. Fabricates plausible metrics and tools to hit 90%+ keyword match. Titles, companies, dates and certifications stay locked."}
                      </p>
                      {config.TAILORING_INTENSITY === 10 && (
                        <div className="mt-3 px-3 py-2.5 rounded-lg text-[11px] bg-red-500/10 border border-red-500/30 text-red-400 leading-relaxed">
                          <strong className="font-semibold">Mirror-mode warning.</strong> Intensity 10 will fabricate plausible metrics, tools, and projects to try and match the JD. Your ATS score goes up, but recruiters who screen dozens of CVs a day spot JD-mirroring instantly and it reads as lazy or manipulative. Stay at 7-9 for aggressive tailoring without the fabrication tax.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Limits Section ── */}
                {activeSection === "limits" && (
                  <div className="space-y-5 landing-section-enter">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-4">Pipeline Limits</h3>

                    {/* Enterprise tier selection lives on the Pricing page
                        now (it's a paid tier choice). Non-enterprise users
                        just see the numeric caps below. Enterprise users
                        who want to change their tier should visit Pricing. */}
                    {currentUser?.plan === "enterprise" && (
                      <div className="bg-gradient-to-br from-[rgba(93,117,160,0.08)] to-transparent border border-[rgba(93,117,160,0.2)] rounded-xl p-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-[var(--text-secondary)]">
                          You're on <span className="font-semibold text-[#6775a0]">Enterprise Tier {config.ENTERPRISE_TIER ?? 3}</span> ({maxJobsToScrape} scraped · {maxResumesToTailor} tailored per day).
                        </p>
                        <button
                          onClick={onNavigateToPricing}
                          className="text-xs font-medium text-[#6775a0] hover:underline shrink-0"
                        >
                          Change tier →
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                          Target relevant jobs
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-[var(--accent)]">
                            max {maxJobsToScrape} ({currentUser?.plan ?? "free"}{isEnterprise ? ` · tier ${currentTier}` : ""})
                          </span>
                        </label>
                        <input
                          type="number"
                          value={config.APIFY_JOB_COUNT}
                          onChange={(e) => {
                            const raw = e.target.value === "" ? 0 : parseInt(e.target.value);
                            // Hard cap at the plan ceiling on every keystroke
                            // so typing "999" immediately collapses to the
                            // plan's max. Server also enforces this, but the
                            // UI should never let the user think a higher
                            // value is possible.
                            const clamped = Math.min(raw, maxJobsToScrape);
                            updateConfig("APIFY_JOB_COUNT", clamped);
                          }}
                          onBlur={(e) => {
                            const v = parseInt(e.target.value);
                            if (!e.target.value || isNaN(v) || v < 1) {
                              updateConfig("APIFY_JOB_COUNT", Math.min(1, maxJobsToScrape));
                            }
                          }}
                          min={1}
                          max={maxJobsToScrape}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                        />
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">
                          Jobs you want <em>after</em> the AI filter. We scrape ~3× this many so enough survive the relevance check.{" "}
                          <button onClick={onNavigateToPricing} className="text-[var(--accent)] hover:underline">
                            Upgrade for more
                          </button>
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                          Max Resumes to Tailor
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-[var(--accent)]">
                            max {maxResumesToTailor} ({currentUser?.plan ?? "free"}{isEnterprise ? ` · tier ${currentTier}` : ""})
                          </span>
                        </label>
                        <input
                          type="number"
                          value={config.MAX_TAILOR_COUNT}
                          onChange={(e) => {
                            const raw = e.target.value === "" ? 0 : parseInt(e.target.value);
                            const clamped = Math.min(raw, maxResumesToTailor);
                            updateConfig("MAX_TAILOR_COUNT", clamped);
                          }}
                          onBlur={(e) => {
                            const v = parseInt(e.target.value);
                            if (!e.target.value || isNaN(v) || v < 1) {
                              updateConfig("MAX_TAILOR_COUNT", Math.min(1, maxResumesToTailor));
                            }
                          }}
                          min={1}
                          max={maxResumesToTailor}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                        />
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">
                          Top N jobs get tailored resumes.{" "}
                          <button onClick={onNavigateToPricing} className="text-[var(--accent)] hover:underline">
                            Upgrade for more
                          </button>
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Max Job Age (days)</label>
                      <input
                        type="number"
                        value={config.MAX_AGE_DAYS}
                        onChange={(e) => updateConfig("MAX_AGE_DAYS", e.target.value === "" ? 0 : parseInt(e.target.value))}
                        onBlur={(e) => { if (!e.target.value || parseInt(e.target.value) < 1) updateConfig("MAX_AGE_DAYS", 14); }}
                        min={1}
                        max={90}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                      />
                      <p className="text-xs text-[var(--text-tertiary)] mt-1">Discard postings older than this</p>
                    </div>
                  </div>
                )}

                {/* Save button */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="px-5 py-2 rounded-lg text-sm font-medium bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-all disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Configuration"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel — Launch */}
          <div className="space-y-4">
            {/* Daily Usage Card */}
            {usage && limits && (
              <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-3">Today's Usage</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
                      <span>Jobs Scraped</span>
                      <span className="font-mono">{usage.jobs_scraped}/{limits.jobs_scraped}</span>
                    </div>
                    <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${Math.min(100, (usage.jobs_scraped / limits.jobs_scraped) * 100)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
                      <span>Resumes Tailored</span>
                      <span className="font-mono">{usage.resumes_tailored}/{limits.resumes_tailored}</span>
                    </div>
                    <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, (usage.resumes_tailored / limits.resumes_tailored) * 100)}%` }} />
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--text-ghost)]">Resets daily at midnight</p>
                </div>
              </div>
            )}

            {/* Launch Card */}
            <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-4">Pipeline Control</h3>

              {!running ? (
                <button
                  data-tour="start-pipeline"
                  onClick={handleStartPipeline}
                  disabled={!config || starting}
                  className="w-full relative group overflow-hidden rounded-xl py-4 px-6 font-semibold text-base transition-all duration-300 disabled:opacity-80 disabled:cursor-wait launch-btn"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {starting ? (
                      <>
                        <span className="inline-block w-4 h-4 rounded-full border-2 border-[#0c0e14] border-t-transparent animate-spin" />
                        Starting pipeline…
                      </>
                    ) : (
                      <>
                        <span className="text-lg">▶</span>
                        Perform Job Hunt
                      </>
                    )}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleStopPipeline}
                  className="w-full rounded-xl py-4 px-6 font-semibold text-base bg-[var(--accent-red-muted)] border border-[rgba(196,82,82,0.3)] text-red-400 hover:bg-[rgba(196,82,82,0.2)] transition-all"
                >
                  <span className="flex items-center justify-center gap-2">
                    <span>■</span>
                    Stop Pipeline
                  </span>
                </button>
              )}

              {pipelineComplete && (
                <p className="text-xs text-[var(--text-tertiary)] mt-3 text-center">
                  Pipeline finished — save config or re-run.
                </p>
              )}
            </div>

            {/* Pipeline Steps Tracker */}
            {(running || pipelineComplete || logs.length > 0) && (
              <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-4">Progress</h3>
                <div className="space-y-1">
                  {PIPELINE_STEPS.map((step, i) => {
                    const status = getStepStatus(step.id);
                    return (
                      <div key={step.id} className="flex items-center gap-3 py-1.5">
                        {/* Step indicator */}
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 transition-all duration-300 ${
                          status === "done"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : status === "active"
                            ? "bg-[var(--accent-muted)] text-[var(--accent)] ring-2 ring-[rgba(201,169,78,0.3)] step-pulse"
                            : "bg-[var(--bg-surface)] text-[var(--text-ghost)]"
                        }`}>
                          {status === "done" ? "✓" : status === "active" ? step.icon : (i + 1)}
                        </div>
                        <span className={`text-sm transition-colors ${
                          status === "done"
                            ? "text-[var(--text-secondary)]"
                            : status === "active"
                            ? "text-[var(--text-primary)] font-medium"
                            : "text-[var(--text-ghost)]"
                        }`}>
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dashboard nav while pipeline is running */}
            {running && (
              <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-5 landing-section-enter">
                <p className="text-xs text-[var(--text-secondary)] mb-3">
                  Jobs appear in your dashboard as the pipeline finds them.
                </p>
                <button
                  onClick={onNavigateToDashboard}
                  className="w-full rounded-xl py-3 px-4 font-medium text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all flex items-center justify-center gap-2"
                >
                  View Dashboard Live
                  <span>→</span>
                </button>
              </div>
            )}

            {/* Dashboard CTA after completion */}
            {pipelineComplete && (() => {
              // Three completion states, in priority order:
              //   noMatch         — pipeline found zero relevant jobs
              //   limitedMatches  — fewer than the target survived the filter
              //   success         — target met (or no target comparison available)
              const noMatch = logs.some((l) => {
                const m = l.message || "";
                // The pipeline's actual zero-result emits (the old
                // "no matching jobs found" string was never emitted, so a
                // 0-match run wrongly fell through to the success card).
                return m.includes("No relevant jobs to tailor")
                  || m.includes("No jobs in target locations")
                  || m.includes("no matching jobs found");
              });
              // Pipeline emits: "Only N quality job(s) passed the AI filter for your role (target: T)."
              const limitedLog = logs
                .map((l) => l.message || "")
                .find((m) => /Only \d+ quality jobs? passed the AI filter/.test(m));
              const limitedMatch = limitedLog ? limitedLog.match(/Only (\d+) quality jobs?/) : null;
              const limitedCount = limitedMatch ? parseInt(limitedMatch[1], 10) : 0;

              if (noMatch) {
                return (
                  <div className="bg-gradient-to-br from-[rgba(196,82,82,0.06)] to-transparent border border-[rgba(196,82,82,0.15)] rounded-2xl p-6 landing-section-enter">
                    <h4 className="text-sm font-semibold text-[var(--accent-red)] mb-2">No matching jobs found</h4>
                    <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                      The pipeline scraped jobs but none matched your profile at the current relevancy threshold. Try:
                    </p>
                    <ul className="text-xs text-[var(--text-tertiary)] space-y-1 mb-4 list-disc list-inside">
                      <li>Lowering the relevancy score threshold</li>
                      <li>Broadening your search keywords</li>
                      <li>Adding more job sources</li>
                      <li>Changing the time filter to "Past week"</li>
                    </ul>
                    <button onClick={() => {
                      setActiveSection("search");
                      setTimeout(() => document.getElementById("ai-tuning")?.scrollIntoView({ behavior: "smooth" }), 100);
                    }}
                      className="w-full rounded-xl py-3 px-4 font-medium text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                      Adjust Search & AI Tuning
                    </button>
                  </div>
                );
              }

              if (limitedLog) {
                return (
                  <div className="bg-gradient-to-br from-[rgba(217,160,71,0.08)] to-transparent border border-[rgba(217,160,71,0.25)] rounded-2xl p-6 landing-section-enter">
                    <h4 className="text-sm font-semibold text-[#d9a047] mb-2">Limited matches for your role</h4>
                    <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                      We scraped extensively but only <span className="font-semibold text-[var(--text-primary)]">{limitedCount}</span> {limitedCount === 1 ? "job" : "jobs"} for your current filters scored high enough to be worth tailoring. Try:
                    </p>
                    <ul className="text-xs text-[var(--text-tertiary)] space-y-1 mb-4 list-disc list-inside">
                      <li>Lowering the relevancy score threshold</li>
                      <li>Broadening your search keywords</li>
                      <li>Switching country (Ireland, UK, Netherlands, India)</li>
                    </ul>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={onNavigateToDashboard}
                        className="flex-1 rounded-xl py-3 px-4 font-medium text-sm bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] text-[var(--accent)] hover:bg-[rgba(201,169,78,0.2)] transition-all flex items-center justify-center gap-2"
                      >
                        Open Dashboard
                        <span>→</span>
                      </button>
                      <button onClick={() => {
                        setActiveSection("search");
                        setTimeout(() => document.getElementById("ai-tuning")?.scrollIntoView({ behavior: "smooth" }), 100);
                      }}
                        className="flex-1 rounded-xl py-3 px-4 font-medium text-sm bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                        Adjust Search & AI Tuning
                      </button>
                    </div>
                  </div>
                );
              }

              // Default success card
              const completeLog = logs.find((l) => l.type === "complete");
              const completeMsg = completeLog?.message || "";
              return (
                <div className="bg-gradient-to-br from-[rgba(201,169,78,0.06)] to-[rgba(201,169,78,0.02)] border border-[rgba(201,169,78,0.15)] rounded-2xl p-6 landing-section-enter">
                  <h4 className="text-sm font-semibold text-[var(--accent)] mb-2">Jobs are ready!</h4>
                  <p className="text-xs text-[var(--text-secondary)] mb-4">
                    {completeMsg.includes("relevant") ? completeMsg.replace("Pipeline completed successfully — ", "") + "." : "Your scored and tailored jobs are now in the Kanban dashboard."} Drag them through your application workflow.
                  </p>
                  <button
                    onClick={onNavigateToDashboard}
                    className="w-full rounded-xl py-3 px-4 font-medium text-sm bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] text-[var(--accent)] hover:bg-[rgba(201,169,78,0.2)] transition-all flex items-center justify-center gap-2"
                  >
                    Open Dashboard
                    <span>→</span>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Live Log Terminal ── */}
        {(running || logs.length > 0) && (
          <div className="mt-4 mb-12">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                Live Output
                {running && <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
              </h3>
              <span className="text-xs text-[var(--text-tertiary)] font-mono">{logs.length} lines</span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mb-3">
              A live activity log of the pipeline as it scrapes, scores, and tailors resumes. You can safely ignore it, or watch it work. Matched jobs land on your Pipeline Board as they're found.
            </p>
            <div className="bg-[#0a0c10] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
              <div className="h-72 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
                {logs.map((log, i) => (
                  <div key={i} className={`${getLogColor(log.type)} py-0.5`}>
                    <span className="text-[var(--text-ghost)] mr-2 select-none">
                      {new Date(log.time).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                    {log.type === "step" && <span className="text-cyan-500 font-bold mr-1">{">>>"}</span>}
                    {log.type === "success" && <span className="text-emerald-500 mr-1">{"  ✓"}</span>}
                    {log.type === "warn" && <span className="text-amber-500 mr-1">{"  ⚠"}</span>}
                    {log.type === "error" && <span className="text-red-500 mr-1">{"  ✗"}</span>}
                    {log.type === "skip" && <span className="text-gray-600 mr-1">{"  ○"}</span>}
                    {log.message}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* ── Dashboard Hint (always visible) ── */}
        {!pipelineComplete && !running && (
          <div className="mt-12 text-center">
            <p className="text-sm text-[var(--text-tertiary)]">
              Already have jobs in the pipeline?{" "}
              <button
                onClick={onNavigateToDashboard}
                className="text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors underline underline-offset-2 decoration-[rgba(201,169,78,0.3)]"
              >
                Go to Kanban Dashboard
              </button>
            </p>
          </div>
        )}
      </main>
          )}

        </div>
      </div>
      )}
    </div>
  );
}
