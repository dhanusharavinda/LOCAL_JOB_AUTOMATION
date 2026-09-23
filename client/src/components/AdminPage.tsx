import { useCallback, useEffect, useState } from "react";
import { AuthUser, AdminUserRow, adminListUsers, adminSetApproval, adminSetTailorLimit, adminSetInterviewLimit } from "../api";
import AdminInvites from "./AdminInvites";

// Daily allowance bounds. The admin can type anything in this range;
// Unlimited is a separate button because 9999 is a number you would
// otherwise have to know to enter.
const LIMIT_MIN = 5;
const LIMIT_MAX = 999;
const UNLIMITED_LIMIT = 9999;   // must match server/src/access.ts

/**
 * Per-user daily allowance: how many resumes and cover letters they can
 * make per day. Lives on every user row, not just the ones who came
 * through an invite link, because someone can exist as a profile without
 * an invite row and still need their limit raised.
 */
function LimitControl({
  user,
  onSaved,
}: {
  user: AdminUserRow;
  onSaved: (userId: string, limit: number | null) => void;
}) {
  const current = user.tailor_limit ?? null;
  const [draft, setDraft] = useState(current === null || current >= UNLIMITED_LIMIT ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function save(limit: number | null) {
    setBusy(true);
    try {
      const r = await adminSetTailorLimit(user.id, limit);
      onSaved(user.id, r.tailor_limit);
      setDraft(r.tailor_limit === null || r.tailor_limit >= UNLIMITED_LIMIT ? "" : String(r.tailor_limit));
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* the list refresh will show the real value */
    } finally {
      setBusy(false);
    }
  }

  const label =
    current === null ? "default (5)" : current >= UNLIMITED_LIMIT ? "unlimited" : `${current}/day`;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-ghost)]">
        Daily limit
      </span>
      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
        now: {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={LIMIT_MIN}
        max={LIMIT_MAX}
        value={draft}
        placeholder={`${LIMIT_MIN}-${LIMIT_MAX}`}
        onChange={(e) => setDraft(e.target.value)}
        className="w-20 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
      />
      <button
        disabled={busy || draft.trim() === ""}
        onClick={() => {
          const n = parseInt(draft, 10);
          if (!Number.isFinite(n)) return;
          save(Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, n)));
        }}
        className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-[#06070a] hover:bg-[var(--accent-light)] transition-colors disabled:opacity-40"
      >
        {done ? "Saved" : "Set"}
      </button>
      <button
        disabled={busy}
        onClick={() => save(UNLIMITED_LIMIT)}
        className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
      >
        Unlimited
      </button>
      <button
        disabled={busy}
        onClick={() => save(null)}
        className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
      >
        Default
      </button>
    </div>
  );
}

/**
 * Practice interviews per WEEK. A separate dial from the resume
 * allowance because a session costs roughly 100x a tailored resume,
 * so handing someone extra interviews is a different decision from
 * handing them extra resumes.
 */
