import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import Ambient, { BrandMark } from "./Ambient";

/**
 * "Set a new password" screen, reached from the password-reset email.
 *
 * The reset mail links to /reset-password, and nothing used to handle
 * that path: the link just dropped people on the front page with no way
 * to finish, which makes a forgotten password unrecoverable from inside
 * the app. supabase-js turns the token in the URL into a session
 * (detectSessionInUrl), so by the time this renders the visitor is
 * authenticated just long enough to set a new password.
 */
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The recovery session may land a tick after mount while supabase-js
    // parses the URL, so listen as well as checking once.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setEmail(data.session?.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      if (session?.user?.email) { setEmail(session.user.email); setReady(true); }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setSaving(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Could not set the new password. Open the link from your email again.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]";

  return (
    <div className="min-h-screen flex flex-col">
      <Ambient />
      <header className="px-5 sm:px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <BrandMark />
          <span className="font-display text-lg text-[var(--text-primary)] tracking-wide">GO CANDID8</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-5 sm:px-6 pb-20">
        <div className="w-full max-w-md bg-[var(--bg-raised)]/80 backdrop-blur-xl border border-[var(--border-default)] rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/40">
          {done ? (
            <div className="text-center">
              <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">Password updated</h1>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                You're signed in with your new password.
              </p>
              <button
                onClick={onDone}
                className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Continue
              </button>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl text-[var(--text-primary)] mb-1">Set a new password</h1>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                {email
                  ? <>For <span className="font-mono text-[var(--text-primary)]">{email}</span>.</>
                  : ready
                    ? "Open the most recent reset link from your email, then set your password here."
                    : "Checking your reset link..."}
              </p>

              <form onSubmit={handleSave} className="space-y-3">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="New password (at least 8 characters)"
                  autoComplete="new-password"
                  className={inputCls}
                />
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                  placeholder="Repeat the new password"
                  autoComplete="new-password"
                  className={inputCls}
                />
                {error && (
                  <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={saving || !password || !confirm}
                  className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save new password"}
                </button>
              </form>

              <button
                onClick={onDone}
                className="mt-4 w-full py-2.5 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
