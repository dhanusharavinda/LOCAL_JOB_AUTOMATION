import { useState, useEffect } from "react";
import { fetchCandidates, createCandidate, deleteCandidate, updateCandidate, Candidate, startPipeline, AuthUser } from "../api";

const TIER_LABELS: Record<number, { label: string; scrape: number; tailor: number }> = {
  1: { label: "Starter", scrape: 20, tailor: 10 },
  2: { label: "Standard", scrape: 35, tailor: 20 },
  3: { label: "Premium", scrape: 50, tailor: 50 },
};

interface Props {
  user: AuthUser;
  onNavigateToLanding: () => void;
  onNavigateToDashboard: (candidateId?: number) => void;
  onLogout: () => void;
}

export default function CandidatesPage({ user, onNavigateToLanding, onNavigateToDashboard, onLogout }: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newTier, setNewTier] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [runningFor, setRunningFor] = useState<number | null>(null);

  useEffect(() => { loadCandidates(); }, []);

  async function loadCandidates() {
    try {
      setCandidates(await fetchCandidates());
    } catch { setError("Failed to load candidates"); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    try {
      await createCandidate({ name: newName.trim(), email: newEmail.trim() || undefined, tier: newTier } as any);
      setNewName(""); setNewEmail(""); setNewTier(1); setShowAdd(false);
      loadCandidates();
    } catch (err: any) { setError(err.message); }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this candidate and all their jobs?")) return;
    try { await deleteCandidate(id); loadCandidates(); }
    catch (err: any) { setError(err.message); }
  }

  async function handleTierChange(id: number, tier: 1 | 2 | 3) {
    try {
      await updateCandidate(id, { tier } as any);
      setCandidates((prev) => prev.map((c) => c.id === id ? {
        ...c, tier,
        limits: { gmail_sync: c.limits?.gmail_sync ?? true, jobs_scraped: TIER_LABELS[tier].scrape, resumes_tailored: TIER_LABELS[tier].tailor },
      } : c));
    } catch (err: any) { setError(err.message); }
  }

  async function handleRunPipeline(candidateId: number) {
    const c = candidates.find((x) => x.id === candidateId);
    if (!c) return;
    setRunningFor(candidateId);
    setError(null);
    try {
      const tierInfo = TIER_LABELS[c.tier || 1];
      await startPipeline(
        { APIFY_JOB_COUNT: tierInfo.scrape, MAX_TAILOR_COUNT: tierInfo.tailor } as any,
        candidateId
      );
      setError("Pipeline started — check the dashboard for live progress");
      setTimeout(() => setError(null), 5000);
      loadCandidates(); // Refresh to show updated canRunToday
    } catch (err: any) { setError(err.message); }
    finally { setRunningFor(null); }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] overflow-y-auto">
      {/* Nav */}
      <header className="shrink-0 px-6 py-5 border-b border-[var(--border-subtle)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onNavigateToLanding} className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] flex items-center justify-center">
                <span className="text-[var(--accent)] text-base">◆</span>
              </div>
              <span className="font-display text-lg text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors tracking-wide">GO CANDID8</span>
            </button>
            <span className="text-[var(--text-ghost)] mx-2">/</span>
            <h1 className="font-display text-lg text-[var(--text-primary)]">Candidates</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => onNavigateToDashboard()} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">My Dashboard</button>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent-blue-muted)] text-[var(--accent-blue)]">enterprise</span>
            <span className="text-xs text-[var(--text-tertiary)]">{user.name}</span>
            <button onClick={onLogout} className="text-xs text-[var(--text-ghost)] hover:text-[var(--accent-red)] transition-colors" title="Sign out">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className={`mb-6 px-4 py-3 rounded-xl text-sm flex items-center justify-between ${
            error.startsWith("Pipeline") ? "bg-emerald-500/8 border border-emerald-500/20 text-emerald-400" : "bg-[var(--accent-red-muted)] border border-[rgba(196,82,82,0.2)] text-red-400"
          }`}>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100 ml-4">✕</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display text-2xl text-[var(--text-primary)]">Manage Candidates</h2>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              {candidates.length} candidate{candidates.length !== 1 ? "s" : ""} — 1 pipeline run per candidate per day
            </p>
          </div>
          <button onClick={() => setShowAdd(true)} className="launch-btn rounded-xl py-2.5 px-5 font-medium text-sm">
            + Add Candidate
          </button>
        </div>

        {/* Add candidate form */}
        {showAdd && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 mb-6 landing-section-enter">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">New Candidate</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Name *</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jane Doe"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Email</label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="jane@example.com"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Usage Tier</label>
                <div className="flex gap-1">
                  {([1, 2, 3] as const).map((t) => (
                    <button key={t} onClick={() => setNewTier(t)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                        newTier === t
                          ? "bg-[var(--accent-blue-muted)] text-[var(--accent-blue)] border-[rgba(103,117,160,0.3)]"
                          : "bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-subtle)]"
                      }`}>
                      {TIER_LABELS[t].label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-ghost)] mt-1">{TIER_LABELS[newTier].scrape} scraped, {TIER_LABELS[newTier].tailor} tailored/day</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              <button onClick={handleAdd} className="launch-btn rounded-lg py-2 px-5 text-sm font-medium">Add</button>
            </div>
          </div>
        )}

        {/* Candidates Grid */}
        {candidates.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[var(--text-tertiary)] text-sm">No candidates yet. Add your first candidate to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {candidates.map((c) => {
              const tierInfo = TIER_LABELS[c.tier || 1];
              return (
                <div key={c.id} className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-5 hover:border-[var(--border-default)] transition-all group">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{c.name}</h3>
                      {c.email && <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{c.email}</p>}
                    </div>
                    <button onClick={() => handleDelete(c.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-ghost)] hover:text-[var(--accent-red)] transition-all" title="Delete candidate">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {/* Tier Slider */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Tier</span>
                      <span className="text-[10px] text-[var(--accent-blue)] font-medium">{tierInfo.label} — {tierInfo.scrape}/{tierInfo.tailor}</span>
                    </div>
                    <div className="flex gap-1">
                      {([1, 2, 3] as const).map((t) => (
                        <button key={t} onClick={() => handleTierChange(c.id, t)}
                          className={`flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all ${
                            c.tier === t
                              ? "bg-[var(--accent-blue-muted)] text-[var(--accent-blue)] border border-[rgba(103,117,160,0.3)]"
                              : "bg-[var(--bg-surface)] text-[var(--text-ghost)] border border-transparent hover:text-[var(--text-tertiary)]"
                          }`}>
                          {TIER_LABELS[t].label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[var(--bg-surface)] rounded-lg p-2.5">
                      <p className="text-lg font-mono font-bold text-[var(--text-primary)]">{c.job_count}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Jobs</p>
                    </div>
                    <div className="bg-[var(--bg-surface)] rounded-lg p-2.5">
                      <p className="text-lg font-mono font-bold text-[var(--text-primary)]">{c.tailored_count}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">Tailored</p>
                    </div>
                  </div>

                  {/* Usage bars */}
                  <div className="space-y-2 mb-4">
                    <div>
                      <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mb-0.5">
                        <span>Scraped today</span>
                        <span>{c.usage.jobs_scraped}/{c.limits.jobs_scraped}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--accent-blue)] rounded-full transition-all" style={{ width: `${Math.min(100, (c.usage.jobs_scraped / c.limits.jobs_scraped) * 100)}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mb-0.5">
                        <span>Tailored today</span>
                        <span>{c.usage.resumes_tailored}/{c.limits.resumes_tailored}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${Math.min(100, (c.usage.resumes_tailored / c.limits.resumes_tailored) * 100)}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button onClick={() => onNavigateToDashboard(c.id)}
                      className="flex-1 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all">
                      View Jobs
                    </button>
                    <button onClick={() => handleRunPipeline(c.id)} disabled={runningFor === c.id || !c.canRunToday}
                      className="flex-1 py-2 rounded-lg text-xs font-medium bg-[var(--accent-muted)] border border-[rgba(201,169,78,0.2)] text-[var(--accent)] hover:bg-[rgba(201,169,78,0.18)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      title={!c.canRunToday ? c.dailyRunReason : undefined}>
                      {runningFor === c.id ? "Starting..." : !c.canRunToday ? "Ran today" : "Run Pipeline"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
