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
- Suppress with `page.addStyleTag()` targeting `.isi-tray`, `[class*="isi-tray"]`, `.floating-isi`, `[class*="floating-isi"]`.
- Re-apply after **every `page.goto()`** because addStyleTag is scoped to the page document.
- Do NOT call hideISITray before the post-entry viewport capture — that step intentionally shows the ISI tray.
- **GATTEX** uses `aside.floating-isi`. The tray has no expand — it loads open. Minimize via `{ "type": "click", "selector": ".floating-isi .toggle-expand" }`. There is no `waitFor: "isi-expanded"` for GATTEX.
- Animations on all elements are disabled globally via `page.addInitScript` in `browser.js` so toggle/dismiss captures never show mid-animation frames.

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
            { "type": "select | input | checkbox", "label": "...", "value": "...", "editable": true },
            { "type": "click", "text": "visible text" },
            { "type": "click", "selector": ".css-selector" }  // bypasses network-idle wait — use for DOM-only toggles
          ],
          "waitFor": "no-results | network-idle | isi-expanded",
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
2. Add `metadata.json`:
   ```json
   {
     "siteName": "Display Name",
     "requiresCredentials": false   // omit or set true for HTTP-Basic-Auth / form-login sites
   }
   ```
3. Add `config.json` following the schema above
4. Optionally add `sites/<site-id>/images/<site-id>.png` — shown above Pages in the sidebar
5. Restart the server — the site appears in the landing page dropdown

### Production (no-credentials) sites
- Set `"requiresCredentials": false` in `metadata.json`.
- The login page grays out the username/password fields and shows "Not required for this site".
- The server skips credential validation and passes `null` credentials to the runner.
- `injectLogin` is skipped when credentials are `null`.

### Form-submit steps that navigate away
- Clicking a submit button on a non-entry page causes a full navigation, which breaks subsequent steps.
- The runner detects this via the `prevSkipped` flag: if a step was skipped, it re-navigates to the page URL before the next step runs — even if the POST lands back on the same URL.
- Example: sign-up validation-errors step (submit empty form) → page navigates → runner re-navigates to `/sign-up/` → filled-form step runs cleanly.

### Multi-step wizard / questionnaire pages (e.g. Gattex Gut Check)

**Pattern:** Each step of the wizard is a separate capture in the config. Steps are cumulative — each step's `actions` continue from where the previous step left off (they do NOT re-navigate). The first step has no actions (landing state). Each subsequent step clicks "Next" and makes a selection, then captures.

**`captureMode: "element"`** with a `selector` pointing to the questionnaire container (e.g. `section.gut-check-questionnaire`) is the right choice — it screenshots only the section at its natural height, not the full page.

**`hideISI: true` on every step** — the floating ISI tray intercepts clicks if it's not hidden. The runner hides it BEFORE executing actions (not just before the screenshot).

**The cascade failure trap:** If any step fails, `prevSkipped = true`, and the runner re-navigates to the page URL before the next step. This resets the wizard to screen 1. Every subsequent step then fails because it assumes mid-questionnaire state. Fix the earliest failing step — don't debug later steps until the chain is unbroken.

**`a.button.next` appears multiple times in the DOM** — one per wizard screen. Only the active screen's button is visible. `clickBySelector` uses a two-strategy approach:
1. Try `.first()` with 2 s timeout (fast path — works when the element is unique or the first is visible)
2. Fallback to `.filter({ visible: true })` with 10 s timeout (handles wizard UIs with multiple hidden instances)

**Conditional fields:** Some wizard screens show/hide inputs based on earlier selections. Never try to fill a textarea or secondary input unless you've verified it's visible for the chosen path. Example: the Gattex goals screen shows a textarea only when "NotSure" is selected — selecting any other radio hides it. Always pick a path that avoids conditional complexity unless you specifically need to capture that state.

**Last-screen button selector:** The final step of a wizard often replaces "Next" with a different CTA ("View Responses", "See Results", "Review", etc.). Use a multi-selector to cover variations: `"a.button.next, a.button.review, a.button.view-responses"`.

**Discovering the real selectors:** If original selectors fail, run an inline diagnostic script with playwright-core that navigates through each screen and dumps `document.body.innerHTML` at each step. The questionnaire branch matters — different entry paths (Adult vs Pediatric, confirmed SBS vs unsure) show completely different screens and selectors.

