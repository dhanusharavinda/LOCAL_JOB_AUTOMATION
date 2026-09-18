/**
 * Icon set for the launch surfaces.
 *
 * One consistent stroke weight, currentColor, sized by the `size` prop.
 * These replace the emoji that were standing in for icons: emoji render
 * differently on every platform and are the fastest way to make a
 * product look thrown together.
 */

type IconProps = { size?: number; className?: string; strokeWidth?: number };

function Svg({ size = 20, className = "", strokeWidth = 1.7, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Invitation / ticket: the "you're invited" moment. */
export const TicketIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4v-1Z" />
    <path d="M14 7.5v9" strokeDasharray="1.5 2.5" />
  </Svg>
);

/** Shield with a tick: privacy and "nothing is stored". */
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6l-7-3Z" />
    <path d="m9.2 12.2 2 2 3.6-3.9" />
  </Svg>
);

/** Sparkles: AI actions. */
export const SparkleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.6 8 18 9.5 13.6 11 12 15.5 10.4 11 6 9.5 10.4 8 12 3.5Z" />
    <path d="M18.5 15.5 19.2 17.6 21.3 18.3 19.2 19 18.5 21.1 17.8 19 15.7 18.3 17.8 17.6 18.5 15.5Z" />
  </Svg>
);

/** Document: resumes. */
export const DocumentIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);

/** Clock: time has run out. */
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

/** Check inside a circle: feature list ticks. */
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.3 2.4 2.4 4.6-5" />
  </Svg>
);

/** Waving hand replacement: a friendly spark for the welcome line. */
export const WelcomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    <circle cx="12" cy="12" r="4" />
  </Svg>
);

export const LinkedInIcon = ({ size = 18, className = "" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M4.98 3.5a2.5 2.5 0 1 1-.02 5 2.5 2.5 0 0 1 .02-5ZM3 9h4v12H3V9Zm6 0h3.8v1.7h.05c.53-.95 1.83-1.95 3.76-1.95 4.02 0 4.76 2.5 4.76 5.76V21H17.6v-5.5c0-1.31-.02-3-1.9-3-1.9 0-2.2 1.43-2.2 2.9V21H9V9Z" />
  </svg>
);

export const InstagramIcon = ({ size = 18, className = "" }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={1.8}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

/**
 * Privacy reassurance. Used on the invite door, the home page and the
 * tailor itself, because "where does my resume go" is the first thing
 * anyone sensible asks before uploading a CV.
 */
export function PrivacyNote({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  if (compact) {
    return (
      <p className={`flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)] ${className}`}>
        <ShieldIcon size={14} className="text-emerald-400 shrink-0" />
        <span>Private by design. Your resume is never stored.</span>
      </p>
    );
  }
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 ${className}`}>
      <ShieldIcon size={18} className="text-emerald-400 shrink-0 mt-0.5" />
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        <span className="text-emerald-300 font-semibold">Completely private.</span>{" "}
        Your resume is used to write your documents and then discarded. Nothing is saved to our
        database, and no copy of your CV is kept on our servers.
      </p>
    </div>
  );
}
