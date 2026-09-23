/**
 * Features that exist but aren't open to early-access users yet.
 * Shown as "Coming soon" cards so people know what's on the way.
 * When a feature opens (server: src/access.ts), remove it from this list.
 */
export const COMING_SOON_FEATURES = [
  {
    title: "Job Hunt Pipeline",
    body: "Finds fresh roles across 15+ job boards, scores each one against your resume, and tailors your CV for the best matches automatically.",
    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  {
    title: "Auto-Apply",
    body: "A browser extension that fills in application forms for you, with your tailored resume attached.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    title: "Application Tracker",
    body: "A board that keeps every application, deadline, and follow-up in one place.",
    icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2",
  },
  {
    title: "Story Bank",
    body: "Turns your work history into ready-to-tell interview stories, with prompts for the details only you know.",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
  {
    title: "Career Coach",
    body: "A personal roadmap: the skills to learn next and the roles you're closest to landing.",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
];

export function ComingSoonGrid({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
      {COMING_SOON_FEATURES.map((f) => (
        <div
          key={f.title}
          className="relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-tertiary)]">
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{f.title}</h3>
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25">
                  Coming soon
                </span>
              </div>
              {!compact && (
                <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-relaxed">{f.body}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
