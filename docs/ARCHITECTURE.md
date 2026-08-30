# SiteSnap architecture

## Product purpose

SiteSnap turns a declarative capture suite into deterministic PNGs for full pages, responsive viewports, and interactive states that ordinary screenshot tools cannot reproduce reliably. The Nuveen fund page is both the current product target and the reference implementation for future sites.

Accuracy is more important than raw throughput. Speed improvements must preserve clean browser state, explicit waits, exact framing, and truthful failure reporting. Local mode is the canonical demo and pixel-reference environment; Vercel is a convenient hosted execution path.

## Runtime flow

```text
ui/ configuration
       |
       v
POST /api/run -> checked-in site suite -> runner -> one Chromium process
                                                -> isolated device contexts
                                                -> actions + screenshots
                                                -> manifest.json + ZIP
       |                                                  |
       | local                                            | Vercel
       v                                                  v
in-memory job status + thumbnails                  public Vercel Blob URL
retained sites/<id>/output                         ephemeral /tmp cleaned
```

Desktop and mobile never share cookies, storage, or viewport state. Local mode runs both isolated contexts concurrently; Vercel runs them one at a time inside the same Chromium process to avoid competing screenshot commands. All states for a page/device reuse one page load unless a state explicitly requests a reset or a prior state fails.

## Runtime boundaries

| Concern | Local | Vercel |
| --- | --- | --- |
| UI source | Served directly from `ui/` | `ui/` is built to CDN-served `public/` |
| Browser | `playwright` + installed Chromium | `playwright-core` + `@sparticuz/chromium` |
| Progress | Polling, live thumbnails | Streaming NDJSON, exact count, inline thumbnails |
| Device passes | Parallel isolated contexts | Sequential isolated contexts for serverless stability |
| Output | Retained under the site output directory | Ephemeral `/tmp`, then public Blob ZIP |
| Scale | 1× or 2× | 1× |
| Run limit | Configuration/device limits only | 60 outputs and 300 seconds |
| Authorization | Local machine boundary | Optional public bootstrap key; no presenter prompt |

`VERCEL=1` is the only browser-runtime switch. Local behavior must never depend on Blob or Vercel variables.

## Capture engine

- `core/browser.js` selects the runtime and creates isolated contexts. It blocks common analytics/tracker requests, blocks service workers, disables persisted storage, fixes locale/color scheme/reduced motion, and disables transitions and animations.
- `core/actions.js` implements the declarative action vocabulary: click, input, select, checkbox, wait, waitFor, scrollTo, press, and cookie acceptance.
- `core/runner.js` validates configuration, launches one browser, schedules isolated device contexts for the active runtime, isolates failed states, records PNG metadata/checksums, and produces the run manifest.
- `core/capture.js` stabilizes lazy assets and selects the runtime-safe full-page strategy: exact viewport expansion locally and a fixed-width, beyond-viewport clip on Vercel.
- `core/zip.js` packages already-compressed PNGs at low compression for fast completion.

Hosted clients request `application/x-ndjson`. The function flushes a start event before launching Chromium, then streams status, heartbeat, failure, and capture events. Desktop and mobile use sequential isolated contexts so competing screenshot commands cannot terminate a constrained serverless Chromium target. Hosted full-page states capture a fixed-width clip beyond the visible viewport instead of allocating a renderer viewport thousands of pixels tall. Each completed hosted capture includes a JPEG preview cropped to a sharp 264×152 landscape frame through the Chromium DevTools screenshot path; preview work has a hard deadline and cannot block the original PNG. The original PNG remains only in the ZIP. Browser cleanup is also bounded, so a failed renderer cannot leave the stream open until the function deadline. A final event supplies the Blob download URL. JSON remains supported for non-streaming API clients.

The configuration UI calls `POST /api/warmup` once after it becomes interactive. This resolves the local Playwright package or hosted Chromium executable before the user starts a run when the runtime instance is retained. The warmup is best-effort, uses the same hosted authorization check as capture, never launches a browser, and a failed warmup does not prevent a later retry. During navigation, network-idle and ready-selector waits run concurrently; font and configured settling waits still happen afterward to preserve capture fidelity. Native select actions also skip their network and animation waits when the requested option is already selected, which avoids repeatedly reloading identical share-class data.

Step failures do not disappear. A failed state produces a debug viewport where possible, is listed in the manifest/API, and changes the run to `partial`. If a page or context closes unexpectedly, completed states remain in the manifest and every still-pending state receives its own failure record. A run is `done` only when every requested output succeeds.

## Hosted trust boundary

The hosted API never executes selectors, paths, URLs, or arbitrary actions supplied by a browser. `sanitizeHostedConfig()` begins with the checked-in configuration and accepts only:

- enabled/disabled device, page, and step flags;
- bounded viewport sizes;
- supported capture modes for that checked-in step;
- 1×/2× selection, with 2× rejected by hosted limits;
- values for actions explicitly marked `editable`, including allow-listed select options.

The optional `SITESNAP_CAPTURE_KEY` is returned by `/api/health` and applied automatically by the UI because the demo is intentionally frictionless. It is not security when exposed this way. If real access control becomes a requirement, stop returning the key, require authentication, and use a shared rate-limit/queue store before making the deployment public.

## UI build

`ui/` is the only maintained UI source. Styles live in `ui/styles/`; behavior lives in `ui/scripts/`. `npm run build` deletes and recreates generated `public/` from `ui/`. `public/` is ignored by Git so source and deploy artifacts cannot drift.

The UI deliberately uses plain HTML/CSS/JavaScript. This keeps first load, local startup, and Vercel builds extremely small and avoids a client framework for a configuration surface that does not need one. Introduce a bundler only when shared UI modules or multiple complex project editors justify it.

## Adding or changing a capture suite

1. Add `sites/<site-id>/metadata.json`, `config.json`, and an optional preview image.
2. Keep page and step IDs unique and stable; IDs become filenames and preset references.
3. Prefer semantic/native selectors and stable data attributes. Avoid generated IDs unless the control itself has a durable ID.
4. Mark only safe value fields as `editable`; use `options` for finite choices.
5. Give modal states cleanup actions. Use `resetBefore` for states that cannot safely inherit prior page state.
6. Run `npm run check` and `npm run verify:capture`.
7. Inspect PNG framing and `manifest.json`, then run `npm run verify:hosted` after deployment.

## Operational constraints and future work

- Blob archives are public to anyone with their URL and are not automatically expired. Add lifecycle cleanup before high-volume use.
- The in-memory local job map is intentionally single-process. A distributed hosted queue/status system is required for asynchronous multi-user jobs.
- Vercel Hobby functions have a five-minute ceiling. Large hosted presets should stay within the 60-output guard and be validated after selector-heavy changes.
- Nuveen data is live and may differ from reference images by date, rating, and return value. Structure/framing are deterministic; market data is not frozen.
- Before adding many sites, split server concerns into route/service modules and add versioned suite schemas.
