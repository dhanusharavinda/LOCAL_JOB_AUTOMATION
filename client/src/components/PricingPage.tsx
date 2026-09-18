import { useEffect, useState } from "react";
import { AuthUser, authSetPlan, fetchSettings, updateSettings } from "../api";

type PlanId = "free" | "pro" | "enterprise";

interface Props {
  currentUser: AuthUser | null;
  onLogout: () => void | Promise<void>;
  onPlanChanged: () => void | Promise<void>;
  onNavigateToLanding: () => void;
  onNavigateToDashboard: () => void;
  onNavigateToAuth: () => void;
}

interface Plan {
  id: PlanId;
  name: string;
  price: string;
  period: string;
  description: string;
  accent: string;
  accentMuted: string;
  accentBorder: string;
  features: string[];
  highlighted: boolean;
  // Disabled during the public testing phase (no Stripe yet + we don't want
  // testers silently converting to the enterprise cap tier). Flip to false
  // when Stripe + per-candidate billing are live.
  disabled?: boolean;
  disabledReason?: string;
}

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try it out. No credit card needed",
    accent: "var(--text-secondary)",
    accentMuted: "rgba(139,143,163,0.1)",
    accentBorder: "rgba(139,143,163,0.2)",
    features: [
      "Kanban job board",
      "5 jobs scraped per day",
      "1 auto-tailored resume per day",
      "Manual job tracking",
      "Basic search filters",
      "1 pipeline run per day",
    ],
    highlighted: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    period: "/month",
    description: "Full automation for active job seekers",
    accent: "var(--accent)",
    accentMuted: "var(--accent-muted)",
    accentBorder: "rgba(201,169,78,0.3)",
    features: [
      "Everything in Free",
      "50 jobs scraped per day",
      "25 auto-tailored resumes per day",
      "AI job scoring & filtering",
      "Cover letter generation",
      "Multi-source job discovery",
      "Skills trend analytics",
      "Career events tracker",
      "No-match alerts with tuning suggestions",
    ],
    highlighted: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "$49",
    period: "/month",
    description: "For recruitment consultancies & job guarantee companies",
    accent: "var(--accent-blue)",
    accentMuted: "var(--accent-blue-muted)",
    accentBorder: "rgba(103,117,160,0.3)",
    features: [
      "Everything in Pro",
      "Unlimited candidates",
      "3 usage tiers per candidate:",
      "  Tier 1: 20 scraped, 10 tailored",
      "  Tier 2: 35 scraped, 20 tailored",
      "  Tier 3: 50 scraped, 50 tailored",
      "1 pipeline run per candidate per day",
      "Individual candidate dashboards",
      "Per-candidate resume & config",
      "Priority support",
    ],
    highlighted: false,
    disabled: true,
    disabledReason: "Not available for testing users",
  },
];

