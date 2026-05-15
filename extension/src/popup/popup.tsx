import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

declare const __DASHBOARD_URL__: string | undefined;
const DASHBOARD_URL =
  (typeof __DASHBOARD_URL__ !== "undefined" && __DASHBOARD_URL__) ||
  "http://localhost:5173";

interface Session {
  user_email: string;
  user_id: string;
  expires_at: number;
}

type View = "main" | "assistant";

// When the popup HTML is loaded inside the standalone pop-out window
// (chrome.windows.create with #assistant), skip the main view entirely
// and render the assistant directly. Read once at module load — the
// hash never changes during the lifetime of the window.
const LAUNCH_IN_ASSISTANT =
  typeof window !== "undefined" && window.location.hash === "#assistant";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [view, setView] = useState<View>(LAUNCH_IN_ASSISTANT ? "assistant" : "main");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "auth/getSession" }, (resp) => {
      setSession(resp?.session || null);
      setLoading(false);
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setActiveTab(tabs[0] || null);
    });
  }, []);

  // Widen the popup when the Assistant view is active. CSS does the actual
  // resize via body.assistant-mode; we just toggle the class.
  useEffect(() => {
    document.body.classList.toggle("assistant-mode", view === "assistant");
  }, [view]);

  const detected = detectAtsFromTab(activeTab);

  function signIn() {
    chrome.runtime.sendMessage({ type: "auth/openSignIn" });
    window.close();
  }
  function signOut() {
    chrome.runtime.sendMessage({ type: "auth/logout" }, () => setSession(null));
  }
  function openDashboard() {
    chrome.tabs.create({ url: DASHBOARD_URL });
  }
  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  // ── Inject the right content script into the active tab ───────────────
  // Used by the "Open auto-fill panel" button. Handles three cases:
  //   1. Known ATS that auto-mounted: re-injects the dedicated script,
  //      which destroys the stale overlay and mounts a fresh one. Fixes
  //      the "popup detects greenhouse but no panel appears" case.
  //   2. Known ATS that failed to auto-mount (CSP, SPA timing): same as
  //      above, but forces an injection where Chrome didn't auto-load.
  //   3. Unsupported page (Bending Spoons, custom careers): injects the
  //      generic content script, which uses heuristic field-detection.
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);
  async function openAutoFillPanel() {
    setInjecting(true);
    setInjectError(null);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id || !tab.url) {
        setInjectError("No active tab.");
        return;
      }
      if (/^chrome:|^chrome-extension:|^edge:|^about:|^file:/i.test(tab.url)) {
        setInjectError("This page can't be modified by extensions (browser internal page).");
        return;
      }
      const file = pickContentScriptFor(tab.url);
      if (!file) {
        setInjectError("Couldn't find a bundled content script. Rebuild the extension.");
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [file],
      });
      // For generic.ts injections on non-application-looking pages,
      // the script's auto-mount heuristic skipped bootstrap. Send an
      // explicit manual-bootstrap message so the overlay mounts even
      // there. Idempotent on pages where bootstrap already ran.
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "go-candid8/manual-bootstrap" });
      } catch { /* dedicated ATS scripts don't have this listener; that's fine */ }
      // Tell the just-injected (or already-mounted) engine to auto-fill.
      // The engine's module-scope listener queues the request if its
      // bootstrap is still fetching context, then bootstrap drains the
      // queue when ctx is ready. If sendMessage rejects because the
      // injected script is still parsing, retry once after 250ms.
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "go-candid8/fill-now" });
      } catch {
        await new Promise((r) => setTimeout(r, 250));
        try { await chrome.tabs.sendMessage(tab.id, { type: "go-candid8/fill-now" }); } catch { /* engine still surfaces overlay */ }
      }
      window.close();
    } catch (err: any) {
      setInjectError(err?.message || "Inject failed.");
    } finally {
      setInjecting(false);
    }
  }

  if (view === "assistant") {
    return <AssistantView onBack={() => setView("main")} signedIn={!!session} />;
  }

  return (
    <div>
      <div className="brand">GO <span className="accent">CANDID8</span></div>
      <div className="muted">Auto-fill applications. You always click Submit.</div>

      <div className="spacer" />

      {loading ? (
        <div className="muted">Loading…</div>
      ) : session ? (
        <>
          <span className="badge">Signed in</span>
          <div className="muted" style={{ marginTop: 6, wordBreak: "break-all" }}>
            {session.user_email}
          </div>

          {detected && (
            <div className="detected">
              <div className="title">{detected.label}</div>
              <div className="meta">
                {detected.ats === "unknown"
                  ? "No supported ATS detected. Click below to try heuristic auto-fill on this page."
                  : `Detected ${detected.ats}. The overlay should appear on the page; click below if it didn't.`}
              </div>
            </div>
          )}

          <div className="spacer" />
          <button className="btn" onClick={openAutoFillPanel} disabled={injecting}>
            {injecting ? "Opening…" : detected?.ats === "unknown" ? "Try fill on this page" : "Open auto-fill panel"}
          </button>
          {injectError && <div className="error-text">{injectError}</div>}
          <div className="spacer" />
          <button className="btn secondary" onClick={() => setView("assistant")}>
            AI Assistant (drafts + comments)
          </button>
          <div className="spacer" />
          <button className="btn secondary" onClick={openOptions}>Edit profile answers</button>
          <div className="spacer" />
          <div className="row">
            <button className="btn secondary" onClick={openDashboard}>Dashboard</button>
            <button className="btn secondary" onClick={signOut}>Sign out</button>
          </div>
        </>
      ) : (
        <>
          <span className="badge warn">Not signed in</span>
          <div className="spacer" />
          <button className="btn" onClick={signIn}>Sign in with GO CANDID8</button>
          <div className="muted" style={{ marginTop: 8 }}>
            Opens the dashboard. After you sign in, you'll be redirected back here automatically.
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Find the bundled JS path for the right content script given a URL.
 *
 * @crxjs renames every content_scripts entry at build time to a hashed
 * path like `assets/linkedin.ts-AbCdEf12.js`, but the original filename
 * is preserved as a substring. We read the manifest at runtime, look
 * up the entry whose source matches the detected ATS, and return its
 * post-hash path so chrome.scripting.executeScript can inject it.
 *
 * For unknown URLs, returns the generic.ts bundle (also identified by
 * filename substring) so any custom careers page falls through to the
 * heuristic adapter.
 */
function pickContentScriptFor(url: string): string | null {
  const tag = atsTagForUrl(url);
  const manifest = chrome.runtime.getManifest();
  const scripts = (manifest.content_scripts || []) as Array<{ js?: string[] }>;
  const needle = `${tag}.ts-`;
  for (const cs of scripts) {
    const file = cs.js?.[0];
    if (!file) continue;
    if (file.includes(needle)) return file;
  }
  // Fallback: try the generic bundle even if we tagged a specific ATS.
  for (const cs of scripts) {
    const file = cs.js?.[0];
    if (file?.includes("generic.ts-")) return file;
  }
  return null;
}

function atsTagForUrl(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "generic"; }
  if (host === "www.linkedin.com" && /\/jobs\//i.test(url)) return "linkedin";
  if (host.endsWith(".greenhouse.io") || host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") return "greenhouse";
  if (host === "jobs.lever.co" || host.endsWith(".lever.co")) return "lever";
  if (host === "jobs.ashbyhq.com") return "ashby";
  if (host === "apply.workable.com") return "workable";
  if (host.endsWith(".myworkdayjobs.com")) return "workday";
  return "generic";
}

function detectAtsFromTab(tab: chrome.tabs.Tab | null): { ats: string; label: string } | null {
  if (!tab?.url) return null;
  let host = "";
  try { host = new URL(tab.url).hostname.toLowerCase(); } catch { return { ats: "unknown", label: "Unknown page" }; }
  if (host === "www.linkedin.com" && /\/jobs\//i.test(tab.url)) return { ats: "linkedin", label: "LinkedIn job posting" };
  if (host.endsWith(".greenhouse.io") || host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") return { ats: "greenhouse", label: "Greenhouse posting" };
  if (host === "jobs.lever.co" || host.endsWith(".lever.co")) return { ats: "lever", label: "Lever posting" };
  if (host === "jobs.ashbyhq.com") return { ats: "ashby", label: "Ashby posting" };
  if (host === "apply.workable.com") return { ats: "workable", label: "Workable posting" };
  if (host.endsWith(".myworkdayjobs.com")) return { ats: "workday", label: "Workday posting" };
  return { ats: "unknown", label: tab.title || "This page" };
}

// ── AI Assistant view ───────────────────────────────────────────────────
//
// Personal writing assistant that already knows the user's resume and
// apply_profile (server-side). The user picks an action, pastes context
// (a JD, someone's LinkedIn post, a recipient's profile), optionally
// names the recipient/company, and gets a short, voice-matched draft.
//
// Style contract is enforced server-side in /api/apply/assistant-text:
// no em-dashes, no AI-slop openers, short and specific. We just collect
// inputs and render the output.

type AssistantAction =
  | "followup"
  | "linkedin_connect"
  | "linkedin_comment"
  | "referral_request"
  | "cold_outreach"
  | "thank_you"
  | "custom";

interface ActionDef {
  id: AssistantAction;
  label: string;
  hint: string;
  contextLabel: string;
  contextPlaceholder: string;
  needsContext: boolean;
}

const ACTIONS: ActionDef[] = [
  {
    id: "followup",
    label: "Follow-up email",
    hint: "Nudge a recruiter or hiring manager",
    contextLabel: "Anything they last said, or the JD",
    contextPlaceholder: "Paste the JD, the last email, or just a few notes about the conversation so far.",
    needsContext: false,
  },
  {
    id: "linkedin_connect",
    label: "LinkedIn connect note",
    hint: "280-char request note",
    contextLabel: "Their LinkedIn profile / a recent post",
    contextPlaceholder: "Paste their headline, a recent post, or what they work on so the note sounds personal.",
    needsContext: true,
  },
  {
    id: "linkedin_comment",
    label: "Comment on a post",
    hint: "Insightful, peer-to-peer",
    contextLabel: "The LinkedIn post",
    contextPlaceholder: "Paste the post you want to comment on.",
    needsContext: true,
  },
  {
    id: "referral_request",
    label: "Ask for a referral",
    hint: "Genuine, low-pressure",
    contextLabel: "About the person + the role you want",
    contextPlaceholder: "What does this person do, and which role at which company are you asking about?",
    needsContext: true,
  },
  {
    id: "cold_outreach",
    label: "Cold outreach",
    hint: "Hiring manager / engineer",
    contextLabel: "About them + the team / role",
    contextPlaceholder: "Their role, the team they're on, anything specific you can tie back to (a project, a talk, a post).",
    needsContext: true,
  },
  {
    id: "thank_you",
    label: "Post-interview thanks",
    hint: "Specific, not templated",
    contextLabel: "What came up in the interview",
    contextPlaceholder: "Topics that came up, who you spoke with, anything you want to reinforce.",
    needsContext: false,
  },
  {
    id: "custom",
    label: "Custom",
    hint: "You write the instruction",
    contextLabel: "Source material (optional)",
    contextPlaceholder: "Paste anything that should ground the reply.",
    needsContext: false,
  },
];

// Chrome popups close the moment the user clicks anywhere outside the
// popup — that's a platform constraint we can't override. Two mitigations:
//   1. Persist every input field + the last output to chrome.storage.local
//      so reopening the popup restores everything (no lost paste, no lost
//      draft).
//   2. Offer a "Pop out" button that reopens this same UI in a standalone
//      Chrome window which stays open regardless of focus.
const ASSISTANT_STATE_KEY = "go-candid8/assistant-state/v1";

interface AssistantState {
  action: AssistantAction;
  context: string;
  recipientName: string;
  recipientRole: string;
  targetCompany: string;
  targetRole: string;
  customInstruction: string;
  output: string;
}

function loadAssistantState(): Promise<AssistantState | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(ASSISTANT_STATE_KEY, (items) => {
        resolve(items?.[ASSISTANT_STATE_KEY] || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function saveAssistantState(s: AssistantState) {
  try {
    chrome.storage.local.set({ [ASSISTANT_STATE_KEY]: s });
  } catch { /* storage quota / private mode — best effort */ }
}

function clearAssistantState() {
  try { chrome.storage.local.remove(ASSISTANT_STATE_KEY); } catch {}
}

// Detect whether we're currently rendered inside the standalone pop-out
// window (chrome.windows.create with type=popup). Read once from the URL
// hash so the same popup.html can render in both contexts.
const IS_POPOUT_WINDOW =
  typeof window !== "undefined" && window.location.hash === "#assistant";

function AssistantView({ onBack, signedIn }: { onBack: () => void; signedIn: boolean }) {
  const [action, setAction] = useState<AssistantAction>("followup");
  const [context, setContext] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientRole, setRecipientRole] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Hydrate state from chrome.storage on mount, then save on every change
  // so the popup can be reopened (or popped out into a window) without
  // losing pasted context or generated output.
  useEffect(() => {
    loadAssistantState().then((s) => {
      if (s) {
        setAction(s.action || "followup");
        setContext(s.context || "");
        setRecipientName(s.recipientName || "");
        setRecipientRole(s.recipientRole || "");
        setTargetCompany(s.targetCompany || "");
        setTargetRole(s.targetRole || "");
        setCustomInstruction(s.customInstruction || "");
        setOutput(s.output || "");
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveAssistantState({
      action, context, recipientName, recipientRole,
      targetCompany, targetRole, customInstruction, output,
    });
  }, [loaded, action, context, recipientName, recipientRole, targetCompany, targetRole, customInstruction, output]);

  const active = ACTIONS.find((a) => a.id === action)!;

  function callApi(): Promise<{ ok: boolean; data?: any; error?: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "api/call",
          path: "/api/apply/assistant-text",
          init: {
            method: "POST",
            body: {
              actionType: action,
              context: context.trim() || undefined,
              recipientName: recipientName.trim() || undefined,
              recipientRole: recipientRole.trim() || undefined,
              targetCompany: targetCompany.trim() || undefined,
              targetRole: targetRole.trim() || undefined,
              customInstruction: action === "custom" ? customInstruction.trim() : undefined,
            },
          },
        },
        (resp) => resolve(resp || { ok: false, error: "No response from background" })
      );
    });
  }

  async function onGenerate() {
    setError(null);
    setOutput("");
    setBusy(true);
    try {
      if (!signedIn) {
        setError("Sign in first so the assistant can read your resume and profile.");
        return;
      }
      if (active.needsContext && !context.trim()) {
        setError(`This action needs ${active.contextLabel.toLowerCase()}. Paste it above.`);
        return;
      }
      if (action === "custom" && !customInstruction.trim()) {
        setError("Tell the assistant what to write in the Custom instruction box.");
        return;
      }
      const resp = await callApi();
      if (!resp.ok) {
        setError(resp.error || "Generation failed");
        return;
      }
      setOutput(String(resp.data?.text || "").trim());
    } catch (err: any) {
      setError(err?.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed. Select the text and use Ctrl+C.");
    }
  }

  // Open the assistant in a standalone Chrome window. The window keeps
  // focus when the user clicks back into the page, so the workflow
  // (paste JD → generate → copy → switch to LinkedIn → paste) stops
  // costing them a closed popup. State is already in chrome.storage so
  // the new window sees the same context immediately.
  function onPopOut() {
    try {
      const url = chrome.runtime.getURL("src/popup/popup.html") + "#assistant";
      chrome.windows.create({
        url,
        type: "popup",
        width: 520,
        height: 760,
        focused: true,
      });
      window.close();
    } catch (err: any) {
      setError(err?.message || "Could not open pop-out window.");
    }
  }

  function onClearAll() {
    if (!output && !context && !recipientName && !recipientRole && !targetCompany && !targetRole && !customInstruction) {
      return;
    }
    if (!confirm("Clear all inputs and the generated draft?")) return;
    setContext("");
    setRecipientName("");
    setRecipientRole("");
    setTargetCompany("");
    setTargetRole("");
    setCustomInstruction("");
    setOutput("");
    setError(null);
    clearAssistantState();
  }

  return (
    <div>
      <div className="assistant-header">
        {!IS_POPOUT_WINDOW && (
          <button className="back-btn" onClick={onBack} title="Back to main">
            ← Back
          </button>
        )}
        <span className="title">AI Assistant</span>
        {!IS_POPOUT_WINDOW ? (
          <button className="pop-out-btn" onClick={onPopOut} title="Open in a separate window so it stays open">
            ⧉ Pop out
          </button>
        ) : (
          <button className="back-btn" onClick={() => window.close()} title="Close window">
            ✕ Close
          </button>
        )}
      </div>
      <div className="muted">
        {IS_POPOUT_WINDOW
          ? "Standalone window. Stays open even when you click into LinkedIn or email."
          : "Tip: click Pop out so this stays open when you switch tabs."}
      </div>

      <div className="spacer" />

      <div className="assistant-actions">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`action-chip${a.id === action ? " active" : ""}`}
            onClick={() => { setAction(a.id); setOutput(""); setError(null); }}
          >
            {a.label}
            <span className="hint">{a.hint}</span>
          </button>
        ))}
      </div>

      {action === "custom" && (
        <>
          <label className="field-label">Custom instruction</label>
          <input
            className="input"
            placeholder="e.g. Write a 3-sentence DM asking if their team is hiring."
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
          />
        </>
      )}

      <label className="field-label">{active.contextLabel}{active.needsContext ? " (required)" : " (optional)"}</label>
      <textarea
        className="textarea"
        rows={5}
        placeholder={active.contextPlaceholder}
        value={context}
        onChange={(e) => setContext(e.target.value)}
      />

      <label className="field-label">Recipient (optional)</label>
      <div className="recipient-row">
        <input
          className="input"
          placeholder="Name (e.g. Priya)"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
        />
        <input
          className="input"
          placeholder="Role (e.g. Eng manager)"
          value={recipientRole}
          onChange={(e) => setRecipientRole(e.target.value)}
        />
      </div>

      <label className="field-label">Target company / role (optional)</label>
      <div className="recipient-row">
        <input
          className="input"
          placeholder="Company"
          value={targetCompany}
          onChange={(e) => setTargetCompany(e.target.value)}
        />
        <input
          className="input"
          placeholder="Role"
          value={targetRole}
          onChange={(e) => setTargetRole(e.target.value)}
        />
      </div>

      <div className="spacer" />
      <div className="row">
        <button className="btn" onClick={onGenerate} disabled={busy}>
          {busy ? "Drafting…" : "Generate"}
        </button>
        <button className="btn secondary" onClick={onClearAll} disabled={busy} style={{ maxWidth: 110 }}>
          Clear
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}

      {output ? (
        <>
          <div className="assistant-output">{output}</div>
          <div className="spacer" />
          <div className="row">
            <button className="btn secondary" onClick={onCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="btn secondary" onClick={onGenerate} disabled={busy}>
              Regenerate
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="spacer" />
          <div className="assistant-output empty">
            Pick an action, paste any context, then Generate. The draft appears here.
          </div>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
