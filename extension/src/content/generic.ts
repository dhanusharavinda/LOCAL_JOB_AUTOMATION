import { bootstrap, type AtsAdapter } from "./shared/engine";
import { findContainerWithInputs } from "./shared/selectors";

// Generic adapter for sites that don't have a dedicated ATS content
// script (custom careers pages like Bending Spoons, ElevenLabs,
// Stripe, Anthropic, etc.) AND as a fallback when a known-ATS
// content script failed to mount.
//
// Auto-load behaviour:
//   - The manifest registers this script for all https pages (minus
//     the dedicated ATS hosts). Chrome runs it automatically at
//     document_idle on every page the user visits.
//   - Most pages are NOT job applications. We run a light heuristic
//     (looksLikeJobApplication) before calling bootstrap. If it
//     returns false, the script does nothing: no DOM mutation, no
//     network calls, no overlay. The user's privacy is preserved on
//     banking, email, social, and news pages.
//   - On pages that ARE job applications, bootstrap mounts the
//     overlay automatically.
//   - The popup's "Open auto-fill panel" button forces a manual
//     bootstrap via chrome.scripting.executeScript regardless of the
//     heuristic, in case the user wants to invoke on a page the
//     heuristic missed.

const adapter: AtsAdapter = {
  atsName: "generic",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    // Try to pull a posting id out of the URL. Common patterns:
    //   /jobs/<id>, /careers/<id>, /apply/<id>, ?job=<id>
    const path = location.pathname.split("/").filter(Boolean);
    for (const p of path.reverse()) {
      if (/^\d{4,}$/.test(p)) return p;
      if (/^[a-z0-9_-]{8,}$/i.test(p) && /\d/.test(p)) return p;
    }
    const sp = new URLSearchParams(location.search);
    return sp.get("job") || sp.get("jobId") || sp.get("posting") || null;
  },

  findFormRoot() {
    const heur = findContainerWithInputs(["name", "email"]);
    return heur !== document.body ? heur : document.body;
  },

  submitButtonSelectors: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[data-action*="submit" i]',
    'button[id*="submit" i]',
    'button[class*="submit" i]',
  ],
};

/**
 * Conservative form-detection heuristic. Returns true only when the
 * page has clear job-application signals:
 *   - 3+ visible non-password text/textarea/select fields, AND
 *   - 2+ application-specific keywords across the page or in the
 *     fields' name/id/autocomplete attributes.
 *
 * False positives we want to avoid:
 *   - Login forms (filtered out by ignoring password-adjacent fields
 *     and by requiring 2 keyword hits, since login pages usually only
 *     mention "email" / "password" once each).
 *   - Sign-up forms (signed-up sites often look like applications;
 *     the keyword set leans toward "resume", "cv", "experience",
 *     "apply" which sign-ups don't usually have).
 *   - Marketing/contact forms (small field count, no application
 *     vocabulary).
 */
function looksLikeJobApplication(): boolean {
  const fields = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="password"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, select'
  );
  if (fields.length < 3) return false;

  const haystackParts: string[] = [
    document.title || "",
    document.querySelector("h1")?.textContent || "",
    document.querySelector("h2")?.textContent || "",
  ];
  for (const f of Array.from(fields)) {
    haystackParts.push(
      (f.getAttribute("name") || ""),
      (f.id || ""),
      (f.getAttribute("autocomplete") || ""),
      (f.getAttribute("placeholder") || ""),
    );
  }
  const haystack = haystackParts.join(" ").toLowerCase();

  const indicators = [
    "resume", "cv ", "cover letter", "linkedin", "portfolio",
    "applicant", "candidate", "apply for", "application",
    "first name", "last name", "fullname", "full name",
    "experience", "work history", "education", "salary",
    "why do you want", "tell us about", "github",
  ];
  let hits = 0;
  for (const ind of indicators) {
    if (haystack.includes(ind)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

// Always register a manual-mount listener so the popup's
// "Open auto-fill panel" button can force the overlay even if the
// page doesn't look like a job application to our heuristic.
// Idempotent: the listener self-disables after the first hit so a
// rapid re-injection (popup clicked twice) doesn't double-mount.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && !(window as any).__GO_CANDID8_GENERIC_MANUAL__) {
  (window as any).__GO_CANDID8_GENERIC_MANUAL__ = true;
  chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (msg?.type === "go-candid8/manual-bootstrap") {
      bootstrap(adapter).catch(() => { /* surfaced by overlay */ });
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
}

// Auto-mount only when the heuristic flags a job-application form.
// Stay completely silent on every other page (banking, email, social,
// news): no DOM mutation, no network call, no overlay.
if (looksLikeJobApplication()) {
  bootstrap(adapter).catch(() => { /* engine surfaces errors via overlay */ });
}
