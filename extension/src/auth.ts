/**
 * Auth state stored in chrome.storage.local.
 *
 * The dashboard's "?ext_auth=1" page posts the Supabase session
 * (access + refresh tokens, plus user email) to the extension via
 * chrome.runtime.sendMessage. The background service worker forwards
 * it here for storage.
 *
 * Refresh logic talks directly to Supabase's /token endpoint - same
 * REST contract as the @supabase/supabase-js client uses, but we don't
 * pull in the full SDK to keep the extension bundle small.
 */

declare const __SUPABASE_URL__: string | undefined;
declare const __SUPABASE_ANON_KEY__: string | undefined;

const SUPABASE_URL =
  (typeof __SUPABASE_URL__ !== "undefined" && __SUPABASE_URL__) ||
  (globalThis as any)?.__GO_TAILORLY_SUPABASE_URL ||
  "";

const SUPABASE_ANON_KEY =
  (typeof __SUPABASE_ANON_KEY__ !== "undefined" && __SUPABASE_ANON_KEY__) ||
  (globalThis as any)?.__GO_TAILORLY_SUPABASE_ANON_KEY ||
  "";

const STORAGE_KEY = "go_candid8_session";

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;        // unix seconds
  user_email: string;
  user_id: string;
}

export async function setSession(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function getSession(): Promise<StoredSession | null> {
  const v = await chrome.storage.local.get(STORAGE_KEY);
  return (v[STORAGE_KEY] as StoredSession) || null;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function getStoredToken(): Promise<string | null> {
  const s = await getSession();
  if (!s) return null;
  // Refresh if within 60s of expiry to avoid mid-request 401s.
  const now = Math.floor(Date.now() / 1000);
  if (s.expires_at && s.expires_at - now < 60) {
    const refreshed = await refreshSession();
    if (refreshed) return refreshed.access_token;
  }
  return s.access_token;
}

export async function refreshSession(): Promise<StoredSession | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const s = await getSession();
  if (!s?.refresh_token) return null;

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.access_token) return null;
    const next: StoredSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || s.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user_email: s.user_email,
      user_id: data.user?.id || s.user_id,
    };
    await setSession(next);
    return next;
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  const s = await getSession();
  return !!s?.access_token;
}
