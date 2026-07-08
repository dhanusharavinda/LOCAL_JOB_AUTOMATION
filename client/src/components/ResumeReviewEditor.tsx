import { useMemo, useState } from "react";

/**
 * Live review editor for a tailored resume.
 *
 * Sits between "AI tailored your resume" and "PDF downloaded": every AI
 * bullet rewrite is shown as a green-highlighted change the user can
 * accept, reject, or hand-edit; every other field (contact info, summary,
 * skills, dates, links) is directly editable too. Confirming re-renders
 * the PDF from the edited JSON server-side — no extra LLM call, no
 * quota burn, and no DOCX round-trip to mangle the formatting.
 *
 * Data model: bulletPoints carry { original, improved, accepted }. The
 * PDF renderer prints `improved` only when `accepted` is true, else
 * `original` — so accept/reject here maps 1:1 onto what prints.
 */

interface Props {
  initialData: any;
  /** True while the edited PDF is being re-rendered server-side. */
  rendering: boolean;
  error: string | null;
  onConfirm: (edited: any) => void;
  onSkip: () => void;
}

/** Deep clone that tolerates the `any`-shaped resume JSON. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** The pristine AI suggestion for a bullet, if any — survives hand-edits. */
function aiSuggestionOf(bp: any): string | null {
  if (!bp) return null;
  if (typeof bp.aiSuggested === "string") return bp.aiSuggested;
  // Before any hand-edit, the AI text lives in `improved` (when it differs
  // from the original). After a hand-edit we stash it in `aiSuggested`.
  if (typeof bp.improved === "string" && bp.improved.trim() && bp.improved !== bp.original) {
    return bp.improved;
  }
  return null;
}

function bulletHasAiChange(bp: any): boolean {
  return aiSuggestionOf(bp) !== null;
}

/** Fields rendered in a fixed, sensible order; extras follow dynamically. */
const PERSONAL_INFO_ORDER = ["name", "location", "phone", "email", "linkedin", "github", "portfolio"];

