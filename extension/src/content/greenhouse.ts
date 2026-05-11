import { bootstrap } from "./shared/engine";

/**
 * Greenhouse Boards.
 *
 * URL shapes:
 *   - https://boards.greenhouse.io/<board>/jobs/<id>
 *   - https://job-boards.greenhouse.io/<board>/jobs/<id>
 *   - https://<company>.greenhouse.io/jobs/<id>      (legacy embedded board)
 *
 * Form fields use stable `name` attributes, e.g. job_application[first_name],
 * job_application[email], etc. Custom questions are nested under
 * job_application[answers_attributes][N][text_value].
 */

bootstrap({
  atsName: "greenhouse",

  currentJobUrl() {
    return location.href;
  },

  externalJobId() {
    const m = location.pathname.match(/\/jobs\/(\d+)/);
    return m ? m[1] : null;
  },

  findFormRoot() {
    return (
      document.querySelector("#application_form") as HTMLElement | null ||
      document.querySelector("form#application-form") as HTMLElement | null ||
      (document.querySelector("form") as HTMLElement | null)
    );
  },

  submitButtonSelectors: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button#submit_app',
  ],
});
