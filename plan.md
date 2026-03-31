# SiteSnap — Architecture & Rules

## What it does
Multi-site screenshot automation. User logs in via a web UI, configures per-page capture steps,
and triggers a Playwright run that produces a timestamped ZIP with `desktop/` and `mobile/` sub-folders.

---

## Rules to live by

### Credentials
- Never hardcode credentials. Never log them. Never store them beyond the immediate call stack.
- On the client: store only in `sessionStorage` (tab-scoped, not persisted). Keys: `ss_username`, `ss_password`, `ss_site`.
- On the server: pass directly to `run()` and nowhere else. Do not attach to job records.
- **HTTP Basic Auth**: Dev/staging environments (e.g. `dev.imcivreehcp.com`) are gated behind HTTP Basic Auth.
  Playwright gets `ERR_INVALID_AUTH_CREDENTIALS` if `httpCredentials` is not set on the context.
  Always pass credentials to `launchContext(viewport, credentials)` — it sets `httpCredentials` on
  `browser.newContext()` so Playwright auto-responds to any 401 challenge before the page loads.
  The same user-entered credentials serve both the HTTP gate and any form-based login.

### Site configs
- Sites live in `/sites/<id>/` with `config.json` + `metadata.json`.
- Users never edit configs via the UI. All config changes are manual file edits.
- The UI sends a modified copy of config with capture requests — the server uses the override if provided, otherwise reads from disk.

### ISI tray
- **Must never appear** in any capture after the entry screenshot.
- Suppress with `page.addStyleTag()` targeting `.isi-tray` and `[class*="isi-tray"]`.
- Re-apply after **every `page.goto()`** because addStyleTag is scoped to the page document.
- Do NOT call hideISITray before the post-entry viewport capture — that step intentionally shows the ISI tray.

### Browser sessions
- Launch a fresh browser context for every device pass (desktop, mobile).
- Never share cookies or storage between sites or between desktop/mobile runs.
- External captures (interstitials) open in an isolated browser context with no session.

### Viewports
- Desktop default: 1442 × 900
- Mobile default: 390 × 800
- `captureMode: "viewport"` = fixed-size screenshot (no scroll). Resize page if step defines different dims, then restore.
- `captureMode: "fullPage"` = scroll through entire document first (lazy-load trigger), then capture.

### Output
- Desktop and mobile screenshots go in **separate sub-folders**: `output/run-<timestamp>/desktop/` and `output/run-<timestamp>/mobile/`.
- Files are sequentially numbered: `01_home-with-overlays.png`, `02_home-post-dismiss.png`, etc.
- Numbering resets per device pass (desktop and mobile each start at 01).
- The entire run folder is zipped and the unzipped folder is deleted.

### Entry page (home)
- The home page has 3 phases driven by `step.phase`:
  1. `pre-entry` — capture before any interaction (cookie banner + HCP gate + ISI tray all visible)
  2. `post-entry` — run `entryActions` (accept cookies, click HCP gate), then capture (ISI tray still visible)
  3. `authenticated` — hide ISI tray, then capture (full page)
- Login injection (`injectLogin`) happens between post-entry and authenticated phases.
- Mobile-only: hamburger menu is opened and captured after the post-entry phase.

### External captures (interstitials)
- Navigate to `triggerPage`, listen for popup before clicking trigger link.
- If a popup opens: capture it at the step's viewport dims, then close.
- If no popup: the interstitial rendered as a modal — capture current page, then press Escape to dismiss.
- These run in the same authenticated browser session; the external content opens in an isolated context.

---

## Config schema (per site)

```json
{
  "baseUrl": "https://...",
  "pages": [
    {
      "id": "string",
      "label": "Display name",
      "path": "/optional-path/",
      "type": "external",          // optional — omit for regular pages
      "includesEntry": true,       // true only for the home page
      "entryActions": [ ... ],     // only on includesEntry pages
      "triggerPage": "/",          // only on external pages
      "steps": [
        {
          "id": "string",
          "enabled": true,
          "label": "Display name",
          "description": "optional",
          "phase": "pre-entry | post-entry | authenticated",  // only for entry page
          "captureMode": "viewport | fullPage",
          "desktop": { "width": 1442, "height": 900 },        // viewport only
          "mobile":  { "width": 390,  "height": 800 },        // viewport only
          "hideISI": true,
          "includeMobile": true,
          "mobileOnly": false,
          "actions": [
            { "type": "select | input | checkbox", "label": "...", "value": "...", "editable": true }
          ],
          "waitFor": "no-results | network-idle",
          "trigger": { "type": "click", "text": "link text" }  // external only
        }
      ]
    }
  ]
}
```

---

## Adding a new site

1. Create `/sites/<site-id>/`
2. Add `metadata.json` with `{ "siteName": "Display Name" }`
3. Add `config.json` following the schema above
4. Create `output/` sub-folder (or let the runner create it automatically)
5. Restart the server — the site appears in the landing page dropdown

