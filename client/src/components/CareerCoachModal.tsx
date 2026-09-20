import { useEffect, useState, useCallback } from "react";
import { getCareerRoadmap, generateCareerRoadmap, CareerRoadmap } from "../api";

interface Props {
  onClose: () => void;
}

/**
 * AI Career Coach.
 * Shows the user's latest roadmap (positioning, skill gaps, learning plan,
 * salary benchmark, next actions) and lets them (re)generate it. The
 * roadmap is grounded server-side in the user's resume + scored jobs +
 * in-demand skills; the salary numbers are computed from real postings.
 */
export default function CareerCoachModal({ onClose }: Props) {
  const [roadmap, setRoadmap] = useState<CareerRoadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reusable so the error state can offer a real "Try again" (re-fetch the
  // existing roadmap) rather than only "Build a new one".
  const loadRoadmap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoadmap(await getCareerRoadmap());
    } catch {
      setError("Could not load your roadmap.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoadmap(); }, [loadRoadmap]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await generateCareerRoadmap();
      setRoadmap(r);
    } catch (e: any) {
      setError(e?.message || "Could not build your roadmap.");
    } finally {
      setGenerating(false);
    }
  }, []);

  const priorityColor = (p: string) =>
    p === "high"
      ? "bg-[#c45252]/15 text-[#e08585] border-[#c45252]/30"
      : p === "medium"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-[#5b9ea6]/15 text-[#7fc0c8] border-[#5b9ea6]/30";

  const fmtMoney = (n: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${currency} ${n.toLocaleString()}`;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0d0f13] border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/60 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-50 flex items-center gap-2">
              <span className="text-[#f97316]">◆</span> AI Career Coach
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {roadmap?.generated_at
                ? `Roadmap built ${new Date(roadmap.generated_at).toLocaleString()}`
                : "Roadmap, salary benchmarks, and learning suggestions tuned to your profile"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {roadmap && (
              <button
                onClick={generate}
                disabled={generating}
                className="font-mono text-xs uppercase tracking-wider px-3 py-1.5 rounded-lg border border-[#f97316]/30 bg-[#f97316]/12 text-[#f97316] hover:bg-[#f97316]/20 transition-all disabled:opacity-50"
              >
                {generating ? "Building..." : "Regenerate"}
              </button>
            )}
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && roadmap && (
            <div className="mb-4 p-3 rounded-xl text-xs bg-red-500/8 border border-red-500/20 text-red-400">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-7 h-7 border-2 border-[#f97316] border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-500 text-sm">Loading your roadmap...</p>
            </div>
          ) : error && !roadmap ? (
            // Load failed - offer a retry (re-fetch the saved roadmap), not
            // the onboarding empty state, so a returning user isn't told
            // their roadmap is gone on a transient error.
            <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center">
                <span className="text-red-400 text-xl">!</span>
              </div>
              <div>
                <p className="text-gray-200 text-sm font-medium mb-1">Couldn't load your roadmap</p>
                <p className="text-gray-500 text-xs max-w-sm">Usually a temporary network or sign-in hiccup, not lost data.</p>
              </div>
              <button
                onClick={loadRoadmap}
                className="font-mono text-xs uppercase tracking-wider px-4 py-2.5 rounded-lg border border-[#f97316]/30 bg-[#f97316]/12 text-[#f97316] hover:bg-[#f97316]/20 transition-all"
              >
                Try again
              </button>
            </div>
          ) : !roadmap ? (
            // Empty state - no roadmap yet
            <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#f97316]/10 border border-[#f97316]/25 flex items-center justify-center">
                <span className="text-[#f97316] text-xl">◆</span>
              </div>
              <div>
                <p className="text-gray-200 text-sm font-medium mb-1">No roadmap yet</p>
                <p className="text-gray-500 text-xs max-w-sm">
                  The coach reads your resume, the jobs you've scored, and the skills
                  showing up in your market, then maps the gaps and a learning plan.
                </p>
              </div>
              <button
                onClick={generate}
                disabled={generating}
                className="font-mono text-xs uppercase tracking-wider px-4 py-2.5 rounded-lg border border-[#f97316]/30 bg-[#f97316]/12 text-[#f97316] hover:bg-[#f97316]/20 transition-all disabled:opacity-50"
              >
                {generating ? "Building your roadmap..." : "Build my roadmap"}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Positioning */}
              {(roadmap.role_target || roadmap.summary) && (
                <section>
                  {roadmap.role_target && (
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#f97316] mb-1">
                      Target: {roadmap.role_target}
                    </div>
                  )}
                  {roadmap.summary && (
                    <p className="text-sm text-gray-300 leading-relaxed">{roadmap.summary}</p>
                  )}
                </section>
              )}

              {/* Salary benchmark */}
              {roadmap.salary_benchmark && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-gray-400 mb-2">
                    Salary benchmark
                  </h3>
                  <div className="rounded-xl border border-gray-800/60 bg-[#0f1115] p-4">
                    <div className="flex items-end justify-between gap-3">
                      {([
                        ["p25", roadmap.salary_benchmark.low],
                        ["median", roadmap.salary_benchmark.median],
                        ["p75", roadmap.salary_benchmark.high],
                      ] as const).map(([label, val]) => (
                        <div key={label} className="text-center flex-1">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-gray-600">{label}</div>
                          <div className={`font-mono tabular-nums ${label === "median" ? "text-lg text-[#5d9968]" : "text-sm text-gray-300"}`}>
                            {fmtMoney(val, roadmap.salary_benchmark!.currency)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-600 mt-3">
                      From {roadmap.salary_benchmark.sample_size} of your scored jobs.
                      {roadmap.salary_benchmark.note ? ` ${roadmap.salary_benchmark.note}` : ""}
                    </p>
                  </div>
                </section>
              )}

              {/* Skill gaps */}
              {roadmap.skill_gaps.length > 0 && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-gray-400 mb-2">
                    Skill gaps to close
                  </h3>
                  <div className="space-y-2">
                    {roadmap.skill_gaps.map((g, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-xl border border-gray-800/60 bg-[#0f1115] p-3">
                        <span className={`shrink-0 mt-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${priorityColor(g.priority)}`}>
                          {g.priority}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm text-gray-200 font-medium">{g.skill}</div>
                          {g.why && <div className="text-xs text-gray-500 mt-0.5">{g.why}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Learning plan */}
              {roadmap.learning_plan.length > 0 && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-gray-400 mb-2">
                    Learning plan
                  </h3>
                  <div className="space-y-2">
                    {roadmap.learning_plan.map((l, i) => (
                      <div key={i} className="rounded-xl border border-gray-800/60 bg-[#0f1115] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm text-gray-200 font-medium">{l.title}</div>
                          {l.timeframe && (
                            <span className="shrink-0 text-[10px] font-mono text-[#f97316] bg-[#f97316]/10 border border-[#f97316]/25 px-1.5 py-0.5 rounded">
                              {l.timeframe}
                            </span>
                          )}
                        </div>
                        {l.detail && <div className="text-xs text-gray-500 mt-1">{l.detail}</div>}
                        {l.resource && (
                          <div className="text-[11px] text-[#5b9ea6] mt-1">→ {l.resource}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Action items */}
              {roadmap.action_items.length > 0 && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-gray-400 mb-2">
                    Next steps
                  </h3>
                  <ul className="space-y-1.5">
                    {roadmap.action_items.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-[#5d9968] mt-0.5 shrink-0">✓</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
