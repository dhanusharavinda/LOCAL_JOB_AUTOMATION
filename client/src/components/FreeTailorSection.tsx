import { useState, useRef, useCallback, useEffect } from "react";
import { freeTailorResume, checkFreeTailorStatus, generateFreeTailorCoverLetter, renderResumePdf, FreeTailorResult, AuthUser, AuthRequiredError } from "../api";
import AuthModal from "./AuthModal";
import ResumeReviewEditor from "./ResumeReviewEditor";

interface Props {
  currentUser: AuthUser | null;
  onNavigateToPricing: () => void;
}

type Phase = "input" | "tailoring" | "review" | "result";

export default function FreeTailorSection({ currentUser, onNavigateToPricing }: Props) {
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [intensity, setIntensity] = useState(5);
  // Optional cover-letter generation. Off by default - only flipped on
  // when the user explicitly checks the box. Server treats this as
  // opt-in too so the OpenAI cost stays flat for users who only want
  // a tailored resume.
  const [alsoCoverLetter, setAlsoCoverLetter] = useState(false);
  const [copiedCoverLetter, setCopiedCoverLetter] = useState(false);
  // Optional free-form steering ("emphasise Databricks, drop GCP").
  // Capped at 500 chars in the UI; the server allows up to 1000 as
  // a safety margin in case the cap moves later. Collapsed by
  // default so it doesn't intimidate first-time users.
  const [userInstructions, setUserInstructions] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  // Post-tailor cover letter generation. Lets a user click "Generate
  // cover letter" on the result panel even if they didn't check the
  // opt-in box before tailoring. We store the generated text here
  // instead of mutating `result.coverLetter` so the original response
  // stays intact and refresh-after-failure works cleanly.
  const [generatedCoverLetter, setGeneratedCoverLetter] = useState<string | null>(null);
  const [generatingCoverLetter, setGeneratingCoverLetter] = useState(false);
  const [coverLetterError, setCoverLetterError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FreeTailorResult | null>(null);
  // Live review editor state: true while the edited resume JSON is being
  // re-rendered to PDF server-side (no LLM call, no quota burn).
  const [rendering, setRendering] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  // Real page count of the uploaded resume (PDF only). Passed to the tailor
  // so the output PDF matches the input's page count. null for DOCX / pasted
  // text, where the server estimates from the resume's text length.
  const [resumePages, setResumePages] = useState<number | null>(null);
  // Live resume-text editor. Lets the user view and freely edit the extracted
  // resume text (add/remove/replace anything) before tailoring, or paste a
  // resume directly without uploading a file.
  const [editingResume, setEditingResume] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  // When the user hits the auth gate, we stash the intent so we can pick
  // back up and run the tailor automatically after they sign in.
  const [pendingTailor, setPendingTailor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback(async (file: File) => {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase();

    // Legacy .doc (pre-2007 binary format) isn't reliably extractable
    // by mammoth - when it half-extracts, the AI receives thin text and
    // emits placeholder JSON that renders as "string or null" all over
    // the PDF. Reject up front and tell the user to re-save as .docx
    // or PDF.
    if (ext === "doc") {
      setError("Legacy .doc files aren't supported. Save your resume as PDF or .docx and upload again.");
      return;
    }
    if (ext !== "pdf" && ext !== "docx") {
      setError("Please upload a PDF or DOCX file.");
      return;
    }

    setParsing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const endpoint = ext === "pdf" ? "/api/parse-pdf" : "/api/parse-docx";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64 }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to parse ${ext.toUpperCase()} file`);
      }

      const data = await res.json();
      if (!data.text || data.text.trim().length < 30) {
        throw new Error("Could not extract enough text from the file. Try a different format.");
      }

      setResumeText(data.text);
      setUploadedFileName(file.name);
      setEditingResume(false);
      // PDF parser returns the true page count; DOCX has none (server falls
      // back to a text-length estimate).
      setResumePages(typeof data.pages === "number" && data.pages > 0 ? data.pages : null);
    } catch (err: any) {
      setError(err.message || "Failed to parse file.");
    } finally {
      setParsing(false);
    }
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  async function handleTailor() {
    setError(null);

    if (resumeText.trim().length < 50) {
      setError("Add your resume first - upload a PDF/DOCX or paste the text.");
      return;
    }
    if (jobDescription.length < 30) {
      setError("Job description is too short. Paste the full job posting.");
      return;
    }

    // Auth gate - the form itself is the marketing bait. Before we
    // actually call OpenAI, pop the auth modal; once the user signs up
    // or logs in, the `pendingTailor` effect below runs the tailor for
    // them automatically so they don't lose their filled-in form.
    if (!currentUser) {
      setPendingTailor(true);
      setShowAuthModal(true);
      return;
    }

    try {
      const status = await checkFreeTailorStatus();
      if (status.remaining <= 0) {
        const isPro = status.plan === "pro" || status.plan === "enterprise";
        const hint = isPro
          ? `You have used all ${status.quota} tailors for today. Quota resets at 00:00 UTC.`
          : `You have used your ${status.quota} free tailor for today. Upgrade to Pro for 5 per day. Resets at 00:00 UTC.`;
        setError(hint);
        return;
      }
    } catch {}

    setPhase("tailoring");

    try {
      const res = await freeTailorResume(
        resumeText,
        jobDescription,
        intensity,
        uploadedFileName || undefined,
        alsoCoverLetter,
        userInstructions.trim() || undefined,
        resumePages || undefined,
      );
      setResult(res);
      // Land on the live review editor when the server returned structured
      // resume data (green-highlighted AI changes, accept/reject, manual
      // edits). Fall back straight to the result panel if it's missing.
      setReviewError(null);
      setPhase(res?.resumeData ? "review" : "result");
    } catch (err: any) {
      // If the server says the user isn't authenticated (stale token,
      // signed out in another tab, cold-start 401, etc.) re-open the sign-
      // up modal instead of surfacing a raw "Authentication required"
      // string. The pending-tailor effect will replay the request once
      // they finish auth.
      if (err instanceof AuthRequiredError) {
        setPhase("input");
        setPendingTailor(true);
        setShowAuthModal(true);
        return;
      }
      setError(err.message || "Something went wrong. Please try again.");
      setPhase("input");
    }
  }

  // After the user completes signup/login in the modal, currentUser flips
  // from null → AuthUser. If they originally clicked "Tailor My Resume"
  // before signing in, finish the job for them so the bait-to-result
  // flow feels seamless.
  useEffect(() => {
    if (!currentUser || !pendingTailor) return;
    setPendingTailor(false);
    // Fire-and-forget; handleTailor re-validates inputs.
    handleTailor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, pendingTailor]);

  // Signal to App.tsx's onboarding tour effect that the FreeTailor flow
  // is actively mid-transition. We only block the tour while the auth
  // modal is open, a signup-triggered tailor is queued, or the tailor
  // is running - NOT while the form sits idle in "input" phase, because
  // otherwise we'd block the tour forever for users who never use the
  // bait. The "result" phase doesn't block either; the tour can start
  // once the PDF is delivered.
  useEffect(() => {
    // "review" blocks too: the user is actively editing their resume and
    // a tour popover over the editor would be hostile.
    const busy = pendingTailor || showAuthModal || phase === "tailoring" || phase === "review";
    (window as any).__freeTailorBusy = busy;
    return () => {
      (window as any).__freeTailorBusy = false;
    };
  }, [pendingTailor, showAuthModal, phase]);

  // Confirm handler for the live review editor: re-render the PDF from the
  // user-edited resume JSON (accept/reject/manual edits applied). Pure
  // Puppeteer render server-side - no LLM call, so it never burns quota.
  async function handleApplyEdits(edited: any) {
    setRendering(true);
    setReviewError(null);
    try {
      // Reuse the exact page budget the server rendered the first PDF at
      // (result.targetPages), falling back to the uploaded PDF's page count.
      // Without this, an edited multi-page resume would be squeezed to 1 page.
      const budget = result?.targetPages ?? resumePages ?? undefined;
      const { pdfBase64 } = await renderResumePdf(edited, budget);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              resumeData: edited,
              pdfBase64,
              // The original signed URL still points at the pre-edit PDF;
              // null it so the download button uses the fresh base64.
              pdfUrl: null,
            }
          : prev,
      );
      setPhase("result");
    } catch (err: any) {
      if (err instanceof AuthRequiredError) {
        // Session expired mid-review. Stay in the review phase so the user's
        // accept/reject/edit decisions survive, and reopen the auth modal.
        // Deliberately do NOT set pendingTailor - that would replay the whole
        // tailor (burning a quota run) and discard the edits.
        setReviewError("Your session expired. Sign in again, then click Apply & Generate PDF - your edits are preserved.");
        setShowAuthModal(true);
        return;
      }
      setReviewError(err.message || "Couldn't render the edited PDF. Please try again.");
    } finally {
      setRendering(false);
    }
  }

  function handleDownloadPdf() {
    if (!result) return;
    // Preserve the uploaded resume's filename and prefix with MODIFIED_
    // so the user can tell the tailored copy apart from the original on
    // disk. Strip any existing extension before appending .pdf - the
    // backend always produces PDFs regardless of the source format.
    const base = (uploadedFileName || "tailored-resume").replace(/\.(pdf|docx?|rtf|txt)$/i, "");
    const outName = `MODIFIED_${base}.pdf`;
    if (result.pdfUrl) {
      // Signed URL path - open in a new tab. Browsers honour the Content-
      // Disposition the server sent, so filename control is server-side.
      window.open(result.pdfUrl, "_blank");
      return;
    }
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${result.pdfBase64}`;
    link.download = outName;
    link.click();
  }

  function handleStartOver() {
    setPhase("input");
    setResult(null);
    setError(null);
    setResumeText("");
    setJobDescription("");
    setUploadedFileName(null);
    setResumePages(null);
    setEditingResume(false);
    setGeneratedCoverLetter(null);
    setCoverLetterError(null);
    setUserInstructions("");
    setShowInstructions(false);
  }

  async function handleGenerateCoverLetter() {
    if (!resumeText || !jobDescription) return;
    setGeneratingCoverLetter(true);
    setCoverLetterError(null);
    try {
      const res = await generateFreeTailorCoverLetter(resumeText, jobDescription);
      setGeneratedCoverLetter(res.coverLetter);
    } catch (err: any) {
      setCoverLetterError(err.message || "Couldn't generate cover letter. Please try again.");
    } finally {
      setGeneratingCoverLetter(false);
    }
  }

  function handleRemoveFile() {
    setResumeText("");
    setUploadedFileName(null);
    setResumePages(null);
    setEditingResume(false);
  }

  return (
    <>
      {showAuthModal && (
        <AuthModal
          initialMode="signup"
          title="Sign up to tailor your resume"
          subtitle="Free account, 1 tailored resume per day. No credit card required."
          onClose={() => {
            setShowAuthModal(false);
            // Cancel the pending tailor if the user dismissed the modal
            // without signing in - otherwise the effect would retry once
            // they sign in later from somewhere else.
            setPendingTailor(false);
          }}
          onSuccess={() => {
            // Keep pendingTailor=true so the useEffect above re-runs
            // handleTailor once currentUser propagates from App.tsx.
          }}
        />
      )}
    <section className="relative py-20 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-10">
          <span className="inline-block font-mono text-xs uppercase tracking-widest text-[#c9a94e] bg-[#c9a94e]/10 border border-[#c9a94e]/20 px-3 py-1 rounded-full mb-4">
            Free Tool
          </span>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-3">
            Tailor Your Resume in Seconds
          </h2>
          <p className="text-[var(--text-secondary)] text-base max-w-xl mx-auto leading-relaxed">
            Upload your resume and paste a job description. Our AI rewrites your bullets, optimizes keywords, and generates a PDF ready to submit.
            {!currentUser && <span className="text-[#c9a94e]"> Free to try - just create an account.</span>}
          </p>
        </div>

        {/* ── Input Phase ── */}
        {phase === "input" && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-2xl overflow-hidden shadow-2xl">
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border-subtle)]">
              {/* Left: Resume Upload */}
              <div className="p-6">
                <label className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold flex items-center justify-between mb-3">
                  <span>Your Resume</span>
                  {editingResume && (
                    <span className="font-mono text-[10px] normal-case tracking-normal text-[var(--text-ghost)]">
                      {resumeText.length.toLocaleString()} characters
                    </span>
                  )}
                </label>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx"
                  onChange={handleFileInput}
                  className="hidden"
                />

                {editingResume ? (
                  /* Live resume-text editor - the exact text below is what the
                     AI reads. Add, remove, or replace anything. */
                  <div className="flex flex-col h-[280px]">
                    <textarea
                      value={resumeText}
                      onChange={(e) => {
                        setResumeText(e.target.value);
                        // Edited text no longer matches the uploaded PDF, so
                        // drop its fixed page count and let the server
                        // estimate pages from the edited text instead.
                        setResumePages(null);
                      }}
                      placeholder={"Paste or type your resume text here...\n\nEverything in this box is exactly what the AI tailors from."}
                      className="flex-1 w-full bg-[var(--bg-base)] border border-[#c9a94e]/30 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[#c9a94e]/60 font-mono resize-none leading-relaxed"
                      autoFocus
                    />
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <p className="text-[10px] text-[var(--text-ghost)]">
                        This exact text is what the AI tailors from.
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={handleRemoveFile}
                          className="text-[10px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-md transition-colors"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => {
                            if (resumeText.trim().length < 50) {
                              setError("Resume text must be at least 50 characters.");
                              return;
                            }
                            if (!uploadedFileName) setUploadedFileName("pasted-resume");
                            setEditingResume(false);
                          }}
                          disabled={resumeText.trim().length < 50}
                          className="text-[10px] font-semibold text-[#c9a94e] bg-[#c9a94e]/10 hover:bg-[#c9a94e]/20 border border-[#c9a94e]/30 px-4 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                ) : !uploadedFileName ? (
                  /* Drop zone */
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => !parsing && fileRef.current?.click()}
                    className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-all h-[280px] ${
                      dragOver
                        ? "border-[#c9a94e] bg-[#c9a94e]/5"
                        : "border-[var(--border-subtle)] hover:border-[var(--text-ghost)] bg-[var(--bg-base)]"
                    }`}
                  >
                    {parsing ? (
                      <>
                        <div className="w-8 h-8 border-2 border-[#c9a94e] border-t-transparent rounded-full animate-spin mb-3" />
                        <p className="text-sm text-[var(--text-secondary)]">Extracting text...</p>
                      </>
                    ) : (
                      <>
                        <div className="w-14 h-14 rounded-2xl bg-[#c9a94e]/10 border border-[#c9a94e]/20 flex items-center justify-center mb-4">
                          <svg className="w-7 h-7 text-[#c9a94e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
                          Drop your resume here
                        </p>
                        <p className="text-xs text-[var(--text-ghost)]">
                          or click to browse
                        </p>
                        <div className="flex items-center gap-2 mt-4">
                          <span className="font-mono text-[10px] text-[var(--text-ghost)] bg-[var(--bg-surface)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">PDF</span>
                          <span className="font-mono text-[10px] text-[var(--text-ghost)] bg-[var(--bg-surface)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">DOCX</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingResume(true); }}
                          className="mt-4 text-xs text-[#c9a94e] hover:text-[#d4b85a] underline underline-offset-2 decoration-[rgba(201,169,78,0.4)] transition-colors"
                        >
                          or paste your resume text instead
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  /* File uploaded state */
                  <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 h-[280px]">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-4">
                      <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-emerald-400 mb-1">{uploadedFileName}</p>
                    <p className="text-xs text-[var(--text-ghost)] mb-4">{resumeText.length.toLocaleString()} characters extracted</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingResume(true)}
                        className="text-[10px] font-semibold text-[#c9a94e] bg-[#c9a94e]/10 hover:bg-[#c9a94e]/20 border border-[#c9a94e]/30 px-3 py-1.5 rounded-md transition-colors"
                        title="View and edit the extracted resume text - add, remove, or replace anything before tailoring"
                      >
                        Edit text
                      </button>
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="text-[10px] font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-3 py-1.5 rounded-md transition-colors"
                      >
                        Replace
                      </button>
                      <button
                        onClick={handleRemoveFile}
                        className="text-[10px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-md transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Job Description */}
              <div className="p-6">
                <label className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold flex items-center justify-between mb-3">
                  <span>Job Description</span>
                  {(() => {
                    const words = jobDescription.trim() ? jobDescription.trim().split(/\s+/).length : 0;
                    const over = words > 1000;
                    return (
                      <span className={`font-mono text-[10px] normal-case tracking-normal ${over ? "text-red-400" : "text-[var(--text-ghost)]"}`}>
                        {words} / 1000 words
                      </span>
                    );
                  })()}
                </label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => {
                    // Enforce a hard 1000-word cap (matches the server's
                    // JD_WORD_CAP). We measure by whitespace-separated tokens
                    // after trimming. If the new value would exceed the cap,
                    // slice it down to the first 1000 words rather than
                    // silently dropping input on paste.
                    const next = e.target.value;
                    const words = next.trim() ? next.trim().split(/\s+/) : [];
                    if (words.length > 1000) {
                      setJobDescription(words.slice(0, 1000).join(" "));
                      setError("Job description capped at 1000 words.");
                      return;
                    }
                    setJobDescription(next);
                  }}
                  placeholder={"Paste the full job description here...\n\nInclude requirements, responsibilities, and preferred qualifications for best results. Max 1000 words."}
                  rows={12}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[#c9a94e]/40 font-mono resize-none leading-relaxed h-[280px]"
                />
              </div>
            </div>

            {/* Tailoring Intensity Slider */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <label className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold">
                    Tailoring Intensity
                  </label>
                  <span
                    className="text-[10px] text-[var(--text-ghost)]"
                    title="How aggressively the AI rewrites your bullets and how much plausible detail (metrics, tools, bullets) it may invent. Employers, titles, dates, and certifications are never altered at any level."
                  >
                    ⓘ
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-bold text-[#c9a94e] tabular-nums w-6 text-right">
                    {intensity}
                  </span>
                  <span className="text-[10px] text-[var(--text-ghost)]">/ 10</span>
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                className="w-full accent-[#c9a94e] cursor-pointer"
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className={`text-[10px] ${intensity <= 2 ? "text-[#c9a94e] font-semibold" : "text-[var(--text-ghost)]"}`}>
                  Light
                </span>
                <span className={`text-[10px] ${intensity > 2 && intensity <= 4 ? "text-[#c9a94e] font-semibold" : "text-[var(--text-ghost)]"}`}>
                  Blend
                </span>
                <span className={`text-[10px] ${intensity > 4 && intensity <= 6 ? "text-[#c9a94e] font-semibold" : "text-[var(--text-ghost)]"}`}>
                  Rewrite
                </span>
                <span className={`text-[10px] ${intensity > 6 && intensity <= 9 ? "text-[#c9a94e] font-semibold" : "text-[var(--text-ghost)]"}`}>
                  Aggressive
                </span>
                <span className={`text-[10px] ${intensity === 10 ? "text-[#c9a94e] font-semibold" : "text-[var(--text-ghost)]"}`}>
                  Mirror
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-ghost)] mt-1.5">
                {intensity <= 2
                  ? "Rewrites about a third of your bullets with the job's keywords. Vague claims may become plausible rounded numbers."
                  : intensity <= 4
                  ? "Rewrites most bullets in the job's language. Invents modest realistic metrics where numbers are missing."
                  : intensity <= 6
                  ? "Rewrites every bullet for this job. Invents realistic metrics and adds job-relevant tools that fit your background."
                  : intensity <= 9
                  ? "Rewrites everything and fabricates freely: metrics, tools, extra bullets. Claims stay plausible for your seniority."
                  : "Full mirror: maximum keyword match with the JD's exact wording plus fabricated supporting detail."}
              </p>
              {intensity >= 7 && intensity <= 9 && (
                <div className="mt-3 px-3 py-2.5 rounded-lg text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-300 leading-relaxed">
                  <strong className="font-semibold">Fabrication is on at this level.</strong> The AI invents plausible metrics, tools, and bullets to match the job. Review every change in the editor: anything it added is something you must be able to defend in an interview. (Employers, titles, dates, and certifications are never altered, at any level.)
                </div>
              )}
              {intensity === 10 && (
                <div className="mt-3 px-3 py-2.5 rounded-lg text-[11px] bg-red-500/10 border border-red-500/30 text-red-400 leading-relaxed">
                  <strong className="font-semibold">Full Mirror mode.</strong> Intensity 10 simulates how an ATS screens you and pushes for 90%+ keyword match - mirroring the JD's exact wording <em>and</em> fabricating plausible metrics, tools, and projects to get there. Your machine ATS score goes way up, but every added line is something you must be ready to defend in an interview, and heavy mirroring is visible to human recruiters. Use the review editor to check each change. (Employers, titles, dates, and certifications are never altered, at any level.)
                </div>
              )}
            </div>

            {/* Custom instructions add-on. Collapsed by default - 
                clicking the header expands a 500-char textarea that
                lets the user steer keyword emphasis ("lean on
                Databricks, drop GCP", "weave Airflow into the
                pipeline bullets"). The server treats this as a
                high-priority hint without overriding the immutable
                rules (job titles stay verbatim, no fabrication
                beyond what intensity allows, etc.). */}
            <div className="px-6 pt-4 pb-2">
              <button
                type="button"
                onClick={() => setShowInstructions((v) => !v)}
                className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <svg className={`w-3 h-3 transition-transform ${showInstructions ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Custom instructions
                <span className="text-[10px] normal-case tracking-normal text-[var(--text-ghost)]">
                  optional, tell the AI what to emphasise or drop
                </span>
              </button>
              {showInstructions && (
                <div className="mt-3">
                  <textarea
                    value={userInstructions}
                    onChange={(e) => {
                      const next = e.target.value.slice(0, 500);
                      setUserInstructions(next);
                    }}
                    rows={3}
                    placeholder={'e.g. "Mention Databricks and drop GCP. Weave Databricks into the work experience and project bullets where it fits."'}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[#c9a94e]/40 font-mono resize-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--text-ghost)]">
                    <span>
                      Steers keyword choice only. Past job titles, certifications, and dates stay verbatim.
                    </span>
                    <span className={`font-mono tabular-nums ${userInstructions.length >= 480 ? "text-amber-400" : ""}`}>
                      {userInstructions.length} / 500
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Cover letter add-on. One extra OpenAI call per tailor run,
                so it's opt-in. When checked, the response includes
                `coverLetter` and the result panel renders it below
                the tailored resume. */}
            <div className="px-6 pb-4">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={alsoCoverLetter}
                  onChange={(e) => setAlsoCoverLetter(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[var(--border-subtle)] bg-[var(--bg-surface)] accent-[var(--accent)] cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                    Also draft a cover letter
                  </div>
                  <div className="text-[11px] text-[var(--text-ghost)] mt-0.5">
                    Adds 3-paragraph cover letter alongside the tailored PDF. Grounded only in skills the AI sees in your resume, no fabricated details.
                  </div>
                </div>
              </label>
            </div>

            {/* Error + CTA */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {error && (
                <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 border border-red-500/20 text-red-400">
                  {error}
                  {error.includes("Upgrade") && (
                    <button
                      onClick={onNavigateToPricing}
                      className="ml-2 underline hover:text-red-300 transition-colors"
                    >
                      View plans
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-[var(--text-ghost)]">
                  {!currentUser
                    ? "Sign up to tailor your resume, 1 free per day."
                    : currentUser.plan === "pro" || currentUser.plan === "enterprise"
                      ? "5 tailors per day on Pro."
                      : "1 free tailor per day. Upgrade to Pro for 5."}
                </p>
                <button
                  onClick={handleTailor}
                  disabled={parsing}
                  className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-[#0c0e14] bg-[#c9a94e] hover:bg-[#d4b45a] px-6 py-3 rounded-xl transition-all shadow-lg shadow-[#c9a94e]/20 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Tailor My Resume
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Tailoring Phase ── */}
        {phase === "tailoring" && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-2xl p-12 text-center shadow-2xl">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#c9a94e]/10 border border-[#c9a94e]/20 mb-6">
              <div className="w-8 h-8 border-3 border-[#c9a94e] border-t-transparent rounded-full animate-spin" />
            </div>
            <h3 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">
              Tailoring your resume...
            </h3>
            <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
              Our AI is analyzing the job description, matching keywords, and rewriting bullets. Next you'll review every change in a live editor before the final PDF. This takes 15-30 seconds.
            </p>
            <div className="mt-6 flex justify-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#c9a94e] animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Review Phase: live editor with green diff highlights ── */}
        {phase === "review" && result?.resumeData && (
          <ResumeReviewEditor
            initialData={result.resumeData}
            rendering={rendering}
            error={reviewError}
            onConfirm={handleApplyEdits}
            onSkip={() => setPhase("result")}
          />
        )}

        {/* ── Result Phase ── */}
        {phase === "result" && result && (
          <div className="space-y-6">
            {/* Success Card */}
            <div className="bg-[var(--bg-raised)] border border-emerald-500/20 rounded-2xl overflow-hidden shadow-2xl">
              <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">Resume tailored successfully</h3>
                    <p className="text-xs text-[var(--text-secondary)]">Keywords optimized, bullets rewritten, PDF ready to download.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {result.resumeData && (
                    <button
                      onClick={() => { setReviewError(null); setPhase("review"); }}
                      className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] px-4 py-2.5 rounded-xl transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit resume
                    </button>
                  )}
                  <button
                    onClick={handleDownloadPdf}
                    className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-[#0c0e14] bg-[#c9a94e] hover:bg-[#d4b45a] px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-[#c9a94e]/20"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PDF
                  </button>
                </div>
              </div>

              {/* Preview of what changed */}
              <div className="px-6 py-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 rounded-xl bg-[var(--bg-surface)]">
                    <p className="font-display text-2xl font-bold text-[#c9a94e]">
                      {result.resumeData?.experience?.length || 0}
                    </p>
                    <p className="font-mono text-[10px] text-[var(--text-ghost)] uppercase tracking-wider">Roles Optimized</p>
                  </div>
                  <div className="p-3 rounded-xl bg-[var(--bg-surface)]">
                    <p className="font-display text-2xl font-bold text-[#c9a94e]">
                      {(result.resumeData?.experience || []).reduce(
                        (acc: number, exp: any) => acc + (exp.bulletPoints?.filter((b: any) => b.improved)?.length || 0),
                        0
                      )}
                    </p>
                    <p className="font-mono text-[10px] text-[var(--text-ghost)] uppercase tracking-wider">Bullets Rewritten</p>
                  </div>
                  <div className="p-3 rounded-xl bg-[var(--bg-surface)]">
                    <p className="font-display text-2xl font-bold text-[#c9a94e]">
                      {Object.values(result.resumeData?.skills || {}).join(", ").split(",").length}
                    </p>
                    <p className="font-mono text-[10px] text-[var(--text-ghost)] uppercase tracking-wider">Skills Matched</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cover letter card - shown when EITHER the user opted in
                up front and the server produced one (result.coverLetter)
                OR the user clicked "Generate cover letter" on this
                result panel (generatedCoverLetter). The card mirrors
                the kanban JobDetailModal's cover-letter section for
                visual consistency across the two surfaces. */}
            {(() => {
              const coverLetter = result.coverLetter || generatedCoverLetter;
              if (!coverLetter) return null;
              return (
                <div className="bg-[var(--bg-raised)] border border-blue-500/20 rounded-2xl overflow-hidden shadow-2xl">
                  <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                        <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">Cover letter drafted</h3>
                        <p className="text-xs text-[var(--text-secondary)]">Grounded in your resume, no fabricated tools or roles.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(coverLetter);
                        setCopiedCoverLetter(true);
                        setTimeout(() => setCopiedCoverLetter(false), 2000);
                      }}
                      className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-4 py-2 rounded-xl transition-colors"
                    >
                      {copiedCoverLetter ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="px-6 py-5">
                    <pre className="font-body text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{coverLetter}</pre>
                  </div>
                </div>
              );
            })()}

            {/* Post-tailor cover-letter CTA. Shown when no cover letter
                exists yet - either because the user didn't opt in, or
                because the inline cover-letter call failed. Gives them
                a way to generate one without re-tailoring (which would
                burn another daily quota). */}
            {!result.coverLetter && !generatedCoverLetter && (
              <div className="bg-[var(--bg-raised)] border border-blue-500/20 rounded-2xl px-6 py-5 shadow-2xl flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
                      {alsoCoverLetter ? "Cover letter not generated" : "Want a cover letter too?"}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {alsoCoverLetter
                        ? "The initial draft didn't come through. Try again, free."
                        : "Generate a 3-paragraph cover letter for this job, free."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleGenerateCoverLetter}
                  disabled={generatingCoverLetter}
                  className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {generatingCoverLetter ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    "Generate cover letter"
                  )}
                </button>
              </div>
            )}

            {coverLetterError && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {coverLetterError}
              </div>
            )}

            {/* Quota + Upsell Card - copy adapts to plan and remaining runs */}
            {(() => {
              const remaining = result.remaining ?? 0;
              const rawPlan = (result.plan ?? "free") as "free" | "pro" | "enterprise";
              // Enterprise is disabled during testing, so collapse it to pro
              // for copy purposes - users on legacy enterprise accounts see
              // pro-level messaging until Stripe wiring ships.
              const plan: "free" | "pro" = rawPlan === "free" ? "free" : "pro";
              const canTailorMore = remaining > 0;

              const headline = !canTailorMore
                ? plan === "pro"
                  ? "You have used all 5 tailors for today"
                  : "You have used your free tailor for today"
                : plan === "free"
                  ? "Want this for every application?"
                  : `${remaining} of ${result.quota} tailors remaining today`;

              const body = !canTailorMore
                ? plan === "pro"
                  ? "Your quota resets at 00:00 UTC."
                  : "Upgrade to Pro for 5 per day, or come back after 00:00 UTC."
                : plan === "free"
                  ? "Upgrade to automatically tailor resumes for every job the pipeline finds. Bulk scrape, score, and tailor in one click."
                  : "Come back anytime today to tailor another resume.";

              // Upgrade CTA: free users always see it; pro users don't - 
              // there's nothing to upgrade to during testing.
              const showUpgradeCta = plan === "free";

              return (
                <div className="bg-gradient-to-br from-[#c9a94e]/8 to-transparent border border-[#c9a94e]/20 rounded-2xl p-6 text-center">
                  <h4 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
                    {headline}
                  </h4>
                  <p className="text-sm text-[var(--text-secondary)] max-w-lg mx-auto mb-5 leading-relaxed">
                    {body}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    {showUpgradeCta && (
                      <button
                        onClick={onNavigateToPricing}
                        className="font-mono text-sm font-semibold uppercase tracking-wider text-[#0c0e14] bg-[#c9a94e] hover:bg-[#d4b45a] px-6 py-3 rounded-xl transition-all shadow-lg shadow-[#c9a94e]/20"
                      >
                        View Plans
                      </button>
                    )}
                    {canTailorMore && (
                      <button
                        onClick={handleStartOver}
                        className="font-mono text-sm font-medium uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-4 py-3 rounded-xl transition-colors"
                      >
                        Tailor Another
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </section>
    </>
  );
}
