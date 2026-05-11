import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApplyProfile } from "../api";

/**
 * Options page = full apply-profile editor inside the extension.
 *
 * Backed by the same /api/apply/profile endpoint the dashboard uses,
 * so a user can edit answers in either place. Saves debounce-on-blur
 * to keep network chatter low.
 */

function emptyProfile(): ApplyProfile {
  return {
    full_name: "", email: "", phone: "",
    linkedin_url: "", github_url: "", portfolio_url: "",
    street: "", city: "", state_region: "", postcode: "", country: "",
    work_auth_status: "", requires_sponsorship: null, willing_to_relocate: null,
    salary_min: null, salary_max: null, salary_currency: "USD",
    years_experience: null, highest_degree: "", university: "", graduation_year: null,
    start_date: "",
    ethnicity: "", gender: "", veteran_status: "", disability_status: "", pronouns: "",
    why_interested: "", greatest_achievement: "", problem_solved: "", unique_strength: "",
  };
}

async function callApi<T>(path: string, init?: { method?: string; body?: any }): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "api/call", path, init }, (resp) => {
      if (resp?.ok) resolve(resp.data as T);
      else reject(new Error(resp?.error || "Request failed"));
    });
  });
}

function App() {
  const [profile, setProfile] = useState<ApplyProfile>(emptyProfile());
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error?: boolean } | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "auth/getSession" }, (resp) => {
      setSignedIn(!!resp?.session);
      if (resp?.session) loadProfile();
      else setLoading(false);
    });
  }, []);

  async function loadProfile() {
    try {
      const data = await callApi<{ profile: ApplyProfile }>("/api/apply/profile");
      setProfile({ ...emptyProfile(), ...data.profile });
    } catch (err: any) {
      setStatus({ msg: err.message || "Could not load profile", error: true });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const body = { ...profile };
      // Coerce empty strings to null so DB stays clean.
      for (const k of Object.keys(body) as (keyof ApplyProfile)[]) {
        if (body[k] === "") (body as any)[k] = null;
      }
      // Strip the cache map - the server owns it, and the editor doesn't display it.
      delete (body as any).custom_answers;
      await callApi("/api/apply/profile", { method: "PUT", body });
      setStatus({ msg: "Saved." });
    } catch (err: any) {
      setStatus({ msg: err.message || "Save failed", error: true });
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof ApplyProfile>(key: K, value: ApplyProfile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  if (signedIn === false) {
    return (
      <div className="wrap">
        <h1>Profile</h1>
        <p className="subtitle">Sign in via the extension popup first to edit your profile.</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>Apply profile</h1>
      <p className="subtitle">
        Fill these once. The extension reuses them on every supported job site,
        and the AI uses your story fields to draft natural answers to free-text questions.
      </p>

      <div className="notice">
        We never auto-submit. The extension fills the form; you always click the site's Submit button.
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <Section title="Personal" help="Used for every form's name/email/phone fields.">
            <div className="grid">
              <Field label="Full name" value={profile.full_name} onChange={(v) => update("full_name", v)} />
              <Field label="Email" type="email" value={profile.email} onChange={(v) => update("email", v)} />
              <Field label="Phone" value={profile.phone} onChange={(v) => update("phone", v)} />
              <Field label="Pronouns" value={profile.pronouns} onChange={(v) => update("pronouns", v)} />
              <Field label="LinkedIn URL" value={profile.linkedin_url} onChange={(v) => update("linkedin_url", v)} />
              <Field label="GitHub URL" value={profile.github_url} onChange={(v) => update("github_url", v)} />
              <Field label="Portfolio URL" value={profile.portfolio_url} onChange={(v) => update("portfolio_url", v)} className="full" />
            </div>
          </Section>

          <Section title="Address">
            <div className="grid">
              <Field label="Street" value={profile.street} onChange={(v) => update("street", v)} className="full" />
              <Field label="City" value={profile.city} onChange={(v) => update("city", v)} />
              <Field label="State / region" value={profile.state_region} onChange={(v) => update("state_region", v)} />
              <Field label="Postcode" value={profile.postcode} onChange={(v) => update("postcode", v)} />
              <Field label="Country" value={profile.country} onChange={(v) => update("country", v)} />
            </div>
          </Section>

          <Section title="Work authorization">
            <div className="grid">
              <Field label="Authorization status" value={profile.work_auth_status} onChange={(v) => update("work_auth_status", v)}
                placeholder="Authorized / Need sponsorship / Citizen / GC / H1B / Stamp4" className="full" />
              <BoolField label="Need visa sponsorship?" value={profile.requires_sponsorship} onChange={(v) => update("requires_sponsorship", v)} />
              <BoolField label="Willing to relocate?" value={profile.willing_to_relocate} onChange={(v) => update("willing_to_relocate", v)} />
            </div>
          </Section>

          <Section title="Compensation" help="Used when forms ask for expected salary.">
            <div className="grid">
              <NumField label="Min (annual)" value={profile.salary_min} onChange={(v) => update("salary_min", v)} />
              <NumField label="Max (annual)" value={profile.salary_max} onChange={(v) => update("salary_max", v)} />
              <Field label="Currency" value={profile.salary_currency} onChange={(v) => update("salary_currency", v)} placeholder="USD / EUR / GBP" />
            </div>
          </Section>

          <Section title="Career">
            <div className="grid">
              <NumField label="Years of experience" value={profile.years_experience} onChange={(v) => update("years_experience", v)} />
              <Field label="Highest degree" value={profile.highest_degree} onChange={(v) => update("highest_degree", v)} placeholder="Bachelor's / Master's / PhD" />
              <Field label="University" value={profile.university} onChange={(v) => update("university", v)} />
              <NumField label="Graduation year" value={profile.graduation_year} onChange={(v) => update("graduation_year", v)} />
              <Field label="Earliest start date" value={profile.start_date} onChange={(v) => update("start_date", v)}
                placeholder="Immediately / 2 weeks notice / 2026-06-01" className="full" />
            </div>
          </Section>

          <Section title="EEO (optional)" help="All optional. Used only when a form asks. Decline-to-state is recorded as blank.">
            <div className="grid">
              <Field label="Gender" value={profile.gender} onChange={(v) => update("gender", v)} />
              <Field label="Ethnicity" value={profile.ethnicity} onChange={(v) => update("ethnicity", v)} />
              <Field label="Veteran status" value={profile.veteran_status} onChange={(v) => update("veteran_status", v)} />
              <Field label="Disability status" value={profile.disability_status} onChange={(v) => update("disability_status", v)} />
            </div>
          </Section>

          <Section title="Story" help="The AI uses these to draft natural-sounding answers to free-text questions like 'why are you interested?' or 'tell us about a problem you solved'.">
            <div className="grid">
              <TextArea label="Why this kind of work motivates you" value={profile.why_interested} onChange={(v) => update("why_interested", v)} />
              <TextArea label="Greatest achievement" value={profile.greatest_achievement} onChange={(v) => update("greatest_achievement", v)} />
              <TextArea label="A problem you solved" value={profile.problem_solved} onChange={(v) => update("problem_solved", v)} />
              <TextArea label="Your unique strength" value={profile.unique_strength} onChange={(v) => update("unique_strength", v)} />
            </div>
          </Section>

          <div className="toolbar">
            <div className="btn-row">
              <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save profile"}</button>
              {status && <span className={`status${status.error ? " error" : ""}`}>{status.msg}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Reusable inputs ─────────────────────────────────────────────────────
function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h2>{title}</h2>
      {help && <p className="help">{help}</p>}
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type, placeholder, className }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <label className={className}>
      <div className="name">{label}</div>
      <input type={type || "text"} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <label>
      <div className="name">{label}</div>
      <input type="number" value={value == null ? "" : String(value)} onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) ? n : null);
      }} />
    </label>
  );
}

function BoolField({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (v: boolean | null) => void }) {
  const v = value == null ? "" : value ? "yes" : "no";
  return (
    <label>
      <div className="name">{label}</div>
      <select value={v} onChange={(e) => {
        const s = e.target.value;
        onChange(s === "yes" ? true : s === "no" ? false : null);
      }}>
        <option value="">- Decline / unset -</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <label className="full">
      <div className="name">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
