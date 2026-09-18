/**
 * Creator page. Who made GO CANDID8, and where to reach him.
 * Linked from the invite front door and the early-access home, and it
 * doubles as the "how do I get in" page: the invite comes from a DM.
 */

export const CREATOR = {
  name: "Dhanush Aravind",
  linkedin: "https://www.linkedin.com/in/dhanush-aravind/",
  instagram: "https://www.instagram.com/_.dhanush7._/",
};

interface Props {
  onBack: () => void;
}

const LinkedInIcon = (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M4.98 3.5a2.5 2.5 0 11-.02 5 2.5 2.5 0 01.02-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.76-1.95 4.02 0 4.76 2.5 4.76 5.76V21H17.6v-5.5c0-1.31-.02-3-1.9-3-1.9 0-2.2 1.43-2.2 2.9V21H9z" />
  </svg>
);

const InstagramIcon = (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export default function CreatorPage({ onBack }: Props) {
  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <header className="px-5 sm:px-6 py-5">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-lg text-[var(--text-primary)] tracking-wide truncate">GO CANDID8</span>
          </div>
          <button
            onClick={onBack}
            className="shrink-0 text-sm font-medium px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
          >
            Back
          </button>
        </div>
      </header>

      <main className="px-5 sm:px-6 pb-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-20 h-20 shrink-0 rounded-2xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.25)] flex items-center justify-center">
                <span className="font-display text-3xl text-[var(--accent)]">D</span>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Created by</div>
                <h1 className="font-display text-2xl sm:text-3xl text-[var(--text-primary)]">{CREATOR.name}</h1>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  I built GO CANDID8 on my own, for people job hunting like me.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4 text-[15px] text-[var(--text-secondary)] leading-relaxed">
              <p>
                Job hunting means rewriting the same resume for every single posting. It's slow,
                and it's the part everyone skips when they're tired, which is exactly when
                applications stop landing.
              </p>
              <p>
                So I built the thing I wanted: paste a job description, get a resume written
                for that job in seconds, edit anything you want, download the PDF. That's it.
                It's free to use, and I'd rather people just have it.
              </p>
              <p>
                I'm still building. More of the product is on the way, and everything new shows
                up in your account automatically.
              </p>
            </div>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <a
                href={CREATOR.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#0a66c2] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                {LinkedInIcon} Connect on LinkedIn
              </a>
              <a
                href={CREATOR.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold text-sm hover:border-[var(--border-default)] transition-all"
              >
                {InstagramIcon} Follow on Instagram
              </a>
            </div>
          </div>

          <div className="mt-5 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Want access?</h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              GO CANDID8 is invite-only while I keep an eye on things. Message me on LinkedIn,
              or comment on my launch post, and I'll send you your own link. It's free.
            </p>
            <a
              href={CREATOR.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Message me for a link
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
