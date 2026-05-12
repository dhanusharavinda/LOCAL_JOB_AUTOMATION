import { useEffect, useState } from "react";

/**
 * Small floating "Contact" button + dialog for bug reports and feature
 * suggestions. Pinned to the bottom-right corner with position:fixed so
 * it's visible across every page (dashboard, landing, auth, pricing,
 * etc.) without each page having to render its own copy.
 *
 * No backend required: pressing "Send" opens the user's mail client via
 * a mailto: link with subject + body pre-filled. Falls back to a
 * copy-email button when the user's environment can't handle mailto:.
 */
const CONTACT_EMAIL = "dhanushgoku997@gmail.com";

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

  function send() {
    const subject = `[${CATEGORY_LABEL[category]}] GO CANDID8 feedback`;
    const trimmed = message.trim();
    const body = trimmed || "(write your feedback here)";
    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Use window.open(...) over location.href so the user doesn't
    // navigate away from the dashboard if their mail client is a
    // webmail tab. window.open returns null when blocked; in that
    // case the click on the underlying <a href={mailto}> falls back.
    window.open(mailto, "_blank");
    setOpen(false);
    setMessage("");
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

            <div style={emailRow}>
              <span style={emailLabel}>Goes to:</span>
              <code style={emailValue}>{CONTACT_EMAIL}</code>
              <button onClick={copyEmail} style={copyBtn}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div style={footerRow}>
              <button onClick={() => setOpen(false)} style={secondaryBtn}>Cancel</button>
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  `[${CATEGORY_LABEL[category]}] GO CANDID8 feedback`
                )}&body=${encodeURIComponent(message.trim() || "(write your feedback here)")}`}
                onClick={(e) => { e.preventDefault(); send(); }}
                style={primaryBtn}
              >
                Open mail to send
              </a>
            </div>
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