**`href=""` anchors + `<base href="/">`:** Some sites use `<a href="">` for wizard buttons. Combined with `<base href="/">`, this resolves to the site root — a full navigation. Playwright's real `.click()` fires this navigation. `dispatchEvent('click')` has `isTrusted: false`, which may be blocked by the site's JS event handlers (no questionnaire advance + navigation to root). Always use real Playwright `.click()`, and use `hideISI` to prevent the ISI tray from blocking the click target.

**Config example — wizard page:**
```json
{
  "id": "gut-check-questionnaire",
  "label": "Gut Check Questionnaire",
  "path": "/gut-check-questionnaire/",
  "steps": [
    {
      "id": "screen-1-default",
      "enabled": true,
      "captureMode": "element",
      "selector": "section.gut-check-questionnaire",
      "hideISI": true,
      "includeMobile": false
    },
    {
      "id": "screen-2-adult-sbs",
      "enabled": true,
      "captureMode": "element",
      "selector": "section.gut-check-questionnaire",
      "hideISI": true,
      "includeMobile": false,
      "actions": [
        { "type": "click", "selector": "a.button.begin-questionnaire" },
        { "type": "click", "selector": "label.image-input:has(input[value='Adult'])" },
        { "type": "click", "selector": "label:has(#AdultSBS)" }
      ]
    },
    {
      "id": "screen-3-symptoms",
      "enabled": true,
      "captureMode": "element",
      "selector": "section.gut-check-questionnaire",
      "hideISI": true,
      "includeMobile": false,
      "actions": [
        { "type": "click", "selector": "a.button.next" },
        { "type": "click", "selector": "label[for='AdultSymptoms-Malnutrition']" }
      ]
    }
  ]
}
```

**Debugging a failing wizard step:**
1. Check `/tmp/sitesnap-step-fail-<page>-<step>-<ts>.png` — shows what the page looked like when the step errored.
2. Check `/tmp/sitesnap-click-debug-<ts>.png` — saved by `clickBySelector` right before throwing; shows what was on screen at the moment of click failure.
3. Look at the error message: "waiting for locator('X') to be visible" means the element exists but is hidden — either it's the wrong path (conditional field) or the previous step didn't advance the wizard.
4. If the debug screenshot shows the wizard landing page, the cascade failure trap has been triggered — fix the step before this one.

---

## Execution flow (runner.js)

