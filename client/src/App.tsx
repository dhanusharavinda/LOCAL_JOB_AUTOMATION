import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Job, JobStatus, COLUMNS } from "./types";
import { fetchJobs, updateJobStatus, batchDeleteJobs, toggleJobFlag, checkExpiry, authMe, AuthUser, LimitsInfo } from "./api";
import { supabase, getCurrentAccessToken } from "./supabaseClient";
import { startLandingTour, startDashboardTour, getTourState } from "./onboarding/tour";
import KanbanBoard from "./components/KanbanBoard";
import JobDetailModal from "./components/JobDetailModal";
import AddJobModal from "./components/AddJobModal";
import SkillsTrendModal from "./components/SkillsTrendModal";
import CareerEventsModal from "./components/CareerEventsModal";
import CareerCoachModal from "./components/CareerCoachModal";
import JobMatchesModal from "./components/JobMatchesModal";
import Sidebar from "./components/Sidebar";
import SettingsModal from "./components/SettingsModal";
import StoryBankModal from "./components/StoryBankModal";
import ApplyProfileEditor from "./components/ApplyProfileEditor";
import ContactUsButton from "./components/ContactUsButton";
import ExtensionAuthBridge from "./components/ExtensionAuthBridge";
import InterviewSession from "./components/InterviewSession";
import LandingPage from "./components/LandingPage";
import AuthPage from "./components/AuthPage";
import PricingPage from "./components/PricingPage";
import WaitlistScreen from "./components/WaitlistScreen";
import AdminPage from "./components/AdminPage";
import InviteGate from "./components/InviteGate";
import LaunchHome from "./components/LaunchHome";
import CreatorPage from "./components/CreatorPage";
import ResetPassword from "./components/ResetPassword";
import { captureInviteFromUrl, clearStoredInvite } from "./invite";
import CandidatesPage from "./components/CandidatesPage";

