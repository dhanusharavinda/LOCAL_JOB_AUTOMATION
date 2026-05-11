import { bootstrap } from "./shared/engine";

/**
 * Workday - best-effort.
 *
 * Every enterprise tenant skins their Workday differently. We rely on
 * react-aria's stable role attributes + the standard "createNewAccount"
 * flow + automationId hints. Expect ~50-70% of fields to fill cleanly;
 * the user should review before submit.
 */

bootstrap({
  atsName: "workday",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    const m = location.pathname.match(/job\/([A-Z0-9-]+)/i);
    return m ? m[1] : null;
  },

  findFormRoot() {
    // Workday wraps everything in a top-level <main>; look for the
    // visible application form within it.
    const main = document.querySelector("main") as HTMLElement | null;
    if (!main) return null;
    const form = main.querySelector("form, [data-automation-id*='form']") as HTMLElement | null;
    return form || main;
  },

  async openFormIfNeeded() {
    // The "Apply" CTA usually has data-automation-id="adventureButton" or
    // is plain text "Apply". Click it to enter the application flow.
    const candidates = Array.from(document.querySelectorAll("button, a")) as HTMLElement[];
    const cta = candidates.find((el) => /^\s*apply\b/i.test(el.textContent || ""));
    if (cta) cta.click();
  },

  submitButtonSelectors: [
    'button[data-automation-id="bottom-navigation-next-button"]',
    'button[data-automation-id="wd-PageBottomNavigationButton"]',
    'button[type="submit"]',
  ],
});