```
run(siteDir, credentials, configOverride?)
  ├── Promise.all([                          ← desktop + mobile run in parallel
  │     runDevice(..., 'desktop'),
  │     runDevice(..., 'mobile')
  │   ])
  │     Each runDevice:
  │     ├── for each page:
  │     │     ├── if external → captureExternal()
  │     │     ├── if includesEntry:
  │     │     │     ├── navigate to path
  │     │     │     ├── pre-entry steps → captureStep()
  │     │     │     ├── executeActions(entryActions)
  │     │     │     ├── injectLogin() — skipped if credentials is null
  │     │     │     ├── post-entry steps → captureStep()
  │     │     │     └── authenticated steps → prepareAndCapture()
  │     │     └── else → navigate + for each step:
  │     │                  re-navigate if prevSkipped or URL drifted
  │     │                  prepareAndCapture() → returns true if skipped
  │     └── browser.close()
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
- `/api/run` → `api-run-background.mjs` directly. Netlify background functions (filenames ending in `-background`) automatically return 202 to the client immediately, then keep running up to 15 min.
- The background function writes initial job state to Blobs as its very first action, before any Playwright work, so the status poll finds the job quickly.
- The client generates the `jobId` with `crypto.randomUUID()` before the POST and starts polling straight away. The status poll tolerates 404 (job not yet written) by retrying silently.

### Browser / Playwright on Netlify
- `core/browser.js` uses `playwright-core` as a **static import** (works everywhere).
- Locally: `playwright-core` auto-discovers the chromium that `npm run setup` installs to `~/.cache/ms-playwright/`. No code change needed for local dev.
- On Netlify: `@sparticuz/chromium` is loaded via dynamic `import()` and supplies `executablePath` + `args`.
- `playwright` (full package) is in `devDependencies` only — used for `npm run setup`, never imported at runtime, never bundled by esbuild.
- `playwright-core` and `@sparticuz/chromium` are both in `external_node_modules` so esbuild doesn't inline them.

### Deploy to Netlify
1. Push repo to GitHub
2. Connect repo in Netlify dashboard — build settings are auto-detected from `netlify.toml`
3. **One-time env var setup** (Netlify does not inject Blobs credentials into background functions automatically):
   - Go to **User settings → Applications → Personal access tokens** → create a token
   - Go to **Site settings → Environment variables** → add `NETLIFY_AUTH_TOKEN` = that token
   - Trigger a redeploy after adding the env var

---

## Netlify pitfalls & hard-won lessons

### `core/package.json` must declare `"type": "module"`
The root `package.json` has `"type": "module"`, but it is NOT deployed to Lambda — only files
listed in `included_files` are. On Lambda, `_bg_impl.mjs` imports `../../core/runner.js`. Node
looks for the nearest `package.json` above `core/runner.js` to decide ESM vs CJS. Without one,
it defaults to CJS, the CJS parser hits `import path from 'path'`, and the function crashes with
`SyntaxError: Cannot use import statement outside a module`.

**Fix:** `core/package.json` contains `{ "type": "module" }`. The `core/**` glob in `included_files`
deploys it automatically. No other changes required.

---

### `included_files` copies files — esbuild does NOT transform them
Files listed in `included_files` (e.g. `core/**`) are deployed as-is to Lambda.
esbuild does NOT inline, transpile, or reformat them. Any assumption about esbuild
converting `core/*.js` from ESM to CJS is wrong. They arrive on Lambda exactly as
they exist in the repo.

Consequence: if `_bg_impl.mjs` imports from `core/runner.js` using a default import
(`import runnerPkg from '...'`) expecting CJS module.exports behaviour, it fails —
because `runner.js` is pure ESM with only named exports. Always use named imports:
```js
import { run } from '../../core/runner.js';   // ✓ correct
import runnerPkg from '../../core/runner.js'; // ✗ wrong — no default export
```

---

### Background function MUST be `.js`, not `.mjs`
The project root has `"type": "module"`. Netlify's background function runtime generates
a CJS loader (`api-run-background.js`) that calls `require()` on the function file.
`require()` cannot load `.mjs` files (always ESM) **or** `.js` files in a `"type": "module"`
project → `ERR_REQUIRE_ESM` at Lambda init, function never runs, job state never written.

**Fix applied:** Add `netlify/functions/package.json` with `{ "type": "commonjs" }` and name
the background function `api-run-background.js`. esbuild then bundles it to a CJS output the
loader can `require()`. All other `.mjs` functions are unaffected (`.mjs` is always ESM
regardless of `package.json`).

### Never put heavy I/O at module level in a background function
Moving `sparticuz.executablePath()` to module-level (outside the handler) to pre-warm
Chromium caused the Lambda container to spend its cold-start doing disk I/O before the
handler could run, delaying or preventing the initial Blobs write. Keep it inside the handler.

### Two Chromium instances on Lambda = OOM crash
`Promise.all([runDevice(desktop), runDevice(mobile)])` launches two Chromium processes
simultaneously. On Lambda this causes memory pressure that kills one browser mid-run —
all its remaining captures are silently skipped and packaging completes with partial results.
**Fix:** Detect `process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME` and run passes
sequentially there. Local stays parallel for speed.

### Mobile full-page captures OOM Lambda — root cause and working fix

**Symptom:** Run stops at `04_nav-open-mobile.png` (last viewport capture before the first
full-page step). All remaining mobile captures skipped with `Target page, context or browser
has been closed` at `page.setViewportSize`. Final log line: `browser closed — skipping remaining pages`.

**Things tried that did NOT fix it:**
1. Cap `safeHeight = Math.min(fullHeight, 15000)` in `capture.js` — crash persisted because
   the page was under 15000px; the cap never triggered.
2. `deviceScaleFactor: 1` on Lambda (was 2) in `browser.js` — crash persisted even at 1x scale.
   The render buffer reduction was real but not the bottleneck.

**Root cause:** `scrollForLazyLoad` is the culprit. It pre-scrolls the full page in 6 jumps to
trigger lazy-loaded images before capturing. On a pharma marketing page this loads hundreds of MB
of decoded image data into Chromium's memory. Then `setViewportSize` to the full document height
tries to repaint all of it at once — the combined memory spike kills the browser.

The crash is at `setViewportSize`, not during scroll, because the images finish decoding
*after* the JS scroll loop returns (they load async). By the time `setViewportSize` fires,
Chromium is already near its limit.

**Working fix (in `capture.js`):**
```
On Lambda:   skip scrollForLazyLoad → page.screenshot({ fullPage: true }) → fallback to viewport
Local:       scrollForLazyLoad → setViewportSize to fullHeight (capped 15000px) → screenshot
```
Playwright's native `fullPage: true` uses CDP's `captureBeyondViewport`, which scrolls and
captures in small chunks rather than holding the entire render tree in one buffer. Without the
pre-scroll filling memory first, this works within Lambda's 3 GB limit.

Detection: `const ON_LAMBDA = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY)`
at module level in `capture.js` (evaluated once at cold-start, not per call).

**Trade-off:** Lazy-loaded images at the bottom of the page may not appear in Lambda captures.
In practice pharma sites load above-the-fold content eagerly; the trade-off is acceptable.

### Add `page.isClosed()` fast-fail after browser crashes
When Chromium dies mid-run every subsequent operation throws "Target page, context or browser
has been closed". Each is caught individually as a [skip], wasting time on 5-6 doomed
navigations. Add `if (page.isClosed()) break` in the authenticated-steps and remaining-pages
loops so the pass ends immediately with one clear log line.

### Status endpoint must ALWAYS return `Content-Type: application/json`
If the endpoint returns a bare `404` (no Content-Type header), the client's `contentType.includes('application/json')` check fails, it enters the non-JSON error path, and after 30 s shows a fatal error overlay. During Lambda cold-start the job hasn't been written yet — return `{ status: 'pending' }` with a 200 instead of a 404. The client keeps polling silently.

### Polling "pending" must have its own timeout
The `status: 'pending'` response keeps the client polling but has no upper bound. If the
background function crashes before writing job state (e.g., bad Blobs credentials), the UI
spins forever. Add a 90-second timeout on the pending state that surfaces a clear error.

### Run folder must not be deleted before thumbnails are served
`runner.js` originally deleted the run folder immediately after zipping. The last screenshot
fires `onProgress`, the Promise.all resolves, zipping + deletion happen — all before the
client's next poll arrives. The final thumbnail (index 18) 404s.
**Fix:** Remove `fs.rmSync(runDir)` from `runner.js`. The Netlify background function cleans up
`/tmp` itself after uploading to Blobs. Locally the folder stays alongside the ZIP.

### No-credentials sites need special handling in the background function
The background function originally bailed with `if (!username || !password) return` before
writing job state. GATTEX (`requiresCredentials: false`) always sends empty strings, so the
function silently exited and the status poll got 404 forever.
**Fix:** Read `metadata.json` inside the background function to decide if credentials are
required, same as the local Express server does.

### `run()` returns a plain string, not `{ zipPath, captureDir }`
The background function was destructuring `const { zipPath, captureDir } = await run(...)`.
`run()` returns a plain string. Both were `undefined`, causing `fs.readFileSync(undefined)`
to throw.

### Site thumbnail images need their own Netlify function
`/site-image/:siteId` only exists on the local Express server. On Netlify, images live inside
`sites/` which is bundled with functions, not served as static files. A dedicated
`api-site-image.mjs` function reads the PNG and returns it `base64`-encoded.
The path parameter from the redirect may not appear in `queryStringParameters` — always fall
back to parsing `event.path.split('/').pop()` (same pattern as `api-status.mjs` uses for jobId).

### Speed knobs for Netlify
- `waitForNetworkIdle` default: 1 500 ms → 1 000 ms (saves ~500 ms per navigation)
- Cookie banner post-click wait: 900 ms → 400 ms (animations are disabled globally)
- Navigation timeout: 30 000 ms → 20 000 ms
- Block pharma/ad networks in `context.route()`: google-analytics, googletagmanager,
  doubleclick, adobe omtrdc, hotjar, segment, newrelic, optimizely, veeva, brightcove,
  coveo, eloqua, marketo, pardot, facebook pixel, linkedin, twitter pixel — these keep
  the network perpetually busy and slow down every `waitForNetworkIdle` call
- Sequential execution saves memory; Chromium warm-starts (~3-5 s) vs cold-starts (~15-30 s)

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
| `netlify/functions/api-sites.mjs` | `GET /api/sites` |
| `netlify/functions/api-config.mjs` | `GET /api/config/:siteId` |
| `netlify/functions/api-run-background.mjs` | `POST /api/run` — background function, 202 immediate, 15-min run |
| `netlify/functions/api-status.mjs` | `GET /api/status/:jobId` |
| `netlify/functions/api-thumbnail.mjs` | `GET /api/thumbnail/:jobId/:index` |
| `netlify/functions/api-download.mjs` | `GET /api/download/:jobId` |
| `netlify.toml` | Build config + function settings + API redirects |
| `sites/<id>/config.json` | Site automation config |
| `sites/<id>/metadata.json` | Display name, `requiresCredentials` flag |
| `sites/<id>/images/<id>.png` | Optional sidebar thumbnail — served via `GET /site-image/:siteId` |
| `sites/<id>/output/` | Run ZIPs stored here (local only) |
