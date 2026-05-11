import { bootstrap } from "./shared/engine";

/**
 * Workable postings.
 *
 * URL shape: https://apply.workable.com/<account>/j/<shortcode>/
 *
 * Workable's hosted form uses stable `name`/`id` attributes per their
 * official template (firstname, lastname, email, phone, resume, etc.).
 */

bootstrap({
  atsName: "workable",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    const m = location.pathname.match(/\/j\/([A-Z0-9]+)/i);
    return m ? m[1] : null;
  },

  findFormRoot() {
    return (
      document.querySelector("form#whr-form") as HTMLElement | null ||
      document.querySelector("[data-ui='application_form']") as HTMLElement | null ||
      (document.querySelector("form") as HTMLElement | null)
    );
  },

  async openFormIfNeeded() {
    // Workable shows a top-level "Apply" button that scrolls to the form.
    const btn = Array.from(document.querySelectorAll("button, a"))
      .find((el) => /apply for this job|apply now/i.test(el.textContent || "")) as HTMLElement | null;
    if (btn) btn.click();
  },

  submitButtonSelectors: [
    'button[type="submit"]',
    'input[type="submit"]',
  ],
});
