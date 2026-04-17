/**
 * Onboarding tour — first-run product walkthrough.
 * ──────────────────────────────────────────────────
 * Uses driver.js to spotlight real UI elements and walk the user through
 * the product. Because the tour spans two pages (landing → dashboard),
 * we run it as two separate driver instances and coordinate with
 * sessionStorage + a server-side `onboarded_at` flag.
 *
 *   1. First sign-in → App.tsx sees `currentUser.onboarded_at === null`
 *      and, on the landing page, calls `startLandingTour`.
 *   2. When the user clicks "Next" on the last landing step, we set
 *      TOUR_STATE_KEY = "dashboard" in sessionStorage and navigate to
 *      the dashboard.
 *   3. On dashboard mount, App.tsx sees `sessionStorage[TOUR_STATE_KEY]`
 *      is "dashboard" and kicks off `startDashboardTour` once jobs have
 *      loaded (so the kanban columns actually exist in the DOM).
 *   4. When the dashboard tour finishes (or is dismissed at any point),
 *      we POST /api/auth/onboarded so the flag persists across devices
 *      and clear the sessionStorage marker.
 *
 * Elements are targeted via `data-tour="…"` attributes instead of CSS
 * classes, so restyling/refactoring the UI doesn't silently break the
 * tour. If an element is missing, driver.js falls back to a centered
 * popover with no spotlight — still useful, never a hard crash.
 */

