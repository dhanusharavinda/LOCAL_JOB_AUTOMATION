import { useEffect, useState } from "react";
import { submitFeedback } from "../api";

/**
 * Small floating "Contact" button + dialog for bug reports and feature
 * suggestions. Pinned to the bottom-right corner with position:fixed so
 * it's visible across every page (dashboard, landing, auth, pricing,
 * etc.) without each page having to render its own copy.
 *
 * "Send" posts to POST /api/feedback (captured server-side so nothing is
 * lost and the user gets a real confirmation). A mailto: link is kept as a
 * fallback for anyone who'd rather email directly.
 *
 * The fallback address comes from VITE_SUPPORT_EMAIL so each deployment
 * points at its own inbox. If it is unset the mailto: link is hidden
 * rather than defaulting to someone else's address - the in-app form
 * still works, so nothing is lost.
 */
const CONTACT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL || "").trim();

type Category = "bug" | "feature" | "general";

const CATEGORY_LABEL: Record<Category, string> = {
  bug: "Bug report",
  feature: "Feature suggestion",
  general: "General feedback",
};

export default function ContactUsButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("feature");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Esc closes the dialog. Mirrors the keyboard contract of every
  // other modal in the app so the user's muscle memory works.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset transient state each time the dialog opens.
  useEffect(() => {
    if (open) { setSent(false); setErr(null); }
  }, [open]);

  async function send() {
    const trimmed = message.trim();
    if (!trimmed) { setErr("Write a message first."); return; }
    setSending(true);
    setErr(null);
    try {
      await submitFeedback({
        category,
        message: trimmed,
        page: typeof window !== "undefined" ? window.location.pathname : undefined,
      });
      setSent(true);
      setMessage("");
      // Auto-close shortly after the confirmation shows.
      setTimeout(() => { setOpen(false); setSent(false); }, 1600);
    } catch (e: any) {
      setErr(e?.message || "Could not send. Try the email option below.");
    } finally {
      setSending(false);
    }
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Old browsers without Clipboard API: do nothing. The email is
      // already visible in the dialog so users can manually select it.
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={launcher}
        aria-label="Send feedback"
        title="Send a bug report or feature suggestion"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Contact
      </button>

      {open && (
        <div style={overlay} onClick={() => setOpen(false)}>
          <div style={panel} onClick={(e) => e.stopPropagation()}>
            <div style={headerRow}>
              <div>
                <div style={title}>Got feedback?</div>
                <div style={subtitle}>Bug, feature idea, or just a hello. I'll see it.</div>
              </div>
              <button onClick={() => setOpen(false)} style={closeBtn} aria-label="Close">×</button>
            </div>

            <div style={fieldRow}>
              <label style={fieldLabel}>Type</label>
              <div style={catRow}>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    style={{
                      ...catChip,
                      background: category === c ? "#1f2335" : "transparent",
                      color: category === c ? "#fff" : "#9ca3af",
                      borderColor: category === c ? "#ff5722" : "rgba(255,255,255,0.12)",
                    }}
                  >
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            <div style={fieldRow}>
              <label style={fieldLabel}>Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  category === "bug"
                    ? "What broke? Steps to reproduce help a lot."
                    : category === "feature"
                    ? "What would make this more useful for you?"
                    : "What's on your mind?"
                }
                style={textarea}
                autoFocus
              />
            </div>

            {CONTACT_EMAIL && (
              <div style={emailRow}>
                <span style={emailLabel}>Goes to:</span>
                <code style={emailValue}>{CONTACT_EMAIL}</code>
                <button onClick={copyEmail} style={copyBtn}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}

            {err && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{err}</p>}
            {sent ? (
              <div style={{ color: "#4ade80", fontSize: 13, fontWeight: 600, textAlign: "center", padding: "8px 0" }}>
                ✓ Sent - thanks for the feedback!
              </div>
            ) : (
              <div style={footerRow}>
                {CONTACT_EMAIL && (
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                      `[${CATEGORY_LABEL[category]}] GO CANDID8 feedback`
                    )}&body=${encodeURIComponent(message.trim() || "(write your feedback here)")}`}
                    style={{ ...secondaryBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  >
                    Email instead
                  </a>
                )}
                <button
                  onClick={send}
                  disabled={sending}
                  style={{ ...primaryBtn, border: 0, opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── styles ─────────────────────────────────────────────────────────────
const launcher: React.CSSProperties = {
  position: "fixed",
  right: 20,
  bottom: 20,
  zIndex: 998,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderRadius: 999,
  background: "#1a1a1a",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
  cursor: "pointer",
};
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999,
  display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
  padding: 20,
};
const panel: React.CSSProperties = {
  background: "#14151c",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  width: "min(420px, 100%)",
  padding: 18,
  boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
  color: "#e5e7eb",
  fontFamily: "inherit",
};
const headerRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12,
};
const title: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: "#fff" };
const subtitle: React.CSSProperties = { fontSize: 12, color: "#9ca3af", marginTop: 2 };
const closeBtn: React.CSSProperties = {
  background: "transparent", border: 0, color: "#9ca3af",
  fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0,
};
const fieldRow: React.CSSProperties = { marginBottom: 12 };
const fieldLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#9ca3af",
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
const catRow: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const catChip: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer", background: "transparent",
};
const textarea: React.CSSProperties = {
  width: "100%", minHeight: 96, padding: 10,
  background: "#0f1018", color: "#fff",
  border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
  fontFamily: "inherit", fontSize: 13, lineHeight: 1.5,
  resize: "vertical", outline: "none", boxSizing: "border-box",
};
const emailRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
  background: "#0f1018", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8, marginBottom: 12, fontSize: 12,
};
const emailLabel: React.CSSProperties = { color: "#9ca3af" };
const emailValue: React.CSSProperties = { color: "#ff5722", fontFamily: "monospace", flex: 1 };
const copyBtn: React.CSSProperties = {
  background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
  color: "#e5e7eb", fontSize: 11, fontWeight: 600, padding: "4px 8px",
  borderRadius: 6, cursor: "pointer",
};
const footerRow: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4,
};
const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
  background: "transparent", color: "#9ca3af", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 8, border: 0,
  background: "#ff5722", color: "#fff", fontSize: 13, fontWeight: 700,
  cursor: "pointer", textDecoration: "none",
  display: "inline-flex", alignItems: "center",
};
