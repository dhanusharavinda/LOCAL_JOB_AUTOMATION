import { Draggable } from "@hello-pangea/dnd";
import { Job, Column, ScoreBreakdown } from "../types";

// Neutral source colours. The server masks `source` into one of three
// buckets before it leaves the API (`primary`, `secondary`, `portal`), so
// this map only needs those three keys. Keeping it minimal also means
// the client bundle no longer spells out any third-party scraper name.
const SOURCE_COLORS: Record<string, string> = {
  primary: "text-[#555872]",
  secondary: "text-[#555872]",
  portal: "text-[#c9a94e]",
};

const SOURCE_LABELS: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  portal: "Portal",
};

interface Props {
  job: Job;
  index: number;
  column: Column;
  onClick: (job: Job) => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onToggleFlag?: (id: number, flagged: boolean) => void;
}

function parseScoreBreakdown(raw: string | null): ScoreBreakdown | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-[#c9a94e] border-[#c9a94e] bg-[#c9a94e]/10",
  B: "text-[#5d9968] border-[#5d9968] bg-[#5d9968]/10",
  C: "text-[#6775a0] border-[#6775a0] bg-[#6775a0]/10",
  D: "text-[#8b8fa3] border-[#8b8fa3] bg-[#8b8fa3]/10",
  F: "text-[#c45252] border-[#c45252] bg-[#c45252]/10",
};

/** Generate a short abbreviation from any role type string.
 *  e.g. "Data Engineer" → "DE", "Frontend Developer" → "FD", "Product Manager" → "PM" */
