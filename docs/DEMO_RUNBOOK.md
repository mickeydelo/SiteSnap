# Demo runbook

## Before the presentation

Run these while connected to the network you will use:

```bash
npm run setup
npm run check
npm audit --omit=dev
npm run verify:capture
npm run verify:hosted
```

Expected results:

- all unit, UI, local HTTP, and hosted smoke checks pass;
- dependency audit reports zero vulnerabilities;
- the local verifier returns `status: done` with one desktop and one mobile output;
- the hosted verifier returns `status: done`, one output, and a Vercel Blob host;
- `git status -sb` is clean and `main` matches `origin/main`.

## Local demo — preferred

```bash
npm start
```

The app opens at `http://localhost:3000`, or the next available port. Recommended presentation flow:

1. Choose Nuveen.
2. Show the desktop/mobile controls and capture-mode selector.
3. Use **Essential only** for a concise live run, or select one Performance state for the fastest proof.
4. Demonstrate the Performance, Characteristics, and Literature groups and the editable TEY values.
5. Start Capture. Local thumbnails appear as outputs complete.
6. Download the ZIP and show `manifest.json` alongside the PNGs.

Use **Recommended** or **All states** when completeness matters more than demo time. The app prevents concurrent local runs so a second tab cannot exhaust the machine during a presentation.

## Hosted demo

Open `https://site-snap-three.vercel.app`. There is no capture-key prompt. The UI loads any configured key automatically.

Hosted mode immediately shows the exact output count, current Chromium phase, and a thumbnail as each screenshot completes. Keep the tab open while the streamed request runs. On completion, download the Blob ZIP. For a fast demo, use one desktop Performance state; a cold hosted run includes Chromium startup and the live Nuveen page load.

## What can legitimately change

Nuveen values are live. Effective dates, ratings, returns, distributions, and labels may differ from prior reference screenshots. The acceptance criteria are:

- the correct tab/state is active;
- headings, tabs, content, and relevant disclosures are framed as configured;
- viewport/full-page dimensions match the manifest;
- the run reports no failed states.

## Recovery

- Hosted problem: switch to the already-tested local app. Local mode does not depend on Vercel or Blob.
- Selector failure: download the diagnostic ZIP, inspect the debug PNG and manifest, then use `npm run dev` to update the checked-in selector.
- Port in use: `npm start` automatically tries the next port.
- Nuveen network issue: do not retry rapidly. Wait briefly, then run one desktop state to distinguish upstream availability from a suite issue.
- Hosted timeout: reduce the run to Essential only or one device. Use local mode for the complete suite.

Do not change dependencies, selectors, Vercel settings, or environment variables immediately before the demo without rerunning both live verifiers.
