import { useEffect, useState } from "react";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { Job, JobStatus, COLUMNS } from "../types";
import JobCard from "./JobCard";

// One-line explanation of each pipeline stage, shown as a tooltip on the
// column header so the workflow (Filtered → Saved → Applied → …) is
// self-explanatory. Drag cards between columns to move a job through it.
const COLUMN_DESC: Record<JobStatus, string> = {
  filtered: "AI-approved shortlist — relevant jobs the pipeline scored and tailored a resume for. Review them, then drag to Saved or Applied.",
  saved: "Jobs you liked and plan to apply to. Drag to Applied once you've submitted.",
  applied: "You've applied. Drag to Interviewing when you hear back.",
  interviewing: "You're in the interview process for these.",
  offer: "You received an offer here.",
  rejected: "Not moving forward. Drag here, or keep for your records.",
};

interface Props {
  jobs: Job[];
  onDragEnd: (jobId: number, newStatus: JobStatus) => void;
  onCardClick: (job: Job) => void;
  selectionMode: boolean;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onDeleteColumn: (status: JobStatus, count: number) => void;
  onSelectAllInColumn?: (status: JobStatus) => void;
  onToggleFlag?: (id: number, flagged: boolean) => void;
}

/**
 * Responsive Kanban board.
 * ─────────────────────────
 * md+ screens: classic horizontal multi-column kanban (current desktop UX).
 * Below md:    single-column view with a horizontal scrolling tab bar at
 *              the top to switch statuses. Drag-and-drop still works within
 *              a column. Cross-column moves on mobile are handled via the
 *              card's detail modal (status dropdown), since dragging across
 *              hidden columns isn't possible.
 */
export default function KanbanBoard({
  jobs,
  onDragEnd,
  onCardClick,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onDeleteColumn,
  onSelectAllInColumn,
  onToggleFlag,
}: Props) {
  const [hoveredCol, setHoveredCol] = useState<JobStatus | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );
  const [mobileStatus, setMobileStatus] = useState<JobStatus>("filtered");

  // Keep isMobile in sync with viewport — fires on rotation / resize.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    const jobId = parseInt(result.draggableId);
    const newStatus = result.destination.droppableId as JobStatus;
    if (result.source.droppableId === newStatus && result.source.index === result.destination.index) return;
    onDragEnd(jobId, newStatus);
  }

  function getJobsByStatus(status: JobStatus) {
    return jobs.filter((j) => j.status === status);
  }

  // Columns to render. On mobile we only render the active one so drag
  // bounds are tight and the single-column UX is uncluttered.
  const visibleColumns = isMobile ? COLUMNS.filter((c) => c.id === mobileStatus) : COLUMNS;

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* Mobile status tab switcher — hidden on md+ */}
      {isMobile && (
        <div className="md:hidden flex gap-1.5 overflow-x-auto px-3 pt-2 pb-2 border-b border-[rgba(255,255,255,0.06)]">
          {COLUMNS.map((col) => {
            const count = getJobsByStatus(col.id).length;
            const active = col.id === mobileStatus;
            return (
              <button
                key={col.id}
                onClick={() => setMobileStatus(col.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                  active
                    ? "bg-[#c9a94e]/15 border border-[#c9a94e]/40 text-[#c9a94e]"
                    : "bg-[var(--bg-surface)] border border-[rgba(255,255,255,0.06)] text-[#8b8fa3]"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                {col.title}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${col.countBg}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Single scroll container for the whole board. @hello-pangea/dnd
          requires each Droppable to have exactly ONE scroll parent in its
          ancestor chain — previously the outer had overflow-x-auto AND
          each Droppable had overflow-y-auto, which tripped the nested-
          scroll-container warning and caused the first drag of a card to
          be ignored. Collapsing both axes onto this one element restores
          drag-and-drop immediately. */}
      <div className={`${isMobile ? "flex flex-col px-3 pt-2 pb-3 overflow-y-auto" : "flex gap-3 overflow-auto px-4 pb-3"} h-full`}>
        {visibleColumns.map((col) => {
          const columnJobs = getJobsByStatus(col.id);
          return (
            <div
              key={col.id}
              data-tour={`kanban-column-${col.id}`}
              className={`flex flex-col ${isMobile ? "w-full flex-1" : "flex-1 min-w-[280px]"} h-full`}
              onMouseEnter={() => setHoveredCol(col.id)}
              onMouseLeave={() => setHoveredCol(null)}
            >
              {/* Column Header */}
              <div className={`px-4 py-3 rounded-t-xl ${col.gradient} bg-[#0c0e14] border border-b-0 border-[rgba(255,255,255,0.06)]`} title={COLUMN_DESC[col.id]}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 cursor-help" title={COLUMN_DESC[col.id]}>
                    <span className={`w-2.5 h-2.5 rounded-full ${col.dotColor}`} />
                    <h2 className="font-display text-sm text-gray-200">
                      {col.title}
                    </h2>
                    <svg className="w-3 h-3 text-[var(--text-ghost)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono text-xs font-medium px-2.5 py-0.5 rounded-full ${col.countBg}`}>
                      {columnJobs.length}
                    </span>
                    {/* Select all in column — shown in selection mode for any column with jobs */}
                    {selectionMode && columnJobs.length > 0 && onSelectAllInColumn && (
                      (() => {
                        const allSelected = columnJobs.every((j) => selectedIds.has(j.id));
                        return (
                          <button
                            onClick={() => onSelectAllInColumn(col.id)}
                            title={allSelected ? `Deselect all in ${col.title}` : `Select all ${columnJobs.length} in ${col.title}`}
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                              allSelected
                                ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                                : "bg-gray-700/30 text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
                            }`}
                          >
                            {allSelected ? "Deselect" : "All"}
                          </button>
                        );
                      })()
                    )}
                    {/* Delete all in column — only for rejected column, visible on hover */}
                    {col.id === "rejected" && columnJobs.length > 0 && hoveredCol === col.id && (
                      <button
                        onClick={() => onDeleteColumn(col.id, columnJobs.length)}
                        title={`Delete all ${columnJobs.length} jobs in ${col.title}`}
                        className="w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Droppable Area — no overflow here. Vertical scrolling
                  for tall columns happens on the board-level container
                  above, because DND only allows one scroll parent per
                  Droppable. */}
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 px-1.5 py-2 space-y-2 min-h-[120px] rounded-b-xl border border-t-0 transition-all duration-200
                      ${snapshot.isDraggingOver
                        ? "border-[#c9a94e]/20 bg-[#c9a94e]/5"
                        : "border-[rgba(255,255,255,0.06)] bg-transparent"
                      }
                    `}
                  >
                    {columnJobs.length === 0 && !snapshot.isDraggingOver && (
                      <div className="flex flex-col items-center justify-center h-20 font-mono text-xs text-[#2e3148] text-center gap-1">
                        <span>Drop jobs here</span>
                        {col.id === "filtered" && (
                          <span className="text-[10px] text-[#2e3148]">Run pipeline to auto-populate</span>
                        )}
                      </div>
                    )}
                    {columnJobs.map((job, index) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        index={index}
                        column={col}
                        onClick={onCardClick}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(job.id)}
                        onToggleSelect={onToggleSelect}
                        onToggleFlag={onToggleFlag}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
