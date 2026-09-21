import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { authMe } from "../api";
import { authRedirect } from "../site";
import { friendlyAuthError } from "../authErrors";

interface Props {
  onClose: () => void;
  /** Fires after a session is established + /me returns successfully. */
  onSuccess?: () => void;
  /** Opening tab. Defaults to "signup" since this modal is reached from
   *  the marketing bait (Tailor My Resume CTA). */
  initialMode?: "login" | "signup";
  /** Optional headline shown above the form. Lets the caller set context
   *  like "Sign up to tailor your resume" instead of a generic title. */
  title?: string;
  subtitle?: string;
}

/**
 * AuthModal - overlay-style sign in / sign up dialog.
 *
 * Reuses the same Supabase auth flow as AuthPage but renders as a
 * dismissable popup so the visitor stays on the landing page. The app's
 * global onAuthStateChange listener (App.tsx) picks up the new session
 * and sets currentUser automatically, so we only need to close the
 * modal and optionally fire onSuccess when auth completes.
 */
export default function AuthModal({
  onClose,
  onSuccess,
  initialMode = "signup",
  title,
  subtitle,
}: Props) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      if (mode === "forgot") {
        if (!email) throw new Error("Enter your email to receive a reset link");
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirect("reset-password"),
        });
        if (err) throw err;
        setNotice(`Password reset link sent to ${email}. Check your inbox.`);
        return;
      }

      if (!email || !password) throw new Error("Please fill in all fields");

      if (mode === "signup") {
        if (!name.trim()) throw new Error("Please enter your name");
        if (password.length < 8) throw new Error("Password must be at least 8 characters");

        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: authRedirect(""),
          },
        });
        if (err) throw err;

        // If Supabase has email confirmation on (default), data.session
        // is null until the user clicks the link in their inbox. Nudge
        // them to check email and flip to login so they can sign in
        // once confirmed.
        if (!data.session) {
          setNotice(
            `We sent a confirmation link to ${email}. Click it to verify, then sign in.`
          );
          setMode("login");
          return;
        }

        // Email confirmation disabled - they're already signed in.
        // Confirm the profile loads, then hand control back to the caller.
        await authMe();
        onSuccess?.();
        onClose();
        return;
      }

      // mode === "login"
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;

      await authMe();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  const defaultTitle =
    mode === "login" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset password";
  const defaultSubtitle =
    mode === "login"
      ? "Sign in to continue where you left off"
      : mode === "signup"
        ? "Free forever plan. No credit card required."
        : "We'll email you a link to set a new one";

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-[slideDown_0.2s_ease-out]"
      onClick={() => !loading && onClose()}
    >
      <div
        className="bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[var(--border-subtle)] relative">
          <button
            onClick={onClose}
            disabled={loading}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-ghost)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(249, 115, 22,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-base text-[var(--text-primary)] tracking-wide">Tailorly AI</span>
          </div>
          <h2 className="font-display text-xl text-[var(--text-primary)] mb-1">
            {title || defaultTitle}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {subtitle || defaultSubtitle}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Tabs - hidden in forgot-password mode */}
          {mode !== "forgot" && (
            <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] mb-5">
              <button
                onClick={() => { setMode("login"); setError(null); setNotice(null); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === "login"
                    ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setMode("signup"); setError(null); setNotice(null); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === "signup"
                    ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {notice && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              {notice}
            </div>
          )}
          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            {mode !== "forgot" && (
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            )}

            {mode === "login" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(null); setNotice(null); }}
                  className="text-xs text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-[#0c0e14] bg-[#f97316] hover:bg-[#fb923c] px-6 py-3 rounded-xl transition-all shadow-lg shadow-[#f97316]/20 disabled:opacity-50 mt-1"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#0c0e14] border-t-transparent rounded-full animate-spin" />
                  Please wait...
                </>
              ) : mode === "login" ? (
                "Sign In"
              ) : mode === "signup" ? (
                "Create Account"
              ) : (
                "Send reset link"
              )}
            </button>

            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); setNotice(null); }}
                className="w-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors mt-1"
              >
                ← Back to sign in
              </button>
            )}
          </form>

        </div>
      </div>
    </div>
  );
}
