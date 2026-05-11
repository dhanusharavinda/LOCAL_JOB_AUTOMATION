/**
 * Background service worker.
 *
 * Three responsibilities:
 *   1. Receive auth handoffs from the dashboard's `?ext_auth=1` page
 *      (forwarded by content script via chrome.runtime.sendMessage).
 *   2. Route content-script API calls through apiFetch - keeps the JWT
 *      out of page scope, gives us one place for refresh/retry.
 *   3. Open the auth bridge tab when the popup asks.
 */

import { setSession, clearSession, getSession, type StoredSession } from "./auth";
import { apiFetch } from "./api";

declare const __DASHBOARD_URL__: string | undefined;

const DASHBOARD_URL =
  (typeof __DASHBOARD_URL__ !== "undefined" && __DASHBOARD_URL__) ||
  "http://localhost:5173";

// ── Lifecycle ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html") });
  }
});

// ── Message router ────────────────────────────────────────────────────
type Message =
  | { type: "auth/login"; session: StoredSession }
  | { type: "auth/logout" }
  | { type: "auth/openSignIn" }
  | { type: "auth/getSession" }
  | { type: "api/call"; path: string; init?: { method?: string; body?: any; query?: Record<string, string> } }
  | { type: "resume/fetch"; url: string };

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  // Async pattern: return true so the channel stays open until sendResponse is called.
  (async () => {
    try {
      switch (msg.type) {
        case "auth/login": {
          await setSession(msg.session);
          sendResponse({ ok: true });
          return;
        }
        case "auth/logout": {
          await clearSession();
          sendResponse({ ok: true });
          return;
        }
        case "auth/getSession": {
          const s = await getSession();
          sendResponse({ ok: true, session: s });
          return;
        }
        case "auth/openSignIn": {
          // ext_auth=1 tells the dashboard to render the bridge UI that
          // posts the session back to us via chrome.runtime.sendMessage.
          // The extension ID is read by the dashboard from the URL it's
          // opened with - chrome.runtime.id baked into the deep link.
          const url = `${DASHBOARD_URL}?ext_auth=1&ext_id=${encodeURIComponent(chrome.runtime.id)}`;
          await chrome.tabs.create({ url });
          sendResponse({ ok: true });
          return;
        }
        case "api/call": {
          const data = await apiFetch(msg.path, msg.init || {});
          sendResponse({ ok: true, data });
          return;
        }
        case "resume/fetch": {
          // Content scripts can hit Supabase signed URLs directly in
          // most cases, but doing it from the background gives us:
          //   - one place to handle 410 (expired URL) → ask the server
          //     to mint a fresh one,
          //   - no host-permission warnings from the user's perspective
          //     (the background's fetches don't show in DevTools as
          //     coming from linkedin.com / ashbyhq.com / etc.).
          const r = await fetch(msg.url, { credentials: "omit" });
          if (!r.ok) {
            sendResponse({ ok: false, error: `Resume fetch failed (${r.status})` });
            return;
          }
          const ab = await r.arrayBuffer();
          // Send as a transferable-ish base64 string. Chrome's
          // structured-clone over runtime.sendMessage doesn't ship
          // ArrayBuffer reliably across browser variants, so b64 is
          // the lowest-common-denominator wire format.
          const bytes = new Uint8Array(ab);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          sendResponse({
            ok: true,
            data: {
              base64: btoa(binary),
              contentType: r.headers.get("Content-Type") || "application/pdf",
            },
          });
          return;
        }
        default: {
          sendResponse({ ok: false, error: "Unknown message" });
        }
      }
    } catch (err: any) {
      sendResponse({ ok: false, error: err?.message || String(err), code: err?.code, status: err?.status });
    }
  })();
  return true;
});

// ── External messaging (dashboard auth bridge) ────────────────────────
// The dashboard at ?ext_auth=1 calls `chrome.runtime.sendMessage(<ext_id>, ...)`
// to hand off the Supabase session. That goes to onMessageExternal,
// not onMessage. We only accept the auth/login message from this path
// - never API calls - so a hostile origin in externally_connectable
// can't trivially exfiltrate user data via our routing.
chrome.runtime.onMessageExternal.addListener((msg: any, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "auth/login" && msg.session) {
        // Validate the shape of session before storing.
        const s = msg.session;
        if (typeof s.access_token !== "string" || typeof s.refresh_token !== "string") {
          sendResponse({ ok: false, error: "Bad session shape" });
          return;
        }
        await setSession({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: Number(s.expires_at) || Math.floor(Date.now() / 1000) + 3600,
          user_email: String(s.user_email || ""),
          user_id: String(s.user_id || ""),
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Only auth handoff is allowed externally." });
      }
    } catch (err: any) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
