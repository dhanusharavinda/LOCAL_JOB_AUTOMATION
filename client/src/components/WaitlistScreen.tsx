import { useEffect, useRef, useState } from "react";
import { AuthUser, redeemInvite } from "../api";
import { supabase } from "../supabaseClient";
import { extractInviteToken, clearStoredInvite } from "../invite";
import { CREATOR } from "./CreatorPage";

interface Props {
  currentUser: AuthUser;
  /** Invite token picked up from a link, redeemed automatically. */
  inviteToken: string | null;
  onInviteConsumed: () => void;
  /** Re-fetch /me after access is granted so the app swaps screens. */
  onAccessGranted: () => Promise<void>;
  onSignOut: () => void | Promise<void>;
}

/**
 * Shown to signed-in users who can't use the app yet during the
 * invite-only launch:
 *   - invite_required / rejected: no invite redeemed on this account
 *   - expired: the free early-access period has ended
 *
 * If the user arrived through an invite link, the token is redeemed
 * automatically. Otherwise they can paste their link here.
 */
export default function WaitlistScreen({ currentUser, inviteToken, onInviteConsumed, onAccessGranted, onSignOut }: Props) {
  const expired = currentUser.access_state === "expired";
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const attempted = useRef<string | null>(null);

  async function redeem(token: string) {
    setRedeeming(true);
    setError(null);
    try {
      await redeemInvite(token);
      clearStoredInvite();
      onInviteConsumed();
      await onAccessGranted();
    } catch (e: any) {
      // A dead link shouldn't be retried on every visit.
      if (["used", "revoked", "not_found"].includes(e?.code)) {
        clearStoredInvite();
        onInviteConsumed();
      }
      setError(e?.message || "Couldn't use this invite link.");
    } finally {
      setRedeeming(false);
    }
  }

  // Auto-redeem once per token (guards against React double-invoking).
  useEffect(() => {
    if (inviteToken && attempted.current !== inviteToken) {
      attempted.current = inviteToken;
      redeem(inviteToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  function submitPasted() {
    const token = extractInviteToken(pasted);
    if (!token) {
      setError("That doesn't look like an invite link. Paste the full link you received.");
      return;
    }
    setPasted("");
    redeem(token);
  }

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    await onSignOut();
  }

  const firstName = (currentUser.name || "").split(" ")[0] || "there";

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col">
      <header className="shrink-0 px-5 sm:px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-lg text-[var(--text-primary)] tracking-wide">GO CANDID8</span>
          </div>
          <button
            onClick={handleSignOut}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-5 sm:px-6 pb-20">
        <div className="w-full max-w-lg bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 sm:p-8">
          {redeeming ? (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[var(--text-secondary)]">Activating your early access...</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <div className="text-4xl mb-3" aria-hidden>{expired ? "⏳" : "👋"}</div>
                <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">
                  {expired ? "Your free early access has ended" : `Almost there, ${firstName}`}
                </h1>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {expired
                    ? "Thanks for trying GO CANDID8. Message me and I'll turn your access back on, or paste a new invite link below."
                    : "Your account is ready, but GO CANDID8 is invite-only right now. Open your personal invite link, or paste it below."}
                </p>
              </div>

              {error && (
                <div className="mt-5 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="mt-6">
                <label className="block text-xs text-[var(--text-tertiary)] mb-2">Paste your invite link</label>
                <div className="flex gap-2">
                  <input
                    value={pasted}
                    onChange={(e) => { setPasted(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") submitPasted(); }}
                    placeholder="https://.../invite/..."
                    className="flex-1 min-w-0 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={submitPasted}
                    disabled={!pasted.trim()}
                    className="px-4 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    Activate
                  </button>
                </div>
              </div>

              <div className="mt-6 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                  {expired ? "Want back in?" : "No invite yet?"}
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  Message me on LinkedIn, or comment <span className="text-[var(--text-primary)] font-medium">"send link"</span> on my launch post, and I'll send you a link.
                </p>
                <a
                  href={CREATOR.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 py-2.5 px-4 rounded-xl bg-[#0a66c2] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  Message {CREATOR.name.split(" ")[0]} on LinkedIn
                </a>
              </div>

              <p className="mt-6 text-center text-xs text-[var(--text-ghost)]">
                Signed in as <span className="font-mono">{currentUser.email}</span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
