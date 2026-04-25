import { useState, useEffect, useCallback, useRef } from "react";
import { Job } from "../types";
import { analyzeResume, applySuggestions, ResumeAnalysis } from "../api";

interface Props {
  job: Job;
  onClose: () => void;
  onResumeUpdated?: (resumeUrl: string) => void;
}

/** Parse a PDF file to text via the server */
async function parsePdfToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arrayBuf = reader.result as ArrayBuffer;
        // Convert in chunks to avoid "Maximum call stack size exceeded" on large PDFs
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.slice(i, i + 8192));
        }
        const base64 = btoa(binary);
        const res = await fetch("/api/parse-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64 }),
        });
        if (!res.ok) throw new Error("PDF parse failed");
        const data = await res.json();
        resolve(data.text);
      } catch (err: any) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

export default function ResumeCompareModal({ job, onClose, onResumeUpdated }: Props) {
  // Phase: "setup" = pre-compare, "analyzing" = running, "results" = done
  const [phase, setPhase] = useState<"setup" | "analyzing" | "results">("setup");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Editable fields for setup phase
  const [jdText, setJdText] = useState(job.description || "");
  const [resumeSource, setResumeSource] = useState<"job" | "upload">("job");
  const [uploadedResumeText, setUploadedResumeText] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadParsing, setUploadParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasJobResume = !!job.resume_url;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".pdf")) {
      setError("Please upload a PDF file");
      return;
    }
    setUploadParsing(true);
    setError(null);
    try {
      const text = await parsePdfToText(file);
      if (text.length < 30) throw new Error("Could not extract text from PDF");
      setUploadedResumeText(text);
      setUploadFileName(file.name);
      setResumeSource("upload");
    } catch (err: any) {
      setError("Failed to parse PDF: " + err.message);
    } finally {
      setUploadParsing(false);
    }
  }

  async function runCompare() {
    setPhase("analyzing");
    setError(null);
    try {
      const opts: { resumeText?: string; customDescription?: string } = {};
      if (resumeSource === "upload" && uploadedResumeText) {
        opts.resumeText = uploadedResumeText;
      }
      if (jdText !== job.description) {
        opts.customDescription = jdText;
      }
      const result = await analyzeResume(job.id, opts);
      setAnalysis(result);
      setPhase("results");
      // Cover letter + hiring message are saved to DB by the server —
      // notify parent to refresh the job so they appear in job detail
      if (onResumeUpdated && (result.coverLetter || result.hiringMessage)) {
        onResumeUpdated("");
      }
    } catch (err: any) {
      if (err.message === "NO_RESUME") {
        setError("No resume PDF found for this job. Upload one manually.");
        setPhase("setup");
      } else {
        setError(err.message);
        setPhase("setup");
      }
    }
  }

  const toggleBullet = useCallback((secIdx: number, bulletIdx: number) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      return { ...prev, optimizations: prev.optimizations.map((s, si) => {
        if (si !== secIdx) return s;
        return { ...s, bullets: s.bullets.map((b, bi) => {
          if (bi !== bulletIdx) return b;
          return { ...b, accepted: !b.accepted };
        })};
      })};
    });
  }, []);

  const acceptAll = useCallback(() => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      return { ...prev, optimizations: prev.optimizations.map((s) => ({
        ...s, bullets: s.bullets.map((b) => ({ ...b, accepted: b.improved ? true : b.accepted }))
      }))};
    });
  }, []);

  const resetAll = useCallback(() => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      return { ...prev, optimizations: prev.optimizations.map((s) => ({
        ...s, bullets: s.bullets.map((b) => ({ ...b, accepted: false }))
      }))};
    });
  }, []);

  // Defensive — if the server ever returns a malformed analysis (e.g.
  // OpenAI hits its token limit and truncates JSON), reduce on undefined
  // would crash the entire modal. Treat missing arrays as empty.
  const acceptedCount = (analysis?.optimizations ?? []).reduce(
    (sum, s) => sum + (s?.bullets ?? []).filter((b) => b?.accepted).length, 0
  );

  async function handleApply() {
    if (!analysis) return;
    setApplying(true);
    try {
      // Pass resume text so server doesn't need to re-parse the PDF
      const resumeTextForApply = uploadedResumeText || undefined;
      const result = await applySuggestions(job.id, analysis.optimizations, analysis.summaryImproved, resumeTextForApply);
      setApplied(true);
      if (onResumeUpdated && result.resumeUrl) onResumeUpdated(result.resumeUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const scoreColor = (s: number) =>
    s >= 75 ? "text-emerald-400" : s >= 50 ? "text-amber-400" : "text-red-400";
  const scoreBg = (s: number) =>
    s >= 75 ? "from-emerald-500/20" : s >= 50 ? "from-amber-500/20" : "from-red-500/20";

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-[#0d0f13] border border-gray-800 rounded-2xl w-full max-w-4xl max-h-[93vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-blue-400">ReWrite</span>
            {analysis && phase === "results" && (
              <>
                <span className="text-xs text-gray-600">ATS SCORE</span>
                <span className={`text-xl font-black tabular-nums ${scoreColor(analysis.atsScore ?? analysis.matchScore)}`}>
                  {analysis.atsScore ?? analysis.matchScore}/100
                </span>
                {/* When the model returns separate match + ATS scores
                    (it often does — match is overall fit, ATS is keyword
                    density), surface both so the user can tell whether
                    a borderline JD is missing keywords or genuinely a
                    weak fit. */}
                {analysis.atsScore != null && analysis.matchScore != null && analysis.atsScore !== analysis.matchScore && (
                  <>
                    <span className="text-xs text-gray-700">·</span>
                    <span className="text-xs text-gray-600">FIT</span>
                    <span className={`text-sm font-bold tabular-nums ${scoreColor(analysis.matchScore)}`}>
                      {analysis.matchScore}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">{job.job_title} @ {job.company_name}</span>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-800/50 text-gray-400 hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── SETUP PHASE ── */}
          {phase === "setup" && (
            <div className="p-6 space-y-5">
              {error && (
                <div className="p-3 rounded-xl bg-red-500/8 border border-red-500/20 text-sm text-red-400">{error}</div>
              )}

              {/* Resume Source */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Resume</label>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setResumeSource("job")}
                    className={`flex-1 text-sm px-4 py-3 rounded-xl border transition-all font-medium ${
                      resumeSource === "job"
                        ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                        : "bg-[#0f1115] border-gray-800 text-gray-500 hover:border-gray-600"
                    }`}
                  >
                    {hasJobResume ? "Job's Tailored Resume" : "Base Resume (from Settings)"}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex-1 text-sm px-4 py-3 rounded-xl border transition-all font-medium ${
                      resumeSource === "upload"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-[#0f1115] border-gray-800 text-gray-500 hover:border-gray-600"
                    }`}
                  >
                    {uploadParsing ? "Parsing PDF..." : uploadFileName ? `Uploaded: ${uploadFileName}` : "Upload PDF"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
                {resumeSource === "job" && (
                  <p className="text-xs text-gray-600">
                    {hasJobResume
                      ? "Using the tailored resume generated by the pipeline for this job."
                      : "No tailored resume. Your base resume from Settings will be used for on-demand tailoring."
                    }
                  </p>
                )}
                {resumeSource === "upload" && uploadedResumeText && (
                  <p className="text-xs text-emerald-500">
                    Parsed {uploadedResumeText.length.toLocaleString()} characters from {uploadFileName}
                  </p>
                )}
                {!hasJobResume && !uploadedResumeText && (
                  <p className="text-xs text-amber-400">
                    No tailored resume for this job. Your base resume from Settings will be used, or upload a PDF.
                  </p>
                )}
              </div>

              {/* Job Description */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">
                  Job Description
                  <span className="text-gray-700 font-normal ml-2">(editable)</span>
                </label>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  rows={12}
                  className="w-full bg-[#0a0c10] border border-gray-800/60 rounded-xl px-4 py-3 text-sm text-gray-300 leading-relaxed placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 resize-y"
                  placeholder="Paste or edit the job description here..."
                />
                <p className="text-xs text-gray-700 mt-1">{jdText.length.toLocaleString()} characters</p>
              </div>

              {/* Compare Button */}
              <button
                onClick={runCompare}
                disabled={!jdText.trim() || (resumeSource === "upload" && !uploadedResumeText)}
                className="w-full text-base font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 px-6 py-3.5 rounded-xl transition-colors"
              >
                Compare Resume with Job Description
              </button>
            </div>
          )}

          {/* ── ANALYZING PHASE ── */}
          {phase === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Analyzing your resume against this job...</p>
              <p className="text-xs text-gray-700">This may take 15-20 seconds (3-step AI analysis)</p>
            </div>
          )}

          {/* ── RESULTS PHASE ── */}
          {phase === "results" && analysis && (
            <div className="divide-y divide-gray-800/40">
              {error && (
                <div className="px-6 py-3">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Back to setup button */}
              <div className="px-6 py-3 flex items-center gap-2">
                <button
                  onClick={() => { setPhase("setup"); setAnalysis(null); setApplied(false); }}
                  className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to setup
                </button>
              </div>

              {/* Score bar */}
              <div className={`px-6 py-4 bg-gradient-to-r ${scoreBg(analysis.matchScore)} to-transparent`}>
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${analysis.matchScore >= 75 ? "bg-emerald-500" : analysis.matchScore >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${analysis.matchScore}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Analysis Insights */}
              <div className="px-6 py-4">
                <h3 className="text-sm font-bold text-gray-200 mb-3">Analysis Insights</h3>

                {/* Strengths */}
                {analysis.analysis.strengths.length > 0 && (
                  <div className="mb-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                    <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-2">Strengths</p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.analysis.strengths.map((s, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/8 text-emerald-300 border border-emerald-500/15">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Found Keywords */}
                {analysis.analysis.foundKeywords.length > 0 && (
                  <div className="mb-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2">Found Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.analysis.foundKeywords.map((kw, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 text-gray-300 border border-gray-700/50">{kw}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Added Keywords */}
                {analysis.analysis.addedKeywords.length > 0 && (
                  <div className="mb-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/15">
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-2">Suggested Keywords to Add</p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.analysis.addedKeywords.map((kw, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/8 text-blue-300 border border-blue-500/15">{kw}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing Keywords */}
                {analysis.analysis.missingKeywords.length > 0 && (
                  <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/15">
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2">Missing Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.analysis.missingKeywords.map((kw, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-red-500/8 text-red-300 border border-red-500/15">{kw}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Summary Optimization */}
              {analysis.summaryImproved && (
                <div className="px-6 py-4">
                  <h3 className="text-sm font-bold text-gray-200 mb-3">Summary Optimization</h3>
                  <div className="p-3 rounded-xl bg-[#0f1115] border border-gray-800/60">
                    {analysis.summaryOriginal && (
                      <div className="mb-3">
                        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-1">Original</p>
                        <p className="text-xs text-gray-500 leading-relaxed">{analysis.summaryOriginal}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Improved</p>
                      <p className="text-xs text-gray-200 leading-relaxed">{analysis.summaryImproved}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Skills Update */}
              {analysis.skillsUpdate && (
                <div className="px-6 py-4">
                  <h3 className="text-sm font-bold text-gray-200 mb-3">Skills Section Update</h3>
                  <p className="text-xs text-gray-600 mb-2">Updated skills extracted from all experience & project bullets:</p>
                  <div className="p-3 rounded-xl bg-[#0f1115] border border-gray-800/60 space-y-2">
                    {Object.entries(analysis.skillsUpdate as Record<string, string>).map(([category, value]) =>
                      value ? (
                        <div key={category}>
                          <span className="text-[10px] font-bold text-blue-400 uppercase">{category}: </span>
                          <span className="text-xs text-gray-300">{value}</span>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              )}

              {/* Project Swaps (from Project Bank) */}
              {analysis.projectSwaps && analysis.projectSwaps.length > 0 && (
                <div className="px-6 py-4">
                  <h3 className="text-sm font-bold text-gray-200 mb-3">Project Swap Suggestions</h3>
                  <p className="text-xs text-gray-600 mb-3">Based on your Project Bank, these projects are a better fit for this JD.</p>
                  <div className="space-y-3">
                    {analysis.projectSwaps.map((swap, i) => (
                      <div key={i} className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded">Remove</span>
                          <span className="text-sm text-gray-400 line-through">{swap.removeProject}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Add</span>
                          <span className="text-sm text-gray-200 font-medium">{swap.addProject.title}</span>
                        </div>
                        {swap.addProject.summary && (
                          <p className="text-xs text-gray-500 mb-2 italic">{swap.addProject.summary}</p>
                        )}
                        <ul className="space-y-1 mb-2">
                          {swap.addProject.bullets.map((b, bi) => (
                            <li key={bi} className="text-xs text-gray-400 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gray-600">{b}</li>
                          ))}
                        </ul>
                        <p className="text-[10px] text-purple-400 italic">{swap.addProject.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cover Letter + Hiring Message saved to job — shown in Job Detail modal */}
              {(analysis.coverLetter || analysis.hiringMessage) && (
                <div className="px-6 py-3">
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Cover letter & "Why I'm a Fit" saved — view them in the job detail panel
                  </p>
                </div>
              )}

              {/* Bullet Optimizations */}
              {analysis.optimizations.length > 0 && (
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-200">Optimization</h3>
                    <div className="flex items-center gap-2">
                      <button onClick={acceptAll}
                        className="text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors">
                        Accept All
                      </button>
                      <button onClick={resetAll}
                        className="text-xs font-medium text-gray-500 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                        Reset
                      </button>
                    </div>
                  </div>

                  {analysis.optimizations.map((section, secIdx) => (
                    <div key={secIdx} className="mb-6">
                      <div className="flex items-baseline justify-between mb-3">
                        <div>
                          <span className="text-sm font-semibold text-gray-200">{section.role}</span>
                          <span className="text-xs text-blue-400 ml-2">at {section.company}</span>
                        </div>
                        <span className="text-xs text-gray-600">{section.date}</span>
                      </div>

                      <div className="space-y-3">
                        {section.bullets.map((bullet, bulletIdx) => (
                          <div key={bulletIdx} className={`rounded-lg border transition-all ${
                            bullet.accepted
                              ? "bg-[#c9a94e]/5 border-[#c9a94e]/20"
                              : "bg-[#12151c] border-[rgba(255,255,255,0.06)]"
                          }`}>
                            {/* Suggestion header with toggle */}
                            {bullet.improved && (
                              <div className="flex items-center justify-between px-4 py-2 border-b border-[rgba(255,255,255,0.06)]">
                                <span className="text-[10px] font-mono font-bold text-[#c9a94e] uppercase tracking-wider">Suggestion</span>
                                <button
                                  onClick={() => toggleBullet(secIdx, bulletIdx)}
                                  className={`relative inline-flex items-center w-8 h-4 rounded-full transition-colors shrink-0 ${
                                    bullet.accepted ? "bg-[#c9a94e]" : "bg-[#2e3148]"
                                  }`}
                                >
                                  <span className={`inline-block w-3 h-3 bg-white rounded-full shadow transition-transform ${
                                    bullet.accepted ? "translate-x-[17px]" : "translate-x-[3px]"
                                  }`} />
                                </button>
                              </div>
                            )}

                            <div className="p-4">
                              {/* Original */}
                              <div className="mb-3">
                                <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-1">Original</p>
                                <p className="text-xs text-gray-400 leading-relaxed">{bullet.original}</p>
                              </div>

                              {/* Improved */}
                              {bullet.improved && (
                                <div>
                                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Improved</p>
                                  <p className="text-xs text-gray-200 leading-relaxed bg-[#0a0c10] rounded-lg p-3 border border-gray-800/30">
                                    {bullet.improved}
                                  </p>
                                  {bullet.addedKeywords?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {bullet.addedKeywords.map((kw, ki) => (
                                        <span key={ki} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium uppercase">{kw}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* No improvement needed */}
                              {!bullet.improved && (
                                <p className="text-[10px] text-emerald-500 italic">Already strong for this role</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with Apply button */}
        {phase === "results" && analysis && (
          <div className="px-5 py-3 border-t border-[rgba(255,255,255,0.06)] shrink-0 flex items-center justify-between">
            <span className="text-xs font-mono text-[#555872]">
              {acceptedCount} suggestion{acceptedCount !== 1 ? "s" : ""} accepted
            </span>
            <div className="flex items-center gap-2">
              {applied && (
                <span className="text-xs font-mono text-[#5d9968] flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  PDF generated
                </span>
              )}
              <button
                onClick={handleApply}
                disabled={applying || acceptedCount === 0}
                className="font-mono text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:bg-[#12151c] disabled:text-[#2e3148] bg-[#c9a94e]/15 text-[#c9a94e] border border-[#c9a94e]/30 hover:bg-[#c9a94e]/25"
              >
                {applying ? "Generating PDF..." : applied ? "Re-apply" : `Apply ${acceptedCount} & Generate PDF`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
