# Halux

Halux is a local-first instrument for making every reviewable webpage state visible in a deterministic, presentation-grade archive. It reveals what is already there—desktop, mobile, consent, data, and interactive states—without inventing or omitting anything. The checked-in suite targets Nuveen, with the High Yield Municipal Bond Fund page as the priority.

## Run locally

Prerequisite: Node.js 22.

```bash
npm run setup
npm start
```

`npm run setup` installs dependencies and the matching local Chromium build. `npm start` opens `http://localhost:3000` (or the next free port). Local mode is the reference runtime: it supports live thumbnails, retained output, 1×/2× captures, and unrestricted run sizes.

Use `npm run dev` to run Chromium visibly with slowed interactions while debugging selectors.

## Capture workflow

1. Choose **Nuveen**.
2. Select Recommended, Essential only, All states, or configure individual states.
3. Enable desktop and/or mobile and adjust viewport dimensions.
4. Choose viewport, full-page, or exact element framing where supported.
5. Capture and download the ZIP.

Every archive contains device folders plus `manifest.json`. The manifest records the runtime, browser version, timing, requested/completed counts, exact PNG dimensions, byte sizes, SHA-256 checksums, and any failed states. Partial runs are clearly identified and include debug screenshots.

## Verification commands

```bash
npm run check
npm audit --omit=dev
npm run verify:capture
npm run verify:hosted
```

- `npm run check` builds the UI, runs unit tests, checks local HTTP/assets/security behavior, and validates both hosted configuration modes without launching Chromium.
- `npm run verify:capture` performs a disposable desktop-and-mobile capture against live Nuveen using local Chromium.
- `npm run verify:hosted` performs one live Vercel capture and verifies the Blob ZIP. Override the deployment with `SITESNAP_BASE_URL=https://...`.

## Vercel deployment

The repository is configured for the Express preset. Vercel runs `npm run build`, which copies the maintained `ui/` source to generated `public/` assets served by Vercel's CDN. The Express application becomes one Fluid Compute function with a 300-second limit.

Required project setup:

1. Connect a **public Vercel Blob** store. Vercel supplies `BLOB_READ_WRITE_TOKEN`.
2. Keep Fluid Compute enabled.
3. Deploy from the repository root with the Express preset.

`SITESNAP_CAPTURE_KEY` is optional. When present, the server still validates it, but the hosted UI obtains and sends it automatically so the presenter never sees a prompt. When absent, hosted capture is open. This is an intentional demo convenience, not an access-control boundary.

Hosted runs support up to 60 outputs at 1× and upload the completed archive to a unique public Blob URL. The capture response streams status, completed/total counts, and compact preview thumbnails to the open tab while Chromium is running. Local mode remains independent of Vercel and Blob configuration.

The configuration screen starts a best-effort browser-runtime warmup in the background. When capture begins, the progress panel immediately shows an indeterminate preparation state, then switches to exact counts as soon as the first state succeeds or fails.

## Source layout

- `index.js` — Express API, local jobs, hosted execution, sanitization, Blob upload
- `core/` — browser lifecycle, actions, orchestration, screenshots, manifests, ZIP creation
- `ui/` — maintained HTML, CSS, and JavaScript source
- `scripts/build-ui.js` — deterministic UI-to-`public/` build for Vercel's CDN
- `sites/nuveen/` — metadata and declarative capture suite
- `test/` — configuration, security-boundary, and UI-contract tests
- `docs/` — architecture and demo runbook

See [Architecture](docs/ARCHITECTURE.md) and [Demo runbook](docs/DEMO_RUNBOOK.md) before extending or presenting the app.
