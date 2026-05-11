import { bootstrap } from "./shared/engine";

/**
 * Lever postings.
 *
 * URL shape: https://jobs.lever.co/<site>/<posting_id>
 *
 * Lever forms use simple `name` attributes (`name`, `email`, `phone`),
 * plus URL fields under `urls[LinkedIn]`, `urls[GitHub]`, etc.
 */

bootstrap({
  atsName: "lever",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[1] || null;
  },

  findFormRoot() {
    return (
      document.querySelector("form.application-form") as HTMLElement | null ||
      document.querySelector("form[action*='apply']") as HTMLElement | null ||
      (document.querySelector("form") as HTMLElement | null)
    );
  },

  // The "Apply for this job" CTA opens the form on the same page.
  async openFormIfNeeded() {
    if (this.findFormRoot && this.findFormRoot()) return;
    const link = document.querySelector(
      "a[href$='/apply'], a.template-btn-submit, a.postings-btn"
    ) as HTMLAnchorElement | null;
    if (link) link.click();
  },

  submitButtonSelectors: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button.template-btn-submit',
  ],
});