import { driver, Driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { authMarkOnboarded } from "../api";

const TOUR_STATE_KEY = "gocandid8_tour_state";

type TourState = "landing" | "dashboard" | "complete";

export function getTourState(): TourState | null {
  const v = sessionStorage.getItem(TOUR_STATE_KEY);
  if (v === "landing" || v === "dashboard" || v === "complete") return v;
  return null;
}

function setTourState(v: TourState | null) {
  if (v === null) sessionStorage.removeItem(TOUR_STATE_KEY);
  else sessionStorage.setItem(TOUR_STATE_KEY, v);
}

/**
 * Persist "tour is done" to the server so it never re-fires for this
 * account on any device. We swallow errors — the worst case is the
 * tour shows once more, which is acceptable.
 */
async function markOnboardedOnServer() {
  try {
    await authMarkOnboarded();
  } catch {
    // Ignore — non-critical. Next login will re-check /me.
  }
}

// ─── Shared driver config ────────────────────────────────────────────
// Dark-theme friendly popover; tight spotlight; allow both keyboard and
// button navigation. overlayClickBehavior: "nextStep" feels too eager
// for a tutorial, so we leave the default (close).
function makeDriver(steps: DriveStep[], onDone: () => void): Driver {
  return driver({
    showProgress: true,
    allowClose: true,
    animate: true,
    smoothScroll: true,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: "gc8-tour-popover",
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Got it",
    steps,
    onDestroyed: () => {
      // Fires on both finish and early dismiss. We always call onDone
      // here so ESC / X / clicking outside all funnel through the same
      // cleanup path.
      onDone();
    },
  });
}

// ─── Landing tour ────────────────────────────────────────────────────
export function startLandingTour(opts: {
  onNavigateToDashboard: () => void;
}) {
  setTourState("landing");

  const steps: DriveStep[] = [
    {
      popover: {
        title: "Welcome to GO CANDID8 👋",
        description:
          "Your job search on autopilot. This 60-second tour shows you the core flow, configure your preferences, run the pipeline, and track everything on the Kanban board.",
      },
    },
    {
      element: '[data-tour="landing-nav"]',
      popover: {
        title: "Your account",
        description:
          "Your name, plan, and sign-out live here. Settings (API keys, Gmail, resume) are one click away.",
        side: "bottom",
        align: "end",
      },
    },
    {
      element: "#config-start",
      popover: {
        title: "Pipeline configuration",
        description:
          "Scroll down and set your target roles, keywords, and locations. This is what the AI uses to decide which jobs are relevant.",
        side: "top",
        align: "center",
      },
    },
    {
      element: '[data-tour="start-pipeline"]',
      popover: {
        title: "Run the pipeline",
        description:
          "Hit Start and GO CANDID8 scrapes multiple job boards, scores each role against your resume, and tailors resumes for the best matches, all in one click.",
        side: "top",
        align: "center",
      },
    },
    {
      element: '[data-tour="nav-dashboard"]',
      popover: {
        title: "Track applications on the dashboard",
        description:
          "Once jobs are scored, they land on your Kanban board. Let's hop over there. Click Next and I'll walk you through it.",
        side: "bottom",
        align: "end",
      },
    },
  ];

  const drv = makeDriver(steps, () => {
    // Finished or dismissed. If they made it to the last step, queue
    // the dashboard tour. Otherwise they bailed — mark onboarded
    // immediately so we don't nag.
    const active = drv.isActive();
    const idx = drv.getActiveIndex();
    // When onDestroyed fires after clicking "Got it" on the final step,
    // isActive is false and idx is undefined. When dismissed early,
    // idx reflects the step they were on.
    const lastIdx = steps.length - 1;
    const completed = !active && (idx === lastIdx || idx === undefined);

    if (completed) {
      setTourState("dashboard");
      // Navigate to the dashboard so the continuation can fire.
      opts.onNavigateToDashboard();
    } else {
      setTourState(null);
      void markOnboardedOnServer();
    }
  });

  drv.drive();
}

// ─── Dashboard tour ──────────────────────────────────────────────────
export function startDashboardTour() {
  setTourState("dashboard");

  const steps: DriveStep[] = [
    {
      popover: {
        title: "Your dashboard",
        description:
          "This is mission control. Every job you scrape or add is tracked here. Let me point out the essentials.",
      },
    },
    {
      element: '[data-tour="dashboard-back"]',
      popover: {
        title: "Back to pipeline",
        description: "Return to the landing page any time to tweak your config and run another pipeline pass.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="dashboard-search"]',
      popover: {
        title: "Search & filter",
        description:
          "Search by title, company, or location. Below you'll find sort buttons (by deadline, score, freshness) and filters for date, location, source, and flagged jobs.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="kanban-board"]',
      popover: {
        title: "The Kanban board",
        description:
          "Six columns represent your pipeline: Filtered (AI-approved), Saved (you liked it), Applied, Interviewing, Offer, and Rejected. Drag cards between columns to update status. Everything syncs automatically.",
        side: "top",
        align: "center",
      },
    },
    {
      element: '[data-tour="kanban-column-filtered"]',
      popover: {
        title: "Filtered, AI shortlist",
        description:
          "When the pipeline runs, it lands relevant roles here with a match score and tailored resume. Review them, then drag to Saved or Applied.",
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-tour="kanban-column-applied"]',
      popover: {
        title: "Applied → Interviewing → Offer",
        description:
          "As you hear back, drag the card through the stages. GO CANDID8 tracks dates and computes your interview / offer / rejection rates.",
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-tour="add-job"]',
      popover: {
        title: "Add jobs manually",
        description:
          "Found a role the scrapers missed? Paste the URL here and GO CANDID8 will score it against your resume.",
        side: "bottom",
        align: "end",
      },
    },
    {
      element: '[data-tour="gmail-connect"]',
      popover: {
        title: "Connect Gmail",
        description:
          "Hook up your inbox and GO CANDID8 auto-detects recruiter replies (interview invites, rejections, offers) and moves the matching cards for you.",
        side: "bottom",
        align: "end",
      },
    },
    {
      element: '[data-tour="dashboard-user"]',
      popover: {
        title: "Your profile",
        description:
          "Your name, plan, and sign-out button live here. That's the tour. Click Got it to get started. Good luck out there 🚀",
        side: "bottom",
        align: "end",
      },
    },
  ];

  const drv = makeDriver(steps, () => {
    // Whether they finished or dismissed, consider them onboarded.
    setTourState("complete");
    void markOnboardedOnServer();
  });

  drv.drive();
}

/** Manual re-run entry point (e.g. a "Replay tour" button in Settings). */
export function replayFullTour(opts: { onNavigateToDashboard: () => void }) {
  setTourState(null);
  startLandingTour(opts);
}