export default function PricingPage({
  currentUser,
  onLogout,
  onPlanChanged,
  onNavigateToLanding,
  onNavigateToDashboard,
  onNavigateToAuth,
}: Props) {
  // Long pages scroll with the document (min-h-screen) rather than
  // inside their own 100vh box. The old approach existed because body
  // carried `overflow: hidden` for the dashboard's fixed layout. That
  // global lock is gone: an inner scroll container broke touch
  // scrolling on phones and silently no-oped every window.scrollTo.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // `switching` holds the plan id currently being upgraded/downgraded to
  // so we can show per-card "switching…" state without blocking the other
  // CTAs. `flash` shows a transient success/error pill after a switch.
  const [switching, setSwitching] = useState<PlanId | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Enterprise-only tier (1/2/3). Fetched from user_settings when the
  // user is already on Enterprise so the slider inside the Enterprise
  // card reflects their saved preference. Defaults to Tier 3.
  const [enterpriseTier, setEnterpriseTier] = useState<1 | 2 | 3>(3);
  const [savingTier, setSavingTier] = useState(false);

  const currentPlan = (currentUser?.plan ?? null) as PlanId | null;

  useEffect(() => {
    if (currentUser?.plan !== "enterprise") return;
    fetchSettings()
      .then((s: any) => {
        const raw = Number(s?.config?.ENTERPRISE_TIER);
        if (raw === 1 || raw === 2 || raw === 3) setEnterpriseTier(raw);
      })
      .catch(() => {});
  }, [currentUser?.plan]);

  async function handleTierChange(tier: 1 | 2 | 3) {
    setEnterpriseTier(tier);
    setSavingTier(true);
    try {
      await updateSettings({ ENTERPRISE_TIER: tier } as any);
      setFlash({ kind: "ok", msg: `Tier ${tier} applied. New scrape + tailor caps take effect on your next run.` });
      setTimeout(() => setFlash(null), 4000);
    } catch (err: any) {
      setFlash({ kind: "err", msg: err?.message || "Failed to save tier. Try again." });
    } finally {
      setSavingTier(false);
    }
  }

  async function handleSelectPlan(planId: PlanId) {
    // Block disabled plans at the callsite in addition to the button's
    // disabled attribute - belt-and-suspenders against a stray click event.
    const target = PLANS.find((p) => p.id === planId);
    if (target?.disabled) {
      setFlash({ kind: "err", msg: target.disabledReason || "This plan isn't available yet." });
      setTimeout(() => setFlash(null), 4000);
      return;
    }
    // Not signed in: route through auth first. The auth flow already
    // lands the user back on landing, and they can return here to pick
    // a plan once they have an account.
    if (!currentUser) {
      onNavigateToAuth();
      return;
    }
    if (planId === currentPlan) return; // no-op
    setSwitching(planId);
    setFlash(null);
    try {
      await authSetPlan(planId);
      await onPlanChanged(); // parent refreshes /me and updates currentUser + userLimits
      setFlash({ kind: "ok", msg: `You're on the ${planId.toUpperCase()} plan now.` });
      // Clear the flash after a few seconds.
      setTimeout(() => setFlash(null), 4000);
    } catch (err: any) {
      setFlash({ kind: "err", msg: err?.message || "Failed to switch plan. Try again." });
    } finally {
      setSwitching(null);
    }
  }

  function ctaLabel(plan: Plan): string {
    if (plan.disabled) return plan.disabledReason || "Not available";
    if (switching === plan.id) return "Switching…";
    if (!currentUser) {
      return plan.id === "free" ? "Get Started" : plan.id === "pro" ? "Start Free Trial" : "Contact Us";
    }
    if (plan.id === currentPlan) return "Current plan";
    // Rank the plans so we can label the action direction.
    const rank: Record<PlanId, number> = { free: 0, pro: 1, enterprise: 2 };
    const going = rank[plan.id] - rank[currentPlan!];
    if (going > 0) return `Upgrade to ${plan.name}`;
    return `Switch to ${plan.name}`;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      {/* Nav */}
      <header className="shrink-0 px-4 sm:px-6 py-4 sm:py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 relative">
          <button onClick={onNavigateToLanding} className="flex items-center gap-2 sm:gap-3 group shrink-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-base sm:text-lg text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors tracking-wide">
              GO CANDID8
            </span>
          </button>

          {/* Desktop nav (md+) */}
          <nav className="hidden md:flex items-center gap-6">
            <button
              onClick={onNavigateToLanding}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Home
            </button>
            {currentUser && (
              <button
                onClick={onNavigateToDashboard}
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Dashboard
              </button>
            )}
            {currentUser ? (
              <div className="flex items-center gap-3 pl-2 border-l border-[var(--border-subtle)]">
                <div className="flex flex-col items-end leading-tight">
                  <span className="text-sm text-[var(--text-primary)] font-medium max-w-[140px] truncate">
                    {currentUser.name}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider ${
                      currentUser.plan === "enterprise"
                        ? "text-[var(--accent-blue)]"
                        : currentUser.plan === "pro"
                        ? "text-[var(--accent)]"
                        : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {currentUser.plan} plan
                  </span>
                </div>
                <button
                  onClick={() => onLogout()}
                  className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-transparent border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-red)] hover:border-[rgba(196,82,82,0.3)] transition-all"
                  title="Sign out"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={onNavigateToAuth}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] text-[var(--accent)] hover:bg-[rgba(201,169,78,0.18)] transition-all"
              >
                Sign In
              </button>
            )}
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileNavOpen((v) => !v)}
            className="md:hidden w-10 h-10 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-label="Toggle menu"
            aria-expanded={mobileNavOpen}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileNavOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Mobile dropdown */}
          {mobileNavOpen && (
            <div className="md:hidden absolute top-full right-0 mt-3 w-60 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl p-3 z-50 flex flex-col gap-1">
              {currentUser && (
                <div className="px-3 py-2 border-b border-[var(--border-subtle)] mb-1">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">{currentUser.name}</div>
                  <div
                    className={`text-[10px] font-semibold uppercase tracking-wider ${
                      currentUser.plan === "enterprise"
                        ? "text-[var(--accent-blue)]"
                        : currentUser.plan === "pro"
                        ? "text-[var(--accent)]"
                        : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {currentUser.plan} plan
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  onNavigateToLanding();
                  setMobileNavOpen(false);
                }}
                className="text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 transition-colors"
              >
                Home
              </button>
              {currentUser && (
                <button
                  onClick={() => {
                    onNavigateToDashboard();
                    setMobileNavOpen(false);
                  }}
                  className="text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 transition-colors"
                >
                  Dashboard
                </button>
              )}
              {currentUser ? (
                <button
                  onClick={() => {
                    onLogout();
                    setMobileNavOpen(false);
                  }}
                  className="text-left text-sm text-[var(--accent-red)] hover:bg-[rgba(196,82,82,0.08)] rounded-lg px-3 py-2 transition-colors mt-1"
                >
                  Sign out
                </button>
              ) : (
                <button
                  onClick={() => {
                    onNavigateToAuth();
                    setMobileNavOpen(false);
                  }}
                  className="text-left text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent-muted)] rounded-lg px-3 py-2 transition-colors mt-1"
                >
                  Sign in
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-6 text-center">
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl text-[var(--text-primary)] leading-tight mb-4">
          Simple, transparent <span className="text-[var(--accent)]">pricing</span>
        </h1>
        <p className="text-[var(--text-secondary)] text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
          Start free. Upgrade when you need the full power of automated job hunting.
        </p>
        {currentUser && (
          <p className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
            Currently on{" "}
            <span
              className={
                currentUser.plan === "enterprise"
                  ? "text-[var(--accent-blue)]"
                  : currentUser.plan === "pro"
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)]"
              }
            >
              {currentUser.plan}
            </span>
          </p>
        )}
        {flash && (
          <div
            className={`mt-5 mx-auto max-w-md text-sm rounded-xl px-4 py-3 border ${
              flash.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-[var(--accent-red-muted)] border-[rgba(196,82,82,0.2)] text-red-400"
            }`}
          >
            {flash.msg}
          </div>
        )}
      </div>

      {/* Plans Grid */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => {
            const isCurrent = currentUser && plan.id === currentPlan;
            const isSwitching = switching === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl p-6 sm:p-8 border transition-all ${
                  isCurrent
                    ? "bg-[var(--bg-raised)] border-[var(--accent)]/50 shadow-[0_0_40px_rgba(201,169,78,0.08)]"
                    : plan.highlighted
                    ? "bg-[var(--bg-raised)] border-[rgba(201,169,78,0.25)] shadow-[0_0_40px_rgba(201,169,78,0.06)]"
                    : "bg-[var(--bg-raised)] border-[var(--border-subtle)] hover:border-[var(--border-default)]"
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--accent)] text-[#0a0b0e]">
                    Your plan
                  </div>
                )}
                {!isCurrent && plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--accent)] text-[#0a0b0e]">
                    Most Popular
                  </div>
                )}

                {/* Plan Header */}
                <div className="mb-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: plan.accent }}>
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl text-[var(--text-primary)]">{plan.price}</span>
                    <span className="text-sm text-[var(--text-tertiary)]">{plan.period}</span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mt-2">{plan.description}</p>
                </div>

                {/* Divider */}
                <div className="h-px bg-[var(--border-subtle)] mb-6" />

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <span
                        className="shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                        style={{ background: plan.accentMuted, color: plan.accent }}
                      >
                        ✓
                      </span>
                      <span className="text-[var(--text-secondary)]">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Enterprise tier picker - only rendered inside the Enterprise
                    card, and only for users already on the Enterprise plan.
                    Switching tiers is a pricing decision (each tier has its
                    own usage cap) so it lives here rather than on the
                    landing-page limits panel. */}
                {plan.id === "enterprise" && currentPlan === "enterprise" && (() => {
                  // Single source of truth for enterprise tier caps - slide
                  // the slider and these numbers update live.
                  const TIER_CAPS: Record<1 | 2 | 3, { jobs: number; tailor: number }> = {
                    1: { jobs: 20, tailor: 10 },
                    2: { jobs: 35, tailor: 20 },
                    3: { jobs: 50, tailor: 50 },
                  };
                  const current = TIER_CAPS[enterpriseTier];
                  return (
                    <div className="mb-6 p-4 rounded-xl bg-[rgba(103,117,160,0.08)] border border-[rgba(103,117,160,0.2)]">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: plan.accent }}>
                          Your tier
                        </label>
                        <span className="font-display text-lg font-bold tabular-nums" style={{ color: plan.accent }}>
                          Tier {enterpriseTier}
                        </span>
                      </div>

                      {/* Big live-updating cap display - changes as the user
                          drags the slider, so the plan impact is immediate. */}
                      <div className="mb-3 p-3 rounded-lg bg-[rgba(103,117,160,0.12)] border border-[rgba(103,117,160,0.25)] text-center">
                        <div className="font-display text-2xl font-bold tabular-nums" style={{ color: plan.accent }}>
                          {current.jobs} <span className="text-[var(--text-tertiary)] text-base font-normal">jobs</span>
                          <span className="mx-2 text-[var(--text-tertiary)]">·</span>
                          {current.tailor} <span className="text-[var(--text-tertiary)] text-base font-normal">resumes</span>
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
                          scraped and tailored per candidate, per day
                        </div>
                      </div>

                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={1}
                        value={enterpriseTier}
                        onChange={(e) => handleTierChange(Number(e.target.value) as 1 | 2 | 3)}
                        disabled={savingTier}
                        className="w-full cursor-pointer"
                        style={{ accentColor: plan.accent as string }}
                      />
                      <div className="grid grid-cols-3 gap-1.5 mt-2">
                        {([1, 2, 3] as const).map((tier) => {
                          const active = enterpriseTier === tier;
                          const caps = TIER_CAPS[tier];
                          return (
                            <div
                              key={tier}
                              className={`text-center px-2 py-1.5 rounded-md text-[10px] font-mono border transition-all ${
                                active
                                  ? "bg-[rgba(103,117,160,0.15)] text-[var(--accent-blue)] border-[rgba(103,117,160,0.5)]"
                                  : "text-[var(--text-tertiary)] border-[var(--border-subtle)]"
                              }`}
                            >
                              <div className="font-semibold">Tier {tier}</div>
                              <div>{caps.jobs}/{caps.tailor}</div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[10px] text-[var(--text-tertiary)] text-center">
                        {savingTier ? "Saving…" : "Applies to your next pipeline run"}
                      </p>
                    </div>
                  );
                })()}

                {/* CTA */}
                <button
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={Boolean(isCurrent) || isSwitching || switching !== null || Boolean(plan.disabled)}
                  className={`w-full rounded-xl py-3 px-4 font-medium text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                    isCurrent
                      ? "bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.3)] text-[var(--accent)]"
                      : plan.highlighted
                      ? "launch-btn"
                      : "border text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                  }`}
                  style={
                    !plan.highlighted && !isCurrent
                      ? { borderColor: plan.accentBorder, background: plan.accentMuted }
                      : undefined
                  }
                >
                  {ctaLabel(plan)}
                </button>
                {plan.disabled && (
                  <p className="mt-2 text-[10px] text-[var(--text-tertiary)] text-center">
                    Coming after public launch. Testers are limited to Free and Pro.
                  </p>
                )}
                {!plan.disabled && currentUser && plan.id !== "free" && plan.id !== currentPlan && (
                  <p className="mt-2 text-[10px] text-[var(--text-ghost)] text-center">
                    Testing mode, no payment. Switches instantly.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* FAQ / Bottom Section */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 sm:pb-20 pt-4 sm:pt-8">
        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 sm:p-8">
          <h3 className="font-display text-xl text-[var(--text-primary)] mb-6 text-center">Frequently asked</h3>
          <div className="space-y-5">
            {[
              {
                q: "What happens when my free trial ends?",
                a: "You keep access to all your tracked jobs and the Kanban board. You just lose access to automated pipeline runs and AI features until you subscribe.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. No contracts, no lock-in. Cancel from your account settings and you'll retain access until the end of your billing period.",
              },
              {
                q: "What is the Enterprise plan for?",
                a: "Built for recruitment consultancies, job guarantee companies, and career coaches who manage multiple candidates. Each candidate gets their own dashboard, resume, and pipeline runs with individual usage tracking.",
              },
              {
                q: "How does resume tailoring work?",
                a: "Our AI reads the job description, identifies key requirements, and rewrites your resume bullets to match, at whatever intensity level you set.",
              },
            ].map(({ q, a }) => (
              <div key={q}>
                <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">{q}</h4>
                <p className="text-sm text-[var(--text-tertiary)] leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
