import { AuthUser } from "../api";
import { supabase } from "../supabaseClient";

interface Props {
  currentUser: AuthUser;
  onSignOut: () => void | Promise<void>;
}

/**
 * WaitlistScreen - shown between AuthPage and the dashboard when a newly
 * signed-up user hasn't been approved yet. During the private testing
 * phase every signup lands here; the owner vets them from the admin
 * panel (or directly via the Supabase SQL editor) and flips their
 * approval_status to 'approved' to unlock the dashboard.
 *
 * Two flavours: 'pending' (friendly, "we'll email you soon") and
 * 'rejected' (terminal, one-sided sign-out CTA). No auto-refresh - the
 * user has to sign out + sign back in once approved, which gives the
 * server a clean /me read rather than stale client state.
 */
export default function WaitlistScreen({ currentUser, onSignOut }: Props) {
  const rejected = currentUser.approval_status === "rejected";

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    await onSignOut();
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col">
      <header className="shrink-0 px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
            <span className="text-[var(--accent)] text-base">◆</span>
          </div>
          <span className="font-display text-lg text-[var(--text-primary)] tracking-wide">GO CANDID8</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-lg bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-8 text-center">
          <div className={`mx-auto mb-5 w-14 h-14 rounded-2xl flex items-center justify-center ${
            rejected
              ? "bg-red-500/10 border border-red-500/20"
              : "bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)]"
          }`}>
            {rejected ? (
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-7 h-7 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>

          <h2 className="font-display text-2xl text-[var(--text-primary)] mb-2">
            {rejected ? "Access not available" : "You're on the waitlist"}
          </h2>

          {rejected ? (
            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
              Your account doesn't have access during the current private testing phase.
              If you believe this is a mistake, reply to the invitation you received or reach
              out to the project owner directly.
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--text-secondary)] mb-2 leading-relaxed">
                Thanks for signing up, <span className="text-[var(--text-primary)] font-medium">{currentUser.name}</span>.
              </p>
              <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
                GO CANDID8 is in private testing. Every signup is manually vetted so we can
                keep quality high while we iterate. We'll email <span className="font-mono text-[var(--text-primary)]">{currentUser.email}</span>
                &nbsp;as soon as your account is approved, usually within 24 hours.
              </p>

              <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 mb-6 text-left">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                  While you wait
                </div>
                <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                  <li className="flex gap-2">
                    <span className="text-[var(--accent)]">•</span>
                    <span>Keep an eye on your inbox (check spam too).</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[var(--accent)]">•</span>
                    <span>Once approved, sign out and back in to land straight on your dashboard.</span>
                  </li>
                </ul>
              </div>
            </>
          )}

          <button
            onClick={handleSignOut}
            className="w-full py-2.5 px-4 rounded-xl border border-[var(--border-subtle)] bg-transparent text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
