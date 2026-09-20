/**
 * The address the product lives at, used wherever a link leaves the app
 * and lands in someone else's hands.
 *
 * Deliberately NOT window.location.origin. The admin panel is reachable
 * at the Vercel preview URL as well as the real domain, and an invite
 * link built from the current origin sends whichever address the admin
 * happened to have open. That put a *.vercel.app link into the DM
 * template, which looks broken to the person receiving it and stops
 * working the moment the preview URL changes.
 *
 * Override with VITE_SITE_URL for a staging deploy.
 */
const RAW = (import.meta.env.VITE_SITE_URL as string | undefined) || "https://tailorlyai.pro";

/** Canonical origin, no trailing slash. */
export const SITE_URL = RAW.replace(/\/+$/, "");

/** Build an absolute URL on the canonical domain. */
export function siteUrl(path: string): string {
  return `${SITE_URL}/${String(path).replace(/^\/+/, "")}`;
}

/** True when running against a dev server rather than a deployed site. */
function isLocalhost(): boolean {
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * Where Supabase should send someone back to after a password reset or
 * an email confirmation.
 *
 * Uses the real domain in production so the emailed link always works
 * and only one address needs allowlisting in Supabase, but keeps the
 * current origin during local development so `npm run dev` does not
 * bounce you to the live site mid-test.
 */
export function authRedirect(path: string): string {
  const clean = String(path).replace(/^\/+/, "");
  return isLocalhost() ? `${window.location.origin}/${clean}` : siteUrl(clean);
}
