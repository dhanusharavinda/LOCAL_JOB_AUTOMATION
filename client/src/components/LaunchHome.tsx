import { AuthUser } from "../api";
import FreeTailorSection from "./FreeTailorSection";
import { ComingSoonGrid } from "./ComingSoon";

interface Props {
  currentUser: AuthUser;
  onLogout: () => void | Promise<void>;
}

function daysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

/**
 * Home for early-access users during the invite-only launch.
 * The Resume Tailor is the product right now; everything else is shown
 * as "coming soon" so people know what's on the way.
 */
export default function LaunchHome({ currentUser, onLogout }: Props) {
  const firstName = (currentUser.name || "").split(" ")[0] || "there";
  const left = daysLeft(currentUser.access_expires_at);

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/90 backdrop-blur" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-lg text-[var(--text-primary)] tracking-wide truncate">GO CANDID8</span>
            <span className="hidden sm:inline-block ml-1 text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
              Early access
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent)] text-xs font-semibold">
                {(currentUser.name || currentUser.email || "?").charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-[var(--text-secondary)] max-w-[140px] truncate">{currentUser.name}</span>
            </div>
            <button
              onClick={() => onLogout()}
              className="text-sm px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Welcome */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8">
        <div className="rounded-2xl border border-[rgba(201,169,78,0.2)] bg-gradient-to-br from-[var(--accent-muted)] to-transparent p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="font-display text-xl sm:text-2xl text-[var(--text-primary)]">
              Welcome, {firstName} 👋
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Thank you for being one of the first. Your early access is completely free.
            </p>
          </div>
          {left !== null && (
            <div className="shrink-0 text-left sm:text-right">
              <div className="font-display text-2xl text-[var(--accent)] tabular-nums leading-none">{left}</div>
              <div className="text-[11px] text-[var(--text-tertiary)] mt-1">
                {left === 1 ? "day" : "days"} of free access left
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The product */}
      <FreeTailorSection currentUser={currentUser} onNavigateToPricing={() => {}} launchMode />

      {/* On the way */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
        <div className="text-center mb-6">
          <h2 className="font-display text-2xl text-[var(--text-primary)]">More is on the way</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-lg mx-auto">
            These features are being polished. They'll unlock on your account automatically when they launch, no new invite needed.
          </p>
        </div>
        <ComingSoonGrid />
      </section>
    </div>
  );
}