interface ConfirmDialog {
  title: string;
  message: string;
  onConfirm: () => void;
}

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [introFading, setIntroFading] = useState(false);
  const [page, setPage] = useState<"landing" | "dashboard" | "auth" | "pricing" | "candidates" | "admin" | "creator">("landing");
  const [activeCandidateId, setActiveCandidateId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  // Invite-only launch. The token from an /invite/<token> link is kept
  // (in localStorage too) until the signed-in user redeems it.
  const [inviteToken, setInviteToken] = useState<string | null>(() => captureInviteFromUrl());
  // True once the persisted Supabase session has been checked, so a
  // returning user never sees the signed-out invite screen flash first.
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  // The plan-derived limits from GET /api/auth/me. Drives client-side
  // clamping of slider maxes so a Free user can't nudge "Jobs to Scrape"
  // past 5. Refreshed whenever currentUser changes (login, plan switch,
  // token refresh).
  const [userLimits, setUserLimits] = useState<LimitsInfo | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // sortByScore + its UI button were removed (numeric score isn't
  // displayed on the kanban card anymore - only the letter grade - 
  // so a numeric sort was redundant with Grade sort and confusing).
  // The raw match_score still drives the final tiebreak inside Grade
  // and Seniority sorts.
  // Default the board to Grade (relevance-first) so the best-fit jobs float
  // to the top out of the box. Deadline is usually empty on scraped jobs, so
  // defaulting to it made the board look unsorted.
  const [sortByDeadline, setSortByDeadline] = useState(false);
  const [sortByFreshness, setSortByFreshness] = useState(false);
  const [sortByGrade, setSortByGrade] = useState(true);
  // Seniority sort is tri-state - single button that cycles
  // off → high (most senior first) → low (least senior first) → off.
  // Other sorts are binary; this one needs both directions because the
  // user might want to find graduate roles OR director roles depending
  // on context.
  const [sortBySeniority, setSortBySeniority] = useState<"off" | "high" | "low">("off");
  const [locationFilter, setLocationFilter] = useState<string>("");
  // Separate work-type filter - remote/hybrid/onsite. Cross-cuts the
  // country filter so a user can e.g. see only UK + remote jobs.
  const [workTypeFilter, setWorkTypeFilter] = useState<"" | "remote" | "hybrid" | "onsite">("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [showAddJob, setShowAddJob] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dateFilter, setDateFilter] = useState<string>(new Date().toISOString().split("T")[0]); // default to today
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [expiryChecking, setExpiryChecking] = useState(false);
  const [showStoryBank, setShowStoryBank] = useState(false);
  const [showApplyProfile, setShowApplyProfile] = useState(false);
  const [showCoach, setShowCoach] = useState(false);
  const [showMatches, setShowMatches] = useState(false);
  // Mobile drawer for the new left sidebar nav (desktop shows it statically).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showInterview, setShowInterview] = useState(false);
  const [interviewJobId, setInterviewJobId] = useState<number | null>(null);

  // JobDetailModal emits this event when the user clicks "Practice for this role".
  // Done via DOM event to avoid threading another prop through the modal hierarchy.
  // Also closes the JobDetailModal so the InterviewSession isn't stacked under it.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ jobId: number }>;
      if (typeof ce.detail?.jobId === "number") {
        setSelectedJob(null);
        setInterviewJobId(ce.detail.jobId);
        setShowInterview(true);
      } else {
        // No jobId means "general practice" trigger from the landing page.
        setInterviewJobId(null);
        setShowInterview(true);
      }
    };
    window.addEventListener("go-candid8/practice-interview", handler);
    return () => window.removeEventListener("go-candid8/practice-interview", handler);
  }, []);
  // Mobile: toggles the collapsed secondary header rows (filters + actions)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Intro loader - show for 3s then fade out
  useEffect(() => {
    const fadeTimer = setTimeout(() => setIntroFading(true), 2500);
    const hideTimer = setTimeout(() => setShowIntro(false), 3200);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  // Restore session on mount via Supabase. supabase-js already read the
  // persisted session from localStorage before this runs, so we can just
  // ask it for getSession() and, if a session exists, hit /api/auth/me
  // to get the server-side profile (numeric id + plan).
  //
  // We also subscribe to onAuthStateChange so that sign-in and sign-out
  // from anywhere in the app (AuthPage, the logout button, or silent
  // token refresh failure) keep currentUser in sync here.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        if (data.session) {
          try {
            const me = await authMe();
            if (mounted) { setCurrentUser(me.user); setUserLimits(me.limits); }
          } catch {
            // Token was stale or server rejected it; sign out cleanly.
            await supabase.auth.signOut();
            if (mounted) { setCurrentUser(null); setUserLimits(null); }
          }
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Guard against state updates after unmount - supabase-js can
      // queue a callback during token refresh that fires a tick after
      // we've already cleaned up, which triggers React's "setState on
      // unmounted component" warning. Cheap bail-out.
      if (!mounted) return;
      if (event === "SIGNED_OUT" || !session) {
        setCurrentUser(null);
        setUserLimits(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        try {
          const me = await authMe();
          if (!mounted) return;
          setCurrentUser(me.user);
          setUserLimits(me.limits);
        } catch (err) {
          // /me failed - common cause is the server being cold-started
          // on Railway. Log so a persistent issue is visible in the
          // console; leave state as-is so the user isn't forcibly
          // signed out on a transient network blip.
          console.warn("[auth] /me refresh after", event, "failed:", (err as Error).message);
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // A user who already has access (admin, or early access still active)
  // keeps any invite link they opened unused, so it can go to someone else.
  useEffect(() => {
    if (!inviteToken || !currentUser) return;
    if (currentUser.is_admin || currentUser.access_state === "active") {
      clearStoredInvite();
      setInviteToken(null);
    }
  }, [currentUser, inviteToken]);

  // Map of job_id → the optimistic local row the user just produced
  // (via drag, flag toggle, or any other inline mutation). loadJobs
  // checks this before overwriting state so the 30s background poll
  // can't snap a freshly-dragged card back to its server-side status.
  //
  // Without this guard the sequence was:
  //   t+0ms   user drags card → setJobs optimistic update
  //   t+10ms  handleDragEnd starts PATCH
  //   t+100ms 30s poll's in-flight GET returns with OLD status
  //   t+101ms setJobs(data) overrides → card snaps back
  //   t+500ms PATCH response arrives → setJobs again → card snaps forward
  // Net visible effect: 10s of "boomerang" lag the user complained about.
  const pendingMutationsRef = useRef<Map<number, Job>>(new Map());

  const loadJobs = useCallback(async () => {
    try {
      const url = activeCandidateId
        ? `/api/jobs?candidate_id=${activeCandidateId}`
        : "/api/jobs";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      const data: Job[] = await res.json();
      // Merge: for any job currently mid-flight in an optimistic
      // mutation, keep the local row instead of the server snapshot.
      const pending = pendingMutationsRef.current;
      const merged = pending.size === 0
        ? data
        : data.map((j) => (pending.has(j.id) ? pending.get(j.id)! : j));
      setJobs(merged);
      setError(null);
    } catch {
      setError("Failed to load jobs. Is the server running on port 3001?");
    } finally {
      setLoading(false);
    }
  }, [activeCandidateId]);

  useEffect(() => {
    if (page !== "dashboard") return;
    // Guard on currentUser so we don't race the Supabase session restore
    // and fire an authenticated /api/jobs call before the token cache is
    // seeded (would 401 and briefly blank the board on refresh).
    if (!currentUser) return;
    loadJobs();
    const interval = setInterval(loadJobs, 30000);
    return () => clearInterval(interval);
  }, [loadJobs, page, currentUser]);

  // Live refresh - subscribe to the pipeline SSE stream so the kanban
  // updates as jobs land. Previously the dashboard only polled every
  // 30s, so a pipeline finishing seconds after the last poll left the
  // board stale until the next tick (or until the user manually
  // refreshed). We listen for two signals:
  //   - "Posted: <title> @ <company>" success messages → debounced
  //     refresh as jobs trickle in during the run.
  //   - type === "complete" → immediate refresh + one delayed catch-up
  //     500ms later in case the final DB inserts hadn't committed
  //     when the SSE event fired.
  // EventSource auto-reconnects on transient drops; we close + reopen
  // when page / user changes. The 30s poll above stays as a safety net.
  useEffect(() => {
    if (page !== "dashboard") return;
    if (!currentUser) return;

    const token = getCurrentAccessToken();
    const url = token
      ? `/api/pipeline/events?access_token=${encodeURIComponent(token)}`
      : "/api/pipeline/events";
    const es = new EventSource(url);

    let pending: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { loadJobs(); pending = null; }, 800);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; message?: string };
        if (data.type === "complete") {
          loadJobs();
          setTimeout(loadJobs, 500);
          return;
        }
        if (data.type === "success" && typeof data.message === "string" && /Posted:/i.test(data.message)) {
          refreshSoon();
        }
      } catch { /* ignore parse errors */ }
    };
    // EventSource fires onerror for both transient hiccups (auto-
    // reconnects) and terminal failures. We don't surface errors on
    // the dashboard - the 30s poll keeps the board fresh either way.
    es.onerror = () => { /* silent - polling fallback covers it */ };

    return () => {
      if (pending) clearTimeout(pending);
      es.close();
    };
  }, [page, currentUser, loadJobs]);

  // ── First-run onboarding tour ──────────────────────────────────────
  // Two-phase tour: landing page first, then dashboard. Trigger logic:
  //
  //   - On landing, if the signed-in user has never been onboarded
  //     (server flag is null) AND no tour is currently running, start
  //     the landing tour.
  //   - On dashboard, if sessionStorage says "dashboard" (the landing
  //     tour's last step queued us here), start the dashboard tour
  //     once jobs have loaded so the kanban columns exist in the DOM.
  //
  // Uses refs-via-hasStarted-style local flag to avoid double-firing
  // when effect deps change while the tour is already running.
  useEffect(() => {
    if (!currentUser) return;
    if (!currentUser.is_admin) return; // early-access home has no tour anchors
    if (currentUser.onboarded_at) return; // already done on another device
    if (page !== "landing") return;
    if (getTourState()) return; // already running or queued for dashboard

    // Don't start the onboarding tour while the FreeTailor bait flow is
    // mid-execution - e.g. the user just signed up via the modal and the
    // auto-tailor is running. The section sets a window-level flag while
    // it's busy and clears it when the result is shown. We poll every
    // 500ms until the flag is gone, then kick off the tour.
    const poll = setInterval(() => {
      if ((window as any).__freeTailorBusy) return;
      clearInterval(poll);
      // Extra settle delay so the result PDF / UI is fully painted.
      setTimeout(() => {
        if (!getTourState()) {
          startLandingTour({ onNavigateToDashboard: () => setPage("dashboard") });
        }
      }, 800);
    }, 500);
    return () => clearInterval(poll);
  }, [currentUser, page]);

  useEffect(() => {
    if (!currentUser) return;
    if (!currentUser.is_admin) return;
    if (currentUser.onboarded_at) return;
    if (page !== "dashboard") return;
    if (getTourState() !== "dashboard") return;
    if (loading) return; // wait for jobs to load so kanban DOM exists
    const t = setTimeout(() => {
      startDashboardTour();
    }, 500);
    return () => clearTimeout(t);
  }, [currentUser, page, loading]);

  // Filter by search query.
  //
  // MEMOIZED. Before this useMemo, every setJobs() - including the
  // optimistic update on every drag + flag - re-ran the entire filter
  // pipeline AND the sort pipeline below, AND every kanban card
  // re-rendered. With a few hundred jobs the synchronous work blocked
  // the event loop for seconds, producing the 5-10s "lag" the user
  // saw after clicking flag / dragging a card. Now the heavy chain
  // only re-runs when its actual inputs change, and unchanged cards
  // skip re-render via React.memo on JobCard.
  const searched = useMemo(() => jobs.filter((j) => {
    if (searchQuery) {
      // Trim whitespace + guard every field. Manually-tracked rows from
      // the extension can land in the DB with null/empty title or
      // company; an unguarded .toLowerCase() throws and the entire
      // memoized filter aborts, leaving the board blank.
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const title = (j.job_title || "").toLowerCase();
        const company = (j.company_name || "").toLowerCase();
        const location = (j.location || "").toLowerCase();
        if (!title.includes(q) && !company.includes(q) && !location.includes(q)) return false;
      }
    }
    // Country filter - the five markets supported end-to-end (pipeline,
    // events, skills). Each option matches the country plus its major
    // cities so a job tagged "Dublin" still surfaces under "Ireland".
    if (locationFilter) {
      const loc = (j.location || "").toLowerCase();
      if (locationFilter === "ireland") {
        if (!/ireland|dublin|cork|galway|limerick|waterford|belfast|kilkenny|wexford|sligo|drogheda|maynooth|éire|eire|shannon|louth|meath|kildare|donegal|mayo|clare|kerry|tipperary|wicklow/.test(loc)) return false;
      } else if (locationFilter === "uk") {
        if (!/\buk\b|united kingdom|england|london|manchester|edinburgh|glasgow|scotland|wales|birmingham|bristol|leeds|cambridge|oxford/.test(loc)) return false;
      } else if (locationFilter === "india") {
        if (!/\bindia\b|bangalore|bengaluru|mumbai|delhi|ncr|noida|gurgaon|gurugram|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|chandigarh/.test(loc)) return false;
      } else if (locationFilter === "netherlands") {
        if (!/netherlands|amsterdam|rotterdam|the hague|utrecht|eindhoven|groningen|\bnl\b/.test(loc)) return false;
      } else if (locationFilter === "newzealand") {
        if (!/new zealand|\bnz\b|auckland|wellington|christchurch|hamilton|tauranga|dunedin|palmerston north/.test(loc)) return false;
      }
    }
    // Work-type filter - remote/hybrid/onsite. Heuristic: the jobs table
    // has no dedicated work_type column yet, so we infer from location +
    // title. "Onsite" is the implicit default when nothing else matches.
    if (workTypeFilter) {
      const hay = `${j.location || ""} ${j.job_title || ""}`.toLowerCase();
      const isRemote = /\bremote\b|work.?from.?home|\bwfh\b/.test(hay);
      const isHybrid = /\bhybrid\b/.test(hay);
      if (workTypeFilter === "remote" && !isRemote) return false;
      if (workTypeFilter === "hybrid" && !isHybrid) return false;
      if (workTypeFilter === "onsite" && (isRemote || isHybrid)) return false;
    }
    // Date filter - show jobs that had activity on the selected date
    if (dateFilter) {
      const d = dateFilter; // "YYYY-MM-DD"
      const matchesDate = (val: string | null) => val?.startsWith(d);
      const hasActivity =
        matchesDate(j.created_at) ||
        matchesDate(j.applied_date) ||
        matchesDate(j.interview_date) ||
        matchesDate(j.offer_date) ||
        matchesDate(j.updated_at) ||
        matchesDate(j.posted_at);
      if (!hasActivity) return false;
    }
    // Flagged filter
    if (showFlaggedOnly) {
      if (!j.flagged) return false;
    }
    return true;
  }), [jobs, searchQuery, locationFilter, workTypeFilter, dateFilter, showFlaggedOnly]);

  // Sort logic - memoized for the same reason as `searched` above:
  // each sort branch builds a fresh array via `[...searched].sort()`,
  // which is O(n log n) per render even when nothing relevant changed.
  const filteredJobs = useMemo(() => {
    if (sortByDeadline) {
      return [...searched].sort((a, b) => {
        // both have deadline - closest first
        if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        // one has deadline - it goes first
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        // neither has deadline - fall back to applied_date desc (most recent first)
        const da = a.applied_date || a.created_at;
        const db2 = b.applied_date || b.created_at;
        return new Date(db2).getTime() - new Date(da).getTime();
      });
    }
    if (sortByFreshness) {
      return [...searched].sort((a, b) => {
        const pa = a.posted_at ? new Date(a.posted_at).getTime() : 0;
        const pb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
        return pb - pa; // newest posted first
      });
    }
    // Grade + Seniority can BE COMBINED. When both are on, sort first
    // by grade (A → F), then within each grade band by seniority
    // direction. That gives the user "best fits within my preferred
    // seniority" - e.g. all the A-grade entry-level roles first, then
    // A-grade associate, then B-grade entry, etc. Either dimension
    // alone keeps its previous behavior.
    if (sortByGrade || sortBySeniority !== "off") {
      const gradeRank = (j: Job): number => {
        if (!j.score_breakdown) return 99;
        try {
          const g = (JSON.parse(j.score_breakdown)?.letter_grade || "").toUpperCase();
          const idx = "ABCDF".indexOf(g);
          return idx === -1 ? 99 : idx;
        } catch {
          return 99;
        }
      };
      // 1=Intern, 2=Entry, 3=Associate, 4=Mid-Senior, 5=Director,
      // 6=Executive, 0=unknown (sinks to bottom for both directions).
      const seniorityRank = (j: Job): number => {
        const s = (j.seniority_level || "").toLowerCase();
        if (!s) return 0;
        if (/exec(utive)?|c-?level|chief|c[oef]o|cto/.test(s)) return 6;
        if (/director|vp|vice president|head of/.test(s)) return 5;
        if (/mid-senior|mid senior|senior|\bsr\.?\b|staff|principal|lead/.test(s)) return 4;
        if (/associate/.test(s)) return 3;
        if (/entry|graduate|grad|junior|\bjr\.?\b/.test(s)) return 2;
        if (/intern/.test(s)) return 1;
        return 0;
      };
      // direction: +1 for "high" (senior-first), -1 for "low"
      // (junior-first). See seniority-fix comment above for the math.
      const senDir = sortBySeniority === "high" ? 1 : sortBySeniority === "low" ? -1 : 0;

      return [...searched].sort((a, b) => {
        // Outer key: grade (when active).
        if (sortByGrade) {
          const ga = gradeRank(a);
          const gb = gradeRank(b);
          if (ga !== gb) return ga - gb; // A (0) before F (4), unknown (99) last
        }
        // Inner key: seniority (when active). Unknowns to bottom.
        if (senDir !== 0) {
          const sa = seniorityRank(a);
          const sb = seniorityRank(b);
          if (sa === 0 && sb !== 0) return 1;
          if (sb === 0 && sa !== 0) return -1;
          if (sa !== sb) return (sb - sa) * senDir;
        }
        // Final tiebreak: raw match_score so the "best of the rest"
        // surfaces first within a (grade, seniority) bucket.
        return (b.match_score ?? -1) - (a.match_score ?? -1);
      });
    }
    return searched;
  }, [searched, sortByDeadline, sortByFreshness, sortByGrade, sortBySeniority]);

  // Whether the current board has any data for each sort key. Used to
  // disable + explain a sort button when nothing can be sorted by it, so a
  // click never silently does nothing (the UAT "inaccessible" complaint).
  const hasDeadlines = useMemo(() => jobs.some((j) => !!j.deadline), [jobs]);
  const hasSeniority = useMemo(() => jobs.some((j) => !!j.seniority_level), [jobs]);
  const hasGrades = useMemo(() => jobs.some((j) => {
    if (!j.score_breakdown) return j.match_score != null;
    try { return !!JSON.parse(j.score_breakdown)?.letter_grade; } catch { return j.match_score != null; }
  }), [jobs]);

  // If the board has jobs but none are graded, don't leave the default Grade
  // sort active-but-disabled (unclickable) - fall back to Newest, which is
  // always usable. Only fires once jobs have loaded (not on the empty board).
  useEffect(() => {
    if (jobs.length > 0 && !hasGrades && sortByGrade) {
      setSortByGrade(false);
      setSortByFreshness(true);
    }
  }, [jobs.length, hasGrades, sortByGrade]);

  // Keep the selection in sync with what's on screen: prune selected ids that
  // are no longer visible (e.g. after a filter change) so batch actions never
  // touch off-screen jobs and the "Delete N" count stays honest.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredJobs.map((j) => j.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredJobs]);

  // Live `jobs` snapshot for callbacks that don't want to depend on
  // the jobs array as a deps entry (which would invalidate them on
  // EVERY job update - defeating useCallback's stability and breaking
  // memo on JobCard). The ref is updated in a layout-priority effect
  // BEFORE handlers fire so the read is fresh.
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const handleDragEnd = useCallback(async (jobId: number, newStatus: JobStatus) => {
    // Snapshot the card's current status so a failed move can revert
    // ONLY that one card. The previous behaviour called loadJobs() on
    // any failure, which refetched the whole board and snapped every
    // card back to its server state - including unrelated optimistic
    // updates. Net effect for the user: drag a card, see it move, then
    // see it bounce back as the refetch arrives a few hundred ms later.
    const original = jobsRef.current.find((j) => j.id === jobId);
    const originalStatus = original?.status;
    if (!original || originalStatus === newStatus) return; // no-op

    // Optimistic update + register as pending so an in-flight
    // background poll can't override the local state on its way back.
    const optimisticRow = { ...original, status: newStatus };
    setJobs((prev) => prev.map((j) => (j.id === jobId ? optimisticRow : j)));
    pendingMutationsRef.current.set(jobId, optimisticRow);

    try {
      const updated = await updateJobStatus(jobId, newStatus);
      // Server is now authoritative - replace local row, remove the
      // pending marker so future polls overwrite normally.
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      pendingMutationsRef.current.delete(jobId);
    } catch (err: any) {
      // Revert just this card, keep all other optimistic state intact.
      // Use `!== undefined` rather than truthy - a valid status like
      // "filtered" is truthy, but if the job was removed from the list
      // in the middle of the drag `original` is undefined and we skip
      // the revert entirely, leaving the UI in its optimistic state.
      pendingMutationsRef.current.delete(jobId);
      if (originalStatus !== undefined) {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: originalStatus } : j))
        );
      }
      const msg = err?.message || "Network error";
      setError(`Couldn't move card: ${msg}. Try again, or reload if the problem persists.`);
      // Surface to console so a Network panel inspection lines up with
      // the visible error banner.
      console.error("[handleDragEnd] update failed", err);
    }
    // Empty deps - handler is stable across re-renders. Reads jobs
    // via jobsRef.current so a fresh snapshot is always available.
  }, []);

  function handleJobUpdate(updated: Job) {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    setSelectedJob(updated);
  }

  function handleJobDelete(id: number) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setSelectedJob(null);
  }

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Stable card-click handler - only re-created when selectionMode
  // flips, so JobCard memo skips re-render for every card on every
  // unrelated state change (every drag, every flag, every poll).
  const handleCardClick = useCallback((job: Job) => {
    if (selectionMode) return; // selection mode handles clicks via onToggleSelect
    setSelectedJob(job);
  }, [selectionMode]);

  function handleSelectAllInColumn(status: JobStatus) {
    const columnJobIds = filteredJobs.filter((j) => j.status === status).map((j) => j.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = columnJobIds.every((id) => next.has(id));
      if (allSelected) {
        // Deselect all in this column
        columnJobIds.forEach((id) => next.delete(id));
      } else {
        // Select all in this column
        columnJobIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function showConfirm(title: string, message: string, onConfirm: () => void) {
    setConfirmDialog({ title, message, onConfirm });
  }

  async function executeBatchDelete(ids: number[]) {
    try {
      await batchDeleteJobs(ids);
      setJobs((prev) => prev.filter((j) => !ids.includes(j.id)));
      exitSelectionMode();
    } catch {
      setError("Failed to delete jobs. Try again.");
    }
  }

  function handleDeleteSelected() {
    const ids = Array.from(selectedIds);
    showConfirm(
      "Delete selected jobs",
      `Delete ${ids.length} selected job${ids.length > 1 ? "s" : ""}? This cannot be undone.`,
      () => executeBatchDelete(ids)
    );
  }

  function handleDeleteColumn(status: JobStatus, count: number) {
    const col = COLUMNS.find((c) => c.id === status);
    const ids = jobs.filter((j) => j.status === status).map((j) => j.id);
    showConfirm(
      `Clear ${col?.title} column`,
      `Delete all ${count} job${count > 1 ? "s" : ""} in ${col?.emoji} ${col?.title}? This cannot be undone.`,
      () => executeBatchDelete(ids)
    );
  }

  function handleAddJob(job: Job) {
    setJobs((prev) => [job, ...prev]);
  }

  const handleToggleFlag = useCallback(async (id: number, flagged: boolean) => {
    // Read jobs via ref instead of dep, so the callback's identity
    // stays stable across the board's lifetime. Stable identity is
    // what lets React.memo on JobCard skip re-rendering unchanged
    // rows when a single card flips its flag - without it, EVERY
    // card on the board re-renders on every flag click.
    const original = jobsRef.current.find((j) => j.id === id);
    if (!original) return;

    // Optimistic update + register as pending so an in-flight 30s
    // background poll can't snap the chip back to its previous state.
    // Same boomerang-prevention pattern as handleDragEnd.
    const optimisticRow = { ...original, flagged: flagged ? 1 : 0 } as Job;
    setJobs((prev) => prev.map((j) => (j.id === id ? optimisticRow : j)));
    pendingMutationsRef.current.set(id, optimisticRow);

    try {
      const updated = await toggleJobFlag(id, flagged);
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
      pendingMutationsRef.current.delete(id);
    } catch (err: any) {
      pendingMutationsRef.current.delete(id);
      // Revert the single card only - loadJobs() would refetch the
      // whole board and clobber any other in-flight optimistic state.
      setJobs((prev) => prev.map((j) => (j.id === id ? original : j)));
      console.error("[handleToggleFlag] toggle failed", err?.message || err);
      setError(`Couldn't flag job: ${err?.message || "network error"}.`);
    }
  }, []);

  // Stats
  const stats = COLUMNS.map((col) => ({
    ...col,
    count: jobs.filter((j) => j.status === col.id).length,
  }));

  // Export the current filtered Kanban view to CSV so users can share
  // their job list with a mentor / referral / spouse. We export the
  // visible filtered set (same filters as the board), not the raw jobs
  // array, so what the user sees on-screen matches what they download.
  function handleExportCsv() {
    const rows = filteredJobs;
    if (rows.length === 0) {
      setError("No jobs to export. Adjust your filters or add jobs first.");
      return;
    }

    const headers = [
      "Job Title", "Company", "Status", "Match Score", "Location", "Salary",
      "Applied Date", "Deadline", "Job Link", "Apply URL", "Source",
      "Match Reason", "Notes",
    ];

    const escape = (val: unknown): string => {
      if (val == null) return "";
      const s = String(val);
      // RFC 4180 quoting: wrap in quotes if the value contains comma,
      // quote, newline, or leading/trailing whitespace, then double-quote
      // any embedded quotes.
      if (/[",\r\n]/.test(s) || s !== s.trim()) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [headers.map(escape).join(",")];
    for (const j of rows) {
      lines.push([
        j.job_title,
        j.company_name,
        j.status,
        j.match_score ?? "",
        j.location ?? "",
        j.salary ?? "",
        j.applied_date ?? "",
        j.deadline ?? "",
        j.job_link ?? "",
        j.apply_url ?? "",
        j.source ?? "",
        j.match_reason ?? "",
        j.notes ?? "",
      ].map(escape).join(","));
    }

    // Prepend a UTF-8 BOM so Excel opens non-ASCII characters correctly.
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `job-tracker-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  async function handleLogout() {
    // Clear the Supabase session first so the onAuthStateChange listener
    // above sets currentUser to null and the auto-attached access token
    // is wiped from the in-memory cache before any subsequent fetch.
    await supabase.auth.signOut();
    setCurrentUser(null);
    setUserLimits(null);
    setActiveCandidateId(null);
    setPage("landing");
    setJobs([]);
  }

  // Re-fetches /me and updates currentUser + userLimits. Used by
  // PricingPage after a plan switch so the rest of the app (slider
  // clamps on LandingPage, plan badge in dashboard header) immediately
  // reflects the new plan without a full page reload.
  const refreshCurrentUser = useCallback(async () => {
    try {
      const me = await authMe();
      setCurrentUser(me.user);
      setUserLimits(me.limits);
    } catch {
      // If refresh fails, leave existing state so the user isn't
      // kicked out over a transient /me failure.
    }
  }, []);

  // ── Password reset ──
  // The reset email links here. Handled before everything else so the
  // screen shows even while the recovery session is still being read
  // out of the URL.
  if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
    return (
      <ResetPassword
        onDone={() => {
          try { window.history.replaceState({}, "", "/"); } catch { /* noop */ }
          setPage("landing");
          void refreshCurrentUser();
        }}
      />
    );
  }

  // ── Extension auth bridge ──
  // When the user lands here via the extension popup's "Sign in" CTA,
  // skip the entire app and just hand off the Supabase session.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ext_auth") === "1") {
    return <ExtensionAuthBridge />;
  }

  // ── Intro Loader Screen ──
  if (showIntro) {
    return (
      <div className={`intro-loader ${introFading ? "intro-fade-out" : ""}`}>
        {/* Video background - mild opacity */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="intro-video"
          src="/loader.mp4"
        />
        {/* Overlay */}
        <div className="intro-overlay" />
        {/* Content */}
        <div className="intro-content">
          <div className="intro-logo">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.3)] flex items-center justify-center mb-5">
              <span className="text-[var(--accent)] text-2xl">◆</span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)] mb-2 tracking-wide">GO CANDID8</h1>
            <p className="text-sm text-[var(--text-tertiary)]">Your job search on autopilot</p>
          </div>
          {/* Spinner */}
          <div className="intro-spinner">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  // ── Invite-only launch gate ──────────────────────────────────────
  // Signed out: the invite front door (or the sign-in page).
  // Signed in, not admin: early-access home (Resume Tailor + coming
  // soon), or the invite/expired screen. Admins fall through to the
  // full app below. The server enforces the same rules on every API
  // call (server/src/access.ts); this only decides what to render.
  if (!currentUser) {
    if (!authChecked) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (page === "creator") {
      return <CreatorPage onBack={() => setPage("landing")} />;
    }
    if (page === "auth") {
      return (
        <AuthPage
          key={authMode}
          initialMode={authMode}
          launchMode
          inviteToken={inviteToken}
          onNeedInvite={() => setPage("landing")}
          onNavigateToLanding={() => setPage("landing")}
          onNavigateToPricing={() => setPage("landing")}
          onAuth={(user) => setCurrentUser(user)}
        />
      );
    }
    return (
      <>
        <InviteGate
          inviteToken={inviteToken}
          onInviteTokenChange={setInviteToken}
          onSignIn={() => { setAuthMode("login"); setPage("auth"); }}
          onCreateAccount={() => { setAuthMode("signup"); setPage("auth"); }}
          onOpenCreator={() => setPage("creator")}
        />
        <ContactUsButton />
      </>
    );
  }

  if (!currentUser.is_admin) {
    if (page === "creator") {
      return <CreatorPage onBack={() => setPage("landing")} />;
    }
    // Fall back to approval_status if the server predates access_state.
    const accessState = currentUser.access_state
      ?? (currentUser.approval_status === "approved" ? "active" : "invite_required");
    if (accessState === "active") {
      return (
        <>
          <LaunchHome currentUser={currentUser} onLogout={handleLogout} onOpenCreator={() => setPage("creator")} />
          <ContactUsButton />
        </>
      );
    }
    return (
      <>
        <WaitlistScreen
          currentUser={currentUser}
          inviteToken={inviteToken}
          onInviteConsumed={() => setInviteToken(null)}
          onAccessGranted={refreshCurrentUser}
          onSignOut={handleLogout}
        />
        <ContactUsButton />
      </>
    );
  }

  if (page === "landing") {
    return (
      <>
        <LandingPage
          currentUser={currentUser}
          userLimits={userLimits}
          onLogout={handleLogout}
          onNavigateToDashboard={() => { setPage("dashboard"); }}
          onNavigateToAuth={() => setPage("auth")}
          onNavigateToPricing={() => setPage("pricing")}
        />
        {/* Interview practice can be triggered from the landing page too,
           via the new "AI Interviewer" CTA. We mount the modal here so
           it overlays the landing page when showInterview flips on. */}
        {showInterview && currentUser && (
          <InterviewSession
            initialJobId={null}
            initialJobTitle={null}
            initialCompanyName={null}
            jobOptions={[]}
            onClose={() => { setShowInterview(false); setInterviewJobId(null); }}
          />
        )}
        {/* Floating contact button is visible on the landing page too
            so casual visitors and signed-out users can report bugs. */}
        <ContactUsButton />
      </>
    );
  }

  if (page === "auth") {
    return (
      <AuthPage
        onNavigateToLanding={() => setPage("landing")}
        onNavigateToPricing={() => setPage("pricing")}
        onAuth={(user) => setCurrentUser(user)}
      />
    );
  }

  if (page === "pricing") {
    return (
      <PricingPage
        currentUser={currentUser}
        onLogout={handleLogout}
        onPlanChanged={refreshCurrentUser}
        onNavigateToLanding={() => setPage("landing")}
        onNavigateToDashboard={() => setPage("dashboard")}
        onNavigateToAuth={() => setPage("auth")}
      />
    );
  }

  if (page === "candidates" && currentUser?.plan === "enterprise") {
    return (
      <CandidatesPage
        user={currentUser}
        onNavigateToLanding={() => setPage("landing")}
        onNavigateToDashboard={(candidateId?: number) => {
          setActiveCandidateId(candidateId ?? null);
          setPage("dashboard");
        }}
        onLogout={handleLogout}
      />
    );
  }

  // Admin route - only renders for users with is_admin from /me. Non-admin
  // access falls through to the normal routing below; the server re-verifies
  // every /api/auth/admin/* call so a spoofed is_admin flag grants no real
  // access. Never call setPage() from the render body - React infinite-loops.
  if (page === "creator") {
    return <CreatorPage onBack={() => setPage("landing")} />;
  }

  if (page === "admin" && currentUser?.is_admin) {
    return (
      <AdminPage
        currentUser={currentUser}
        onNavigateToLanding={() => setPage("landing")}
        onNavigateToDashboard={() => setPage("dashboard")}
        onLogout={handleLogout}
      />
    );
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#07080a] gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading your jobs...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[#07080a] overflow-hidden relative">
      {/* Subtle animated video background - loops behind everything.
          Opacity is deliberately low (~0.08) so it stays a texture and
          never competes with the cards. pointer-events-none so it can't
          intercept clicks; z-0 keeps it below every other child. */}
      <div
        className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
        aria-hidden="true"
        style={{ ["--dashboard-bg-opacity" as any]: "0.08" }}
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: "var(--dashboard-bg-opacity)" as any }}
        >
          <source src="/dashboard-bg.mp4" type="video/mp4" />
        </video>
        {/* Soft darkening gradient so text never competes with bright frames */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#07080a]/40 via-transparent to-[#07080a]/60" />
      </div>

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d0f13] border border-gray-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-gray-50 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-gray-400 mb-5">{confirmDialog.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premium left navigation rail (replaces the old 3-row button wall).
          Pure presentation - every action maps to an existing handler. */}
      <Sidebar
        currentUser={currentUser}
        jobCount={jobs.length}
        onOpenMatches={() => setShowMatches(true)}
        onOpenCoach={() => setShowCoach(true)}
        onOpenSkills={() => setShowSkills(true)}
        onOpenEvents={() => setShowEvents(true)}
        onOpenStories={() => setShowStoryBank(true)}
        onOpenApplyProfile={() => setShowApplyProfile(true)}
        onOpenInterview={() => { setInterviewJobId(null); setShowInterview(true); }}
        onAddJob={() => setShowAddJob(true)}
        isAdmin={!!currentUser?.is_admin}
        onAdmin={() => setPage("admin")}
        onBackToLanding={() => {
          setActiveCandidateId(null);
          // Land directly on the Job Hunt config (not the hero) so returning
          // from the dashboard to tweak/re-run the pipeline is one click.
          try { sessionStorage.setItem("gc8-landing-target", "hunt"); } catch { /* ignore */ }
          setPage("landing");
        }}
        onOpenSettings={() => setShowSettings(true)}
        onNavigateToCandidates={() => setPage("candidates")}
        onNavigateToPricing={() => setPage("pricing")}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-h-0 relative z-10">

      {/* Header - board top bar (search + account) and the board toolbar */}
      <header className="shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#07080a]/80 backdrop-blur-sm relative z-10">
      <div className="px-3 md:px-6 py-2 md:py-3 flex items-center gap-2 md:gap-3.5">
        {/* Mobile: open the sidebar drawer (desktop shows the rail statically) */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden shrink-0 w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
          aria-label="Open menu"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {/* View title */}
        <h1 className="hidden sm:block font-display text-lg md:text-xl tracking-tight text-[var(--text-primary)] shrink-0">Pipeline Board</h1>

        {/* Search - flex-1 on mobile so it fills remaining space */}
        <div className="relative flex-1 md:flex-none min-w-0" data-tour="dashboard-search">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full md:w-52 bg-[var(--bg-surface)] border border-[rgba(255,255,255,0.06)] rounded-lg pl-9 pr-3 py-2 md:py-2.5 font-mono text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-[#c9a94e]/40 focus:ring-1 focus:ring-[#c9a94e]/20 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Spacer + User info (top row) - hidden name+plan on mobile, logout icon always */}
        <div className="hidden md:block flex-1" />
        {currentUser && (
          <div className="flex items-center gap-2 shrink-0" data-tour="dashboard-user">
            {currentUser.is_admin && (
              <button
                onClick={() => setPage("admin")}
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-lg bg-[#c45252]/10 text-[#c45252] border border-[#c45252]/20 hover:bg-[#c45252]/20 transition-colors"
                title="Tester approvals + admin tools"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Admin
              </button>
            )}
            <span className="hidden md:inline text-xs text-[var(--text-tertiary)] font-mono">
              {currentUser.name}
            </span>
            <span className={`hidden md:inline text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              currentUser.plan === "enterprise" ? "bg-[var(--accent-blue-muted)] text-[var(--accent-blue)]" :
              currentUser.plan === "pro" ? "bg-[var(--accent-muted)] text-[var(--accent)]" :
              "bg-[var(--bg-surface)] text-[var(--text-tertiary)]"
            }`}>
              {currentUser.plan}
            </span>
            <button
              onClick={handleLogout}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-ghost)] hover:text-[var(--accent-red)] hover:bg-[rgba(196,82,82,0.08)] transition-colors"
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
        {/* Mobile-only filters toggle - expands the hidden filter/action rows */}
        <button
          onClick={() => setMobileFiltersOpen((v) => !v)}
          className="md:hidden shrink-0 w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Toggle filters and actions"
          aria-expanded={mobileFiltersOpen}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {mobileFiltersOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 01.707 1.707L15 10.414V17a1 1 0 01-.293.707l-4 4A1 1 0 019 21v-10.586L3.293 4.707A1 1 0 013 4z" />
            )}
          </svg>
        </button>
      </div>
      {/* Collapsible wrapper - rows 2+3 always shown on md+, toggled on mobile */}
      <div className={`${mobileFiltersOpen ? "block" : "hidden"} md:block`}>
      {/* Second row - sorts & filters (Deadline / Score / Newest / date / locations / sources / flagged) */}
      <div className="px-3 md:px-6 py-2 flex flex-wrap items-center gap-2 border-t border-[rgba(255,255,255,0.03)]">

        {/* Sort by deadline. Single-key - clears Grade + Seniority
            because deadline ordering can't meaningfully combine with
            grade or seniority bands. */}
        <button
          onClick={() => { setSortByDeadline((v) => !v); setSortByFreshness(false); setSortByGrade(false); setSortBySeniority("off"); }}
          disabled={!hasDeadlines}
          title={hasDeadlines ? "Sort by application deadline (soonest first)" : "No jobs have a deadline yet"}
          className={`flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-lg border transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            sortByDeadline
              ? "bg-[#c9a94e]/12 border-[#c9a94e]/30 text-[#c9a94e]"
              : "bg-transparent border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3]"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Deadline
        </button>

        {/* Score sort removed - the kanban card and detail modal now
            show only the letter grade, so a numeric "Score" sort would
            be redundant with Grade and confusing alongside it. The
            underlying match_score is still used as a tiebreak inside
            Grade sort. */}

        {/* Sort by grade. Now COMBINABLE with Seniority below: when
            both are active, the array is sorted by Grade first
            (A → F), and within each grade band by Seniority direction.
            That gives "best fits within my preferred seniority" with
            one click each. */}
        <button
          onClick={() => { setSortByGrade((v) => !v); setSortByDeadline(false); setSortByFreshness(false); }}
          disabled={!hasGrades}
          className={`flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-lg border transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            sortByGrade && hasGrades
              ? "bg-[#c9a94e]/12 border-[#c9a94e]/30 text-[#c9a94e]"
              : "bg-transparent border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3]"
          }`}
          title={!hasGrades
            ? "No graded jobs yet - run the pipeline so jobs get an AI match grade"
            : sortBySeniority !== "off"
              ? "Grade sort active. Combined with Seniority below - grade first, seniority breaks ties."
              : "Sort by letter grade - A first, then B, C, D, F"}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 19l7-14 7 14M8 14h8" />
          </svg>
          Grade
        </button>

        {/* Sort by seniority (tri-state: off → high → low → off).
            COMBINABLE with Grade: when both are active, Grade is the
            outer sort and Seniority breaks ties within each grade
            band. Clicking this no longer clears Grade. The OTHER sorts
            (Deadline, Freshness) still clear because they're
            single-key sorts that can't meaningfully combine. */}
        <button
          onClick={() => {
            setSortBySeniority((cur) => cur === "off" ? "high" : cur === "high" ? "low" : "off");
            setSortByDeadline(false);
            setSortByFreshness(false);
          }}
          disabled={!hasSeniority}
          className={`flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-lg border transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            sortBySeniority !== "off"
              ? "bg-[#c9a94e]/12 border-[#c9a94e]/30 text-[#c9a94e]"
              : "bg-transparent border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3]"
          }`}
          title={
            !hasSeniority
              ? "No seniority level on these jobs yet"
              : sortBySeniority === "off"
                ? "Sort by seniority - click to start with highest first"
                : sortBySeniority === "high"
                  ? "Highest seniority first (Director → Intern). Click again to flip."
                  : "Lowest seniority first (Intern → Director). Click again to clear."
          }
        >
          {/* Bar-chart-style icon flips orientation to match direction */}
          <svg
            className={`w-4 h-4 transition-transform ${sortBySeniority === "low" ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m-6 4h3" />
          </svg>
          Seniority
          {sortBySeniority !== "off" && (
            <span className="ml-0.5 text-[10px] opacity-70">
              {sortBySeniority === "high" ? "↓" : "↑"}
            </span>
          )}
        </button>

        {/* Sort by freshness (newest posted first) */}
        <button
          onClick={() => { setSortByFreshness((v) => !v); setSortByDeadline(false); setSortByGrade(false); setSortBySeniority("off"); }}
          className={`flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-lg border transition-all shrink-0 ${
            sortByFreshness
              ? "bg-[#c9a94e]/12 border-[#c9a94e]/30 text-[#c9a94e]"
              : "bg-transparent border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3]"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Newest
        </button>

        {/* Date filter - calendar picker */}
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className={`bg-[var(--bg-surface)] border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#c9a94e]/40 cursor-pointer ${
              dateFilter
                ? "border-[#c9a94e]/30 text-[#c9a94e]"
                : "border-[rgba(255,255,255,0.06)] text-[#8b8fa3]"
            }`}
            title="Filter jobs by activity date"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter("")}
              className="text-gray-500 hover:text-gray-300 px-1"
              title="Clear date filter (show all)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {dateFilter && (
            <button
              onClick={() => setDateFilter(new Date().toISOString().split("T")[0])}
              className="text-xs font-mono text-[#c9a94e] hover:text-[#d4b85a] font-medium"
              title="Reset to today"
            >
              Today
            </button>
          )}
        </div>

        {/* Country filter - limited to the 4 supported markets. */}
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className={`bg-[var(--bg-surface)] border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#c9a94e]/40 shrink-0 cursor-pointer ${
            locationFilter
              ? "border-[#c9a94e]/30 text-[#c9a94e]"
              : "border-[rgba(255,255,255,0.06)] text-[#8b8fa3]"
          }`}
          title="Filter by country"
        >
          <option value="">All countries</option>
          <option value="ireland">Ireland</option>
          <option value="uk">United Kingdom</option>
          <option value="india">India</option>
          <option value="netherlands">Netherlands</option>
          <option value="newzealand">New Zealand</option>
        </select>

        {/* Work-type filter - independent of country. */}
        <select
          value={workTypeFilter}
          onChange={(e) => setWorkTypeFilter(e.target.value as "" | "remote" | "hybrid" | "onsite")}
          className={`bg-[var(--bg-surface)] border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#c9a94e]/40 shrink-0 cursor-pointer ${
            workTypeFilter
              ? "border-[#c9a94e]/30 text-[#c9a94e]"
              : "border-[rgba(255,255,255,0.06)] text-[#8b8fa3]"
          }`}
          title="Filter by work type"
        >
          <option value="">Any work type</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">Onsite</option>
        </select>

        {/* Flagged jobs filter */}
        {(() => {
          const flaggedCount = jobs.filter((j) => j.flagged).length;
          return flaggedCount > 0 ? (
            <button
              onClick={() => setShowFlaggedOnly((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-lg border transition-all shrink-0 ${
                showFlaggedOnly
                  ? "bg-[#c45252]/12 border-[#c45252]/30 text-[#c45252]"
                  : "bg-transparent border-[rgba(255,255,255,0.06)] text-[#555872] hover:border-[#c45252]/30 hover:text-[#c45252]"
              }`}
              title={showFlaggedOnly ? "Show all jobs" : `Show ${flaggedCount} flagged jobs`}
            >
              🚩 Flagged ({flaggedCount})
            </button>
          ) : null;
        })()}
      </div>

      {/* Third row - actions, stats, rates, selection (Skills / Events / Stories / counts / …) */}
      <div className="px-3 md:px-6 py-2 flex flex-wrap items-center gap-2 border-t border-[rgba(255,255,255,0.03)]">

        {/* Export CSV button - downloads the current filtered view */}
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1 font-mono text-xs uppercase tracking-wider px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3] transition-all shrink-0"
          title={`Export ${filteredJobs.length} filtered job${filteredJobs.length === 1 ? "" : "s"} to CSV (share with mentors, referrals, etc.)`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-[rgba(255,255,255,0.06)] shrink-0" />

        {/* Stats inline */}
        <div className="flex items-center gap-0.5 shrink-0">
          {stats.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-800/40 transition-colors"
              title={s.title}
            >
              <span className={`font-mono text-lg font-semibold tabular-nums ${s.count > 0 ? "text-gray-200" : "text-gray-700"}`}>{s.count}</span>
              <span className="text-[#555872] text-xs font-mono uppercase tracking-wider">{s.title}</span>
            </div>
          ))}
        </div>


        {/* Divider */}
        <div className="w-px h-5 bg-[rgba(255,255,255,0.06)] shrink-0" />

        {/* Selection mode */}
        {!selectionMode ? (
          <button
            onClick={() => setSelectionMode(true)}
            className="flex items-center gap-1 font-mono text-xs uppercase tracking-wider px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3] transition-all shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Select
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs text-gray-400">{selectedIds.size} selected</span>
            <button
              onClick={() => {
                const allFilteredIds = filteredJobs.map((j) => j.id);
                const allSelected = allFilteredIds.every((id) => selectedIds.has(id));
                if (allSelected) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(allFilteredIds));
                }
              }}
              className="font-mono text-xs px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] text-[#8b8fa3] hover:text-[#c9a94e] transition-all"
            >
              {filteredJobs.every((j) => selectedIds.has(j.id)) ? "Deselect All" : `Select All (${filteredJobs.length})`}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-1 font-mono text-xs px-3 py-2 rounded-lg bg-[#c45252] hover:bg-[#d45e5e] text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete {selectedIds.size}
              </button>
            )}
            <button
              onClick={exitSelectionMode}
              className="font-mono text-xs px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] text-[#555872] hover:text-[#8b8fa3] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

      </div>
      </div>
      </header>

      {error && (
        <div className={`mx-5 mb-2 p-3 rounded-xl text-xs flex items-center gap-2 relative z-10 ${
          error.startsWith("✓")
            ? "bg-emerald-500/8 border border-emerald-500/20 text-emerald-400"
            : "bg-red-500/8 border border-red-500/20 text-red-400"
        }`}>
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {error.startsWith("✓")
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            }
          </svg>
          {error}
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 min-h-0 relative z-10" data-tour="kanban-board">
        <KanbanBoard
          jobs={filteredJobs}
          onDragEnd={handleDragEnd}
          // Stable card-click handler so React.memo on JobCard can skip
          // re-renders for unaffected rows. Reads selectionMode via
          // closure but is itself created once - `selectionMode` is
          // captured at definition, so we re-create only when it flips.
          onCardClick={handleCardClick}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onDeleteColumn={handleDeleteColumn}
          onSelectAllInColumn={handleSelectAllInColumn}
          onToggleFlag={handleToggleFlag}
        />
      </div>
      </div>{/* end main content column */}

      {/* Detail Modal */}
      {selectedJob && !selectionMode && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onUpdate={handleJobUpdate}
          onDelete={handleJobDelete}
        />
      )}

      {/* Add Job Modal */}
      {showAddJob && <AddJobModal onClose={() => setShowAddJob(false)} onAdded={handleAddJob} />}

      {/* Skills Trend Modal */}
      {showSkills && <SkillsTrendModal onClose={() => setShowSkills(false)} />}

      {/* Career Events Modal */}
      {showEvents && <CareerEventsModal onClose={() => setShowEvents(false)} />}
      {showStoryBank && <StoryBankModal onClose={() => setShowStoryBank(false)} />}

      {/* Auto-Apply Profile Editor */}
      {showApplyProfile && <ApplyProfileEditor onClose={() => setShowApplyProfile(false)} />}

      {/* AI Career Coach */}
      {showCoach && <CareerCoachModal onClose={() => setShowCoach(false)} />}

      {/* Realtime Job Matches */}
      {showMatches && <JobMatchesModal onClose={() => setShowMatches(false)} />}

      {/* AI Interview Practice */}
      {showInterview && (() => {
        const j = interviewJobId ? jobs.find((x) => x.id === interviewJobId) : null;
        return (
          <InterviewSession
            initialJobId={interviewJobId}
            initialJobTitle={j?.job_title || null}
            initialCompanyName={j?.company_name || null}
            jobOptions={jobs
              .filter((x) => ["saved", "applied", "interviewing"].includes(x.status))
              .map((x) => ({ id: x.id, job_title: x.job_title, company_name: x.company_name }))}
            onClose={() => { setShowInterview(false); setInterviewJobId(null); }}
          />
        );
      })()}

      {/* Settings Modal - reachable from the sidebar's Settings item */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Floating Contact button - small dialog for bug reports and
          feature suggestions, opens user's mail client via mailto: */}
      <ContactUsButton />
    </div>
  );
}
