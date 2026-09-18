import Ambient, { BrandMark } from "./Ambient";
import { ShieldIcon, LinkedInIcon, InstagramIcon } from "./icons";
import { FeatureBadges, ResultQuote, HonestyNote, BANNED_WORD_COUNT } from "./Badges";

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

export default function CreatorPage({ onBack }: Props) {
  return (
    <div className="min-h-screen">
      <Ambient />
      <header className="px-5 sm:px-6 py-5">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark />
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
          <div className="bg-[var(--bg-raised)]/80 backdrop-blur-xl border border-[var(--border-default)] rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/40">
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
                <span className="text-[var(--text-primary)] font-medium">This exists because of my LinkedIn community.</span>{" "}
                They watched the whole thing: the ups, the downs, the events I turned up to, the
                projects I kept building when nothing was landing. They encouraged me, shared my
                work, and pushed me to keep going, and that support is a real part of how I ended
                up with a job.
              </p>
              <p>
                So this is me giving something back. Everyone who was there for me gets the tool
                that got me there, for free.
              </p>
              <p>
                I built it because I had already tried the other resume tools. They charge a lot,
                and what comes out reads like every other AI paragraph on the internet: passionate,
                results-driven, leveraging cutting-edge solutions. A recruiter spots that in
                seconds, and so does an ATS that is looking for the actual words in the job ad.
              </p>
              <p>
                So I went the other way. I banned{" "}
                <span className="text-[var(--accent)] font-medium">{BANNED_WORD_COUNT.toLocaleString()}+ words and phrases</span>{" "}
                that AI reaches for by default, and tuned the prompts around how applicant tracking
                systems actually score a resume. The output is a clean, LaTeX-style PDF that reads
                like a person wrote it, because the only thing in it is your real work.
              </p>
            </div>

            <ResultQuote className="mt-6" />
            <FeatureBadges className="mt-6 justify-start" />

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <a
                href={CREATOR.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#0a66c2] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                <LinkedInIcon /> Connect on LinkedIn
              </a>
              <a
                href={CREATOR.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold text-sm hover:border-[var(--border-default)] transition-all"
              >
                <InstagramIcon /> Follow on Instagram
              </a>
            </div>
          </div>

          <HonestyNote className="mt-5" />

          {/* Privacy, spelled out properly. This is the question people
              actually have before uploading a CV to a stranger's site. */}
          <div className="mt-5 bg-[var(--bg-raised)]/80 backdrop-blur-xl border border-[var(--border-default)] rounded-3xl p-6">
            <div className="flex items-center gap-2.5 mb-3">
              <ShieldIcon size={18} className="text-emerald-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Your resume stays yours</h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              I don't store your resume. It's held in memory just long enough to write your tailored
              version, then it's gone. Nothing is written to the database, no copy of your CV is kept
              on the servers, and the finished PDF is sent straight to your browser rather than saved
              anywhere. The only thing recorded is a count of how many documents you generated, so the
              daily limit works.
            </p>
            <p className="text-xs text-[var(--text-tertiary)] leading-relaxed mt-3">
              To be straight with you about how it works: the text is sent to an AI provider (OpenAI)
              to do the rewriting. They process it to return your resume and do not train on it.
            </p>
          </div>

          <div className="mt-5 bg-[var(--bg-raised)]/80 backdrop-blur-xl border border-[var(--border-default)] rounded-3xl p-6">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Want access?</h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              GO CANDID8 is invite-only while I keep an eye on things. Message me on LinkedIn,
              or comment on my launch post, and I'll send you your own link. It's free, and it
              stays free for the people who supported me.
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