function roleTypeShort(role: string): string {
  if (!role || role === "Other") return "";
  const words = role.split(/[\s/]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map(w => w[0]?.toUpperCase() || "").join("").slice(0, 3);
}

function ScoreBadge({ score, breakdown }: { score: number; breakdown: ScoreBreakdown | null }) {
  const grade = breakdown?.letter_grade;
  const gradeStyle = grade ? (GRADE_COLORS[grade] || GRADE_COLORS.C) : "";

  // Grade-only display. The numeric "X/10" line was removed per UX
  // request — the letter grade is the only relevance signal kept on
  // the card. We keep `score` in the tooltip so power users can still
  // see the raw number on hover, and the function signature is
  // unchanged so the existing call sites + sort-by-grade logic in
  // App.tsx keep working without a refactor.
  return (
    <div
      className={`flex items-center justify-center shrink-0 rounded-lg border px-2 py-1 min-w-[32px] ${gradeStyle || "border-[rgba(255,255,255,0.1)]"}`}
      title={breakdown ? `Grade ${grade} (${breakdown.weighted_score.toFixed(1)}/5)` : `Score ${score}/10`}
    >
      {grade ? (
        <span className="font-display font-bold text-sm leading-none">{grade}</span>
      ) : (
        // No breakdown / grade available (legacy rows from before the
        // 10-dimension scorer landed). Fall back to the numeric so the
        // card still has a relevance signal.
        <span className="font-mono text-[10px] opacity-60 leading-none">
          {score}/10
        </span>
      )}
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const styles: Record<string, string> = {
    startup: "text-[#8b8fa3] bg-[#12151c]",
    graduate: "text-[#8b8fa3] bg-[#12151c]",
    intern: "text-[#8b8fa3] bg-[#12151c]",
  };
  const labels: Record<string, string> = {
    startup: "STARTUP",
    graduate: "GRAD PROG",
    intern: "INTERN",
  };
  const style = styles[category] || "text-[#8b8fa3] bg-[#12151c]";
  return (
    <span className={`inline-flex items-center font-mono text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded ${style}`}>
      {labels[category] || category.toUpperCase()}
    </span>
  );
}

function getInitials(name: string) {
  return name
    .split(/[\s&]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

function hashColor(_str: string): string {
  return "bg-[#12151c]";
}

function formatPostedAge(postedAt: string | null): { label: string; color: string } | null {
  if (!postedAt) return null;
  const posted = new Date(postedAt);
  const now = new Date();
  const diffMs = now.getTime() - posted.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 0) return { label: "Upcoming", color: "" };
  if (days === 0) return { label: "New today", color: "" };
  if (days === 1) return { label: "1d ago", color: "" };
  if (days <= 3) return { label: `${days}d ago`, color: "" };
  if (days <= 7) return { label: `${days}d ago`, color: "" };
  if (days <= 14) return { label: `${days}d ago`, color: "" };
  return { label: `${days}d ago`, color: "" };
}

function formatDeadline(deadline: string | null): { label: string; urgent: boolean } {
  if (!deadline) return { label: "No deadline", urgent: false };
  const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) return { label: "Expired", urgent: false };
  if (daysLeft === 0) return { label: "Due today", urgent: true };
  if (daysLeft === 1) return { label: "Due tomorrow", urgent: true };
  if (daysLeft <= 7) return { label: `${daysLeft}d left`, urgent: true };
  return { label: `${daysLeft}d left`, urgent: false };
}

export default function JobCard({ job, index, column, onClick, selectionMode, isSelected, onToggleSelect, onToggleFlag }: Props) {
  const daysAgo = job.applied_date
    ? Math.floor((Date.now() - new Date(job.applied_date).getTime()) / 86400000)
    : null;

  const isReach = job.notes?.toLowerCase().includes("reach role");
  const deadline = formatDeadline(job.deadline);
  const postedAge = formatPostedAge(job.posted_at);

  function handleClick(e: React.MouseEvent) {
    if (selectionMode) {
      e.stopPropagation();
      onToggleSelect(job.id);
    } else {
      onClick(job);
    }
  }

  return (
    <Draggable draggableId={String(job.id)} index={index} isDragDisabled={selectionMode}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={handleClick}
          className={`group relative p-4 pl-5 rounded-lg border transition-all duration-200 cursor-pointer card-enter job-card
            ${snapshot.isDragging
              ? "bg-[#0c0e14] border-[#c9a94e]/40 shadow-lg shadow-[#c9a94e]/5 scale-[1.02] z-50"
              : isSelected
              ? "bg-blue-900/20 border-blue-500/50"
              : job.flagged
              ? "bg-[#c45252]/5 border-[#c45252]/20 hover:border-[#c45252]/40"
              : `bg-[#0c0e14] border-[rgba(255,255,255,0.06)] ${column.cardAccent} hover:bg-[#12151c]`
            }
            ${job.status === "offer" ? "offer-glow" : ""}
          `}
        >
          {/* Selection checkbox overlay */}
          {selectionMode && (
            <div className={`absolute top-2.5 right-2.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
              isSelected ? "bg-[#c9a94e] border-[#c9a94e]" : "border-gray-600 bg-transparent"
            }`}>
              {isSelected && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          )}

          {/* Top row: Company avatar + title + flag + score */}
          <div className="flex items-start gap-2.5">
            <div className={`w-11 h-11 rounded-lg ${hashColor(job.company_name)} flex items-center justify-center font-display text-sm text-white shrink-0 mt-0.5`}>
              {getInitials(job.company_name)}
            </div>
            <div className="flex-1 min-w-0">
              <h3
                className="font-body font-semibold text-[15px] text-[#e8eaed] leading-snug break-words"
                title={job.job_title}
              >
                {job.flagged ? <span className="text-red-400 mr-1" title="Flagged — excluded from pipeline">🚩</span> : null}
                {job.job_title}
              </h3>
              <p className="font-mono text-xs text-[#8b8fa3] uppercase tracking-wider truncate mt-0.5">{job.company_name}</p>
            </div>
            {!selectionMode && onToggleFlag && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFlag(job.id, !job.flagged); }}
                className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-all ${
                  job.flagged
                    ? "text-red-400 bg-red-500/15 hover:bg-red-500/25"
                    : "text-gray-700 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                }`}
                title={job.flagged ? "Unflag — include in future pipeline runs" : "Flag — exclude from future pipeline runs"}
              >
                <svg className="w-3.5 h-3.5" fill={job.flagged ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V4m0 0l8 4 8-4v13l-8 4-8-4" />
                </svg>
              </button>
            )}
            {!selectionMode && job.match_score != null && <ScoreBadge score={job.match_score} breakdown={parseScoreBreakdown(job.score_breakdown)} />}
          </div>

          {/* Badges row: TOP PICK + REACH + category + role type + keyword warning */}
          {(isReach || job.job_category || job.resume_url || job.detected_role_type || job.keyword_match_rate != null) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {job.expired === 1 && (
                <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest font-bold text-[#c45252] bg-[#c45252]/10 px-1.5 py-0.5 rounded">
                  EXPIRED
                </span>
              )}
              {job.resume_url && job.status === "filtered" && (
                <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest font-bold text-[#c9a94e] bg-[#c9a94e]/10 px-1.5 py-0.5 rounded">
                  TOP PICK
                </span>
              )}
              {isReach && (
                <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest font-bold text-[#8b8fa3] bg-[#12151c] px-1.5 py-0.5 rounded">
                  REACH
                </span>
              )}
              {job.detected_role_type && roleTypeShort(job.detected_role_type) && (
                <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest font-bold text-[#6775a0] bg-[#6775a0]/10 px-1.5 py-0.5 rounded"
                  title={`Detected: ${job.detected_role_type}`}>
                  {roleTypeShort(job.detected_role_type)}
                </span>
              )}
              {job.keyword_match_rate != null && job.keyword_match_rate < 0.7 && (
                <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest font-bold text-[#c9a94e] bg-[#c9a94e]/10 px-1.5 py-0.5 rounded"
                  title={`Keyword match: ${Math.round(job.keyword_match_rate * 100)}% — review resume`}>
                  LOW KW
                </span>
              )}
              {job.job_category && <CategoryBadge category={job.job_category} />}
            </div>
          )}

          {/* Tags row */}
          <div className="font-mono text-[11px] text-[#8b8fa3] mt-2.5">
            {[
              postedAge ? postedAge.label : null,
              job.location ? (job.location.length > 22 ? job.location.slice(0, 22) + "…" : job.location) : null,
              job.salary || null,
              job.seniority_level || null,
            ].filter(Boolean).join(" / ")}
          </div>

          {/* Source badges */}
          {job.source && (
            <div className="font-mono text-[10px] text-[#555872] mt-2">
              {(() => {
                const srcs: string[] = job.sources
                  ? (() => { try { return JSON.parse(job.sources); } catch { return [job.source]; } })()
                  : [job.source];
                const show = srcs.slice(0, 3);
                const extra = srcs.length - show.length;
                return (
                  <>
                    {show.map((s, i) => (
                      <span key={s}>
                        {SOURCE_LABELS[s] || s}{i < show.length - 1 ? ", " : ""}
                      </span>
                    ))}
                    {extra > 0 && (
                      <span> +{extra}</span>
                    )}
                  </>
                );
              })()}
              {job.source_count && job.source_count > 1 && (
                <span className="ml-0.5" title={`Found on ${job.source_count} job boards`}>
                  · {job.source_count} boards
                </span>
              )}
            </div>
          )}

          {/* Deadline row */}
          <div className="flex items-center gap-1 mt-2">
            <svg className="w-2.5 h-2.5 text-[#555872] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className={`font-mono text-[11px] ${deadline.urgent ? "text-[#c9a94e]" : "text-[#555872]"}`}>
              {deadline.label}
            </span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[rgba(255,255,255,0.06)] gap-2">
            {daysAgo !== null ? (
              <span className="font-mono text-[11px] text-[#555872]">
                {daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo}d ago`}
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5">
              {job.applicants_count && (
                <span className="font-mono text-[11px] text-[#555872] flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {job.applicants_count}
                </span>
              )}
              {job.resume_url && !selectionMode && (
                <a
                  href={job.resume_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-[#6775a0] hover:text-[#8b8fa3] transition-colors"
                  title="View tailored resume PDF"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CV
                </a>
              )}
              {job.cover_letter && !selectionMode && (
                <span
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-[#c9a94e] whitespace-nowrap"
                  title="Cover letter drafted — click card to view"
                >
                  <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CL
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
