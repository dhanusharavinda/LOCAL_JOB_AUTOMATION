# GO CANDID8 - Auto Apply (Browser Extension)

Manifest V3 Chrome / Edge extension that fills application forms on
LinkedIn Easy Apply, Greenhouse, Lever, Ashby, Workable, and Workday.
The extension never auto-submits - you always click the form's native
Submit button.

## What it does

1. You sign in once via the popup (handoff to the dashboard's Supabase
   session).
2. Land on a supported ATS posting that's tracked in your GO CANDID8
   dashboard. The extension's overlay panel appears in the top-right.
3. Click **Fill form**. The script populates standard fields from your
   Apply Profile (name, email, work auth, salary expectations, …).
4. For free-text questions ("Why this role?", "Tell us about a problem
   you solved"), click **Draft with AI** in the overlay. The server
   uses your saved Story answers + the job description to compose a
   natural first-person reply, which you can edit before applying it
   to the form.
5. Click the site's native **Submit**. The extension reports the
   outcome to GO CANDID8 and your kanban card moves to **Applied**.

## Local install (developer mode)

```
# from repo root
npm install                       # one-time, picks up the new extension workspace
npm run build --workspace=extension
```

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and pick `extension/dist/`.
4. Note the Extension ID Chrome assigns.

### Configure the API + dashboard

Create `extension/.env.local`:

```
VITE_API_URL=http://localhost:3001
VITE_DASHBOARD_URL=http://localhost:5173
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-jwt>
```

Re-run `npm run build --workspace=extension` after changes - Chrome
auto-reloads the unpacked extension.

### Configure the server to admit the extension

`server/.env`:

```
EXTENSION_IDS=<extension-id-from-chrome-extensions-page>
```

The server's CORS layer rejects any other `chrome-extension://` origin
in production. In local dev (`NODE_ENV !== "production"`) it admits any
extension to keep onboarding frictionless.

## Production build

```
VITE_API_URL=https://api.gocandid8.com \
VITE_DASHBOARD_URL=https://app.gocandid8.com \
VITE_SUPABASE_URL=https://<project>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-jwt> \
npm run build --workspace=extension
```

Then zip `extension/dist/` and upload to the Chrome Web Store. The
production dashboard hostname must be added to
`externally_connectable.matches` in `manifest.config.ts` before the
`?ext_auth=1` handoff will work.

## Architecture

```
┌──────────────────┐        ┌────────────────────┐
│ Chrome extension │ ─────▶ │  Server (/api/apply)│
│  background.ts   │        │  - profile          │
│   (auth + api)   │ ◀───── │  - job-context      │
│                  │        │  - track            │
│  content/*.ts    │        │  - ats-submit       │
│   (per-ATS DOM)  │        │  - answer  (AI)     │
└──────────────────┘        └────────────────────┘
        │
        ▼
ATS site DOM (LinkedIn / Greenhouse / Lever / Ashby / Workable / Workday)
```

- `src/background.ts` - service worker. Holds the Supabase session in
  `chrome.storage.local` and proxies all `/api/*` calls so JWTs never
  leak to the page origin.
- `src/content/<ats>.ts` - one per ATS. Tiny adapters that hand DOM
  selectors to the shared engine.
- `src/content/shared/engine.ts` - overlay lifecycle, fill, AI-draft,
  submit detection.
- `src/content/shared/{selectors,filler,overlay}.ts` - reusable DOM
  utilities. Overlay UI lives in a Shadow DOM with inlined styles so
  host-page CSS can't bleed in.
- `src/popup/`, `src/options/` - extension UI surfaces.

## Risks / known limitations

- **Workday is brittle.** Enterprise tenants customise the form, so a
  selector that works on IBM Workday may break on Capital One Workday.
  Expect 50–70% field coverage on Workday and review before submit.
- **LinkedIn rate-limit risk.** LinkedIn flags suspiciously fast
  apply patterns (~50 / 10 min). The engine deliberately doesn't queue
  multi-job applies - humans pace themselves naturally.
- **No auto-submit, ever.** This is a hard product principle, not a
  toggle: the extension fills, you submit.
