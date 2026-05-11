import { bootstrap } from "./shared/engine";
import { findContainerWithInputs } from "./shared/selectors";

/**
 * Ashby postings.
 *
 * URL shape: https://jobs.ashbyhq.com/<org>/<posting_id>
 *
 * Ashby's React-based form mounts under #__next; system fields use
 * `name="_systemfield_<key>"`.
 */

bootstrap({
  atsName: "ashby",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  },

  findFormRoot() {
    // Ashby renders Overview + Application as tabs on the SAME URL - the
    // path doesn't change when the user switches tabs, so we can't gate
    // on `/apply`. The Application tab's content is a React-rendered
    // panel without a real <form> element; field inputs sit inside a
    // <div role="region"> or just plain divs.
    //
    // Strategy: look for the application section container by data-attr,
    // then by a heuristic - any container that has BOTH a Name/Email
    // input is "the form". Falls back to <form>, then document.body.
    const candidates: Array<HTMLElement | null> = [
      document.querySelector("[data-testid='application-form']") as HTMLElement | null,
      document.querySelector("[data-testid='ApplicationForm']") as HTMLElement | null,
      document.querySelector("[aria-label*='application' i]") as HTMLElement | null,
      document.querySelector("form") as HTMLElement | null,
    ];
    for (const c of candidates) if (c) return c;

    // Heuristic: find the smallest container that has a Name AND Email
    // input visible. This survives Ashby's frequent React class-name
    // churn - we're matching on user-facing labels, not framework state.
    return findContainerWithInputs(["name", "email"]);
  },

  async openFormIfNeeded() {
    // Ashby's "Application" tab is what renders the fields. If the user
    // is on Overview, click the Application tab.
    const tab = Array.from(document.querySelectorAll("button, a, [role='tab']"))
      .find((el) => /^application$/i.test((el.textContent || "").trim())) as HTMLElement | null;
    if (tab) tab.click();
    // Plus the legacy /apply navigation anchor in case some tenants still use it.
    const cta = document.querySelector(
      "a[href*='/apply'], a[data-testid='Apply']"
    ) as HTMLAnchorElement | null;
    if (cta && !document.querySelector("input[name*='name' i], input[name*='email' i]")) cta.click();
  },

  submitButtonSelectors: [
    'button[type="submit"]',
    'button[data-testid="ApplicationFormSubmitButton"]',
  ],
});
