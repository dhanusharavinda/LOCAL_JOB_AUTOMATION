import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminInvite, adminListInvites, adminCreateInvites, adminRevokeInvite,
  adminExtendAccess, adminEndAccess, adminSetTailorLimit, adminBlockUser,
} from "../api";
import { CREATOR } from "./CreatorPage";
import { siteUrl } from "../site";

/**
 * Admin panel for the invite-only launch: generate single-use invite
 * links, copy them (bare or as a ready-to-send DM), cancel unused ones,
 * and control each person who joined (daily allowance, extra days,
 * block, end access).
 */

function inviteUrl(token: string): string {
  // Always the real domain, never the origin the admin happens to be on.
  return siteUrl(`invite/${token}`);
}

/** Ready-to-paste LinkedIn DM. Intro + link + follow ask. */
function dmMessage(token: string): string {
  return [
    "Hey! Thanks for commenting.",
    "",
    "I'm Dhanush, I built Tailorly AI: paste a job description, and it rewrites your resume for that exact job in seconds. You can edit everything before you download the PDF.",
    "",
    "Here's your personal invite link (free to use, and it works once, so it's just for you):",
    inviteUrl(token),
    "",
    `If it helps you, a follow on LinkedIn would mean a lot: ${CREATOR.linkedin}`,
    "",
    "Any bugs or ideas, message me and I'll fix them.",
  ].join("\n");
}

// Must match UNLIMITED_LIMIT in server/src/access.ts.
const UNLIMITED_LIMIT = 9999;

/** One-tap daily allowances. null puts the person back on the default. */
const LIMIT_PRESETS: { label: string; value: number | null; hint: string }[] = [
  { label: "Default", value: null, hint: "Whatever the site default is (currently 5 a day)" },
  { label: "10", value: 10, hint: "10 resumes and 10 cover letters a day" },
  { label: "25", value: 25, hint: "25 resumes and 25 cover letters a day" },
  { label: "50", value: 50, hint: "50 resumes and 50 cover letters a day" },
  { label: "Unlimited", value: UNLIMITED_LIMIT, hint: "No practical daily cap" },
];

/**
 * Spend reads in cents until it is worth showing in dollars: a user who
 * has cost $0.018 should not render as "$0.02" next to someone at
 * "$0.00", because at these amounts the rounding hides the comparison.
 */
function money(usd: number | undefined): string {
  const v = usd ?? 0;
  if (v === 0) return "$0";
  if (v < 0.01) return "<1c";
  if (v < 1) return `${Math.round(v * 100)}c`;
  return `$${v.toFixed(2)}`;
}

/** How a stored limit reads in the UI. */
function limitLabel(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return "5";
  if (limit >= UNLIMITED_LIMIT) return "∞";
  return String(limit);
}

