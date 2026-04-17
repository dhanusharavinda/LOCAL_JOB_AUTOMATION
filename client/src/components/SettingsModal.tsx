import { useEffect, useState, useRef } from "react";
import {
  fetchSettings, uploadResume, uploadResumeText, deleteResume,
  fetchProjectBank, createBankProject, deleteBankProject,
  fetchTargetCompanies, createTargetCompany, deleteTargetCompany, updateTargetCompany,
  SettingsData, PipelineConfig, BankProject, TargetCompany,
} from "../api";

interface Props {
  onClose: () => void;
}

// Note: "pipeline" and "scrapers" tabs used to live here but duplicated the
// Search / Sources / Limits sections on LandingPage, which is the canonical
// place to configure a pipeline run. We keep only the account-level tools
// here (resume management, project bank, target portals) so there's exactly
// one place for each setting.
type Tab = "resume" | "projects" | "portals";

export default function SettingsModal({ onClose }: Props) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("resume");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Local editable config state
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState("");

  // Project bank state
  const [projects, setProjects] = useState<BankProject[]>([]);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProject, setNewProject] = useState({ title: "", summary: "", bullets: "", tags: "", link: "", date: "" });

  // Target companies state (Feature 4)
  const [targetCompanies, setTargetCompanies] = useState<TargetCompany[]>([]);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompany, setNewCompany] = useState({ company_name: "", careers_url: "", ats_type: "greenhouse" });

  useEffect(() => {
    fetchSettings()
      .then((d) => { setData(d); setConfig(d.config); })
      .catch(() => setError("Failed to load settings"))
      .finally(() => setLoading(false));
    fetchProjectBank().then(setProjects).catch(() => {});
    fetchTargetCompanies().then(setTargetCompanies).catch(() => {});
  }, []);

  function flash(msg: string) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const result = await uploadResume(file);
      setData((prev) => prev ? { ...prev, resume: { uploaded: true, filename: result.filename || file.name, charCount: result.charCount, preview: result.preview || "" } } : prev);
      flash(`Resume uploaded: ${file.name} (${result.charCount} chars)`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handlePasteSubmit() {
    if (!pastedText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await uploadResumeText(pastedText);
      setData((prev) => prev ? { ...prev, resume: { uploaded: true, filename: "pasted_text", charCount: result.charCount, preview: result.preview || pastedText.slice(0, 300) } } : prev);
      flash(`Resume saved (${result.charCount} chars)`);
      setPasteMode(false);
      setPastedText("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteResume() {
    setSaving(true);
    try {
      await deleteResume();
      setData((prev) => prev ? { ...prev, resume: { uploaded: false, filename: null, charCount: 0, preview: "" } } : prev);
      flash("Resume removed. Upload a new one before running the pipeline.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // handleSaveConfig / updateConfig were removed alongside the pipeline +
  // scrapers tabs. LandingPage owns pipeline config editing now. `config`
  // state is still populated by fetchSettings() for potential future use
  // (target-country awareness etc.) but the Resume tab no longer reads
  // any fields from it after the Google Docs integration was removed.

  const tabs: { id: Tab; label: string }[] = [
    { id: "resume", label: "Resume" },
    { id: "projects", label: `Projects (${projects.length})` },
    { id: "portals", label: `Portals (${targetCompanies.length})` },
  ];

  async function handleAddProject() {
    if (!newProject.title.trim() || !newProject.bullets.trim() || !newProject.tags.trim()) {
      setError("Title, bullet points, and tags are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const bulletPoints = newProject.bullets.split("\n").map((b) => b.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
      const tags = newProject.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const created = await createBankProject({
        title: newProject.title,
        link: newProject.link || null,
        date: newProject.date || null,
        location: null,
        summary: newProject.summary || null,
        bulletPoints,
        tags,
      });
      setProjects((prev) => [created, ...prev]);
      setNewProject({ title: "", summary: "", bullets: "", tags: "", link: "", date: "" });
      setShowAddProject(false);
      flash("Project added to bank");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProject(id: number) {
    try {
      await deleteBankProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      flash("Project removed");
    } catch (err: any) {
      setError(err.message);
    }
  }


  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0d0f13] border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/60 shrink-0">
          <h2 className="text-base font-bold text-gray-50">Settings</h2>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 pt-3 gap-1 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                tab === t.id
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                  : "text-gray-500 hover:text-gray-300 border border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Feedback */}
        {(error || success) && (
          <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-xs ${
            error ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
          }`}>
            {error || success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && config && tab === "resume" && (
            <div className="space-y-4">
              {/* Current resume status */}
              <div className="p-4 rounded-xl border border-gray-800/60 bg-[#0f1115]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-200">Current Resume</h3>
                  {data?.resume.uploaded && (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                      UPLOADED
                    </span>
                  )}
                  {!data?.resume.uploaded && (
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                      NOT UPLOADED
                    </span>
                  )}
                </div>
                {data?.resume.uploaded ? (
                  <>
                    <p className="text-xs text-gray-400">
                      <span className="text-gray-300 font-medium">{data.resume.filename}</span> ({data.resume.charCount.toLocaleString()} characters)
                    </p>
                    <p className="text-[11px] text-gray-600 mt-2 leading-relaxed line-clamp-3 font-mono">
                      {data.resume.preview}...
                    </p>
                    <button
                      onClick={handleDeleteResume}
                      disabled={saving}
                      className="mt-3 text-xs text-red-400 hover:text-red-300 bg-red-500/8 hover:bg-red-500/15 border border-red-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                    >
                      Remove uploaded resume
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">
                    No resume on file. Upload your resume below so the pipeline can score jobs and tailor applications for you.
                  </p>
                )}
              </div>

              {/* Upload options */}
              <div className="grid grid-cols-2 gap-3">
                {/* File upload */}
                <div className="p-4 rounded-xl border border-gray-800/60 bg-[#0f1115] hover:border-gray-700/60 transition-colors">
                  <h4 className="text-xs font-semibold text-gray-300 mb-2">Upload File</h4>
                  <p className="text-[11px] text-gray-600 mb-3">PDF or TXT format, max 5MB</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={saving}
                    className="w-full text-xs font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                  >
                    {saving ? "Uploading..." : "Choose File"}
                  </button>
                </div>

                {/* Paste text */}
                <div className="p-4 rounded-xl border border-gray-800/60 bg-[#0f1115] hover:border-gray-700/60 transition-colors">
                  <h4 className="text-xs font-semibold text-gray-300 mb-2">Paste Text</h4>
                  <p className="text-[11px] text-gray-600 mb-3">Copy-paste your resume content</p>
                  <button
                    onClick={() => setPasteMode(!pasteMode)}
                    className="w-full text-xs font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 px-3 py-2 rounded-lg transition-all"
                  >
                    {pasteMode ? "Cancel" : "Paste Resume"}
                  </button>
                </div>
              </div>

              {/* Paste textarea */}
              {pasteMode && (
                <div className="space-y-2">
                  <textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste your resume text here..."
                    rows={8}
                    className="w-full bg-[#0a0c10] border border-gray-800/60 rounded-xl px-4 py-3 text-xs text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40 font-mono resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-600">{pastedText.length} characters</span>
                    <button
                      onClick={handlePasteSubmit}
                      disabled={saving || pastedText.length < 50}
                      className="text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save Resume"}
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-gray-600 leading-relaxed">
                Your resume is the source of truth for job scoring and tailoring. Upload a PDF or paste the text once and the pipeline reuses it on every run. You can replace or remove it at any time.
              </p>
            </div>
          )}

          {/* Pipeline + Scrapers tabs intentionally removed. Those settings
              (country, keywords, LinkedIn builder, scraper toggles, numeric
              limits, auto-generation toggles) all live on LandingPage where
              the pipeline is actually launched from. Keeping both places in
              sync was a bug farm; now there's exactly one UI for them. */}
          {/* ── Projects Tab ── */}
          {tab === "projects" && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-300">Project Bank</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Add backup projects here. During ReWrite analysis, the AI will suggest swapping in the most relevant projects based on the JD.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddProject(!showAddProject)}
                  className="text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                >
                  {showAddProject ? "Cancel" : "+ Add Project"}
                </button>
              </div>

              {/* Add project form */}
              {showAddProject && (
                <div className="p-4 rounded-xl bg-[#0a0c10] border border-gray-800/60 space-y-3">
                  <input
                    value={newProject.title}
                    onChange={(e) => setNewProject((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Project title *"
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40"
                  />
                  <input
                    value={newProject.summary}
                    onChange={(e) => setNewProject((p) => ({ ...p, summary: e.target.value }))}
                    placeholder="Brief summary (optional)"
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40"
                  />
                  <textarea
                    value={newProject.bullets}
                    onChange={(e) => setNewProject((p) => ({ ...p, bullets: e.target.value }))}
                    placeholder={"Bullet points (one per line) *\n- Built a real-time ETL pipeline using Spark...\n- Deployed ML model on AWS SageMaker..."}
                    rows={4}
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40 resize-y"
                  />
                  <input
                    value={newProject.tags}
                    onChange={(e) => setNewProject((p) => ({ ...p, tags: e.target.value }))}
                    placeholder="Tags (comma-separated) * e.g. ai, data-engineering, cloud, databricks"
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40"
                  />
                  <div className="flex gap-2">
                    <input
                      value={newProject.link}
                      onChange={(e) => setNewProject((p) => ({ ...p, link: e.target.value }))}
                      placeholder="GitHub/demo link (optional)"
                      className="flex-1 bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40"
                    />
                    <input
                      value={newProject.date}
                      onChange={(e) => setNewProject((p) => ({ ...p, date: e.target.value }))}
                      placeholder="Date (optional)"
                      className="w-32 bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40"
                    />
                  </div>
                  <button
                    onClick={handleAddProject}
                    disabled={saving}
                    className="w-full text-sm font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 py-2.5 rounded-xl transition-all disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Add to Project Bank"}
                  </button>
                </div>
              )}

              {/* Existing projects */}
              {projects.length === 0 && !showAddProject && (
                <p className="text-xs text-gray-600 italic py-4 text-center">No projects in bank yet. Add your backup projects so the AI can suggest swaps.</p>
              )}
              <div className="space-y-3">
                {projects.map((p) => (
                  <div key={p.id} className="p-4 rounded-xl bg-[#0f1115] border border-gray-800/60">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="text-sm font-medium text-gray-200">{p.title}</h4>
                        {p.summary && <p className="text-xs text-gray-500 mt-0.5">{p.summary}</p>}
                      </div>
                      <button
                        onClick={() => handleDeleteProject(p.id)}
                        className="text-gray-700 hover:text-red-400 transition-colors shrink-0 ml-2"
                        title="Delete project"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    <ul className="space-y-1 mb-2">
                      {p.bulletPoints.map((b, bi) => (
                        <li key={bi} className="text-xs text-gray-400 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gray-600">{b}</li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-1">
                      {p.tags.map((t, ti) => (
                        <span key={ti} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Portals Tab (Feature 4) ── */}
          {tab === "portals" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-300">Target Company Portals</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Careers pages scanned directly by the pipeline. Supports Greenhouse, Lever, and Ashby APIs.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {targetCompanies.length === 0 && (
                    <button
                      onClick={async () => {
                        setSaving(true);
                        try {
                          const defaultCompanies = [
                            { company_name: "Google", careers_url: "https://careers.google.com", ats_type: "custom" },
                            { company_name: "Microsoft", careers_url: "https://careers.microsoft.com", ats_type: "custom" },
                            { company_name: "Amazon", careers_url: "https://www.amazon.jobs", ats_type: "custom" },
                            { company_name: "Apple", careers_url: "https://jobs.apple.com", ats_type: "custom" },
                            { company_name: "Meta", careers_url: "https://www.metacareers.com", ats_type: "custom" },
                            { company_name: "Netflix", careers_url: "https://jobs.netflix.com", ats_type: "lever" },
                            { company_name: "Stripe", careers_url: "https://stripe.com/jobs", ats_type: "custom" },
                            { company_name: "Shopify", careers_url: "https://www.shopify.com/careers", ats_type: "greenhouse" },
                            { company_name: "Airbnb", careers_url: "https://careers.airbnb.com", ats_type: "greenhouse" },
                            { company_name: "Spotify", careers_url: "https://www.lifeatspotify.com/jobs", ats_type: "greenhouse" },
                            { company_name: "Salesforce", careers_url: "https://careers.salesforce.com", ats_type: "custom" },
                            { company_name: "Adobe", careers_url: "https://careers.adobe.com", ats_type: "custom" },
                            { company_name: "Atlassian", careers_url: "https://www.atlassian.com/company/careers", ats_type: "greenhouse" },
                            { company_name: "HubSpot", careers_url: "https://www.hubspot.com/careers", ats_type: "greenhouse" },
                            { company_name: "Datadog", careers_url: "https://careers.datadoghq.com", ats_type: "greenhouse" },
                            { company_name: "Cloudflare", careers_url: "https://www.cloudflare.com/careers", ats_type: "greenhouse" },
                            { company_name: "Figma", careers_url: "https://www.figma.com/careers", ats_type: "greenhouse" },
                            { company_name: "Notion", careers_url: "https://www.notion.so/careers", ats_type: "greenhouse" },
                            { company_name: "Vercel", careers_url: "https://vercel.com/careers", ats_type: "greenhouse" },
                            { company_name: "Linear", careers_url: "https://linear.app/careers", ats_type: "ashby" },
                          ];
                          await fetch("/api/target-companies/seed", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ companies: defaultCompanies }),
                          });
                          const updated = await fetchTargetCompanies();
                          setTargetCompanies(updated);
                          flash(`Seeded ${updated.length} default companies`);
                        } catch (err: any) { setError(err.message); }
                        finally { setSaving(false); }
                      }}
                      className="text-xs font-medium text-[#c9a94e] bg-[#c9a94e]/10 hover:bg-[#c9a94e]/20 border border-[#c9a94e]/30 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Seed Defaults
                    </button>
                  )}
                  <button
                    onClick={() => setShowAddCompany(!showAddCompany)}
                    className="text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {showAddCompany ? "Cancel" : "+ Add"}
                  </button>
                </div>
              </div>

              {showAddCompany && (
                <div className="p-4 rounded-xl bg-[#0a0c10] border border-gray-800/60 space-y-3">
                  <input
                    value={newCompany.company_name}
                    onChange={(e) => setNewCompany((p) => ({ ...p, company_name: e.target.value }))}
                    placeholder="Company name *"
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40"
                  />
                  <input
                    value={newCompany.careers_url}
                    onChange={(e) => setNewCompany((p) => ({ ...p, careers_url: e.target.value }))}
                    placeholder="Careers page URL *"
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-blue-500/40 font-mono"
                  />
                  <select
                    value={newCompany.ats_type}
                    onChange={(e) => setNewCompany((p) => ({ ...p, ats_type: e.target.value }))}
                    className="w-full bg-[#0f1115] border border-gray-800/60 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/40"
                  >
                    <option value="greenhouse">Greenhouse</option>
                    <option value="lever">Lever</option>
                    <option value="ashby">Ashby</option>
                    <option value="custom">Custom (manual only)</option>
                  </select>
                  <button
                    onClick={async () => {
                      if (!newCompany.company_name || !newCompany.careers_url) { setError("Name and URL required"); return; }
                      setSaving(true);
                      try {
                        const created = await createTargetCompany(newCompany);
                        setTargetCompanies((prev) => [...prev, created]);
                        setNewCompany({ company_name: "", careers_url: "", ats_type: "greenhouse" });
                        setShowAddCompany(false);
                        flash("Company added");
                      } catch (err: any) { setError(err.message); }
                      finally { setSaving(false); }
                    }}
                    disabled={saving}
                    className="w-full text-sm font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 py-2.5 rounded-xl transition-all disabled:opacity-50"
                  >
                    {saving ? "Adding..." : "Add Company"}
                  </button>
                </div>
              )}

              {targetCompanies.length === 0 && !showAddCompany && (
                <p className="text-xs text-gray-600 italic py-4 text-center">No target companies yet. Click "Seed Defaults" for 20 pre-configured companies.</p>
              )}

              <div className="space-y-2">
                {targetCompanies.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-800/60 bg-[#0f1115]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-200">{c.company_name}</span>
                        <span className="font-mono text-[10px] text-[#6775a0] bg-[#6775a0]/10 px-1.5 py-0.5 rounded uppercase">{c.ats_type}</span>
                        {!c.active && <span className="font-mono text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">INACTIVE</span>}
                      </div>
                      <p className="font-mono text-[11px] text-gray-600 truncate mt-0.5">{c.careers_url}</p>
                      {c.last_scanned_at && (
                        <p className="text-[10px] text-gray-700 mt-0.5">
                          Last scan: {new Date(c.last_scanned_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <button
                        onClick={async () => {
                          const updated = await updateTargetCompany(c.id, { active: c.active ? 0 : 1 } as any);
                          setTargetCompanies((prev) => prev.map((p) => p.id === c.id ? updated : p));
                        }}
                        className={`text-[10px] px-2 py-1 rounded-md border transition-all ${
                          c.active ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-gray-600 border-gray-800"
                        }`}
                      >
                        {c.active ? "ON" : "OFF"}
                      </button>
                      <button
                        onClick={async () => {
                          await deleteTargetCompany(c.id);
                          setTargetCompanies((prev) => prev.filter((p) => p.id !== c.id));
                        }}
                        className="text-gray-700 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800/60 shrink-0">
          <p className="text-[11px] text-gray-600">
            Changes to pipeline settings take effect on the next run. Resume changes are immediate.
          </p>
        </div>
      </div>
    </div>
  );
}
