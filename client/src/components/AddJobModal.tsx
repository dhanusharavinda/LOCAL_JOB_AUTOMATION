import { useState } from "react";
import { createJob } from "../api";
import { Job, JobStatus, COLUMNS } from "../types";

interface Props {
  onClose: () => void;
  onAdded: (job: Job) => void;
}

export default function AddJobModal({ onClose, onAdded }: Props) {
  const [form, setForm] = useState({
    job_title: "",
    company_name: "",
    location: "",
    job_link: "",
    apply_url: "",
    salary: "",
    seniority_level: "",
    description: "",
    status: "saved" as JobStatus,
    applied_date: new Date().toISOString().split("T")[0],
    deadline: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.job_title.trim() || !form.company_name.trim()) {
      setError("Job title and company name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = { ...form };
      // Clean empty strings to null
      for (const k of Object.keys(payload)) {
        if (payload[k] === "") payload[k] = null;
      }
      const created = await createJob(payload);
      onAdded(created);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to add job.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full bg-[#0a0c10] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all";
  const labelClass = "text-xs font-medium text-gray-500 block mb-1";

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d0f13] border border-gray-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50">
          <h2 className="text-base font-bold text-gray-50">Add Job Manually</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-800/50 text-gray-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelClass}>Job Title *</label>
              <input className={inputClass} placeholder="e.g. Data Engineer" value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Company Name *</label>
              <input className={inputClass} placeholder="e.g. Google" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <input className={inputClass} placeholder="e.g. Dublin, IE" value={form.location} onChange={(e) => set("location", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Salary</label>
              <input className={inputClass} placeholder="e.g. €60k–€80k" value={form.salary} onChange={(e) => set("salary", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Job Posting URL</label>
              <input className={inputClass} placeholder="https://..." value={form.job_link} onChange={(e) => set("job_link", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Apply URL</label>
              <input className={inputClass} placeholder="https://..." value={form.apply_url} onChange={(e) => set("apply_url", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Applied On</label>
              <input type="date" className={inputClass} value={form.applied_date} onChange={(e) => set("applied_date", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Deadline</label>
              <input type="date" className={inputClass} value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Seniority</label>
              <select className={inputClass} value={form.seniority_level} onChange={(e) => set("seniority_level", e.target.value)}>
                <option value="">— select —</option>
                <option>Entry level</option>
                <option>Associate</option>
                <option>Mid-Senior level</option>
                <option>Senior</option>
                <option>Director</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Initial Status</label>
              <select className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.title}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Job Description (paste text)</label>
              <textarea className={`${inputClass} resize-none h-24`} placeholder="Paste the full job description here..." value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea className={`${inputClass} resize-none h-16`} placeholder="Any notes about this role..." value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50">
              {saving ? "Adding..." : "Add Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