function InterviewLimitControl({
  user,
  onSaved,
}: {
  user: AdminUserRow;
  onSaved: (userId: string, limit: number | null) => void;
}) {
  const current = user.interview_limit ?? null;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function save(limit: number | null) {
    setBusy(true);
    try {
      const r = await adminSetInterviewLimit(user.id, limit);
      onSaved(user.id, r.interview_limit);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* the next refresh shows the real value */
    } finally {
      setBusy(false);
    }
  }

  const label = current === null ? "default (1/week)" : `${current}/week`;
  const options: { text: string; value: number | null }[] = [
    { text: "1", value: 1 },
    { text: "2", value: 2 },
    { text: "5", value: 5 },
    { text: "Off", value: 0 },
    { text: "Default", value: null },
  ];

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-ghost)]">
        Interviews
      </span>
      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
        now: {done ? "saved" : label}
      </span>
      <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
        {options.map((o) => (
          <button
            key={o.text}
            disabled={busy}
            onClick={() => save(o.value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40 ${
              current === o.value
                ? "bg-[var(--accent)] text-[#06070a]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
            title={o.value === 0 ? "No practice interviews for this person" : undefined}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

// Small monospace pill for a single usage counter. Keeps the admin row
// scannable - zero values render greyed out so non-zero activity visually
// pops. Used inside the activity strip under each user row.
function UsageChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "sky" | "violet" | "amber" | "emerald" | "muted";
}) {
  const zero = value === 0;
  const palette = zero
    ? "bg-[var(--bg-surface)] text-[var(--text-ghost)] border-[var(--border-subtle)]"
    : accent === "sky"
      ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
      : accent === "violet"
        ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
        : accent === "amber"
          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
          : accent === "emerald"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${palette}`}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="lowercase tracking-normal">{label}</span>
    </span>
  );
}

interface Props {
  currentUser: AuthUser;
  onNavigateToLanding: () => void;
  onNavigateToDashboard: () => void;
  onLogout: () => void | Promise<void>;
}

type Tab = "pending" | "approved" | "rejected" | "all";

/**
 * AdminPage - owner-only interface for vetting testers.
 *
 * Access rules:
 *  - Client-side check: we only render this page when currentUser.is_admin
 *    is true. A non-admin who manually navigates here gets bounced.
 *  - Server-side check: every /api/auth/admin/* request is re-verified
 *    against ADMIN_EMAILS env server-side, so tampering with the client
 *    flag grants no actual access.
 *
 * Four tabs filter by approval_status. Approve/Reject buttons update the
 * row in place so the owner can triage the whole queue without reloading.
 */
export default function AdminPage({
  currentUser,
  onNavigateToLanding,
  onNavigateToDashboard,
  onLogout,
}: Props) {
  // Invite links are the day-to-day launch workflow, so they open first.
  const [section, setSection] = useState<"invites" | "users">("invites");
  const [tab, setTab] = useState<Tab>("pending");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-user action flag so the row's buttons can show a spinner
  // independently - approving tester A doesn't freeze the whole table.
  const [actingOn, setActingOn] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  // Every user regardless of tab. The tabbed list above is filtered
  // server-side, so totals taken from it would silently mean "total in
  // this tab" and move whenever a tab is clicked.
  const [allUsers, setAllUsers] = useState<AdminUserRow[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const statusFilter = tab === "all" ? undefined : tab;
    adminListUsers(statusFilter)
      .then((rows) => setUsers(rows))
      .catch((err: any) => setError(err?.message || "Failed to load users"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const loadTotals = useCallback(() => {
    adminListUsers()
      .then((rows) => setAllUsers(rows))
      .catch(() => { /* the tabbed list already surfaces load errors */ });
  }, []);

  useEffect(() => {
    loadTotals();
  }, [loadTotals]);

  async function handleSetStatus(userId: string, next: "approved" | "rejected" | "pending") {
    setActingOn((prev) => ({ ...prev, [userId]: true }));
    try {
      await adminSetApproval(userId, next);
      // Optimistic update: adjust the row's status in place so UI feels
      // snappy. If the current tab no longer matches (e.g. approved a
      // user while on "pending" tab), drop the row. That's less work than
      // re-fetching and avoids a flash of stale data.
      setUsers((prev) => {
        if (tab === "all") {
          return prev.map((u) => (u.id === userId ? { ...u, approval_status: next } : u));
        }
        return prev.filter((u) => u.id !== userId);
      });
      loadTotals();
    } catch (err: any) {
      setError(err?.message || "Failed to update user");
    } finally {
      setActingOn((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }

  // Simple client-side search across email + name. Admin lists are small
  // (< 500 rows) so we don't bother plumbing a server-side LIKE filter.
  const filtered = search.trim()
    ? users.filter((u) => {
        const q = search.toLowerCase();
        return u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
      })
    : users;

  const tabCounts = {
    pending: users.filter((u) => tab === "all" ? u.approval_status === "pending" : tab === "pending").length,
  };

  // All-time figures, not just today.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86400000;
  const totals = {
    joined: allUsers.length,
    approved: allUsers.filter((u) => u.approval_status === "approved").length,
    pending: allUsers.filter((u) => u.approval_status === "pending").length,
    joinedToday: allUsers.filter((u) => new Date(u.created_at).getTime() >= startOfToday.getTime()).length,
    joinedWeek: allUsers.filter((u) => new Date(u.created_at).getTime() >= weekAgo).length,
    tailorsTotal: allUsers.reduce((n, u) => n + (u.manual_tailors_total || 0), 0),
    tailorsToday: allUsers.reduce((n, u) => n + (u.manual_tailors_today || 0), 0),
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      {/* Nav */}
      <header className="shrink-0 px-4 sm:px-6 py-4 sm:py-5 border-b border-[var(--border-subtle)]">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <button onClick={onNavigateToLanding} className="flex items-center gap-2 sm:gap-3 group shrink-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-muted)] border border-[rgba(249, 115, 22,0.2)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-base">◆</span>
            </div>
            <span className="font-display text-base sm:text-lg text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors tracking-wide">
              Tailorly AI
            </span>
            <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#c45252]/10 text-[#c45252] border border-[#c45252]/20">
              Admin
            </span>
          </button>

          <nav className="flex items-center gap-4">
            <button
              onClick={onNavigateToDashboard}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Dashboard
            </button>
            <div className="flex items-center gap-3 pl-3 border-l border-[var(--border-subtle)]">
              <span className="text-sm text-[var(--text-primary)] font-medium max-w-[140px] truncate">
                {currentUser.name}
              </span>
              <button
                onClick={() => onLogout()}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-red)] hover:border-[rgba(196,82,82,0.3)] transition-all"
              >
                Sign out
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl text-[var(--text-primary)] mb-1">
          {section === "invites" ? "Invite links" : "Users"}
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {section === "invites"
            ? "Create a personal link for each person who asks, then paste it into their DM. They get in as soon as they open it and sign up."
            : "Everyone who has signed up. Approving someone here gives them early access with no expiry."}
        </p>
        <div className="mt-4 inline-flex gap-1 p-1 bg-[var(--bg-raised)] rounded-xl border border-[var(--border-subtle)]">
          {([
            { id: "invites", label: "Invite links" },
            { id: "users", label: "Users" },
          ] as const).map((sct) => (
            <button
              key={sct.id}
              onClick={() => setSection(sct.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                section === sct.id
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {sct.label}
            </button>
          ))}
        </div>
      </div>

      {section === "invites" && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
          <AdminInvites />
        </div>
      )}

      {section === "users" && (<>

      {/* All-time totals. Deliberately not derived from the tabbed list
          below, which only ever holds one status at a time. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {[
            { label: "Total joined", value: totals.joined, cls: "text-[var(--accent)]", hint: "Everyone who has ever signed up" },
            { label: "Approved", value: totals.approved, cls: "text-emerald-400", hint: "Have access right now" },
            { label: "Pending", value: totals.pending, cls: "text-amber-400", hint: "Signed up but not granted access" },
            { label: "Joined this week", value: totals.joinedWeek, cls: "text-sky-400", hint: "Last 7 days" },
            { label: "Joined today", value: totals.joinedToday, cls: "text-sky-400", hint: "Since midnight" },
            { label: "Resumes all time", value: totals.tailorsTotal, cls: "text-[var(--text-primary)]", hint: `${totals.tailorsToday} tailored today` },
          ].map((s) => (
            <div
              key={s.label}
              title={s.hint}
              className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-3 sm:p-4"
            >
              <div className={`font-display text-xl sm:text-2xl tabular-nums ${s.cls}`}>{s.value}</div>
              <div className="text-[11px] sm:text-xs text-[var(--text-tertiary)] mt-1 leading-tight">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs + search */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 bg-[var(--bg-raised)] rounded-xl border border-[var(--border-subtle)]">
          {(["pending", "approved", "rejected", "all"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                tab === t
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {t}
              {t === "pending" && tabCounts.pending > 0 && tab === t && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[#f97316]/20 text-[#f97316]">
                  {tabCounts.pending}
                </span>
              )}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)] transition-colors"
        />

        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all disabled:opacity-50"
          title="Reload list"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3">
          <div className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
          {loading && users.length === 0 ? (
            <div className="p-10 text-center text-[var(--text-tertiary)] text-sm">Loading testers…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-[var(--text-tertiary)] text-sm">
              {tab === "pending"
                ? "No pending signups. You're all caught up."
                : search
                  ? "No users match your search."
                  : `No ${tab} users.`}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {/* Header row */}
              <div className="hidden md:grid grid-cols-[2fr_2fr_0.8fr_1fr_1fr_auto] gap-3 px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-surface)]">
                <div>Email</div>
                <div>Name</div>
                <div>Plan</div>
                <div>Status</div>
                <div>Signed up</div>
                <div className="text-right">Actions</div>
              </div>

              {filtered.map((u) => {
                const acting = !!actingOn[u.id];
                const signedUp = new Date(u.created_at);
                const daysAgo = Math.max(0, Math.floor((Date.now() - signedUp.getTime()) / 86400000));
                const signedUpText = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
                // Identifying the current admin's own row lets us hide the
                // reject/reset buttons - the server also blocks this, but
                // showing a disabled button you can't use is worse UX than
                // hiding it outright.
                const isSelf = u.email.toLowerCase() === currentUser.email.toLowerCase();

                // "Last seen" - the most recent usage_tracking period.
                // Null means the user has never run a pipeline, which for
                // a freshly-approved tester is expected.
                const lastActiveText = (() => {
                  if (!u.last_active_date) return "never";
                  const d = new Date(u.last_active_date + "T00:00:00Z");
                  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
                  if (days === 0) return "today";
                  if (days === 1) return "yesterday";
                  return `${days}d ago`;
                })();
                return (
                  <div
                    key={u.id}
                    className="px-5 py-4 hover:bg-[var(--bg-surface)]/40 transition-colors"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-[2fr_2fr_0.8fr_1fr_1fr_auto] gap-3 items-center">
                    <div className="text-sm text-[var(--text-primary)] truncate font-mono">{u.email}</div>
                    <div className="text-sm text-[var(--text-secondary)] truncate">{u.name}</div>
                    <div>
                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          u.plan === "enterprise"
                            ? "bg-[var(--accent-blue-muted)] text-[var(--accent-blue)]"
                            : u.plan === "pro"
                              ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                              : "bg-[var(--bg-surface)] text-[var(--text-tertiary)]"
                        }`}
                      >
                        {u.plan}
                      </span>
                    </div>
                    <div>
                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          u.approval_status === "approved"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : u.approval_status === "rejected"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {u.approval_status}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] font-mono">{signedUpText}</div>

                    <div className="flex items-center gap-2 justify-end">
                      {isSelf ? (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] italic">
                          You
                        </span>
                      ) : (
                        <>
                          {u.approval_status !== "approved" && (
                            <button
                              onClick={() => handleSetStatus(u.id, "approved")}
                              disabled={acting}
                              className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            >
                              {acting ? "…" : "Approve"}
                            </button>
                          )}
                          {u.approval_status !== "rejected" && (
                            <button
                              onClick={() => handleSetStatus(u.id, "rejected")}
                              disabled={acting}
                              className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            >
                              {acting ? "…" : "Reject"}
                            </button>
                          )}
                          {u.approval_status !== "pending" && (
                            <button
                              onClick={() => handleSetStatus(u.id, "pending")}
                              disabled={acting}
                              className="text-xs font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-default)] transition-all disabled:opacity-50"
                              title="Move back to pending"
                            >
                              Reset
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    </div>

                    {/* Usage strip - per-user activity summary. Shown for
                        every row regardless of status because "this signup
                        ran 5 pipelines before approval" is something an
                        admin wants to see when triaging. */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                      <span className="uppercase tracking-wider text-[var(--text-ghost)] mr-1">Today</span>
                      <UsageChip label="jobs scraped" value={u.jobs_scraped_today} accent="sky" />
                      <UsageChip label="auto-tailored" value={u.resumes_tailored_today} accent="violet" />
                      <UsageChip label="manual tailors" value={u.manual_tailors_today} accent="amber" />
                      <UsageChip label="pipeline runs" value={u.pipeline_runs_today} accent="emerald" />

                      <span className="mx-2 h-3 w-px bg-[var(--border-subtle)]" />

                      <span className="uppercase tracking-wider text-[var(--text-ghost)] mr-1">Lifetime</span>
                      <UsageChip label="jobs" value={u.total_jobs} accent="muted" />
                      <UsageChip label="auto" value={u.resumes_tailored_total} accent="muted" />
                      <UsageChip label="manual" value={u.manual_tailors_total} accent="muted" />
                      <UsageChip label="runs" value={u.pipeline_runs_total} accent="muted" />

                      <span className="mx-2 h-3 w-px bg-[var(--border-subtle)]" />

                      <span className="uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]">
                        Last active: {lastActiveText}
                      </span>
                    </div>

                    <LimitControl
                      user={u}
                      onSaved={(userId, limit) =>
                        setUsers((prev) =>
                          prev.map((row) => (row.id === userId ? { ...row, tailor_limit: limit } : row)),
                        )
                      }
                    />

                    <InterviewLimitControl
                      user={u}
                      onSaved={(userId, limit) =>
                        setUsers((prev) =>
                          prev.map((row) => (row.id === userId ? { ...row, interview_limit: limit } : row)),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-xs text-[var(--text-tertiary)] mt-4 text-center">
          Showing {filtered.length} user{filtered.length === 1 ? "" : "s"}. Approved users pick up access on their next sign-in.
        </p>
      </div>
      </>)}
    </div>
  );
}
