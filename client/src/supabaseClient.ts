import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client - browser side.
 *
 * Vite exposes env vars prefixed with `VITE_` to the bundle. Set these in
 * `client/.env.local` (gitignored) for local dev and in your hosting
 * platform's environment config for production:
 *
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon public key - safe to expose>
 *
 * The anon key is safe to ship in the frontend bundle. It's a JWT whose
 * only power is to let unauthenticated users hit Supabase's auth endpoints
 * (signup, signin) and any Postgres tables your RLS policies allow.
 *
 * DO NOT put the `sb_secret_...` service role key here. Ever. That key
 * bypasses Row Level Security and if it leaks, anyone who has it can
 * read/write every row in your Supabase project.
 */

const url  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  // Fail loud in the console so a misconfigured deploy is easy to spot.
  // We still export a client so the app doesn't crash on import - calls
  // will just fail with a clear error at runtime.
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY - " +
    "auth will not work. Create client/.env.local with both values."
  );
}

export const supabase: SupabaseClient = createClient(
  url  || "https://invalid.supabase.co",
  anon || "invalid-anon-key",
  {
    auth: {
      // Persist the session in localStorage so refreshing the page keeps
      // the user signed in. supabase-js handles silent access-token
      // refresh using the stored refresh token.
      persistSession: true,
      autoRefreshToken: true,
      // We're not using URL-based magic-link callbacks right now, but
      // keeping this on is harmless and future-proofs email verification.
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      storageKey: "gocandid8-supabase-auth",
    },
  }
);

/**
 * In-memory cache of the current access token, kept in sync with
 * supabase-js via onAuthStateChange. Used by the fetch wrapper in
 * api.ts so every outgoing API request can attach the Authorization
 * header synchronously without awaiting getSession() on every call.
 *
 * The subscription fires on: INITIAL_SESSION (boot), SIGNED_IN, SIGNED_OUT,
 * TOKEN_REFRESHED, USER_UPDATED - which covers every case the token could
 * change. The only thing we won't catch is a hard failure of the refresh
 * flow, in which case the token eventually expires and the server returns
 * 401 - the fetch wrapper handles that by redirecting to the auth page.
 */
let _accessToken: string | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  _accessToken = session?.access_token ?? null;
});

// Seed the cache on boot from whatever supabase-js has in its persisted
// storage. This await is safe here because supabaseClient.ts is imported
// once at app startup.
supabase.auth.getSession().then(({ data }) => {
  _accessToken = data.session?.access_token ?? null;
});

/** Current access token or null if the user is signed out. */
export function getCurrentAccessToken(): string | null {
  return _accessToken;
}
