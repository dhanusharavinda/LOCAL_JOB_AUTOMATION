import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminInvite, adminListInvites, adminCreateInvites, adminRevokeInvite, adminExtendAccess, adminEndAccess,
} from "../api";

/**
 * Admin panel for the invite-only launch: generate single-use invite
 * links, copy them (bare or with a ready-to-send DM), cancel unused ones,
 * and extend or end access for people who joined.
 */

function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

function dmMessage(token: string, days: number): string {
  return `Hi! Thanks for commenting. Here's your personal invite to GO CANDID8, free for ${days} days: ${inviteUrl(token)}\n\nThe link works once, so it's just for you. Enjoy!`;
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
    return false;
  }
}

type Filter = "unused" | "used" | "all";

export default function AdminInvites() {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(5);
  const [days, setDays] = useState(30);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<AdminInvite[]>([]);
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

  const stats = useMemo(() => ({
    unused: invites.filter((i) => !i.redeemed_at && !i.revoked_at).length,
    used: invites.filter((i) => !!i.redeemed_at).length,
    active: invites.filter((i) => i.redeemed_at && (daysLeft(i.access_expires_at) ?? 1) > 0).length,
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
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Unused links", value: stats.unused, cls: "text-[var(--accent)]" },
          { label: "People joined", value: stats.used, cls: "text-emerald-400" },
          { label: "Active now", value: stats.active, cls: "text-sky-400" },
        ].map((s) => (
          <div key={s.label} className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-4">
            <div className={`font-display text-2xl tabular-nums ${s.cls}`}>{s.value}</div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Generate */}
      <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Create invite links</h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Each link works once and gives free early access (Resume Tailor) for the chosen number of days, starting when it's used.
        </p>

        <div className="mt-4 grid sm:grid-cols-[auto_auto_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">How many</label>
            <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
              {[1, 5, 10, 25].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    count === n ? "bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">Free days</label>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.min(365, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-20 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">Note (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. LinkedIn launch, or the person's name"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
          >
            {creating ? "Creating..." : `Create ${count} link${count === 1 ? "" : "s"}`}
          </button>
        </div>

        {fresh.length > 0 && (
          <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <span className="text-sm font-semibold text-emerald-300">
                {fresh.length} new link{fresh.length === 1 ? "" : "s"} ready to send
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => flashCopy("all", fresh.map((f) => inviteUrl(f.token!)).join("\n"))}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                >
                  {copied === "all" ? "Copied!" : "Copy all links"}
                </button>
                <button onClick={() => setFresh([])} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-2">
                  Done
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
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
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex gap-1 p-1 bg-[var(--bg-raised)] rounded-xl border border-[var(--border-subtle)]">
            {(["unused", "used", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
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
            className="flex-1 min-w-[180px] bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all disabled:opacity-50"
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
              const left = daysLeft(i.access_expires_at);
              const expired = left !== null && left <= 0;
              const key = `u${i.redeemed_user_id}`;
              return (
                <div key={i.id} className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--text-primary)] truncate">
                      {i.redeemed_name || "Unknown"} <span className="text-[var(--text-tertiary)] font-mono text-xs">{i.redeemed_email}</span>
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      Joined {ago(i.redeemed_at)}{i.label ? ` · ${i.label}` : ""}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    left === null ? "bg-[var(--bg-surface)] text-[var(--text-tertiary)]"
                      : expired ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
                  }`}>
                    {left === null ? "No expiry" : expired ? "Expired" : `${left} day${left === 1 ? "" : "s"} left`}
                  </span>
                  {i.redeemed_user_id && (
                    <div className="flex gap-1.5">
                      <button
                        disabled={!!busy[key]}
                        onClick={() => withBusy(key, async () => {
                          const r = await adminExtendAccess(i.redeemed_user_id!, 30);
                          setInvites((prev) => prev.map((x) => x.redeemed_user_id === i.redeemed_user_id ? { ...x, access_expires_at: r.access_expires_at } : x));
                        })}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        +30 days
                      </button>
                      {!expired && (
                        <button
                          disabled={!!busy[key]}
                          onClick={() => {
                            if (!window.confirm(`End access for ${i.redeemed_email}? They'll be locked out right away.`)) return;
                            withBusy(key, async () => {
                              const r = await adminEndAccess(i.redeemed_user_id!);
                              setInvites((prev) => prev.map((x) => x.redeemed_user_id === i.redeemed_user_id ? { ...x, access_expires_at: r.access_expires_at } : x));
                            });
                          }}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
                        >
                          End access
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            if (i.revoked_at) {
              return (
                <div key={i.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 opacity-60">
                  <span className="text-sm text-[var(--text-tertiary)] truncate">{i.label || "Invite link"}</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-tertiary)]">
                    Cancelled {ago(i.revoked_at)}
                  </span>
                </div>
              );
            }
            const key = `r${i.id}`;
            return (
              <div key={i.id} className="px-4 sm:px-5 py-3">
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
                      className="text-xs px-2.5 py-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 transition-colors disabled:opacity-50"
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs text-[var(--text-primary)] truncate" title={url}>{url}</div>
        <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
          {invite.access_days} free days · created {ago(invite.created_at)}{invite.label ? ` · ${invite.label}` : ""}
        </div>
      </div>
      <button
        onClick={() => onCopy(`l${invite.id}`, url)}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors"
      >
        {copied === `l${invite.id}` ? "Copied!" : "Copy link"}
      </button>
      <button
        onClick={() => onCopy(`m${invite.id}`, dmMessage(invite.token!, invite.access_days))}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] border border-[rgba(201,169,78,0.3)] hover:opacity-90 transition-opacity"
        title="Copies a friendly DM with the link, ready to paste into LinkedIn"
      >
        {copied === `m${invite.id}` ? "Copied!" : "Copy DM"}
      </button>
      {extra}
    </div>
  );
}
