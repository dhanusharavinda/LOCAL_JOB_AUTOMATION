import { useEffect, useState } from "react";
import { getApplyProfile, saveApplyProfile, clearApplyAnswerCache, extractResumeContacts, type ApplyProfile } from "../api";

/**
 * Dashboard editor for the apply profile.
 *
 * Same shape the extension's options page uses, just rendered with the
 * dashboard's existing styling. Saving here is the canonical setup
 * step before the extension is installed - once a user fills this in,
 * the extension picks up everything via /api/apply/profile.
 */

interface Props {
  onClose: () => void;
}

function emptyProfile(): ApplyProfile {
  return {
    full_name: "", email: "", phone: "", pronouns: "",
    linkedin_url: "", github_url: "", portfolio_url: "",
    street: "", city: "", state_region: "", postcode: "", country: "",
    work_auth_status: "", requires_sponsorship: null, willing_to_relocate: null,
    salary_min: null, salary_max: null, salary_currency: "USD",
    years_experience: null, highest_degree: "", university: "", graduation_year: null,
    start_date: "",
    ethnicity: "", gender: "", veteran_status: "", disability_status: "",
    why_interested: "", greatest_achievement: "", problem_solved: "", unique_strength: "",
  };
}

export default function ApplyProfileEditor({ onClose }: Props) {
  const [profile, setProfile] = useState<ApplyProfile>(emptyProfile());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { profile: p } = await getApplyProfile();
        if (alive) setProfile({ ...emptyProfile(), ...p });
      } catch (err: any) {
        if (alive) setStatus({ msg: err.message || "Could not load profile", error: true });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function update<K extends keyof ApplyProfile>(key: K, value: ApplyProfile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const body: any = { ...profile };
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
      delete body.custom_answers;
      await saveApplyProfile(body);
      setStatus({ msg: "Saved." });
    } catch (err: any) {
      setStatus({ msg: err.message || "Save failed", error: true });
    } finally {
      setSaving(false);
    }
  }

  async function autoFillFromResume() {
    setStatus(null);
    try {
      const found = await extractResumeContacts();
      const updates: Partial<ApplyProfile> = {};
      const filled: string[] = [];
      // Only fill empty fields. Existing user-entered values are kept.
      if (found.linkedin_url && !profile.linkedin_url) { updates.linkedin_url = found.linkedin_url; filled.push("LinkedIn"); }
      if (found.github_url && !profile.github_url)     { updates.github_url   = found.github_url;   filled.push("GitHub"); }
      if (found.portfolio_url && !profile.portfolio_url) { updates.portfolio_url = found.portfolio_url; filled.push("Portfolio"); }
      if (found.email && !profile.email)               { updates.email        = found.email;        filled.push("Email"); }
      if (found.phone && !profile.phone)               { updates.phone        = found.phone;        filled.push("Phone"); }

      if (Object.keys(updates).length === 0) {
        setStatus({ msg: "Nothing new found in your resume (or fields are already filled)." });
        return;
      }
      setProfile((p) => ({ ...p, ...updates }));
      setStatus({ msg: `Filled from resume: ${filled.join(", ")}. Click Save to persist.` });
    } catch (err: any) {
      setStatus({ msg: err?.message || "Could not parse resume", error: true });
    }
  }

  async function clearAi() {
    if (!confirm("Clear all cached AI answers? You can re-generate them on the next application.")) return;
    try {
      await clearApplyAnswerCache();
      setStatus({ msg: "AI answer cache cleared." });
    } catch (err: any) {
      setStatus({ msg: err.message || "Could not clear cache", error: true });
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
              Auto-Apply Profile
              <span style={betaBadge}>BETA</span>
            </h2>
            <p style={muted}>Fill this once. The browser extension uses these answers to fill every supported job site. Auto-apply is in beta — review every submission before sending.</p>
          </div>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>

        {loading ? (
          <div style={{ padding: 24, color: "#666" }}>Loading…</div>
        ) : (
          <div style={{ padding: 16, overflowY: "auto", maxHeight: "calc(85vh - 110px)" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", marginBottom: 14, borderRadius: 10,
              background: "#fff8e1", border: "1px solid #ffd54f", fontSize: 12, color: "#6d4c00",
            }}>
              <span>Already uploaded a resume in Settings? Auto-fill these fields by parsing it.</span>
              <button onClick={autoFillFromResume} type="button" style={{
                padding: "8px 14px", borderRadius: 8, border: 0,
                background: "#1a1a1a", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 12,
              }}>Auto-fill from resume</button>
            </div>
            <Section title="Personal" help="Used for every form's name/email/phone fields.">
              <Grid>
                <Field label="Full name" value={profile.full_name} onChange={(v) => update("full_name", v)} />
                <Field label="Email" type="email" value={profile.email} onChange={(v) => update("email", v)} />
                <Field label="Phone" value={profile.phone} onChange={(v) => update("phone", v)} />
                <Field label="Pronouns" value={profile.pronouns} onChange={(v) => update("pronouns", v)} />
                <Field label="LinkedIn URL" value={profile.linkedin_url} onChange={(v) => update("linkedin_url", v)} />
                <Field label="GitHub URL" value={profile.github_url} onChange={(v) => update("github_url", v)} />
                <Field label="Portfolio URL" value={profile.portfolio_url} onChange={(v) => update("portfolio_url", v)} full />
              </Grid>
            </Section>

            <Section title="Address">
              <Grid>
                <Field label="Street" value={profile.street} onChange={(v) => update("street", v)} full />
                <Field label="City" value={profile.city} onChange={(v) => update("city", v)} />
                <Field label="State / region" value={profile.state_region} onChange={(v) => update("state_region", v)} />
                <Field label="Postcode" value={profile.postcode} onChange={(v) => update("postcode", v)} />
                <Field label="Country" value={profile.country} onChange={(v) => update("country", v)} />
              </Grid>
            </Section>

            <Section title="Work authorization">
              <Grid>
                <Field
                  label="Authorization status"
                  value={profile.work_auth_status}
                  onChange={(v) => update("work_auth_status", v)}
                  placeholder="Authorized / Need sponsorship / Citizen / GC / H1B / Stamp4"
                  full
                />
                <BoolField
                  label="Need visa sponsorship?"
                  value={profile.requires_sponsorship}
                  onChange={(v) => update("requires_sponsorship", v)}
                />
                <BoolField
                  label="Willing to relocate?"
                  value={profile.willing_to_relocate}
                  onChange={(v) => update("willing_to_relocate", v)}
                />
              </Grid>
            </Section>

            <Section title="Compensation" help="Used when a form asks for expected salary.">
              <Grid>
                <NumField label="Min (annual)" value={profile.salary_min} onChange={(v) => update("salary_min", v)} />
                <NumField label="Max (annual)" value={profile.salary_max} onChange={(v) => update("salary_max", v)} />
                <Field label="Currency" value={profile.salary_currency} onChange={(v) => update("salary_currency", v)} placeholder="USD / EUR / GBP" />
              </Grid>
            </Section>

            <Section title="Career">
              <Grid>
                <NumField label="Years of experience" value={profile.years_experience} onChange={(v) => update("years_experience", v)} />
                <Field label="Highest degree" value={profile.highest_degree} onChange={(v) => update("highest_degree", v)} placeholder="Bachelor's / Master's / PhD" />
                <Field label="University" value={profile.university} onChange={(v) => update("university", v)} />
                <NumField label="Graduation year" value={profile.graduation_year} onChange={(v) => update("graduation_year", v)} />
                <Field
                  label="Earliest start date"
                  value={profile.start_date}
                  onChange={(v) => update("start_date", v)}
                  placeholder="Immediately / 2 weeks notice / 2026-06-01"
                  full
                />
              </Grid>
            </Section>

            <Section title="EEO (optional)" help="All optional. Used only when a form asks. Decline-to-state is recorded as blank.">
              <Grid>
                <Field label="Gender" value={profile.gender} onChange={(v) => update("gender", v)} />
                <Field label="Ethnicity" value={profile.ethnicity} onChange={(v) => update("ethnicity", v)} />
                <Field label="Veteran status" value={profile.veteran_status} onChange={(v) => update("veteran_status", v)} />
                <Field label="Disability status" value={profile.disability_status} onChange={(v) => update("disability_status", v)} />
              </Grid>
            </Section>

            <Section title="Story" help="The AI uses these to draft natural answers to free-text questions like 'why are you interested?' or 'tell us about a problem you solved'.">
              <Grid>
                <TextArea label="Why this kind of work motivates you" value={profile.why_interested} onChange={(v) => update("why_interested", v)} />
                <TextArea label="Greatest achievement" value={profile.greatest_achievement} onChange={(v) => update("greatest_achievement", v)} />
                <TextArea label="A problem you solved" value={profile.problem_solved} onChange={(v) => update("problem_solved", v)} />
                <TextArea label="Your unique strength" value={profile.unique_strength} onChange={(v) => update("unique_strength", v)} />
              </Grid>
            </Section>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 8 }}>
              <button onClick={clearAi} style={secondaryBtn} type="button">
                Clear cached AI answers
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {status && (
                  <span style={{ fontSize: 12, color: status.error ? "#c62828" : "#2e7d32" }}>{status.msg}</span>
                )}
                <button onClick={save} disabled={saving} style={primaryBtn}>
                  {saving ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────
function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fafafa", border: "1px solid #ececec", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</h3>
      {help && <p style={{ margin: "2px 0 12px", fontSize: 12, color: "#666" }}>{help}</p>}
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}

function Field({ label, value, onChange, type, placeholder, full }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void;
  type?: string; placeholder?: string; full?: boolean;
}) {
  return (
    <label style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <div style={fieldName}>{label}</div>
      <input
        type={type || "text"}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={input}
      />
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <label>
      <div style={fieldName}>{label}</div>
      <input
        type="number"
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) ? n : null);
        }}
        style={input}
      />
    </label>
  );
}

