import { useState, useEffect } from "react";
import {
  fetchStoryBank, deleteStory, createStory, StoryBankEntry,
  fetchExperienceStories, generateExperienceStories, refineExperienceStory, deleteExperienceStory,
  ExperienceStory,
} from "../api";

interface Props {
  onClose: () => void;
}

const EMPTY_FORM = { story_title: "", situation: "", task: "", action: "", result: "", reflection: "", tags: "" };

export default function StoryBankModal({ onClose }: Props) {
  const [tab, setTab] = useState<"stories" | "experience">("stories");
  const [stories, setStories] = useState<StoryBankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // Manual add-story form (previously stories could only appear via
  // auto-generation from an Interviewing job - this lets users build the
  // bank directly).
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // ── Work Experience tab state ─────────────────────────────────────
  const [expStories, setExpStories] = useState<ExperienceStory[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expLoaded, setExpLoaded] = useState(false);
  const [expErr, setExpErr] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // Per-story follow-up answer drafts: story id -> question -> answer.
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, Record<string, string>>>({});
  const [refiningId, setRefiningId] = useState<number | null>(null);
  const [copiedExpId, setCopiedExpId] = useState<number | null>(null);

  useEffect(() => {
    fetchStoryBank()
      .then(setStories)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load experience stories the first time the tab is opened.
  useEffect(() => {
    if (tab !== "experience" || expLoaded) return;
    setExpLoading(true);
    fetchExperienceStories()
      .then((rows) => { setExpStories(rows); setExpLoaded(true); })
      .catch((e: any) => setExpErr(e?.message || "Could not load experience stories"))
      .finally(() => setExpLoading(false));
  }, [tab, expLoaded]);

  async function handleGenerateExperience() {
    setExpErr(null);
    setGenerating(true);
    try {
      const { created, skipped } = await generateExperienceStories();
      setExpStories((prev) => [...created, ...prev]);
      if (created.length === 0 && skipped > 0) {
        setExpErr("All the roles on your resume already have a story. Delete one first to regenerate it.");
      }
    } catch (e: any) {
      setExpErr(e?.message || "Could not generate experience stories.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRefine(story: ExperienceStory) {
    const drafts = answerDrafts[story.id] || {};
    const answers = story.followups
      .filter((f) => !f.answer)
      .map((f) => ({ question: f.question, answer: (drafts[f.question] || "").trim() }))
      .filter((a) => a.answer.length > 0);
    if (answers.length === 0) return;
    setExpErr(null);
    setRefiningId(story.id);
    try {
      const updated = await refineExperienceStory(story.id, answers);
      setExpStories((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setAnswerDrafts((prev) => ({ ...prev, [story.id]: {} }));
    } catch (e: any) {
      setExpErr(e?.message || "Could not update the story.");
    } finally {
      setRefiningId(null);
    }
  }

  async function handleDeleteExperience(id: number) {
    setExpErr(null);
    try {
      await deleteExperienceStory(id);
      setExpStories((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      setExpErr(e?.message || "Could not delete that story.");
    }
  }

  function copyExperience(story: ExperienceStory) {
    const parts = [
      `${story.title} at ${story.company}${story.date_range ? ` (${story.date_range})` : ""}`,
      "",
      story.monologue,
    ];
    if (story.day_in_life) parts.push("", "A typical day:", story.day_in_life);
    if (story.how_it_felt) parts.push("", "What it was like:", story.how_it_felt);
    navigator.clipboard.writeText(parts.join("\n"));
    setCopiedExpId(story.id);
    setTimeout(() => setCopiedExpId(null), 2000);
  }

  // Collect all unique tags
  const allTags = Array.from(new Set(stories.flatMap((s) => s.tags)));

  const filtered = filter
    ? stories.filter((s) =>
        s.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())) ||
        s.story_title.toLowerCase().includes(filter.toLowerCase())
      )
    : stories;

  function copyStory(story: StoryBankEntry) {
    const text = `${story.story_title}\n\nSituation: ${story.situation}\nTask: ${story.task}\nAction: ${story.action}\nResult: ${story.result}${story.reflection ? `\nReflection: ${story.reflection}` : ""}`;
    navigator.clipboard.writeText(text);
    setCopiedId(story.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleDelete(id: number) {
    setDeleteErr(null);
    try {
      await deleteStory(id);
      setStories((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      setDeleteErr(e?.message || "Could not delete that story. Please try again.");
    }
  }

  async function handleAdd() {
    setAddErr(null);
    if (!form.story_title.trim() || !form.situation.trim() || !form.task.trim() || !form.action.trim() || !form.result.trim()) {
      setAddErr("Title, Situation, Task, Action, and Result are all required.");
      return;
    }
    setSaving(true);
    try {
      const created = await createStory({
        story_title: form.story_title.trim(),
        situation: form.situation.trim(),
        task: form.task.trim(),
        action: form.action.trim(),
        result: form.result.trim(),
        reflection: form.reflection.trim() || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        source_job_id: null,
      });
      setStories((prev) => [created, ...prev]);
      setForm(EMPTY_FORM);
      setShowAdd(false);
      // Clear any active tag filter so the just-saved story is visible at the
      // top of the list (otherwise a non-matching tag hides it and the save
      // looks like it failed).
      setFilter("");
    } catch (e: any) {
      setAddErr(e?.message || "Could not save story. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0d0f13] border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/60 shrink-0">
          <div>
            <h2 className="font-display text-lg font-bold text-gray-50">Story Bank</h2>
            <p className="font-mono text-xs text-[#8b8fa3] mt-0.5">
              {tab === "stories"
                ? `${stories.length} STAR+R ${stories.length === 1 ? "story" : "stories"} in your bank`
                : `${expStories.length} work-experience ${expStories.length === 1 ? "narrative" : "narratives"} from your resume`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "stories" && (
              <button
                onClick={() => { setShowAdd((v) => !v); setAddErr(null); }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#f97316]/30 bg-[#f97316]/10 text-[#f97316] hover:bg-[#f97316]/20 transition-colors"
              >
                {showAdd ? "Close" : "+ Add story"}
              </button>
            )}
            {tab === "experience" && (
              <button
                onClick={handleGenerateExperience}
                disabled={generating}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#f97316]/30 bg-[#f97316]/10 text-[#f97316] hover:bg-[#f97316]/20 transition-colors disabled:opacity-50"
              >
                {generating ? "Reading your resume..." : "✨ Generate from resume"}
              </button>
            )}
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-gray-800/60 shrink-0">
          {([
            { id: "stories", label: "STAR Stories" },
            { id: "experience", label: "Work Experience" },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-xs font-semibold px-4 py-2 rounded-t-lg border border-b-0 transition-colors ${
                tab === t.id
                  ? "bg-[#0f1115] border-gray-800 text-[#f97316]"
                  : "bg-transparent border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Add-story form */}
        {tab === "stories" && showAdd && (
          <div className="px-6 py-4 border-b border-gray-800/60 shrink-0 space-y-2 bg-[#0f1115]">
            <input
              value={form.story_title}
              onChange={(e) => setForm((f) => ({ ...f, story_title: e.target.value }))}
              placeholder="Story title (e.g. Led migration under deadline)"
              className="w-full bg-[#0d0f13] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#f97316]/40"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ["situation", "Situation - the context"],
                ["task", "Task - what you had to do"],
                ["action", "Action - what you did"],
                ["result", "Result - the outcome (with numbers)"],
              ] as const).map(([key, ph]) => (
                <textarea
                  key={key}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={ph}
                  className="w-full min-h-[56px] bg-[#0d0f13] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#f97316]/40 resize-y"
                />
              ))}
            </div>
            <input
              value={form.reflection}
              onChange={(e) => setForm((f) => ({ ...f, reflection: e.target.value }))}
              placeholder="Reflection (optional) - what you learned"
              className="w-full bg-[#0d0f13] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#f97316]/40"
            />
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="Tags (optional), comma-separated - e.g. leadership, teamwork"
              className="w-full bg-[#0d0f13] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#f97316]/40"
            />
            {addErr && <p className="text-xs text-red-400">{addErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setAddErr(null); }}
                className="text-xs font-medium px-3 py-2 rounded-lg border border-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] hover:bg-[#f97316]/25 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save story"}
              </button>
            </div>
          </div>
        )}

        {/* Tag filter */}
        {tab === "stories" && (
        <div className="px-6 py-3 border-b border-gray-800/60 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilter("")}
              className={`font-mono text-[10px] px-2 py-1 rounded-md border transition-all ${
                !filter ? "text-[#f97316] bg-[#f97316]/10 border-[#f97316]/30" : "text-gray-500 border-gray-800 hover:text-gray-300"
              }`}
            >
              ALL ({stories.length})
            </button>
            {allTags.slice(0, 15).map((tag) => (
              <button
                key={tag}
                onClick={() => setFilter(filter === tag ? "" : tag)}
                className={`font-mono text-[10px] px-2 py-1 rounded-md border transition-all ${
                  filter === tag ? "text-[#6775a0] bg-[#6775a0]/10 border-[#6775a0]/30" : "text-gray-500 border-gray-800 hover:text-gray-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Content: Work Experience tab */}
        {tab === "experience" && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {expErr && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400">
              {expErr}
            </div>
          )}
          {(expLoading || generating) && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-6 h-6 border-2 border-[#f97316] border-t-transparent rounded-full animate-spin" />
              {generating && (
                <p className="text-xs text-gray-500">
                  Reading your resume and drafting a narrative for each role...
                </p>
              )}
            </div>
          )}
          {!expLoading && !generating && expStories.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <p className="text-gray-400 text-sm max-w-md mx-auto">
                Turn each job on your resume into a spoken-ready story: what you did there,
                what a typical day looked like, and what it was like to work there.
              </p>
              <p className="text-gray-600 text-xs max-w-md mx-auto">
                The AI only uses what your resume says. Anything it can't know (team size,
                culture, your proudest moment) becomes a follow-up question for you to answer.
              </p>
              <button
                onClick={handleGenerateExperience}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] hover:bg-[#f97316]/25 transition-colors"
              >
                ✨ Generate from resume
              </button>
            </div>
          )}
          {!expLoading && expStories.map((story) => {
            const open = story.followups.filter((f) => !f.answer);
            const drafts = answerDrafts[story.id] || {};
            const hasDraft = open.some((f) => (drafts[f.question] || "").trim().length > 0);
            return (
              <div key={story.id} className="p-4 rounded-xl bg-[#0f1115] border border-gray-800/60">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <h3 className="font-body font-semibold text-[15px] text-[#e8eaed] truncate">
                      {story.title} <span className="text-[#8b8fa3]">at</span> {story.company}
                    </h3>
                    <p className="font-mono text-[10px] text-[#555872] mt-0.5">
                      {story.date_range || ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {open.length > 0 ? (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {open.length} question{open.length > 1 ? "s" : ""} open
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Complete
                      </span>
                    )}
                    <button
                      onClick={() => copyExperience(story)}
                      className="text-[10px] font-medium text-gray-500 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-md transition-colors"
                    >
                      {copiedExpId === story.id ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => handleDeleteExperience(story.id)}
                      className="text-gray-700 hover:text-[#c45252] transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{story.monologue}</p>

                {story.day_in_life && (
                  <div className="mt-3 pt-3 border-t border-gray-800/40">
                    <div className="font-mono text-[10px] text-[#6775a0] uppercase tracking-wider font-bold mb-1">A day in that role</div>
                    <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{story.day_in_life}</p>
                  </div>
                )}
                {story.how_it_felt && (
                  <div className="mt-3 pt-3 border-t border-gray-800/40">
                    <div className="font-mono text-[10px] text-pink-400 uppercase tracking-wider font-bold mb-1">What it was like</div>
                    <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{story.how_it_felt}</p>
                  </div>
                )}

                {open.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-800/40 space-y-2">
                    <div className="font-mono text-[10px] text-[#f97316] uppercase tracking-wider font-bold">
                      The AI needs these details from you
                    </div>
                    {open.map((f) => (
                      <div key={f.question}>
                        <p className="text-xs text-gray-400 mb-1">{f.question}</p>
                        <input
                          value={drafts[f.question] || ""}
                          onChange={(e) =>
                            setAnswerDrafts((prev) => ({
                              ...prev,
                              [story.id]: { ...(prev[story.id] || {}), [f.question]: e.target.value },
                            }))
                          }
                          placeholder="Your answer (skip any you don't want to share)"
                          className="w-full bg-[#0d0f13] border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#f97316]/40"
                        />
                      </div>
                    ))}
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => handleRefine(story)}
                        disabled={!hasDraft || refiningId === story.id}
                        className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#f97316]/15 border border-[#f97316]/30 text-[#f97316] hover:bg-[#f97316]/25 transition-colors disabled:opacity-40"
                      >
                        {refiningId === story.id ? "Weaving your answers in..." : "Weave answers into the story"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}

        {/* Content */}
        {tab === "stories" && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {deleteErr && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400">
              {deleteErr}
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-[#f97316] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-gray-600 text-sm py-8">
              {stories.length === 0
                ? "No stories yet. Click \"+ Add story\" to create one. Stories are also auto-saved when a job moves to \"Interviewing\"."
                : "No stories match this filter."}
            </p>
          )}
          {filtered.map((story) => (
            <div key={story.id} className="p-4 rounded-xl bg-[#0f1115] border border-gray-800/60">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-body font-semibold text-[15px] text-[#e8eaed]">{story.story_title}</h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => copyStory(story)}
                    className="text-[10px] font-medium text-gray-500 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-md transition-colors"
                  >
                    {copiedId === story.id ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleDelete(story.id)}
                    className="text-gray-700 hover:text-[#c45252] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                <div><span className="font-mono text-[10px] text-[#f97316] uppercase tracking-wider font-bold">S</span> <span className="text-gray-300 ml-1">{story.situation}</span></div>
                <div><span className="font-mono text-[10px] text-[#6775a0] uppercase tracking-wider font-bold">T</span> <span className="text-gray-300 ml-1">{story.task}</span></div>
                <div><span className="font-mono text-[10px] text-[#5d9968] uppercase tracking-wider font-bold">A</span> <span className="text-gray-300 ml-1">{story.action}</span></div>
                <div><span className="font-mono text-[10px] text-violet-400 uppercase tracking-wider font-bold">R</span> <span className="text-gray-300 ml-1">{story.result}</span></div>
                {story.reflection && (
                  <div className="mt-1 pt-1 border-t border-gray-800/40">
                    <span className="font-mono text-[10px] text-pink-400 uppercase tracking-wider font-bold">Reflection</span>
                    <span className="text-gray-400 ml-1 text-xs">{story.reflection}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-2.5">
                {story.tags.map((tag, i) => (
                  <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#6775a0]/10 text-[#6775a0] border border-[#6775a0]/20">{tag}</span>
                ))}
              </div>
              <p className="font-mono text-[10px] text-[#555872] mt-1.5">
                {new Date(story.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                {story.source_job_id && ` from job #${story.source_job_id}`}
              </p>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