function ago(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and can be blocked; fall back
    // to a hidden textarea + execCommand so copying still works.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

type Filter = "unused" | "used" | "all";

export default function AdminInvites() {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(5);
  // 0 = access that never expires, which is the launch default. The
  // public promise is that the tool is free, so no countdown runs
  // unless an invite is deliberately given one.
  const [days, setDays] = useState(0);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<AdminInvite[]>([]);
  const [creatingDm, setCreatingDm] = useState(false);
  // The link behind the DM just copied, so it can be shown for reference.
  const [lastDmToken, setLastDmToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("unused");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminListInvites()
      .then(setInvites)
      .catch((e: any) => setError(e?.message || "Could not load invites"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function flashCopy(key: string, text: string) {
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } else {
      setError("Your browser blocked the clipboard. Select the link and copy it manually.");
    }
  }

  /**
   * Mint ONE brand new invite and copy its DM straight to the clipboard.
   *
   * Copying the DM off an existing row means squinting at the list trying
   * to remember whether that link already went to someone. A link created
   * at the moment of copying cannot have been sent before, which removes
   * the question entirely.
   */
  async function handleCopyFreshDm() {
    setCreatingDm(true);
    setError(null);
    try {
      const created = await adminCreateInvites({ count: 1, days, label: label.trim() || undefined });
      const invite = created[0];
      if (!invite?.token) throw new Error("No link came back. Try again.");
      setInvites((prev) => [invite, ...prev]);
      setLastDmToken(invite.token);
      await flashCopy("fresh-dm", dmMessage(invite.token));
    } catch (e: any) {
      setError(e?.message || "Could not create a link");
    } finally {
      setCreatingDm(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const created = await adminCreateInvites({ count, days, label: label.trim() || undefined });
      setFresh(created);
      setInvites((prev) => [...created, ...prev]);
      setLabel("");
    } catch (e: any) {
      setError(e?.message || "Could not create links");
    } finally {
      setCreating(false);
    }
  }

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [key]: true }));
    setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message || "Something went wrong"); }
    finally { setBusy((b) => { const n = { ...b }; delete n[key]; return n; }); }
  }

  /** Apply a change to every row belonging to one person. */
  function patchUser(userId: string, patch: Partial<AdminInvite>) {
    setInvites((prev) => prev.map((x) => (x.redeemed_user_id === userId ? { ...x, ...patch } : x)));
  }

  const stats = useMemo(() => ({
    unused: invites.filter((i) => !i.redeemed_at && !i.revoked_at).length,
    used: invites.filter((i) => !!i.redeemed_at).length,
    active: invites.filter((i) => i.redeemed_at && i.approval_status !== "rejected" && (daysLeft(i.access_expires_at) ?? 1) > 0).length,
    // What the tool has actually done, which is the number worth
    // watching once people are in.
    resumes: invites.reduce((n, i) => n + (i.tailors_total ?? 0), 0),
    covers: invites.reduce((n, i) => n + (i.covers_total ?? 0), 0),
    today: invites.reduce((n, i) => n + (i.tailors_today ?? 0), 0),
    spend: invites.reduce((n, i) => n + (i.cost_usd ?? 0), 0),
    costedRuns: invites.reduce((n, i) => n + (i.costed_runs ?? 0), 0),
  }), [invites]);

  const visible = invites.filter((i) => {
    if (filter === "unused" && (i.redeemed_at || i.revoked_at)) return false;
    if (filter === "used" && !i.redeemed_at) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [i.label, i.redeemed_email, i.redeemed_name].some((v) => (v || "").toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "Unused links", value: stats.unused, cls: "text-[var(--accent)]" },
          { label: "People joined", value: stats.used, cls: "text-emerald-400" },
          { label: "Active now", value: stats.active, cls: "text-sky-400" },
          { label: "Resumes tailored", value: stats.resumes, cls: "text-[var(--accent)]" },
          { label: "Cover letters", value: stats.covers, cls: "text-[var(--text-primary)]" },
          { label: "Tailored today", value: stats.today, cls: "text-sky-400" },
          {
            label: stats.costedRuns > 0 ? "OpenAI spend" : "OpenAI spend (est)",
            value: money(stats.spend),
            cls: "text-emerald-400",
          },
        ].map((s) => (
          <div key={s.label} className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-3 sm:p-4">
            <div className={`font-display text-xl sm:text-2xl tabular-nums ${s.cls}`}>{s.value}</div>
            <div className="text-[11px] sm:text-xs text-[var(--text-tertiary)] mt-1 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Generate */}
      <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Create invite links</h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Each link works once. Whoever opens it gets in straight away, with no approval step for you.
        </p>

        {/* Primary path when replying to a comment: one click gives a link
            that has never been sent to anyone. */}
        <div className="mt-4 p-3 sm:p-4 rounded-xl bg-[var(--accent-muted)] border border-[var(--accent)]/30">
          <button
            onClick={handleCopyFreshDm}
            disabled={creatingDm}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[var(--accent)] text-[#06070a] text-sm font-semibold hover:bg-[var(--accent-light)] transition-colors disabled:opacity-60"
          >
            {creatingDm ? "Creating..." : copied === "fresh-dm" ? "Copied, ready to paste" : "Copy DM with a new link"}
          </button>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-2 leading-relaxed">
            Makes a fresh link every time you click, so you never have to wonder whether you already sent it.
          </p>
          {lastDmToken && (
            <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-2 break-all">
              {inviteUrl(lastDmToken)}
            </p>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">How many</label>
              <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
                {[1, 5, 10, 25].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      count === n ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                Access days <span className="normal-case tracking-normal text-[var(--text-ghost)]">(0 = never expires)</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(Math.min(365, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-24 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">Note (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. LinkedIn launch, or the person's name"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {creating ? "Creating..." : `Create ${count} link${count === 1 ? "" : "s"}`}
          </button>
        </div>

        {fresh.length > 0 && (
          <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <span className="text-sm font-semibold text-emerald-300">
                {fresh.length} new link{fresh.length === 1 ? "" : "s"} ready to send
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => flashCopy("all", fresh.map((f) => inviteUrl(f.token!)).join("\n"))}
                  className="text-xs font-medium px-3 py-2 rounded-lg border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                >
                  {copied === "all" ? "Copied!" : "Copy all links"}
                </button>
                <button onClick={() => setFresh([])} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-2">
                  Done
                </button>
              </div>
            </div>
            <div className="space-y-3 max-h-72 overflow-y-auto">
              {fresh.map((f) => (
                <LinkRow key={f.id} invite={f} copied={copied} onCopy={flashCopy} />
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* List */}
      <div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
          <div className="flex gap-1 p-1 bg-[var(--bg-raised)] rounded-xl border border-[var(--border-subtle)]">
            {(["unused", "used", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                  filter === f ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {f === "used" ? "Joined" : f}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search note, name, or email..."
            className="flex-1 min-w-[160px] bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all disabled:opacity-50"
          >
            {loading ? "..." : "Refresh"}
          </button>
        </div>

        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden divide-y divide-[var(--border-subtle)]">
          {loading && invites.length === 0 && (
            <div className="p-10 text-center text-sm text-[var(--text-tertiary)]">Loading invites...</div>
          )}
          {!loading && visible.length === 0 && (
            <div className="p-10 text-center text-sm text-[var(--text-tertiary)]">
              {filter === "unused" ? "No unused links. Create some above." : filter === "used" ? "Nobody has joined yet." : "No invite links yet."}
            </div>
          )}

          {visible.map((i) => {
            if (i.redeemed_at) {
              return (
                <JoinedRow
                  key={i.id}
                  invite={i}
                  busy={busy}
                  withBusy={withBusy}
                  patchUser={patchUser}
                />
              );
            }
            if (i.revoked_at) {
              return (
                <div key={i.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 opacity-60">
                  <span className="text-sm text-[var(--text-tertiary)] truncate">{i.label || "Invite link"}</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-tertiary)] shrink-0">
                    Cancelled {ago(i.revoked_at)}
                  </span>
                </div>
              );
            }
            const key = `r${i.id}`;
            return (
              <div key={i.id} className="px-4 sm:px-5 py-3.5">
                <LinkRow
                  invite={i}
                  copied={copied}
                  onCopy={flashCopy}
                  extra={
                    <button
                      disabled={!!busy[key]}
                      onClick={() => withBusy(key, async () => {
                        await adminRevokeInvite(i.id);
                        setInvites((prev) => prev.map((x) => x.id === i.id ? { ...x, revoked_at: new Date().toISOString(), token: null } : x));
                        setFresh((prev) => prev.filter((x) => x.id !== i.id));
                      })}
                      className="text-xs px-3 py-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One person who joined, with every control for their account. */
function JoinedRow({
  invite: i, busy, withBusy, patchUser,
}: {
  invite: AdminInvite;
  busy: Record<string, boolean>;
  withBusy: (key: string, fn: () => Promise<void>) => Promise<void>;
  patchUser: (userId: string, patch: Partial<AdminInvite>) => void;
}) {
  const userId = i.redeemed_user_id;
  const key = `u${userId}`;
  const isBusy = !!busy[key];
  const left = daysLeft(i.access_expires_at);
  const blocked = i.approval_status === "rejected";
  const expired = left !== null && left <= 0;
  const [addDays, setAddDays] = useState(30);
  const [limitDraft, setLimitDraft] = useState<string>(
    i.tailor_limit === null || i.tailor_limit === undefined ? "" : String(i.tailor_limit)
  );

  const statusPill = blocked
    ? { text: "Blocked", cls: "bg-red-500/10 text-red-400" }
    : expired
      ? { text: "Expired", cls: "bg-amber-500/10 text-amber-400" }
      : left === null
        ? { text: "Active", cls: "bg-emerald-500/10 text-emerald-400" }
        : { text: `${left}d left`, cls: "bg-emerald-500/10 text-emerald-400" };

  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-[var(--text-primary)] truncate">{i.redeemed_name || "Unknown"}</div>
          <div className="text-xs text-[var(--text-tertiary)] font-mono truncate">{i.redeemed_email}</div>
          <div className="text-xs text-[var(--text-tertiary)] mt-1">
            Joined {ago(i.redeemed_at!)}
            {i.label ? ` · ${i.label}` : ""}
            {i.last_used_at ? ` · last used ${ago(i.last_used_at)}` : " · never used it"}
          </div>
          {/* Lifetime usage, split by kind. The combined number used to
              be labelled "total", which read as resumes but quietly
              counted cover letters too. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
            <span className="text-xs text-[var(--text-secondary)]">
              <span className="font-mono font-semibold text-[var(--accent)] tabular-nums">{i.tailors_total ?? 0}</span>
              {" "}resume{(i.tailors_total ?? 0) === 1 ? "" : "s"} tailored
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              <span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">{i.covers_total ?? 0}</span>
              {" "}cover letter{(i.covers_total ?? 0) === 1 ? "" : "s"}
            </span>
            <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
              today {i.tailors_today ?? 0}/{limitLabel(i.tailor_limit)}
              {typeof i.covers_today === "number" && i.covers_today > 0 ? ` · ${i.covers_today} cl` : ""}
            </span>
            <span
              className="text-[11px] font-mono text-[var(--text-tertiary)]"
              title={
                (i.costed_runs ?? 0) > 0
                  ? `${i.costed_runs} run(s) measured from the API's own token counts${i.tokens_total ? `, ${i.tokens_total.toLocaleString()} tokens` : ""}. Older runs use a measured average.`
                  : "Estimated from a measured per-run average. Exact token costs are recorded from now on."
              }
            >
              {money(i.cost_usd)} cost{(i.costed_runs ?? 0) > 0 ? "" : " (est)"}
            </span>
          </div>
        </div>
        <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full shrink-0 ${statusPill.cls}`}>
          {statusPill.text}
        </span>
      </div>

      {userId && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Daily allowance: one tap for the common values, typing for
              anything else. Unlimited is a real option rather than a
              number the admin has to know to enter. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-tertiary)]">Daily limit</span>
            <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
              {LIMIT_PRESETS.map((preset) => {
                const active = (i.tailor_limit ?? null) === preset.value;
                return (
                  <button
                    key={preset.label}
                    disabled={isBusy}
                    onClick={() => withBusy(key, async () => {
                      const r = await adminSetTailorLimit(userId, preset.value);
                      patchUser(userId, { tailor_limit: r.tailor_limit });
                      setLimitDraft(r.tailor_limit === null ? "" : String(r.tailor_limit));
                    })}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50 ${
                      active
                        ? "bg-[var(--accent)] text-[#06070a]"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    }`}
                    title={preset.hint}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={UNLIMITED_LIMIT}
              value={limitDraft}
              placeholder="custom"
              onChange={(e) => setLimitDraft(e.target.value)}
              className="w-20 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              disabled={isBusy}
              onClick={() => withBusy(key, async () => {
                const value = limitDraft.trim() === "" ? null : Math.max(0, parseInt(limitDraft, 10) || 0);
                const r = await adminSetTailorLimit(userId, value);
                patchUser(userId, { tailor_limit: r.tailor_limit });
              })}
              className="text-xs font-medium px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              title="Resumes and cover letters per day. Empty means the default."
            >
              Save
            </button>
          </div>

          {/* Extra days */}
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={addDays}
              onChange={(e) => setAddDays(Math.min(365, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-16 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              disabled={isBusy}
              onClick={() => withBusy(key, async () => {
                const r = await adminExtendAccess(userId, addDays);
                patchUser(userId, { access_expires_at: r.access_expires_at });
              })}
              className="text-xs font-medium px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              Add days
            </button>
          </div>

          {/* Block / unblock */}
          <button
            disabled={isBusy}
            onClick={() => {
              if (!blocked && !window.confirm(`Block ${i.redeemed_email}? They lose access until you unblock them.`)) return;
              withBusy(key, async () => {
                const r = await adminBlockUser(userId, !blocked);
                patchUser(userId, { approval_status: r.approval_status as any });
              });
            }}
            className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
              blocked
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-500/30"
            }`}
          >
            {blocked ? "Unblock" : "Block"}
          </button>

          {!expired && !blocked && (
            <button
              disabled={isBusy}
              onClick={() => {
                if (!window.confirm(`End access for ${i.redeemed_email} right now?`)) return;
                withBusy(key, async () => {
                  const r = await adminEndAccess(userId);
                  patchUser(userId, { access_expires_at: r.access_expires_at });
                });
              }}
              className="text-xs font-medium px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
            >
              End access
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LinkRow({
  invite, copied, onCopy, extra,
}: {
  invite: AdminInvite;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  extra?: React.ReactNode;
}) {
  if (!invite.token) return null;
  const url = inviteUrl(invite.token);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs text-[var(--text-primary)] truncate" title={url}>{url}</div>
        <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
          {invite.access_days > 0 ? `${invite.access_days} days access` : "never expires"} · created {ago(invite.created_at)}{invite.label ? ` · ${invite.label}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onCopy(`m${invite.id}`, dmMessage(invite.token!))}
          className="flex-1 sm:flex-none text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(249, 115, 22,0.3)] hover:opacity-90 transition-opacity"
          title="Copies the full DM: who you are, the link, and your LinkedIn"
        >
          {copied === `m${invite.id}` ? "Copied!" : "Copy DM"}
        </button>
        <button
          onClick={() => onCopy(`l${invite.id}`, url)}
          className="flex-1 sm:flex-none text-xs font-medium px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors"
        >
          {copied === `l${invite.id}` ? "Copied!" : "Link"}
        </button>
        {extra}
      </div>
    </div>
  );
}
