import { useEffect, useState } from "react";
import { AuthUser, interviewQuota, InterviewQuota } from "../api";
import InterviewSession from "./InterviewSession";
import FreeTailorSection from "./FreeTailorSection";
import { ComingSoonGrid } from "./ComingSoon";
import { CREATOR } from "./CreatorPage";
import Ambient, { BrandMark } from "./Ambient";
import { PrivacyNote, LinkedInIcon, InstagramIcon } from "./icons";
import { FeatureBadges } from "./Badges";

interface Props {
  currentUser: AuthUser;
  onLogout: () => void | Promise<void>;
  onOpenCreator: () => void;
}

/**
 * Home for early-access users during the invite-only launch.
 * The Resume Tailor is the product right now; everything else is shown
 * as "coming soon" so people know what's on the way.
 */
export default function LaunchHome({ currentUser, onLogout, onOpenCreator }: Props) {
  const firstName = (currentUser.name || "").split(" ")[0] || "there";
  const [quota, setQuota] = useState<InterviewQuota | null>(null);
  const [showInterview, setShowInterview] = useState(false);

  // Refreshed when the interviewer closes so the remaining count is
  // right straight after a session rather than on the next page load.
  const loadQuota = () => { interviewQuota().then(setQuota).catch(() => setQuota(null)); };
  useEffect(loadQuota, []);

  const left = quota ? Math.max(0, quota.remaining) : null;
  const resetsOn = quota?.resets_at
    ? new Date(quota.resets_at).toLocaleDateString(undefined, { weekday: "long" })
    : "Monday";

  return (
    <div className="min-h-screen">
      <Ambient />
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/70 backdrop-blur-xl" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandMark />
            <span className="font-display text-lg text-[var(--text-primary)] tracking-wide truncate">Tailorly AI</span>
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
        <div className="rounded-2xl border border-[rgba(249, 115, 22,0.2)] bg-gradient-to-br from-[var(--accent-muted)] to-transparent p-5">
          <h1 className="font-display text-xl sm:text-2xl text-[var(--text-primary)]">
            Welcome, {firstName}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Thank you for being one of the first. Tailored resumes, cover letters and a
            weekly AI mock interview, all free.
          </p>
          <FeatureBadges className="mt-4 justify-start" />
          <PrivacyNote className="mt-4" />
        </div>
      </div>

      {/* The product */}
      <FreeTailorSection currentUser={currentUser} onNavigateToPricing={() => {}} launchMode />

      {/* Practice interview: one a week, because a session costs about a
          hundred times what a tailored resume does. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-12">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-xl sm:text-2xl text-[var(--text-primary)]">
                  Practice interview
                </h2>
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)]/25">
                  New
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-xl leading-relaxed">
                A voice interviewer that asks five questions written for the exact job,
                follows up when an answer is thin, and scores you at the end. Speak your
                answers or type them. Free, like everything else here.
              </p>
              <p className="text-xs text-[var(--accent)] mt-2 font-medium">
                One round a week, so give it a proper go: somewhere quiet, about 10 minutes.
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-3">
                {left === null
                  ? "One session a week, free."
                  : left > 0
                  ? `${left} session${left === 1 ? "" : "s"} left this week. Refills ${resetsOn}.`
                  : `You have used this week's session. It refills ${resetsOn}.`}
              </p>
            </div>
            <button
              onClick={() => setShowInterview(true)}
              disabled={left === 0}
              className="px-5 py-3 rounded-xl bg-[var(--accent)] text-[#06070a] text-sm font-semibold hover:bg-[var(--accent-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {left === 0 ? `Back ${resetsOn}` : "Start interview"}
            </button>
          </div>
        </div>
      </section>

      {showInterview && (
        <InterviewSession
          onClose={() => { setShowInterview(false); loadQuota(); }}
        />
      )}

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

      <footer className="border-t border-[var(--border-subtle)] px-4 sm:px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <p className="text-sm text-[var(--text-tertiary)]">
            Built by{" "}
            <button onClick={onOpenCreator} className="text-[var(--accent)] hover:underline font-medium">{CREATOR.name}</button>
            . Found a bug or have an idea? Message me.
          </p>
          <div className="flex items-center gap-2">
            <a href={CREATOR.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all">
              <LinkedInIcon size={15} /> LinkedIn
            </a>
            <a href={CREATOR.instagram} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all">
              <InstagramIcon size={15} /> Instagram
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
