import { useEffect, useState, useCallback, useRef } from "react";
import { fetchJobMatches, JobMatch, JobMatchesResponse } from "../api";

interface Props {
  onClose: () => void;
}

// Surfacing layer auto-refresh cadence. The underlying scrape+score is the
// pipeline; this just re-reads the curated list so a finished pipeline run
// shows up without the user reopening the panel.
const REFRESH_MS = 60 * 60 * 1000; // hourly

export default function JobMatchesModal({ onClose }: Props) {
  const [data, setData] = useState<JobMatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(6);
  const minRef = useRef(minScore);
  minRef.current = minScore;
  // Monotonic request id so overlapping loads (threshold clicks, manual
  // refresh, hourly poll) can't resolve out of order and show a list that
  // doesn't match the selected threshold.
  const reqIdRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    const myId = ++reqIdRef.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await fetchJobMatches(minRef.current, 50);
      if (myId !== reqIdRef.current) return; // superseded by a newer load
      setData(res);
    } catch {
      // Never surface an error banner for a background (silent) refresh —
      // the already-shown matches are still valid.
      if (myId === reqIdRef.current && !silent) setError("Could not load your matches.");
    } finally {
      if (myId === reqIdRef.current && !silent) setLoading(false);
    }
  }, []);

  // Initial load + reload when the threshold changes.
  useEffect(() => { load(); }, [load, minScore]);

  // Hourly background refresh while the panel is open.
  useEffect(() => {
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const matches: JobMatch[] = data?.matches || [];
  const profile = data?.profile;

  const scoreColor = (s: number | null) => {
    if (s == null) return "text-gray-500";
    if (s >= 8) return "text-[#5d9968]";
    if (s >= 6) return "text-[#c9a94e]";
    return "text-gray-400";
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
            <h2 className="text-base font-bold text-gray-50">Job Matches</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Curated from your scored jobs, matched to your skills, salary, and city.
              {data?.generated_at && (
                <span className="text-gray-600"> Refreshed {new Date(data.generated_at).toLocaleTimeString()}.</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 pt-3 pb-1 shrink-0 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-wider text-gray-600">Min match</span>
          {[6, 7, 8].map((s) => (
            <button
              key={s}
              onClick={() => setMinScore(s)}
              className={`font-mono text-xs px-2.5 py-1 rounded-lg border transition-all ${
                minScore === s
                  ? "bg-[#c9a94e]/12 border-[#c9a94e]/30 text-[#c9a94e]"
                  : "bg-transparent border-gray-800/60 text-gray-500 hover:text-gray-300"
              }`}
            >
              {s}+
            </button>
          ))}
          <div className="flex-1" />
          {profile && (profile.city || profile.salary_min || profile.salary_max) && (
            <span className="text-[10px] text-gray-600">
              Aligned to {profile.city ? profile.city : "your profile"}
              {profile.salary_min || profile.salary_max ? " + target salary" : ""}
            </span>
          )}
          <button
            onClick={() => load()}
            className="font-mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-lg border border-gray-800/60 text-gray-500 hover:text-[#c9a94e] transition-all"
          >
            Refresh
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 p-3 rounded-xl text-xs bg-red-500/8 border border-red-500/20 text-red-400">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-7 h-7 border-2 border-[#c9a94e] border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-500 text-sm">Finding your matches...</p>
            </div>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <p className="text-gray-300 text-sm font-medium">No matches at {minScore}+ yet</p>
              <p className="text-gray-500 text-xs max-w-sm">
                Run the pipeline to scrape and score jobs, or lower the minimum match.
                Matches appear here as soon as they're scored.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {matches.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-gray-800/60 bg-[#0f1115] p-3 hover:border-gray-700/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-100 font-medium truncate">{m.job_title}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {m.company_name}
                        {m.location ? ` · ${m.location}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(m.match_score)}`}>
                        {m.match_score ?? "-"}
                        <span className="text-xs text-gray-600">/10</span>
                      </div>
                      {m.letter_grade && (
                        <div className="text-[10px] font-mono text-gray-500">Grade {m.letter_grade}</div>
                      )}
                    </div>
                  </div>

                  {/* Alignment chips */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {m.detected_role_type && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-400">
                        {m.detected_role_type}
                      </span>
                    )}
                    {m.salary_fit && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#5d9968]/15 text-[#7fc08a] border border-[#5d9968]/30">
                        salary fit
                      </span>
                    )}
                    {m.city_fit && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#5b9ea6]/15 text-[#7fc0c8] border border-[#5b9ea6]/30">
                        in your city
                      </span>
                    )}
                    {m.salary && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800/40 text-gray-500">
                        {m.salary}
                      </span>
                    )}
                  </div>

                  {m.match_reason && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-2">{m.match_reason}</p>
                  )}

                  {(m.apply_url || m.job_link) && (
                    <a
                      href={m.apply_url || m.job_link || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-[11px] font-mono text-[#c9a94e] hover:text-[#d4b85a] transition-colors"
                    >
                      View role
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
