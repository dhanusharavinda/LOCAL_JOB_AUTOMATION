import { useEffect, useState } from "react";
import { checkInvite, InviteCheck } from "../api";
import { extractInviteToken, storeInvite, clearStoredInvite } from "../invite";
import { ComingSoonGrid } from "./ComingSoon";

interface Props {
  /** Token from the invite link (URL or localStorage), if any. */
  inviteToken: string | null;
  onInviteTokenChange: (token: string | null) => void;
  onSignIn: () => void;
  onCreateAccount: () => void;
}

// Optional: set VITE_LAUNCH_POST_URL on Vercel to link the LinkedIn post.
const LAUNCH_POST_URL = (import.meta as any).env?.VITE_LAUNCH_POST_URL as string | undefined;

/**
 * Front door for signed-out visitors during the invite-only launch.
 *
 * With an invite link: confirms the link is still good, then sends the
 * visitor to create an account (the link is redeemed after sign-in).
 * Without one: explains how to get an invite and offers sign-in for
 * people who already have access.
 */
export default function InviteGate({ inviteToken, onInviteTokenChange, onSignIn, onCreateAccount }: Props) {
  const [check, setCheck] = useState<InviteCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) { setCheck(null); return; }
    let cancelled = false;
    setChecking(true);
    setCheckError(null);
    checkInvite(inviteToken)
      .then((r) => { if (!cancelled) setCheck(r); })
      .catch((e: any) => { if (!cancelled) setCheckError(e?.message || "Couldn't check this invite right now."); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [inviteToken]);

  function applyPastedLink() {
    const token = extractInviteToken(pasted);
    if (!token) {
      setPasteError("That doesn't look like an invite link. Paste the full link you received.");
      return;
    }
    setPasteError(null);
    storeInvite(token);
    onInviteTokenChange(token);
    setPasted("");
  }

  function forgetInvite() {
    clearStoredInvite();
    onInviteTokenChange(null);
  }

  const invalidReason = check && !check.valid ? check.reason : null;

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
            onClick={onSignIn}
            className="text-sm font-medium px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all"
          >
            Sign in
          </button>
        </div>
      </header>

      <main className="flex-1 px-5 sm:px-6 pb-16">
        <div className="max-w-xl mx-auto pt-6 sm:pt-12">
          {/* ── Invite link present ── */}
          {inviteToken && (
            <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 sm:p-8 text-center">
              {checking && (
                <div className="py-8 flex flex-col items-center gap-3">
                  <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-[var(--text-tertiary)]">Checking your invite...</p>
                </div>
              )}

              {!checking && checkError && (
                <>
                  <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">We couldn't check your invite</h1>
                  <p className="text-sm text-[var(--text-secondary)] mb-6">{checkError}</p>
                  <button onClick={onCreateAccount} className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity">
                    Continue anyway
                  </button>
                </>
              )}

              {!checking && check?.valid && (
                <>
                  <div className="text-4xl mb-3" aria-hidden>🎉</div>
                  <h1 className="font-display text-2xl sm:text-3xl text-[var(--text-primary)] mb-2">You're invited</h1>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                    You've got free early access to GO CANDID8 for <span className="text-[var(--accent)] font-semibold">{check.access_days} days</span>.
                    Create your account to claim it. This link is just for you and works once.
                  </p>

                  <div className="text-left bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 mb-6">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 mb-2">Included now</div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">AI Resume Tailor</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-[var(--text-secondary)]">
                      <li className="flex gap-2"><span className="text-[var(--accent)]">✓</span>Rewrites your resume for any job description in seconds</li>
                      <li className="flex gap-2"><span className="text-[var(--accent)]">✓</span>Live editor to accept, change, or add anything</li>
                      <li className="flex gap-2"><span className="text-[var(--accent)]">✓</span>Download a clean PDF, plus an optional cover letter</li>
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button onClick={onCreateAccount} className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity">
                      Create my account
                    </button>
                    <button onClick={onSignIn} className="w-full py-3 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all">
                      I already have an account
                    </button>
                  </div>
                </>
              )}

              {!checking && invalidReason && (
                <>
                  <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-300 text-xl" aria-hidden>!</div>
                  <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">
                    {invalidReason === "used" ? "This invite has already been used" : invalidReason === "revoked" ? "This invite was cancelled" : "This invite link isn't valid"}
                  </h1>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                    {invalidReason === "used"
                      ? "Each invite link works for one person. If it was yours, just sign in. Otherwise ask for your own link."
                      : invalidReason === "revoked"
                        ? "Ask for a new invite link and you'll be in shortly."
                        : "Check that you copied the whole link, or ask for a new one."}
                  </p>
                  <div className="flex flex-col gap-2">
                    <button onClick={onSignIn} className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity">
                      Sign in
                    </button>
                    <button onClick={forgetInvite} className="w-full py-3 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                      Use a different link
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── No invite link ── */}
          {!inviteToken && (
            <>
              <div className="text-center">
                <span className="inline-block text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.25)] px-3 py-1 rounded-full mb-4">
                  Invite-only early access
                </span>
                <h1 className="font-display text-3xl sm:text-4xl text-[var(--text-primary)] mb-3 leading-tight">
                  Tailor your resume to any job in seconds
                </h1>
                <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
                  GO CANDID8 is opening up to a small group first, free for 30 days.
                </p>
              </div>

              <div className="mt-8 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">How to get your invite</h2>
                <ol className="space-y-3">
                  {[
                    "Find the GO CANDID8 launch post on LinkedIn.",
                    'Comment "send link" on the post.',
                    "You'll get a personal invite link by DM. Open it to get in.",
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className="w-6 h-6 shrink-0 rounded-full bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.25)] text-[var(--accent)] text-xs font-semibold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-sm text-[var(--text-secondary)] pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
                {LAUNCH_POST_URL && (
                  <a
                    href={LAUNCH_POST_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#0a66c2] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                  >
                    Open the LinkedIn post
                  </a>
                )}

                <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
                  <label className="block text-xs text-[var(--text-tertiary)] mb-2">Already got your link? Paste it here</label>
                  <div className="flex gap-2">
                    <input
                      value={pasted}
                      onChange={(e) => { setPasted(e.target.value); setPasteError(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") applyPastedLink(); }}
                      placeholder="https://.../invite/..."
                      className="flex-1 min-w-0 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      onClick={applyPastedLink}
                      disabled={!pasted.trim()}
                      className="px-4 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      Continue
                    </button>
                  </div>
                  {pasteError && <p className="text-xs text-red-400 mt-2">{pasteError}</p>}
                </div>
              </div>

              <p className="text-center text-sm text-[var(--text-tertiary)] mt-5">
                Already have access?{" "}
                <button onClick={onSignIn} className="text-[var(--accent)] hover:underline font-medium">Sign in</button>
              </p>
            </>
          )}
        </div>

        {/* What's coming, shown to everyone */}
        <div className="max-w-5xl mx-auto mt-14">
          <h2 className="text-center text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] mb-5">On the way</h2>
          <ComingSoonGrid />
        </div>
      </main>
    </div>
  );
}
