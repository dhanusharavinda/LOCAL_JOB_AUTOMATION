/**
 * Snapshot of the URL as the page was opened.
 *
 * supabase-js parses the address bar when it initialises and then clears
 * what it found, so anything read later has already lost the fragment.
 * That is why a failed reset link showed a generic message instead of
 * "expired or already used": the error was gone before the screen could
 * read it. This module must be imported before the Supabase client, so
 * main.tsx imports it first.
 */

function read(): { hash: string; search: string } {
  if (typeof window === "undefined") return { hash: "", search: "" };
  return { hash: window.location.hash || "", search: window.location.search || "" };
}

const SNAPSHOT = read();

/** Params from the fragment and the query as the page first loaded. */
export function initialUrlParams(): URLSearchParams {
  const merged = new URLSearchParams(SNAPSHOT.search);
  const fromHash = new URLSearchParams(SNAPSHOT.hash.replace(/^#/, ""));
  fromHash.forEach((value, key) => { if (!merged.has(key)) merged.set(key, value); });
  return merged;
}
