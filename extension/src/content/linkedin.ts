import { bootstrap } from "./shared/engine";

/**
 * LinkedIn Easy Apply.
 *
 * Easy Apply is a multi-step modal - fields appear progressively as the
 * user clicks Next. Our overlay sits outside the modal; on each step
 * the engine's findFormRoot picks up the currently-visible step and
 * fills it. The user advances steps themselves.
 *
 * URL shapes we care about:
 *   - https://www.linkedin.com/jobs/view/<id>/
 *   - https://www.linkedin.com/jobs/search/?currentJobId=<id>&...
 */

bootstrap({
  atsName: "linkedin",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    // Posting id is in the path after /jobs/view/, or in ?currentJobId=
    const m = location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m) return m[1];
    const sp = new URLSearchParams(location.search);
    return sp.get("currentJobId") || sp.get("jobId") || null;
  },

  findFormRoot() {
    // Easy Apply renders into a modal with role="dialog" and
    // data-test-modal-id="easy-apply-modal". The current step is the
    // visible <form> inside.
    const modal = document.querySelector('[data-test-modal-id="easy-apply-modal"]') as HTMLElement | null;
    if (modal) {
      const form = modal.querySelector("form") as HTMLElement | null;
      if (form) return form;
      return modal;
    }
    // Fallback: any visible form on the job-view page.
    const forms = Array.from(document.querySelectorAll("form")) as HTMLElement[];
    return forms.find((f) => f.offsetParent !== null) || null;
  },

  async openFormIfNeeded() {
    // If the modal isn't open, click the Easy Apply CTA.
    const open = document.querySelector('[data-test-modal-id="easy-apply-modal"]');
    if (open) return;
    const buttons = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
    const cta = buttons.find((b) =>
      /easy apply/i.test(b.textContent || "") &&
      (b.getAttribute("aria-label") || "").toLowerCase().includes("apply")
    );
    if (cta) cta.click();
  },

  // The Submit click is the last-step "Submit application" button.
  // Multiple selectors so a LinkedIn redesign doesn't immediately break us.
  submitButtonSelectors: [
    'button[aria-label="Submit application"]',
    'button[data-test-modal-confirm-button]',
    'button.artdeco-button--primary[aria-label*="Submit"]',
  ],
});
