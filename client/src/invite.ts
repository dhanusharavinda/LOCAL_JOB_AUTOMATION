/**
 * Invite-link token handling for the invite-only launch.
 *
 * Links look like  https://<site>/invite/<token>  (or ?invite=<token>).
 * The token is stashed in localStorage so it survives the sign-up email
 * confirmation round-trip, then redeemed once the user is signed in.
 */

const KEY = "gc8_invite_token";
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Pull a token out of a pasted link, a bare token, or the current URL. */
export function extractInviteToken(input: string): string | null {
  const text = (input || "").trim();
  if (!text) return null;
  const fromPath = text.match(/\/invite\/([A-Za-z0-9_-]{8,64})/);
  if (fromPath) return fromPath[1];
  const fromQuery = text.match(/[?&]invite=([A-Za-z0-9_-]{8,64})/);
  if (fromQuery) return fromQuery[1];
  return TOKEN_RE.test(text) ? text : null;
}

/**
 * Called once on app load. If the URL carries an invite, remember it and
 * clean the address bar so a refresh or screenshot doesn't expose it.
 */
export function captureInviteFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const token = extractInviteToken(window.location.pathname + window.location.search);
  if (!token) return getStoredInvite();
  try { localStorage.setItem(KEY, token); } catch { /* private mode */ }
  try { window.history.replaceState({}, "", "/"); } catch { /* noop */ }
  return token;
}

export function getStoredInvite(): string | null {
  try {
    const t = localStorage.getItem(KEY);
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function storeInvite(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* noop */ }
}

export function clearStoredInvite(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
