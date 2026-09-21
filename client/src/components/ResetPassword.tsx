import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import Ambient, { BrandMark } from "./Ambient";
import { initialUrlParams } from "../urlSnapshot";
import { authRedirect } from "../site";
import { friendlyAuthError } from "../authErrors";

/**
 * "Set a new password" screen, reached from the password-reset email.
 *
 * Supabase verifies the emailed token and then redirects here with the
 * session in the URL fragment (or, on the PKCE flow, a ?code= to
 * exchange). If neither arrives there is no session and the password
 * cannot be changed, which is what "Auth session missing" means. That
 * happens when the link was already used, has expired, was opened in a
 * different browser than it was requested from, or when the redirect
 * URL is not allowlisted in Supabase.
 *
 * Rather than dead-ending on that error, this screen explains it and
 * lets the visitor send themselves a fresh link without leaving.
 */
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Requesting a fresh link from this screen.
  const [requestEmail, setRequestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Did Supabase hand back an error instead of a session?
      // Read the URL as it was when the page opened: supabase-js has
      // usually wiped the fragment by now.
      const params = initialUrlParams();
      const errCode = params.get("error_code");
      const errDesc = params.get("error_description");
      if (errCode || errDesc) {
        if (!cancelled) {
          setLinkError(
            /expired|otp/i.test(errCode || "")
              ? "That reset link has expired or was already used."
              : (errDesc || "").replace(/\+/g, " ") || "That reset link didn't work."
          );
          setChecking(false);
        }
        return;
      }

      // 2. PKCE flow hands back ?code= to exchange for a session.
      const code = params.get("code");
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
        } catch {
          /* fall through to the session check below */
        }
      }

      // 3. Otherwise supabase-js reads the fragment itself
      //    (detectSessionInUrl), which can land a tick after mount.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user?.email) {
        setEmail(data.session.user.email);
        setChecking(false);
      } else {
        // Give the URL parser a moment before declaring it missing.
        setTimeout(async () => {
          if (cancelled) return;
          const again = await supabase.auth.getSession();
          if (cancelled) return;
          if (again.data.session?.user?.email) setEmail(again.data.session.user.email);
          else setLinkError("This page was opened without a valid reset link.");
          setChecking(false);
        }, 1200);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      if (session?.user?.email) {
        setEmail(session.user.email);
        setLinkError(null);
        setChecking(false);
      }
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
      setError(friendlyAuthError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const target = requestEmail.trim();
    if (!target) return;
    setSending(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: authRedirect("reset-password"),
      });
      if (err) throw err;
      setSent(true);
    } catch (err: any) {
      setError(friendlyAuthError(err));
    } finally {
      setSending(false);
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
          <span className="font-display text-lg text-[var(--text-primary)] tracking-wide">Tailorly AI</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-5 sm:px-6 pb-20">
        <div className="w-full max-w-md bg-[var(--bg-raised)]/80 backdrop-blur-xl border border-[var(--border-default)] rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/40">
          {done ? (
            <div className="text-center">
              <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">Password updated</h1>
              <p className="text-sm text-[var(--text-secondary)] mb-6">You're signed in with your new password.</p>
              <button
                onClick={onDone}
                className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Continue
              </button>
            </div>
          ) : checking ? (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[var(--text-secondary)]">Checking your reset link...</p>
            </div>
          ) : email ? (
            <>
              <h1 className="font-display text-2xl text-[var(--text-primary)] mb-1">Set a new password</h1>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                For <span className="font-mono text-[var(--text-primary)]">{email}</span>.
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
                  <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
                )}
                <button
                  type="submit"
                  disabled={saving || !password || !confirm}
                  className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save new password"}
                </button>
              </form>
            </>
          ) : sent ? (
            <div className="text-center">
              <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">Check your email</h1>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                A fresh reset link is on its way to{" "}
                <span className="font-mono text-[var(--text-primary)]">{requestEmail.trim()}</span>.
                Open it in <span className="text-[var(--text-primary)]">this same browser</span>, and use the newest
                email if you have several.
              </p>
              <button onClick={onDone} className="w-full py-3 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                Back
              </button>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl text-[var(--text-primary)] mb-2">Reset link needed</h1>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                {linkError || "This page was opened without a valid reset link."} Send yourself a new one
                and open it in this browser.
              </p>
              <form onSubmit={handleRequest} className="space-y-3">
                <input
                  type="email"
                  value={requestEmail}
                  onChange={(e) => { setRequestEmail(e.target.value); setError(null); }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={inputCls}
                />
                {error && (
                  <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
                )}
                <button
                  type="submit"
                  disabled={sending || !requestEmail.trim()}
                  className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Email me a reset link"}
                </button>
              </form>
              <button onClick={onDone} className="mt-4 w-full py-2.5 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