---

## Execution flow (runner.js)

```
run(siteDir, credentials, configOverride?)
  ├── runDevice(..., 'desktop')
  │     ├── for each page:
  │     │     ├── if external → captureExternal()
  │     │     ├── if includesEntry:
  │     │     │     ├── navigate to path
  │     │     │     ├── pre-entry steps → captureStep()
  │     │     │     ├── executeActions(entryActions)
  │     │     │     ├── injectLogin()
  │     │     │     ├── post-entry steps → captureStep()
  │     │     │     └── authenticated steps → prepareAndCapture()
  │     │     └── else → navigate + prepareAndCapture()
  │     └── browser.close()
  ├── runDevice(..., 'mobile')
  │     └── same as desktop, but:
  │           - uses 390×800 viewport
  │           - after post-entry: captureHamburger()
  ├── zipDirectory(runDir, zipPath)
  └── rmSync(runDir)
```

---

## Deployment

SiteSnap runs in two modes — same codebase, same UI:

### Local (Express)
```
node index.js          # starts Express on port 3000 (auto-walks on EADDRINUSE)
SITESNAP_DEBUG=1 node index.js   # headed Chromium + slowMo for debugging
```
- Job state: in-memory Map
- Screenshots/ZIPs: written to `sites/<id>/output/` on disk
- `browser.js` uses the `playwright` package

### Netlify
- UI files in `ui/` are the static publish target (`publish = "ui"`)
- API routes are Netlify Functions in `netlify/functions/`
- `/api/run` → background function (`api-run-background.mjs`, 15-min timeout, 3GB RAM)
- Job state + screenshots + ZIPs: stored in Netlify Blobs (3 stores: `sitesnap-jobs`, `sitesnap-screenshots`, `sitesnap-zips`)
- `browser.js` detects `process.env.NETLIFY` and uses `@sparticuz/chromium` + `playwright-core`
- Screenshots written to `/tmp` during the run, then uploaded to Blobs, then deleted
- Client generates `jobId` with `crypto.randomUUID()` before POST; polling starts immediately (handles 202 with no body)
- `sites/**` bundled with functions via `included_files` in `netlify.toml`

### Netlify function architecture
- `/api/run` → `api-run.mjs` (regular function): validates params, writes initial job state to Blobs **immediately** so polling can start, then fire-and-forgets a POST to `api-run-background` and returns 200.
- `api-run-background.mjs` (background function): does the Playwright work, updates Blobs as it goes.
- This split ensures the job always exists in Blobs before the client starts polling, even if the background worker cold-starts slowly.

### Browser / Playwright on Netlify
- `core/browser.js` uses `playwright-core` as a **static import** (works everywhere).
- Locally: `playwright-core` auto-discovers the chromium that `npm run setup` installs to `~/.cache/ms-playwright/`. No code change needed for local dev.
- On Netlify: `@sparticuz/chromium` is loaded via dynamic `import()` and supplies `executablePath` + `args`.
- `playwright` (full package) is in `devDependencies` only — used for `npm run setup`, never imported at runtime, never bundled by esbuild.
- `playwright-core` and `@sparticuz/chromium` are both in `external_node_modules` so esbuild doesn't inline them.

### Deploy to Netlify
1. Push repo to GitHub
2. Connect repo in Netlify dashboard
3. Build settings are auto-detected from `netlify.toml`
4. No environment variables required — Blobs context and `process.env.URL` are injected automatically by Netlify

---

## File map

| File | Role |
|---|---|
| `index.js` | Express server — site API, config API, job management (local only) |
| `core/runner.js` | Playwright orchestrator — desktop + mobile passes |
| `core/browser.js` | Browser/context factory — switches between local Playwright and `@sparticuz/chromium` |
| `core/actions.js` | Action executor (click, input, select, checkbox, login) |
| `core/capture.js` | Screenshot + lazy-load scroll |
| `core/utils.js` | waitForNetworkIdle, hideISITray, waitForCondition |
| `core/zip.js` | ZIP packaging |
| `ui/index.html` | Login/site-selection landing page |
| `ui/run.html` | Per-page step configuration + capture trigger |
| `netlify/functions/api-sites.mjs` | GET /api/sites |
| `netlify/functions/api-config.mjs` | GET /api/config/:siteId |
| `netlify/functions/api-run-background.mjs` | POST /api/run (background, 15 min) |
| `netlify/functions/api-status.mjs` | GET /api/status/:jobId |
| `netlify/functions/api-thumbnail.mjs` | GET /api/thumbnail/:jobId/:index |
| `netlify/functions/api-download.mjs` | GET /api/download/:jobId |
| `netlify.toml` | Build config + function settings + API redirects |
| `sites/<id>/config.json` | Site automation config |
| `sites/<id>/metadata.json` | Display name |
| `sites/<id>/output/` | Run ZIPs stored here (local only) |
