import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * Auth bridge for the browser extension.
 *
 * Activated when the dashboard URL has ?ext_auth=1&ext_id=<extension_id>.
 * Once the user has a Supabase session, posts the access + refresh tokens
 * to the extension via chrome.runtime.sendMessage(extensionId, {...}).
 *
 * The extension's background service worker has a matching listener
 * that stores the session in chrome.storage.local. After the handoff
 * we close the tab automatically (or show a "you can close this tab"
 * banner if window.close() is blocked, e.g. tab opened by a user click
 * inside the dashboard rather than by chrome.tabs.create).
 */
export default function ExtensionAuthBridge() {
  const [status, setStatus] = useState<"waiting" | "signed_out" | "sending" | "done" | "error">(
    "waiting"
  );
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const extId = params.get("ext_id") || "";
    if (!extId) {
      setStatus("error");
      setErrorMsg("Missing extension id in URL.");
      return;
    }

    let cancelled = false;

    async function tryHandoff() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        if (!cancelled) setStatus("signed_out");
        return;
      }
      if (cancelled) return;
      setStatus("sending");
      try {
        // chrome.runtime.sendMessage with a fixed extension id is the
        // documented external-message API. The extension declares
        // matching `externally_connectable` in manifest if we wanted to
        // send from the page directly, but in practice we use the
        // dashboard origin's runtime messaging via the chrome runtime
        // namespace exposed when the user has the extension installed.
        const chromeApi = (window as any).chrome;
        if (!chromeApi?.runtime?.sendMessage) {
          setStatus("error");
          setErrorMsg("This page can't reach the extension. Make sure Tailorly AI is installed and try again.");
          return;
        }
        chromeApi.runtime.sendMessage(
          extId,
          {
            type: "auth/login",
            session: {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              expires_at: Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
              user_email: session.user.email || "",
              user_id: session.user.id || "",
            },
          },
          (resp: any) => {
            if (cancelled) return;
            if (chromeApi.runtime.lastError) {
              setStatus("error");
              setErrorMsg(chromeApi.runtime.lastError.message || "Could not reach extension.");
              return;
            }
            if (resp?.ok) {
              setStatus("done");
              // Try to close the tab. If we can't (sometimes the case
              // when the tab was opened by something other than the
              // extension itself), the message instructs the user.
              setTimeout(() => { try { window.close(); } catch { /* noop */ } }, 800);
            } else {
              setStatus("error");
              setErrorMsg(resp?.error || "Extension rejected the handoff.");
            }
          }
        );
      } catch (err: any) {
        setStatus("error");
        setErrorMsg(err?.message || String(err));
      }
    }

    tryHandoff();
    const sub = supabase.auth.onAuthStateChange((_event, _session) => {
      tryHandoff();
    });

    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={brand}>GO <span style={{ color: "#ff5722" }}>TAILORLY</span></div>
        <h1 style={h1}>Connect the browser extension</h1>

        {status === "waiting" && <p style={muted}>Checking your sign-in…</p>}

        {status === "signed_out" && (
          <>
            <p style={muted}>You need to sign in first. Use the dashboard, then return here automatically.</p>
            <a href="/" style={btn}>Go to sign in</a>
          </>
        )}

        {status === "sending" && <p style={muted}>Sending session to the extension…</p>}

        {status === "done" && (
          <>
            <p style={{ ...muted, color: "#2e7d32" }}>Connected. You can close this tab.</p>
            <button onClick={() => window.close()} style={btn}>Close tab</button>
          </>
        )}

        {status === "error" && (
          <>
            <p style={{ ...muted, color: "#c62828" }}>Couldn't connect: {errorMsg}</p>
            <button onClick={() => window.location.reload()} style={btn}>Try again</button>
          </>
        )}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#0a0a0a", color: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto",
};
const card: React.CSSProperties = {
  background: "#141414", border: "1px solid #2a2a2a", borderRadius: 16,
  padding: "32px 36px", width: "min(440px, 100%)", margin: "0 16px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const brand: React.CSSProperties = { fontWeight: 700, letterSpacing: "0.06em", fontSize: 13, opacity: 0.7 };
const h1: React.CSSProperties = { margin: "10px 0 16px", fontSize: 22 };
const muted: React.CSSProperties = { color: "#aaa", fontSize: 14, lineHeight: 1.5 };
const btn: React.CSSProperties = {
  display: "inline-block", marginTop: 14, padding: "10px 16px",
  borderRadius: 8, background: "#ff5722", color: "#fff", fontWeight: 600,
  textDecoration: "none", border: 0, cursor: "pointer",
};