function BoolField({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (v: boolean | null) => void }) {
  const v = value == null ? "" : value ? "yes" : "no";
  return (
    <label>
      <div style={fieldName}>{label}</div>
      <select
        value={v}
        onChange={(e) => {
          const s = e.target.value;
          onChange(s === "yes" ? true : s === "no" ? false : null);
        }}
        style={input}
      >
        <option value="">- Decline / unset -</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <label style={{ gridColumn: "1 / -1" }}>
      <div style={fieldName}>{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...input, minHeight: 80, resize: "vertical" }} />
    </label>
  );
}

// ── Inline styles (matches dashboard's tone, no global CSS dependency) ──
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const panelStyle: React.CSSProperties = {
  // Explicit dark text: this is a light (#fff) panel rendered inside an app
  // whose global `body { color: var(--text-primary) }` is near-white, so
  // without this every unstyled bit of text inherits white-on-white and
  // becomes invisible.
  background: "#fff", color: "#1a1a1a", borderRadius: 14, width: "min(820px, 100%)",
  maxHeight: "85vh", display: "flex", flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};
const headerStyle: React.CSSProperties = {
  padding: "16px 20px", borderBottom: "1px solid #eee",
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
};
const muted: React.CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "#666" };
const betaBadge: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
  padding: "2px 6px", borderRadius: 4,
  background: "rgba(255, 152, 0, 0.15)", color: "#e6982a",
  border: "1px solid rgba(255, 152, 0, 0.35)",
};
const closeBtn: React.CSSProperties = {
  background: "transparent", border: 0, fontSize: 22, cursor: "pointer", color: "#666", lineHeight: 1,
};
const fieldName: React.CSSProperties = { fontSize: 12, color: "#444", marginBottom: 4, fontWeight: 600 };
const input: React.CSSProperties = {
  width: "100%", padding: "8px 10px", font: "inherit",
  // Form controls don't reliably inherit color; set it so typed values and
  // placeholders are dark/visible on the white field instead of near-white.
  color: "#1a1a1a",
  border: "1px solid #d4d4d4", borderRadius: 8, background: "#fff", boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 18px", border: 0, borderRadius: 8,
  background: "#1a1a1a", color: "#fff", fontWeight: 600, cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "10px 14px", border: "1px solid #ddd", borderRadius: 8,
  background: "#fff", color: "#444", fontWeight: 600, cursor: "pointer", fontSize: 12,
};
