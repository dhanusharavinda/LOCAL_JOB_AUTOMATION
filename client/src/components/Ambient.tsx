/**
 * Ambient page background.
 *
 * Pure CSS, no images and no network cost: two slow-drifting brass and
 * slate glows, a fine engineering grid that fades out at the edges, and
 * a faint film grain so the flat black never looks like a dead screen.
 * Everything sits behind the content and ignores pointer events.
 *
 * Motion is disabled for anyone with "reduce motion" turned on.
 */

// Film grain as an inline SVG turbulence filter. Tiny, cached, and it
// keeps large dark areas from banding on cheap panels.
const GRAIN =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
       <filter id='n'>
         <feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/>
         <feColorMatrix type='saturate' values='0'/>
       </filter>
       <rect width='160' height='160' filter='url(#n)' opacity='0.5'/>
     </svg>`
  );

export default function Ambient({ variant = "default" }: { variant?: "default" | "warm" }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Brass glow, top */}
      <div
        className="ambient-drift-a absolute rounded-full"
        style={{
          top: "-28vh",
          left: "-10vw",
          width: "70vw",
          height: "70vw",
          maxWidth: 900,
          maxHeight: 900,
          background:
            "radial-gradient(circle, rgba(249, 115, 22,0.30) 0%, rgba(249, 115, 22,0.10) 40%, transparent 70%)",
          filter: "blur(28px)",
        }}
      />
      {/* Slate glow, bottom right */}
      <div
        className="ambient-drift-b absolute rounded-full"
        style={{
          bottom: "-32vh",
          right: "-14vw",
          width: "75vw",
          height: "75vw",
          maxWidth: 950,
          maxHeight: 950,
          background:
            variant === "warm"
              ? "radial-gradient(circle, rgba(196,82,82,0.20) 0%, rgba(103,117,160,0.10) 42%, transparent 72%)"
              : "radial-gradient(circle, rgba(103,117,160,0.26) 0%, rgba(103,117,160,0.09) 42%, transparent 72%)",
          filter: "blur(36px)",
        }}
      />
      {/* Engineering grid, faded toward the edges */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 95% 70% at 50% 35%, #000 20%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 95% 70% at 50% 35%, #000 20%, transparent 85%)",
        }}
      />
      {/* Spotlight behind the headline, so the hero has a focal point */}
      <div
        className="absolute inset-x-0 top-0 h-[70vh]"
        style={{
          background: "radial-gradient(ellipse 55% 100% at 50% 0%, rgba(249, 115, 22,0.10), transparent 70%)",
        }}
      />
      {/* Film grain */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: `url("${GRAIN}")`, backgroundSize: "160px 160px" }}
      />
      {/* Top hairline: catches the eye at the very top of the page */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(249, 115, 22,0.35), transparent)" }}
      />
    </div>
  );
}

/** Brand mark: the diamond in a softly glowing brass tile. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-xl border border-[rgba(249, 115, 22,0.28)] bg-[var(--accent-muted)] shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-xl"
        style={{ boxShadow: "0 0 24px rgba(249, 115, 22,0.28)" }}
      />
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} className="relative" aria-hidden>
        <defs>
          <linearGradient id="gc8-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffc08a" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <path d="M12 2.6 21.4 12 12 21.4 2.6 12 12 2.6Z" fill="url(#gc8-mark)" />
      </svg>
    </span>
  );
}
