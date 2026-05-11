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

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "auth/getSession" }, (resp) => {
      setSession(resp?.session || null);
      setLoading(false);
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setActiveTab(tabs[0] || null);
    });
  }, []);

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

createRoot(document.getElementById("root")!).render(<App />);