const inputCls =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[#c9a94e]/40";
const labelCls =
  "font-mono text-[10px] uppercase tracking-wider text-[var(--text-ghost)] font-semibold block mb-1";
const sectionTitleCls =
  "font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold";

function rowsFor(text: string): number {
  return Math.min(6, Math.max(2, Math.ceil((text || "").length / 90)));
}

/** One editable bullet with accept / reject / restore controls. */
function BulletRow({ bp, onChange }: { bp: any; onChange: (next: any) => void }) {
  const original: string = bp?.original || "";
  const accepted: boolean = bp?.accepted === true;
  // `improved` is what prints when accepted; it may be an empty string (the
  // user deleted the text), which is a legitimate edit — do NOT coerce empty
  // back to the original.
  const improved: string | null = typeof bp?.improved === "string" ? bp.improved : null;
  const ai = aiSuggestionOf(bp);
  const aiChanged = ai !== null;
  // What the textarea shows: the accepted edit (even if empty) or the original.
  const displayText = accepted && improved !== null ? improved : original;
  const isLiveChange = displayText !== original;
  // The user hand-edited away from the AI's suggestion.
  const isEdited = ai !== null && improved !== null && improved !== ai;
  // An AI-added bullet has no original text; deleting it means empty output.
  const isAddedBullet = !original.trim() && aiChanged;

  function handleEdit(text: string) {
    // Stash the pristine AI text on first hand-edit so the toggle/footer can
    // still show and restore it after the user overwrites `improved`.
    const aiSuggested = bp?.aiSuggested ?? ai ?? undefined;
    if (text === original) {
      onChange({ ...bp, aiSuggested, improved: null, accepted: false });
    } else {
      onChange({ ...bp, aiSuggested, improved: text, accepted: true });
    }
  }

  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors ${
        isLiveChange
          ? "border-emerald-500/30 bg-emerald-500/[0.07]"
          : "border-[var(--border-subtle)] bg-[var(--bg-base)]"
      }`}
    >
      <textarea
        value={displayText}
        onChange={(e) => handleEdit(e.target.value)}
        rows={rowsFor(displayText)}
        placeholder={isAddedBullet ? "AI-added bullet (empty = removed from PDF)" : ""}
        className={`w-full bg-transparent text-sm leading-relaxed resize-y focus:outline-none placeholder:text-[var(--text-ghost)] placeholder:italic ${
          isLiveChange ? "text-emerald-100" : "text-[var(--text-primary)]"
        }`}
      />
      {aiChanged && (
        <div className="flex items-start justify-between gap-3 mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]/60">
          <p className="text-[10px] text-[var(--text-ghost)] leading-snug min-w-0">
            <span className="font-semibold">{isLiveChange ? "Original: " : "AI suggested: "}</span>
            <span className="line-clamp-2">{isLiveChange ? (original || "(new bullet)") : ai}</span>
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {isEdited ? (
              // Hand-edited: offer to snap back to the AI's original suggestion.
              <button
                type="button"
                onClick={() => onChange({ ...bp, improved: ai, accepted: true })}
                className="text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-1 rounded-md border text-amber-300 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                title="Replace your edit with the AI's suggested text"
              >
                Edited · use AI
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChange({ ...bp, accepted: !accepted })}
                className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors ${
                  accepted
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"
                    : "text-[var(--text-secondary)] bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                }`}
              >
                {accepted ? "✓ Accepted" : isAddedBullet ? "Removed" : "Rejected"}
              </button>
            )}
            {isLiveChange && !original.trim() ? null : (
              isLiveChange && (
                <button
                  type="button"
                  onClick={() => onChange({ ...bp, improved: null, accepted: false })}
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md text-[var(--text-ghost)] hover:text-red-400 transition-colors"
                  title="Discard changes to this bullet and keep the original text"
                >
                  Restore
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResumeReviewEditor({ initialData, rendering, error, onConfirm, onSkip }: Props) {
  const [data, setData] = useState<any>(() => clone(initialData || {}));
  // Skills are held as an ORDERED [name, value] array while editing, not
  // derived from the object each keystroke — otherwise renaming one category
  // to match another collapses them via Object.fromEntries key-collision and
  // silently deletes a whole row. Rebuilt into an object only at confirm time.
  const [skillRows, setSkillRows] = useState<[string, string][]>(() =>
    Object.entries(initialData?.skills || {}).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]),
  );

  /** Clone-mutate-set helper: keeps updates terse for a deeply `any` tree. */
  function mutate(fn: (draft: any) => void) {
    setData((d: any) => {
      const next = clone(d);
      fn(next);
      return next;
    });
  }

  const changeStats = useMemo(() => {
    let total = 0;
    let accepted = 0;
    for (const section of [data?.experience, data?.projects]) {
      for (const entry of section || []) {
        for (const bp of entry?.bulletPoints || []) {
          if (bulletHasAiChange(bp)) {
            total++;
            if (bp.accepted) accepted++;
          }
        }
      }
    }
    return { total, accepted };
  }, [data]);

  function setAllAccepted(value: boolean) {
    mutate((d) => {
      for (const section of [d?.experience, d?.projects]) {
        for (const entry of section || []) {
          for (const bp of entry?.bulletPoints || []) {
            if (bulletHasAiChange(bp)) bp.accepted = value;
          }
        }
      }
    });
  }

  const personalInfo = data?.personalInfo || {};
  const extraPersonalKeys = Object.keys(personalInfo).filter(
    (k) => !PERSONAL_INFO_ORDER.includes(k) && typeof personalInfo[k] === "string",
  );
  const personalKeys = [
    ...PERSONAL_INFO_ORDER.filter((k) => k === "name" || personalInfo[k] !== undefined),
    ...extraPersonalKeys,
  ];

  /** Merge the ordered skill rows back into an object at confirm time. */
  function buildConfirmedData(): any {
    const skills: Record<string, string> = {};
    for (const [k, v] of skillRows) {
      const key = k.trim();
      if (!key && !v.trim()) continue; // drop fully-empty rows
      // If two categories end up with the same name, merge their values
      // rather than silently dropping one (last-writer-wins would lose data).
      skills[key || "Skills"] = skills[key || "Skills"] ? `${skills[key || "Skills"]}, ${v}` : v;
    }
    return { ...data, skills };
  }

  return (
    <div className="bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-2xl overflow-hidden shadow-2xl">
      {/* Header: change summary + bulk actions */}
      <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
            Review before your PDF
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500/60 mr-1.5 align-[-1px]" />
            Green = changed text that will print. Accept, reject, or edit anything — then generate the PDF.
          </p>
        </div>
        {changeStats.total > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
              {changeStats.accepted}/{changeStats.total} changes accepted
            </span>
            <button
              type="button"
              disabled={rendering}
              onClick={() => setAllAccepted(true)}
              className="text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Accept all
            </button>
            <button
              type="button"
              disabled={rendering}
              onClick={() => setAllAccepted(false)}
              className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--bg-base)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Reject all
            </button>
          </div>
        )}
      </div>

      {/* Disabled while the PDF renders: a disabled fieldset natively disables
          every descendant input/textarea/button, so edits typed mid-render
          can't be silently discarded when the result phase swaps in. */}
      <fieldset disabled={rendering} className="block border-0 m-0 px-6 py-5 space-y-7 max-h-[70vh] overflow-y-auto disabled:opacity-60 min-w-0">
        {/* ── Contact ── */}
        <section>
          <h4 className={sectionTitleCls}>Contact</h4>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            {personalKeys.map((key) => (
              <div key={key}>
                <label className={labelCls}>{key}</label>
                <input
                  value={personalInfo[key] ?? ""}
                  onChange={(e) => mutate((d) => { d.personalInfo = d.personalInfo || {}; d.personalInfo[key] = e.target.value; })}
                  placeholder={
                    ["linkedin", "github", "portfolio"].includes(key) ? "https://..." : ""
                  }
                  className={inputCls}
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-ghost)] mt-1.5">
            Links must be full URLs (https://...) to be clickable in the PDF.
          </p>
        </section>

        {/* ── Summary ── */}
        <section>
          <div className="flex items-center gap-2">
            <h4 className={sectionTitleCls}>Summary</h4>
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
              AI-rewritten
            </span>
          </div>
          <textarea
            value={data?.summary || ""}
            onChange={(e) => mutate((d) => { d.summary = e.target.value; })}
            rows={rowsFor(data?.summary || "")}
            className={`${inputCls} mt-2 resize-y leading-relaxed`}
          />
        </section>

        {/* ── Skills ── */}
        {skillRows.length > 0 && (
          <section>
            <div className="flex items-center gap-2">
              <h4 className={sectionTitleCls}>Skills</h4>
              <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                AI-optimized
              </span>
            </div>
            <div className="space-y-2 mt-2">
              {skillRows.map(([cat, value], i) => (
                <div key={i} className="grid grid-cols-[minmax(90px,180px)_1fr] gap-2">
                  <input
                    value={cat}
                    onChange={(e) =>
                      setSkillRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))
                    }
                    className={`${inputCls} font-semibold`}
                  />
                  <input
                    value={value}
                    onChange={(e) =>
                      setSkillRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))
                    }
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Experience ── */}
        {(data?.experience || []).length > 0 && (
          <section>
            <h4 className={sectionTitleCls}>Experience</h4>
            <div className="space-y-5 mt-2">
              {(data.experience || []).map((exp: any, ei: number) => (
                <div key={ei} className="border border-[var(--border-subtle)] rounded-xl p-3.5">
                  <div className="grid sm:grid-cols-2 gap-2 mb-2.5">
                    {(["title", "company", "date", "location"] as const).map((f) => (
                      <div key={f}>
                        <label className={labelCls}>{f}</label>
                        <input
                          value={exp?.[f] ?? ""}
                          onChange={(e) => mutate((d) => { d.experience[ei][f] = e.target.value; })}
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(exp?.bulletPoints || []).map((bp: any, bi: number) => (
                      <BulletRow
                        key={bi}
                        bp={bp}
                        onChange={(next) => mutate((d) => { d.experience[ei].bulletPoints[bi] = next; })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Projects ── */}
        {(data?.projects || []).length > 0 && (
          <section>
            <h4 className={sectionTitleCls}>Projects</h4>
            <div className="space-y-5 mt-2">
              {(data.projects || []).map((proj: any, pi: number) => (
                <div key={pi} className="border border-[var(--border-subtle)] rounded-xl p-3.5">
                  <div className="grid sm:grid-cols-2 gap-2 mb-2.5">
                    {(["title", "link", "date", "location"] as const).map((f) => (
                      <div key={f}>
                        <label className={labelCls}>{f === "link" ? "link (https://...)" : f}</label>
                        <input
                          value={proj?.[f] ?? ""}
                          onChange={(e) => mutate((d) => { d.projects[pi][f] = e.target.value; })}
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(proj?.bulletPoints || []).map((bp: any, bi: number) => (
                      <BulletRow
                        key={bi}
                        bp={bp}
                        onChange={(next) => mutate((d) => { d.projects[pi].bulletPoints[bi] = next; })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Education ── */}
        {(data?.education || []).length > 0 && (
          <section>
            <h4 className={sectionTitleCls}>Education</h4>
            <div className="space-y-3 mt-2">
              {(data.education || []).map((edu: any, i: number) => (
                <div key={i} className="grid sm:grid-cols-4 gap-2">
                  {(["institution", "degree", "date", "gpa"] as const).map((f) => (
                    <div key={f} className={f === "institution" || f === "degree" ? "sm:col-span-2 lg:col-span-1" : ""}>
                      <label className={labelCls}>{f}</label>
                      <input
                        value={edu?.[f] ?? ""}
                        onChange={(e) => mutate((d) => { d.education[i][f] = e.target.value; })}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Certifications & Awards ── */}
        {((data?.certifications || []).length > 0 || (data?.awards || []).length > 0) && (
          <section>
            <h4 className={sectionTitleCls}>Certifications & Awards</h4>
            <div className="space-y-2 mt-2">
              {(data?.certifications || []).map((c: any, i: number) => (
                <div key={`c${i}`} className="grid grid-cols-[2fr_1.5fr_1fr] gap-2">
                  <input value={c?.name ?? ""} onChange={(e) => mutate((d) => { d.certifications[i].name = e.target.value; })} className={inputCls} placeholder="Certification" />
                  <input value={c?.issuer ?? ""} onChange={(e) => mutate((d) => { d.certifications[i].issuer = e.target.value; })} className={inputCls} placeholder="Issuer" />
                  <input value={c?.date ?? ""} onChange={(e) => mutate((d) => { d.certifications[i].date = e.target.value; })} className={inputCls} placeholder="Date" />
                </div>
              ))}
              {(data?.awards || []).map((a: any, i: number) => (
                <div key={`a${i}`} className="grid grid-cols-[2fr_1.5fr_1fr] gap-2">
                  <input value={a?.title ?? ""} onChange={(e) => mutate((d) => { d.awards[i].title = e.target.value; })} className={inputCls} placeholder="Award" />
                  <input value={a?.issuer ?? ""} onChange={(e) => mutate((d) => { d.awards[i].issuer = e.target.value; })} className={inputCls} placeholder="Issuer" />
                  <input value={a?.date ?? ""} onChange={(e) => mutate((d) => { d.awards[i].date = e.target.value; })} className={inputCls} placeholder="Date" />
                </div>
              ))}
            </div>
          </section>
        )}
      </fieldset>

      {/* Footer: skip / confirm */}
      <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 border border-red-500/20 text-red-400">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={rendering}
            className="font-mono text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            Skip — use as-is
          </button>
          <button
            type="button"
            onClick={() => onConfirm(buildConfirmedData())}
            disabled={rendering}
            className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-[#0c0e14] bg-[#c9a94e] hover:bg-[#d4b45a] px-6 py-3 rounded-xl transition-all shadow-lg shadow-[#c9a94e]/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {rendering ? (
              <>
                <div className="w-4 h-4 border-2 border-[#0c0e14] border-t-transparent rounded-full animate-spin" />
                Rendering PDF...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Apply & Generate PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
