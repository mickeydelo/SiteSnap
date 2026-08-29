# Working Notes — SiteSnap

## Current architecture

- Local server and job state: `index.js`
- Browser/context setup: `core/browser.js`
- Declarative actions: `core/actions.js`
- Page/device orchestration: `core/runner.js`
- Screenshot stabilization: `core/capture.js`
- Nuveen suite: `sites/nuveen/config.json`
- Configuration UI: `ui/run.html`

## Important behavior

- Nuveen’s region/site switcher is bypassed with explicit Individual Investor cookies.
- OneTrust is not pre-dismissed so the cookie-notice capture remains available.
- The fund page runs once per device; share classes, tables, and modals transition in sequence.
- Failed states are isolated. A debug viewport is saved and the next state reloads cleanly.
- Full-page capture expands height without a fixed cap. This avoids native full-page capture including Nuveen’s off-canvas utility drawer.
- Desktop and mobile contexts run in parallel and never share cookies or storage.
- Output is local and credentials are not used.

## Selector strategy

- Prefer native controls (`#myselect`, `#tey-filing-status`, `#annual-income`).
- Scope data tables by their visible `h3` title instead of generated GUID IDs.
- Use Nuveen modal data attributes when available, with visible-text fallbacks.
- Restore the Maturity tab before opening maturity details because other characteristic tabs hide that CTA.

## Quick verification

```bash
npm run check
npm audit --omit=dev
npm start
```

Use `npm run dev` for a visible, slowed browser when a live selector changes.
