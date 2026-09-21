import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { authMe, AuthUser, checkInvite } from "../api";
import { getStoredInvite } from "../invite";
import { authRedirect } from "../site";
import { friendlyAuthError } from "../authErrors";

interface Props {
  onNavigateToLanding: () => void;
  onNavigateToPricing: () => void;
  onAuth: (user: AuthUser) => void;
  /** Which tab to open on (the invite flow opens "signup"). */
  initialMode?: "login" | "signup";
  /** Invite token from the link, if the visitor arrived with one. */
  inviteToken?: string | null;
  /** Take the visitor back to the invite page to request access. */
  onNeedInvite?: () => void;
  /** Invite-only launch: hide pricing, use early-access wording. */
  launchMode?: boolean;
}

/**
 * AuthPage - email-only Supabase auth.
 * Sign in / sign up / forgot password run client-side via supabase-js.
 * On success we call GET /api/auth/me to fetch the server profile and
 * hand it to the parent via onAuth. Token storage is delegated to
 * supabase-js (persistSession + autoRefreshToken).
 */
export default function AuthPage({ onNavigateToLanding, onNavigateToPricing, onAuth, initialMode = "login", launchMode = false, inviteToken = null, onNeedInvite }: Props) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Accounts can only be created with a working invite link. Signing in
  // stays open, because people who already joined come back without one
  // (and an account with no redeemed invite can't reach anything: the
  // server enforces that on every request).
  const [canSignUp, setCanSignUp] = useState<boolean | null>(launchMode ? null : true);

  useEffect(() => {
    if (!launchMode) { setCanSignUp(true); return; }
    const token = inviteToken || getStoredInvite();
    if (!token) { setCanSignUp(false); return; }
    let cancelled = false;
    checkInvite(token)
      .then((r) => { if (!cancelled) setCanSignUp(r.valid); })
      .catch(() => { if (!cancelled) setCanSignUp(false); })
      .finally(() => {
        if (!cancelled) setMode((m) => (m === "signup" ? m : m));
      });
    return () => { cancelled = true; };
  }, [launchMode, inviteToken]);

  // If the tab was opened on signup but this visitor has no invite,
  // drop them back to sign-in rather than showing a form that can't work.
  useEffect(() => {
    if (canSignUp === false && mode === "signup") setMode("login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSignUp]);

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

        // If email confirmation is enabled in Supabase (it is by default),
        // data.session will be null and the user must click the link in
        // their email before they can sign in. Surface that explicitly.
        if (!data.session) {
          setNotice(
            `We sent a confirmation link to ${email}. Click it to verify your account, then sign in.`
          );
          setMode("login");
          return;
        }

        // Email confirmation was disabled in the project - user is
        // already signed in. Load their profile from the server and drop
        // them on the landing page (not straight into the dashboard) so
        // first-time users see the pipeline config flow and the onboarding
        // tour can start there.
        const me = await authMe();
        onAuth(me.user);
        onNavigateToLanding();
        return;
      }

      // mode === "login"
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;

      const me = await authMe();
      onAuth(me.user);
      onNavigateToLanding();
    } catch (err: any) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  const titleMap = launchMode
    ? {
        login:  { title: "Welcome back",  sub: "Sign in to continue tailoring your resume" },
        signup: { title: "Claim your early access", sub: "Create your account and start tailoring your resume in minutes" },
        forgot: { title: "Reset password", sub: "We'll email you a link to set a new one" },
      }
    : {
        login:  { title: "Welcome back",  sub: "Sign in to put your job search back on autopilot" },
        signup: { title: "Get started",   sub: "Create an account and let your job search run itself" },
        forgot: { title: "Reset password", sub: "We'll email you a link to set a new one" },
      };
  const title = titleMap[mode];

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col">
      {/* Nav */}
      <header className="shrink-0 px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button onClick={onNavigateToLanding} className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(249, 115, 22,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-lg text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors tracking-wide">Tailorly AI</span>
          </button>
          <nav className="flex items-center gap-6">
            {!launchMode && (
              <button
                onClick={onNavigateToPricing}
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Pricing
              </button>
            )}
            <button
              onClick={onNavigateToLanding}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Home
            </button>
          </nav>
        </div>
      </header>

      {/* Auth Card */}
      <div className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-md">
          {launchMode && canSignUp === false && (
            <div className="mb-6 rounded-2xl border border-[rgba(249, 115, 22,0.25)] bg-[var(--accent-muted)] px-4 py-3.5">
              <p className="text-sm text-[var(--text-primary)] font-medium mb-1">New accounts need an invite</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Tailorly AI is invite-only, so accounts can only be created from a personal invite
                link.{" "}
                {onNeedInvite && (
                  <button onClick={onNeedInvite} className="text-[var(--accent)] hover:underline font-medium">
                    Ask for a link
                  </button>
                )}
                {onNeedInvite ? ", it takes a second." : ""} Already joined? Sign in below.
              </p>
            </div>
          )}

          {/* Tabs */}
          {mode !== "forgot" && canSignUp !== false && (
            <div className="flex gap-1 p-1 bg-[var(--bg-raised)] rounded-xl border border-[var(--border-subtle)] mb-8">
              <button
                onClick={() => { setMode("login"); setError(null); setNotice(null); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  mode === "login"
                    ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setMode("signup"); setError(null); setNotice(null); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  mode === "signup"
                    ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {/* Form Card */}
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-8">
            <h2 className="font-display text-2xl text-[var(--text-primary)] mb-1">{title.title}</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-8">{title.sub}</p>

            {notice && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                {notice}
              </div>
            )}
            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-[var(--accent-red-muted)] border border-[rgba(196,82,82,0.2)] text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    autoComplete="name"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
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
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>

              {mode !== "forgot" && (
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
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
                className="w-full launch-btn rounded-xl py-3.5 px-6 font-semibold text-sm transition-all duration-300 disabled:opacity-50 mt-2"
              >
                {loading
                  ? "Please wait..."
                  : mode === "login"
                  ? "Sign In"
                  : mode === "signup"
                  ? "Create Account"
                  : "Send reset link"}
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

          {/* Footer */}
          {mode !== "forgot" && (
            <p className="text-center text-xs text-[var(--text-ghost)] mt-6">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button onClick={() => { setMode("signup"); setError(null); setNotice(null); }} className="text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors">
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button onClick={() => { setMode("login"); setError(null); setNotice(null); }} className="text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors">
                    Sign in
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
