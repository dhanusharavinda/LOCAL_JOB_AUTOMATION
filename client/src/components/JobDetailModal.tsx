import { useState, useEffect } from "react";
import { Job, JobStatus, COLUMNS, ScoreBreakdown } from "../types";
import { updateJobNotes, deleteJob, updateJobStatus, toggleJobFlag, fetchJobTimeline, fetchInterviewPrep, regenerateInterviewPrep, regenerateCoverLetter, regenerateWhyFit, checkJobLink, StatusHistoryEntry, InterviewPrep } from "../api";
import ResumeCompareModal from "./ResumeCompareModal";

interface Props {
  job: Job;
  onClose: () => void;
  onUpdate: (updated: Job) => void;
  onDelete: (id: number) => void;
}

export default function JobDetailModal({ job, onClose, onUpdate, onDelete }: Props) {
  const [notes, setNotes] = useState(job.notes || "");
  const [saving, setSaving] = useState(false);
  const [showCoverLetter, setShowCoverLetter] = useState(false);
  const [showHiringMsg, setShowHiringMsg] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [copiedCL, setCopiedCL] = useState(false);
  const [copiedHM, setCopiedHM] = useState(false);
  const [copiedDesc, setCopiedDesc] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [timeline, setTimeline] = useState<StatusHistoryEntry[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [interviewPrep, setInterviewPrep] = useState<InterviewPrep | null>(null);
  const [showPrep, setShowPrep] = useState(false);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [linkChecking, setLinkChecking] = useState(false);
  const [clLoading, setClLoading] = useState(false);
  const [clError, setClError] = useState<string | null>(null);
  const [fitLoading, setFitLoading] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setNotes(job.notes || "");
    // Load timeline
    fetchJobTimeline(job.id).then(setTimeline).catch(() => {});
    // Load interview prep if exists
    if (job.interview_prep || job.status === "interviewing") {
      fetchInterviewPrep(job.id).then(setInterviewPrep).catch(() => {});
    }
  }, [job]);

  async function handleSaveNotes() {
    setSaving(true);
    try {
      const updated = await updateJobNotes(job.id, notes);
      onUpdate(updated);
    } catch (err: any) {
      // Previously on save failure `setSaving(false)` never ran — the
      // button stayed on "Saving..." forever because the awaited call
      // threw before we reached the reset. Guard with try/finally.
      console.error("[JobDetailModal] save notes failed:", err?.message || err);
      alert(`Couldn't save notes: ${err?.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDateChange(field: "interview_date" | "offer_date", value: string) {
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(updated);
      } else {
        // A non-2xx was previously a silent no-op — the date input
        // stayed visually updated but the server never accepted it,
        // and the user had no way to tell. Pop an alert so they know
        // to retry or fix the problem.
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        alert(`Couldn't update ${field.replace("_", " ")}: ${body.error || `HTTP ${res.status}`}`);
      }
    } catch (err: any) {
      console.error("Failed to update date:", err);
      alert(`Couldn't update ${field.replace("_", " ")}: network error`);
    }
  }

  async function handleStatusChange(status: JobStatus) {
    try {
      const updated = await updateJobStatus(job.id, status);
      onUpdate(updated);
    } catch (err: any) {
      // Without this, a failed status change threw an unhandled
      // promise rejection into the console and the dropdown stayed on
      // the new (unsaved) value. Surface it so the user knows to retry.
      console.error("[JobDetailModal] status change failed:", err?.message || err);
      alert(`Couldn't change status: ${err?.message || "unknown error"}`);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this job card?")) return;
    try {
      await deleteJob(job.id);
      onDelete(job.id);
    } catch (err: any) {
      // Previously the deleteJob call could throw (e.g. auth expired)
      // and onDelete never ran, but the confirm dialog already closed.
      // User had no feedback that the delete didn't happen.
      console.error("[JobDetailModal] delete failed:", err?.message || err);
      alert(`Couldn't delete: ${err?.message || "unknown error"}`);
    }
  }

  function handleCopyDesc() {
    if (job.description) {
      navigator.clipboard.writeText(job.description);
      setCopiedDesc(true);
      setTimeout(() => setCopiedDesc(false), 2000);
    }
  }

  async function handleGenerateCoverLetter() {
    setClLoading(true);
    setClError(null);
    try {
      const text = await regenerateCoverLetter(job.id);
      onUpdate({ ...job, cover_letter: text });
      setShowCoverLetter(true);
    } catch (err: any) {
      setClError(err.message || "Failed to generate");
    } finally {
      setClLoading(false);
    }
  }

  async function handleGenerateWhyFit() {
    setFitLoading(true);
    setFitError(null);
    try {
      const text = await regenerateWhyFit(job.id);
      onUpdate({ ...job, hiring_message: text });
      setShowHiringMsg(true);
    } catch (err: any) {
      setFitError(err.message || "Failed to generate");
    } finally {
      setFitLoading(false);
    }
  }

  const currentCol = COLUMNS.find((c) => c.id === job.status);
  const daysAgo = job.applied_date
    ? Math.floor((Date.now() - new Date(job.applied_date).getTime()) / 86400000)
    : null;

  return (
    <>
    {showCompare && <ResumeCompareModal job={job} onClose={() => setShowCompare(false)} onResumeUpdated={(url) => onUpdate({ ...job, resume_url: url })} />}
    <div className="fixed inset-0 bg-black/70 modal-backdrop flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#0c0e14] border border-[rgba(255,255,255,0.06)] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient accent */}
        <div className={`relative p-6 border-b border-[rgba(255,255,255,0.06)] bg-gradient-to-b ${currentCol?.gradient || ""}`}>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg bg-[#12151c] text-[#555872] hover:text-[#e8eaed] hover:bg-gray-700/50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex items-start gap-3">
            {job.match_score != null && (
              <div className={`flex flex-col items-center justify-center w-14 px-2 py-2 rounded-xl border shrink-0 ${
                job.match_score >= 8
                  ? "bg-[#c9a94e]/10 text-[#c9a94e] border-[#c9a94e]/20"
                  : job.match_score >= 6
                  ? "bg-[#6775a0]/10 text-[#6775a0] border-[#6775a0]/20"
                  : "bg-[#c45252]/10 text-[#c45252] border-[#c45252]/20"
              }`}>
                <span className="font-display text-xl font-bold leading-none">{job.match_score}</span>
                <span className="text-[9px] opacity-60 font-normal leading-none mt-0.5">/10</span>
                <span className="text-[9px] opacity-50 leading-none mt-1">AI Score</span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold text-gray-50 leading-tight">{job.job_title}</h2>
              <p className="font-mono text-sm text-[#6775a0] uppercase tracking-wider mt-1">{job.company_name}</p>
            </div>
          </div>

          {/* Meta tags */}
          <div className="flex flex-wrap gap-2 mt-4">
            {job.location && (
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[#8b8fa3] bg-[#12151c] px-2.5 py-1 rounded-lg">
                <svg className="w-3 h-3 text-[#555872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                {job.location}
              </span>
            )}
            {job.salary && (
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[#c9a94e] bg-[#12151c] px-2.5 py-1 rounded-lg">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {job.salary}
              </span>
            )}
            {job.seniority_level && (
              <span className="font-mono text-xs text-[#6775a0] bg-[#12151c] px-2.5 py-1 rounded-lg">
                {job.seniority_level}
              </span>
            )}
            {job.applicants_count && (
              <span className="font-mono text-xs text-[#8b8fa3] bg-[#12151c] px-2.5 py-1 rounded-lg">
                {job.applicants_count} applicants
              </span>
            )}
            {daysAgo !== null && (
              <span className="font-mono text-xs text-[#8b8fa3] bg-[#12151c] px-2.5 py-1 rounded-lg">
                {daysAgo === 0 ? "Applied today" : `Applied ${daysAgo}d ago`}
              </span>
            )}
            {job.job_category && (
              <span className={`font-mono text-xs px-2.5 py-1 rounded-lg font-medium ${
                job.job_category === "startup" ? "text-violet-400 bg-violet-500/10" :
                job.job_category === "graduate" ? "text-sky-400 bg-sky-500/10" :
                "text-pink-400 bg-pink-500/10"
              }`}>
                {job.job_category === "startup" ? "Startup" : job.job_category === "graduate" ? "Grad Programme" : "Internship"}
              </span>
            )}
            <span className={`font-mono text-xs px-2.5 py-1 rounded-lg ${
              job.deadline
                ? Math.ceil((new Date(job.deadline).getTime() - Date.now()) / 86400000) <= 7
                  ? "text-[#c9a94e] bg-[#c9a94e]/10"
                  : "text-[#8b8fa3] bg-[#12151c]"
                : "text-[#555872] bg-[#12151c]"
            }`}>
              {job.deadline
                ? `Deadline: ${new Date(job.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                : "No deadline specified"
              }
            </span>
          </div>
        </div>

        {/* Expired Warning */}
        {job.expired === 1 && (
          <div className="px-6 py-2.5 bg-red-500/8 border-b border-red-500/20 flex items-center justify-between">
            <span className="text-xs font-medium text-red-400 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Listing expired{job.expiry_reason ? ` (${job.expiry_reason})` : ""}
            </span>
            <button
              onClick={async () => {
                setLinkChecking(true);
                try {
                  const result = await checkJobLink(job.id);
                  onUpdate({ ...job, expired: result.expired ? 1 : 0, expiry_reason: result.reason });
                } catch {} finally { setLinkChecking(false); }
              }}
              className="text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              {linkChecking ? "Checking..." : "Re-check"}
            </button>
          </div>
        )}

        {/* AI Match Reasoning */}
        {job.match_reason && (
          <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[#12151c]">
            <div className="flex items-start gap-2.5">
              <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mt-0.5">
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-semibold text-emerald-400/80 uppercase tracking-wider mb-1">Why AI selected this job</p>
                <p className="font-body text-sm text-gray-300 leading-relaxed">{job.match_reason}</p>
                {job.notes?.includes("Reach role") && (
                  <p className="text-xs text-orange-400/80 mt-1.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 inline-block" />
                    Flagged as reach role — you may not meet all requirements, but the match is strong enough to apply.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Score Breakdown (10-Dimension) */}
        {(() => {
          let bd: ScoreBreakdown | null = null;
          try { bd = job.score_breakdown ? JSON.parse(job.score_breakdown) : null; } catch {}
          if (!bd?.dimensions) return null;

          const DIMENSION_LABELS: Record<string, string> = {
            role_match: "Role Match",
            skills_alignment: "Skills Alignment",
            seniority_fit: "Seniority Fit",
            compensation: "Compensation",
            geographic_fit: "Geographic Fit",
            company_stage: "Company Stage",
            product_market_fit: "Product-Market Fit",
            growth_trajectory: "Growth Trajectory",
            interview_likelihood: "Interview Likelihood",
            timeline_urgency: "Timeline/Urgency",
          };

          const GRADE_COLORS: Record<string, string> = {
            A: "text-[#c9a94e] bg-[#c9a94e]/15 border-[#c9a94e]/30",
            B: "text-[#5d9968] bg-[#5d9968]/15 border-[#5d9968]/30",
            C: "text-[#6775a0] bg-[#6775a0]/15 border-[#6775a0]/30",
            D: "text-[#8b8fa3] bg-[#8b8fa3]/15 border-[#8b8fa3]/30",
            F: "text-[#c45252] bg-[#c45252]/15 border-[#c45252]/30",
          };

          const barColor = (s: number) =>
            s >= 4 ? "bg-[#c9a94e]" : s >= 3 ? "bg-[#6775a0]" : s >= 2 ? "bg-[#8b8fa3]" : "bg-[#c45252]";

          return (
            <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs font-semibold text-[#c9a94e] uppercase tracking-wider">Score Breakdown</span>
                <div className="flex items-center gap-2">
                  <span className={`font-display text-2xl font-bold px-3 py-1 rounded-lg border ${GRADE_COLORS[bd.letter_grade] || GRADE_COLORS.C}`}>
                    {bd.letter_grade}
                  </span>
                  <span className="font-mono text-xs text-[#8b8fa3]">{bd.weighted_score.toFixed(1)}/5</span>
                  {bd.gate_capped && (
                    <span className="font-mono text-[10px] text-[#c45252] bg-[#c45252]/10 px-1.5 py-0.5 rounded">GATE-CAPPED</span>
                  )}
                  {bd.detected_role_type && (
                    <span className="font-mono text-[10px] text-[#6775a0] bg-[#6775a0]/10 px-1.5 py-0.5 rounded">{bd.detected_role_type}</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                {Object.entries(bd.dimensions).map(([key, dim]) => (
                  <div key={key} className="group">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[#8b8fa3] w-36 shrink-0">{DIMENSION_LABELS[key] || key}</span>
                      <div className="flex-1 h-2 bg-[#12151c] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor(dim.score)}`} style={{ width: `${(dim.score / 5) * 100}%` }} />
                      </div>
                      <span className="font-mono text-xs font-bold text-[#e8eaed] w-6 text-right tabular-nums">{dim.score}</span>
                    </div>
                    <p className="font-body text-[11px] text-[#555872] ml-[152px] leading-tight opacity-0 group-hover:opacity-100 transition-opacity">{dim.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Keyword Match Rate (CV Sync Check) */}
        {job.keyword_match_rate != null && job.resume_url && (
          <div className="px-6 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
            <span className="font-mono text-xs text-[#8b8fa3]">
              Keyword Match Rate
            </span>
            <span className={`font-mono text-sm font-bold ${
              job.keyword_match_rate >= 0.7 ? "text-[#5d9968]" : "text-[#c9a94e]"
            }`}>
              {Math.round(job.keyword_match_rate * 100)}%
              {job.keyword_match_rate < 0.7 && (
                <span className="text-[10px] font-normal text-[#c9a94e] ml-1.5">review resume</span>
              )}
            </span>
          </div>
        )}

        {/* Status Switcher */}
        <div className="px-6 py-3.5 border-b border-[rgba(255,255,255,0.06)] bg-[#12151c]">
          <div className="flex gap-1.5 flex-wrap">
            {COLUMNS.map((col) => (
              <button
                key={col.id}
                onClick={() => handleStatusChange(col.id)}
                className={`font-mono text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 font-medium
                  ${job.status === col.id
                    ? `${col.countBg} border-current`
                    : "bg-transparent text-gray-500 border-[rgba(255,255,255,0.1)] hover:border-gray-600 hover:text-gray-300"
                  }
                `}
              >
                {col.emoji} {col.title}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Links */}
        <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)] flex flex-wrap gap-2">
          {job.job_link && (
            <a href={job.job_link} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-blue-400 bg-blue-500/8 hover:bg-blue-500/15 px-3 py-1.5 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Job Post
            </a>
          )}
          {job.apply_url && (
            <a href={job.apply_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-emerald-400 bg-emerald-500/8 hover:bg-emerald-500/15 px-3 py-1.5 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Apply Now
            </a>
          )}
          {job.resume_url && (
            <a href={job.resume_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-purple-400 bg-purple-500/8 hover:bg-purple-500/15 px-3 py-1.5 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Resume
            </a>
          )}
          {job.company_url && (
            <a href={job.company_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-gray-400 bg-gray-500/8 hover:bg-gray-500/15 px-3 py-1.5 rounded-lg transition-colors">
              Company
            </a>
          )}
        </div>

        {/* Cover Letter — always renders; shows Generate button when empty.
            Only the `cover_letter` column counts toward "has generated" — the
            legacy `outreach_email` field used to double as a fallback, but
            that broke the on-demand contract: stale data in the old column
            made the Show toggle appear on jobs the user had never asked to
            generate. */}
        {(() => {
          const clText = job.cover_letter || "";
          const hasCL = !!clText;
          return (
            <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-between w-full">
                <button
                  onClick={() => hasCL && setShowCoverLetter(!showCoverLetter)}
                  className={`flex items-center gap-2 text-left rounded-md px-1 -ml-1 py-0.5 ${hasCL ? "hover:bg-white/5 cursor-pointer" : "cursor-default"}`}
                  disabled={!hasCL}
                  title={hasCL ? (showCoverLetter ? "Click to collapse" : "Click to reveal the cover letter") : undefined}
                >
                  <span className="font-mono text-xs font-semibold text-blue-400 uppercase tracking-wider">Cover Letter</span>
                  {hasCL && (
                    <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-blue-400/80">
                      <svg className={`w-3 h-3 transition-transform ${showCoverLetter ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      {showCoverLetter ? "Hide" : "Click to view"}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  {clError && <span className="text-red-400 text-[10px]">{clError}</span>}
                  <button
                    onClick={handleGenerateCoverLetter}
                    disabled={clLoading}
                    className="text-[10px] font-mono uppercase tracking-wider text-blue-400/70 hover:text-blue-400 disabled:opacity-50 transition-colors"
                    title={hasCL ? "Regenerate — replaces current cover letter" : "Generate a cover letter for this job"}
                  >
                    {clLoading ? "Generating..." : hasCL ? "Regenerate" : "Generate"}
                  </button>
                </div>
              </div>
              {hasCL && showCoverLetter && (
                <div className="mt-3 relative">
                  <div className="p-4 bg-[#12151c] rounded-xl font-body text-sm text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed border border-[rgba(255,255,255,0.06)]">
                    {clText}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(clText); setCopiedCL(true); setTimeout(() => setCopiedCL(false), 2000); }}
                    className="absolute top-2 right-2 text-[10px] font-medium bg-gray-700/80 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded-md transition-colors"
                  >
                    {copiedCL ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
              {!hasCL && !clLoading && (
                <p className="text-[11px] text-gray-600 mt-1.5">Not generated yet. Click Generate to draft one for this role.</p>
              )}
            </div>
          );
        })()}

        {/* Why I'm a Fit — always renders; shows Generate button when empty */}
        {(() => {
          const hasFit = !!job.hiring_message;
          return (
            <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-between w-full">
                <button
                  onClick={() => hasFit && setShowHiringMsg(!showHiringMsg)}
                  className={`flex items-center gap-2 text-left rounded-md px-1 -ml-1 py-0.5 ${hasFit ? "hover:bg-white/5 cursor-pointer" : "cursor-default"}`}
                  disabled={!hasFit}
                  title={hasFit ? (showHiringMsg ? "Click to collapse" : "Click to reveal the fit summary") : undefined}
                >
                  <span className="font-mono text-xs font-semibold text-purple-400 uppercase tracking-wider">Why I'm a Fit</span>
                  {hasFit && (
                    <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-purple-400/80">
                      <svg className={`w-3 h-3 transition-transform ${showHiringMsg ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      {showHiringMsg ? "Hide" : "Click to view"}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  {fitError && <span className="text-red-400 text-[10px]">{fitError}</span>}
                  <button
                    onClick={handleGenerateWhyFit}
                    disabled={fitLoading}
                    className="text-[10px] font-mono uppercase tracking-wider text-purple-400/70 hover:text-purple-400 disabled:opacity-50 transition-colors"
                    title={hasFit ? "Regenerate — replaces current fit summary" : "Generate a fit summary for this job"}
                  >
                    {fitLoading ? "Generating..." : hasFit ? "Regenerate" : "Generate"}
                  </button>
                </div>
              </div>
              {hasFit && showHiringMsg && (
                <div className="mt-3 relative">
                  <div className="p-4 bg-[#12151c] rounded-xl font-body text-sm text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed border border-[rgba(255,255,255,0.06)]">
                    {job.hiring_message}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(job.hiring_message || ""); setCopiedHM(true); setTimeout(() => setCopiedHM(false), 2000); }}
                    className="absolute top-2 right-2 text-[10px] font-medium bg-gray-700/80 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded-md transition-colors"
                  >
                    {copiedHM ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
              {!hasFit && !fitLoading && (
                <p className="text-[11px] text-gray-600 mt-1.5">Not generated yet. Click Generate to draft a short fit summary.</p>
              )}
            </div>
          );
        })()}

        {/* Description */}
        {job.description && (
          <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowDesc(!showDesc)}
                className="flex items-center gap-2 text-left"
              >
                <span className="font-mono text-xs font-semibold text-gray-400 uppercase tracking-wider">Job Description</span>
                <span className="text-gray-600 text-xs">{showDesc ? "Hide" : "Show"}</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCompare(true)}
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#c9a94e] bg-[#c9a94e]/10 hover:bg-[#c9a94e]/20 px-2 py-1 rounded-md transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Compare
                </button>
                <button
                  onClick={handleCopyDesc}
                  className="text-[11px] font-medium bg-gray-700/80 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded-md transition-colors"
                >
                  {copiedDesc ? "Copied!" : "Copy JD"}
                </button>
              </div>
            </div>
            {showDesc && (
              <div className="mt-3 p-4 bg-[#12151c] rounded-xl font-body text-sm text-gray-300 max-h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap border border-[rgba(255,255,255,0.06)]">
                {job.description}
              </div>
            )}
          </div>
        )}

        {/* Interview Prep */}
        {(interviewPrep || job.status === "interviewing") && (
          <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <button
              onClick={() => setShowPrep(!showPrep)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="font-mono text-xs font-semibold text-[#c9a94e] uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Interview Prep
              </span>
              <div className="flex items-center gap-2">
                {/* Only show Generate button if prep doesn't exist yet */}
                {!interviewPrep && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      setPrepLoading(true);
                      try {
                        const prep = await regenerateInterviewPrep(job.id);
                        setInterviewPrep(prep);
                        setShowPrep(true);
                      } catch {
                        setPrepError("Failed to generate — check your OpenAI key");
                      } finally { setPrepLoading(false); }
                    }}
                    className="text-[10px] text-[#c9a94e]/60 hover:text-[#c9a94e] transition-colors"
                  >
                    {prepLoading ? "Generating..." : "Generate"}
                  </button>
                )}
                {prepError && !interviewPrep && (
                  <span className="text-red-400 text-[10px]">{prepError}</span>
                )}
                {interviewPrep && (
                  <span className="text-gray-600 text-xs">{showPrep ? "Hide" : "Show"}</span>
                )}
              </div>
            </button>
            {showPrep && interviewPrep && (
              <div className="mt-3 space-y-4">
                {/* Key Themes */}
                {interviewPrep.roleKeyThemes && interviewPrep.roleKeyThemes.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] font-bold text-[#c9a94e] uppercase tracking-wider mb-2">Key Themes (what they WILL probe)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {interviewPrep.roleKeyThemes.map((t, i) => (
                        <span key={i} className="font-mono text-xs font-medium px-2.5 py-1 rounded-lg bg-[#c9a94e]/10 text-[#c9a94e] border border-[#c9a94e]/20">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Topics to Study (80/20) */}
                {interviewPrep.topicsToStudy && interviewPrep.topicsToStudy.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2">Topics to Study (prioritized)</p>
                    <div className="space-y-1.5">
                      {interviewPrep.topicsToStudy.map((t, i) => (
                        <div key={i} className="flex items-start gap-2 p-2.5 bg-[#12151c] rounded-xl border border-[rgba(255,255,255,0.06)]">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                            t.depth === "deep" ? "text-red-400 bg-red-500/10 border border-red-500/20" :
                            t.depth === "working" ? "text-[#c9a94e] bg-[#c9a94e]/10 border border-[#c9a94e]/20" :
                            "text-gray-400 bg-gray-500/10 border border-gray-500/20"
                          }`}>{t.depth}</span>
                          <div>
                            <p className="text-sm text-gray-200 font-medium">{t.topic}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{t.why}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* STAR Stories to Prepare */}
                {interviewPrep.starStories && interviewPrep.starStories.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">STAR Stories to Prepare</p>
                    <div className="space-y-1.5">
                      {interviewPrep.starStories.map((s, i) => (
                        <div key={i} className="p-2.5 bg-[#12151c] rounded-xl border border-[rgba(255,255,255,0.06)]">
                          <p className="text-sm text-gray-200 font-medium">{s.scenario}</p>
                          <p className="text-xs text-emerald-400/70 mt-0.5">Maps to: {s.maps_to}</p>
                          {s.tip && <p className="text-xs text-gray-500 mt-0.5 italic">{s.tip}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Company Intel */}
                {interviewPrep.companyIntel && (
                  <div>
                    <p className="font-mono text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-2">Company Intel</p>
                    <div className="p-3 bg-[#12151c] rounded-xl border border-[rgba(255,255,255,0.06)] space-y-2">
                      <div><span className="text-[10px] text-gray-500 uppercase">What they do:</span><p className="text-xs text-gray-300">{interviewPrep.companyIntel.whatTheyDo}</p></div>
                      <div><span className="text-[10px] text-gray-500 uppercase">Why this role:</span><p className="text-xs text-gray-300">{interviewPrep.companyIntel.whyThisRole}</p></div>
                      {interviewPrep.companyIntel.sharpQuestions?.length > 0 && (
                        <div>
                          <span className="text-[10px] text-gray-500 uppercase">Sharp questions to ask:</span>
                          {interviewPrep.companyIntel.sharpQuestions.map((q, i) => (
                            <p key={i} className="text-xs text-violet-300 mt-1 pl-2 border-l-2 border-violet-500/20">{q}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Opener */}
                {interviewPrep.opener && (
                  <div>
                    <p className="font-mono text-[10px] font-bold text-[#6775a0] uppercase tracking-wider mb-2">Your 60-Second Opener</p>
                    <div className="p-3 bg-[#12151c] rounded-xl border border-[#6775a0]/15 font-body text-sm text-gray-300 leading-relaxed italic">
                      "{interviewPrep.opener}"
                    </div>
                  </div>
                )}

                {/* Closer Questions */}
                {interviewPrep.closerQuestions && interviewPrep.closerQuestions.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">Closing Questions (they remember how it ends)</p>
                    {interviewPrep.closerQuestions.map((q, i) => (
                      <p key={i} className="text-xs text-gray-300 mt-1 pl-2 border-l-2 border-pink-500/20">{q}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showPrep && !interviewPrep && !prepLoading && (
              <p className="text-xs text-gray-600 mt-2">No interview prep generated yet. Click "Generate" above.</p>
            )}
          </div>
        )}

        {/* Application Timeline */}
        {timeline.length > 0 && (
          <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="font-mono text-xs font-semibold text-[#6775a0] uppercase tracking-wider">Application Timeline</span>
              <span className="text-gray-600 text-xs">{showTimeline ? "Hide" : `Show (${timeline.length})`}</span>
            </button>
            {showTimeline && (
              <div className="mt-3 relative pl-4">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-800" />
                {timeline.map((entry, i) => {
                  const col = COLUMNS.find((c) => c.id === entry.to_status);
                  const d = new Date(entry.changed_at);
                  const ago = Math.floor((Date.now() - d.getTime()) / 86400000);
                  return (
                    <div key={i} className="relative flex items-start gap-3 mb-3 last:mb-0">
                      <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 -ml-[7px] z-10 ${col?.dotColor || "bg-gray-500"} border-[#0c0e14]`} />
                      <div>
                        <div className="flex items-center gap-2">
                          {entry.from_status && (
                            <>
                              <span className="text-xs text-gray-500">{COLUMNS.find((c) => c.id === entry.from_status)?.emoji} {entry.from_status}</span>
                              <svg className="w-3 h-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </>
                          )}
                          <span className="text-xs font-medium text-gray-200">{col?.emoji} {entry.to_status}</span>
                        </div>
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          {d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} at {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          {ago === 0 ? " (today)" : ago === 1 ? " (yesterday)" : ` (${ago}d ago)`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Date Tracking */}
        <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)]">
          <label className="font-mono text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-3">Date Tracking</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Interview Date</label>
              <input
                type="date"
                defaultValue={job.interview_date || ""}
                onBlur={(e) => handleDateChange("interview_date", e.target.value)}
                className="w-full bg-[#12151c] border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#c9a94e]/40 focus:ring-1 focus:ring-[#c9a94e]/20 transition-all"
              />
              {!job.interview_date && (
                <p className="text-xs text-gray-600 mt-1">Not scheduled</p>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Offer Date</label>
              <input
                type="date"
                defaultValue={job.offer_date || ""}
                onBlur={(e) => handleDateChange("offer_date", e.target.value)}
                className="w-full bg-[#12151c] border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#c9a94e]/40 focus:ring-1 focus:ring-[#c9a94e]/20 transition-all"
              />
              {!job.offer_date && (
                <p className="text-xs text-gray-600 mt-1">—</p>
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="px-6 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <label className="font-mono text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Interview prep, contact info, thoughts..."
            className="w-full bg-[#12151c] border border-[rgba(255,255,255,0.06)] rounded-xl p-3.5 font-body text-sm text-gray-200 resize-none h-28 focus:outline-none focus:border-[#c9a94e]/40 focus:ring-1 focus:ring-[#c9a94e]/20 transition-all placeholder:text-gray-700"
          />
          <div className="flex justify-between items-center mt-3">
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              className="font-mono text-xs font-medium bg-[#c9a94e]/15 text-[#c9a94e] border border-[#c9a94e]/30 hover:bg-[#c9a94e]/25 px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save Notes"}
            </button>
            <button
              onClick={async () => {
                const updated = await toggleJobFlag(job.id, !job.flagged);
                onUpdate(updated);
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                job.flagged
                  ? "text-red-400 bg-red-500/15 border-red-500/30 hover:bg-red-500/25"
                  : "text-gray-500 border-gray-700 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
              }`}
            >
              🚩 {job.flagged ? "Unflag" : "Flag"}
            </button>
            <button
              onClick={handleDelete}
              className="font-mono text-xs text-[#c45252]/60 hover:text-[#c45252] transition-colors"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 font-mono text-[11px] text-[#555872] flex justify-between">
          <span>Created: {new Date(job.created_at).toLocaleDateString()}</span>
          <span>Updated: {new Date(job.updated_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
    </>
  );
}
