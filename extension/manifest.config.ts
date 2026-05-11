import { defineManifest } from "@crxjs/vite-plugin";

/**
 * Manifest V3 manifest. Defined as TypeScript so the build can read
 * package.json's version + tweak host_permissions per environment.
 *
 * Content scripts are split per-ATS so a Workday breakage can't take
 * down the LinkedIn handler. Each script registers ONE host pattern;
 * shared utilities are imported via ES modules and bundled together
 * by the CRX plugin.
 */
export default defineManifest({
  manifest_version: 3,
  name: "GO CANDID8 - Auto Apply",
  short_name: "GO CANDID8",
  description: "Fill job applications with your tailored resume + AI-generated answers. You always click Submit.",
  version: "0.1.0",

  // The toolbar popup is the user's main entry point: shows sign-in
  // status, current-page detection, and a deep link to the dashboard.
  action: {
    default_title: "GO CANDID8",
    default_popup: "src/popup/popup.html",
  },

  // Service worker. ESM module so we can `import` the shared API client.
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },

  // Standalone profile editor (Chrome surfaces this via the extension's
  // chrome://extensions toggle as well as the popup's Settings link).
  options_page: "src/options/options.html",

  // Per-ATS content scripts. document_idle is critical for SPAs (Workday,
  // Ashby, modern Greenhouse Boards) - running too early means the form
  // hasn't rendered and our selectors all miss.
  content_scripts: [
    {
      matches: ["https://www.linkedin.com/jobs/*"],
      js: ["src/content/linkedin.ts"],
      run_at: "document_idle",
    },
    {
      matches: [
        "https://boards.greenhouse.io/*",
        "https://job-boards.greenhouse.io/*",
        "https://*.greenhouse.io/*",
      ],
      js: ["src/content/greenhouse.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://jobs.lever.co/*"],
      js: ["src/content/lever.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://jobs.ashbyhq.com/*"],
      js: ["src/content/ashby.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://apply.workable.com/*"],
      js: ["src/content/workable.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://*.myworkdayjobs.com/*"],
      js: ["src/content/workday.ts"],
      run_at: "document_idle",
    },
    // Generic fallback. Auto-loads on every https page so the overlay
    // can pop on its own when the page looks like a job application
    // (form fields plus apply-related signals). On non-application
    // pages (banking, social, news), generic.ts loads but stays silent;
    // it does not call bootstrap, no DOM is mutated, no network calls
    // are made until the user explicitly invokes via the popup.
    //
    // exclude_matches are the dedicated ATS hosts that already have
    // their own bundled content script. Excluding them prevents two
    // overlays from mounting on the same page.
    {
      matches: ["https://*/*"],
      exclude_matches: [
        "https://www.linkedin.com/jobs/*",
        "https://boards.greenhouse.io/*",
        "https://job-boards.greenhouse.io/*",
        "https://*.greenhouse.io/*",
        "https://jobs.lever.co/*",
        "https://jobs.ashbyhq.com/*",
        "https://apply.workable.com/*",
        "https://*.myworkdayjobs.com/*",
      ],
      js: ["src/content/generic.ts"],
      run_at: "document_idle",
    },
  ],

  // Dedicated ATS hosts plus a broad https://*/* permission for the
  // generic content script. The broad permission triggers a Chrome
  // Web Store review warning ("read and change all your data on
  // websites you visit") which is the cost of supporting any company
  // careers page. The generic script does nothing on non-form pages
  // (no DOM mutation, no network calls), so the privacy footprint is
  // minimal in practice.
  host_permissions: [
    "https://www.linkedin.com/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://*.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "https://jobs.ashbyhq.com/*",
    "https://apply.workable.com/*",
    "https://*.myworkdayjobs.com/*",
    "https://*/*",
  ],

  // We need storage (auth tokens), activeTab + scripting (overlay panel).
  // Deliberately NOT requesting `tabs` or `cookies` - those raise the
  // permission-warning bar dramatically with no real benefit for us.
  permissions: ["storage", "activeTab", "scripting"],

  // The dashboard's ?ext_auth=1 bridge calls
  // `chrome.runtime.sendMessage(<ext_id>, {...})` to hand off a
  // Supabase session to the background worker. That API is gated by
  // `externally_connectable.matches` - only origins listed here can
  // message us. Localhost is for dev; the production dashboard host
  // should be added via VITE_DASHBOARD_HOST_PATTERN at build time.
  externally_connectable: {
    matches: [
      "http://localhost:5173/*",
      "https://localhost:5173/*",
      "https://*.vercel.app/*",
      // Add a stable production domain here when the SaaS launches:
      // "https://app.gocandid8.com/*",
    ],
  },

  // No web-accessible resources for v1: the overlay UI lives entirely in
  // a Shadow DOM with inlined styles, the React popup/options pages are
  // extension-internal pages, and content scripts are bundled directly.
});
