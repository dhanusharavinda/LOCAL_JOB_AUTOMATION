import { useState, useEffect } from "react";
import { fetchStoryBank, deleteStory, StoryBankEntry } from "../api";

interface Props {
  onClose: () => void;
}

export default function StoryBankModal({ onClose }: Props) {
  const [stories, setStories] = useState<StoryBankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    fetchStoryBank()
      .then(setStories)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
    try {
      await deleteStory(id);
      setStories((prev) => prev.filter((s) => s.id !== id));
    } catch {}
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
              {stories.length} STAR+R {stories.length === 1 ? "story" : "stories"} accumulated across interviews
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tag filter */}
        <div className="px-6 py-3 border-b border-gray-800/60 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilter("")}
              className={`font-mono text-[10px] px-2 py-1 rounded-md border transition-all ${
                !filter ? "text-[#c9a94e] bg-[#c9a94e]/10 border-[#c9a94e]/30" : "text-gray-500 border-gray-800 hover:text-gray-300"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-[#c9a94e] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-gray-600 text-sm py-8">
              {stories.length === 0
                ? "No stories yet. Stories are generated when jobs move to \"Interviewing\" status."
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
                <div><span className="font-mono text-[10px] text-[#c9a94e] uppercase tracking-wider font-bold">S</span> <span className="text-gray-300 ml-1">{story.situation}</span></div>
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
      </div>
    </div>
  );
}
