import { ReactNode } from "react";
import { AuthUser } from "../api";

/**
 * Premium left navigation rail for the dashboard.
 * ───────────────────────────────────────────────
 * Replaces the old three-row button wall in App.tsx. Pure presentation:
 * every action is a prop the parent already owns, so no backend or data
 * logic moves here. On md+ it's a static rail; below md it's a slide-in
 * drawer (mobileOpen) with a tap-to-dismiss backdrop.
 *
 * Tour anchors preserved here: data-tour="add-job" and
 * data-tour="dashboard-back". (dashboard-search / dashboard-user stay in the
 * top bar; kanban-board stays on the board.)
 */

interface SidebarProps {
  currentUser: AuthUser | null;
  jobCount: number;
  // Primary view + tools (each maps to an existing handler in App).
  onOpenMatches: () => void;
  onOpenCoach: () => void;
  onOpenSkills: () => void;
  onOpenEvents: () => void;
  onOpenStories: () => void;
  onOpenApplyProfile: () => void;
  onOpenInterview: () => void;
  onAddJob: () => void;
  // Account / nav
  isAdmin: boolean;
  onAdmin: () => void;
  onBackToLanding: () => void;
  onOpenSettings: () => void;
  onNavigateToCandidates: () => void;
  onNavigateToPricing: () => void;
  // Mobile drawer
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function NavItem({
  icon,
  label,
  onClick,
  active = false,
  badge,
  accent = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all border ${
        active
          ? "bg-[var(--accent-muted)] text-[var(--accent)] border-[rgba(201,169,78,0.25)]"
          : accent
            ? "text-[var(--accent)] border-[rgba(201,169,78,0.2)] hover:bg-[var(--accent-muted)]"
            : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
      }`}
    >
      <span className="w-4 h-4 shrink-0 flex items-center justify-center">{icon}</span>
      <span className="truncate text-left flex-1">{label}</span>
      {badge}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
      {children}
    </div>
  );
}

const ic = (d: string) => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const betaBadge = (
  <span className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
    BETA
  </span>
);

export default function Sidebar({
  currentUser,
  jobCount,
  onOpenMatches,
  onOpenCoach,
  onOpenSkills,
  onOpenEvents,
  onOpenStories,
  onOpenApplyProfile,
  onOpenInterview,
  onAddJob,
  isAdmin,
  onAdmin,
  onBackToLanding,
  onOpenSettings,
  onNavigateToCandidates,
  onNavigateToPricing,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  // Close the mobile drawer after any tap so the board is visible again.
  const tap = (fn: () => void) => () => { fn(); onCloseMobile(); };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 md:w-60 shrink-0 h-full flex flex-col
          bg-[var(--bg-raised)] border-r border-[var(--border-subtle)]
          transform transition-transform duration-200 ease-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
        {/* Brand */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <button onClick={onBackToLanding} className="flex items-center gap-2.5 group" title="Back to pipeline / landing">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.3)] flex items-center justify-center shrink-0">
              <span className="text-[var(--accent)] text-lg">◆</span>
            </div>
            <div className="text-left">
              <div className="font-display text-base leading-tight text-[var(--text-primary)] tracking-wide">GO CANDID8</div>
              <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">Your job search on autopilot</div>
            </div>
          </button>
          {/* Mobile close */}
          <button onClick={onCloseMobile} className="md:hidden text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1" aria-label="Close menu">
            {ic("M6 18L18 6M6 6l12 12")}
          </button>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {/* Primary CTA */}
          <button
            data-tour="add-job"
            onClick={tap(onAddJob)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 mt-1 rounded-lg text-sm font-medium
              bg-gradient-to-br from-[var(--accent)] to-[#b8982f] text-[#0a0b0e]
              hover:brightness-110 transition-all shadow-[0_0_0_0_rgba(201,169,78,0.4)] hover:shadow-[0_0_20px_rgba(201,169,78,0.25)]"
          >
            {ic("M12 4v16m8-8H4")}
            Add Job
          </button>

          <SectionLabel>Workspace</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              active
              icon={ic("M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10h6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2")}
              label="Pipeline Board"
              onClick={tap(() => {})}
              badge={<span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded">{jobCount}</span>}
            />
            <NavItem
              accent
              icon={ic("M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z")}
              label="Job Matches"
              onClick={tap(onOpenMatches)}
            />
            <NavItem
              icon={ic("M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422A12.083 12.083 0 0112 21.5a12.083 12.083 0 01-6.16-10.922L12 14z")}
              label="Career Coach"
              onClick={tap(onOpenCoach)}
            />
          </div>

          <SectionLabel>Insights</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              icon={ic("M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z")}
              label="Skills Demand"
              onClick={tap(onOpenSkills)}
            />
            <NavItem
              icon={ic("M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z")}
              label="Career Events"
              onClick={tap(onOpenEvents)}
            />
            <NavItem
              icon={ic("M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253")}
              label="Story Bank"
              onClick={tap(onOpenStories)}
            />
          </div>

          <SectionLabel>Apply</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              icon={ic("M13 10V3L4 14h7v7l9-11h-7z")}
              label="Auto-Apply Extension"
              onClick={tap(onOpenApplyProfile)}
              badge={betaBadge}
            />
            <NavItem
              icon={ic("M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z")}
              label="Interview Practice"
              onClick={tap(onOpenInterview)}
              badge={betaBadge}
            />
          </div>

        </div>

        {/* Account footer */}
        <div className="border-t border-[var(--border-subtle)] px-3 py-3 space-y-0.5">
          {currentUser && (
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="w-7 h-7 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent)] text-xs font-semibold shrink-0">
                {(currentUser.name || currentUser.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-[var(--text-secondary)] truncate">{currentUser.name}</div>
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${
                  currentUser.plan === "enterprise" ? "text-[var(--accent-blue)]"
                    : currentUser.plan === "pro" ? "text-[var(--accent)]"
                      : "text-[var(--text-tertiary)]"
                }`}>{currentUser.plan}</div>
              </div>
            </div>
          )}
          {currentUser?.plan === "enterprise" && (
            <NavItem
              icon={ic("M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.83-4M7 14a3 3 0 10-2.83-4")}
              label="Candidates"
              onClick={tap(onNavigateToCandidates)}
            />
          )}
          <NavItem
            icon={ic("M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75")}
            label="Settings"
            onClick={tap(onOpenSettings)}
          />
          {currentUser && currentUser.plan !== "enterprise" && (
            <NavItem
              accent
              icon={ic("M13 10V3L4 14h7v7l9-11h-7z")}
              label="Upgrade plan"
              onClick={tap(onNavigateToPricing)}
            />
          )}
          {isAdmin && (
            <NavItem
              icon={ic("M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z")}
              label="Admin"
              onClick={tap(onAdmin)}
            />
          )}
          <button
            data-tour="dashboard-back"
            onClick={tap(onBackToLanding)}
            title="Go to the Job Hunt setup on the home page"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-all"
          >
            <span className="w-4 h-4 shrink-0">{ic("M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6")}</span>
            New Job Hunt
          </button>
        </div>
      </aside>
    </>
  );
}
