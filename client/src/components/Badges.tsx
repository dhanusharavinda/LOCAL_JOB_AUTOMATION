import { ShieldIcon, SparkleIcon, DocumentIcon, CheckIcon } from "./icons";

/**
 * The claims worth making, in the order they matter to a job seeker.
 *
 * BANNED_WORD_COUNT mirrors BANNED_COUNT in
 * server/src/prompts/banned-words.ts. If that list grows, update this
 * number: it is printed on the site, so it has to stay true.
 */
export const BANNED_WORD_COUNT = 1601;

const BADGES = [
  { icon: SparkleIcon, label: "Anti AI slop", tone: "accent" as const },
  { icon: CheckIcon, label: `${BANNED_WORD_COUNT.toLocaleString()}+ banned AI words`, tone: "accent" as const },
  { icon: DocumentIcon, label: "LaTeX-style PDF", tone: "blue" as const },
  { icon: SparkleIcon, label: "Tuned for ATS scoring", tone: "blue" as const },
  { icon: ShieldIcon, label: "Nothing stored", tone: "green" as const },
  { icon: SparkleIcon, label: "Free AI mock interview, weekly", tone: "accent" as const },
];

export function FeatureBadges({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`}>
      {BADGES.map((b) => {
        const Icon = b.icon;
        const tone =
          b.tone === "green"
            ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300"
            : b.tone === "blue"
              ? "border-[rgba(103,117,160,0.3)] bg-[var(--accent-blue-muted)] text-[#8f9dc8]"
              : "border-[rgba(249, 115, 22,0.28)] bg-[var(--accent-muted)] text-[var(--accent)]";
        return (
          <span
            key={b.label}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium ${tone}`}
          >
            <Icon size={13} />
            {b.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The creator's own result. It is his personal outcome, not a promise,
 * so it is written as a quote with his name on it rather than as a
 * headline statistic.
 */
export function ResultQuote({ className = "" }: { className?: string }) {
  return (
    <figure
      className={`rounded-2xl border border-[rgba(249, 115, 22,0.22)] bg-gradient-to-br from-[var(--accent-muted)] to-transparent p-5 ${className}`}
    >
      <blockquote className="font-display text-lg sm:text-xl text-[var(--text-primary)] leading-snug">
        "This is the tool that got me 2 job offers and 3 interviews."
      </blockquote>
      <figcaption className="mt-2.5 text-xs text-[var(--text-tertiary)]">
        Dhanush Aravind, who built it while job hunting
      </figcaption>
    </figure>
  );
}

/**
 * The line that keeps the product honest, and the question people ask
 * first: does this make things up?
 */
export function HonestyNote({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">This is not about lying</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        The point is not to fabricate your resume. It is to describe the work you genuinely
        did in the words that specific job description uses, so the screening software and the
        recruiter both recognise the match. Same experience, better matched wording.
      </p>
    </div>
  );
}
