# SiteSnap Product Plan

## Purpose

SiteSnap is a local-first screenshot studio for capturing complete responsive pages and deterministic interactive states. The current capture suite is dedicated to Nuveen, with the Nuveen High Yield Municipal Bond Fund page as the priority target.

## Product principles

1. Accuracy: output dimensions match the configured viewport and full-page images include the complete document.
2. Determinism: every browser pass starts without persisted storage, animations are disabled, fonts and lazy content settle before capture, and configured states use explicit selectors.
3. Speed: desktop and mobile run in parallel, tracker/media requests are blocked, and all fund-page states share one page load per device.
4. Isolation: a failed optional state produces a debug image and the next state reloads cleanly instead of ending the run.
5. Control: every state can be enabled independently and can use viewport, full-page, or element capture.

## Nuveen capture coverage

- Homepage cookie notice, clean viewport, and full page.
- Fund-page full-page baseline.
- Hero share classes: I/NHMRX, A/NHMAX, C/NHCCX, and R6/NHMFX.
- Average annual total returns: quarterly and monthly.
- Taxable Equivalent Yield modal with editable filing status and annual income.
- Distributions overview and Since inception distribution-history modal.
- Characteristics: maturity breakdown, top states, sector allocation, credit quality, and maturity-details modal.

## Runtime

- Express serves the local UI and API.
- Playwright drives a fresh Chromium context for each enabled device.
- The UI sends an in-memory config override to `POST /api/run`.
- Progress and thumbnails are available while the run is active.
- Successful runs are retained under `sites/nuveen/output/` and packaged as ZIP files.

Cloud/serverless deployment is intentionally out of scope.

## Validation expectations

- `npm run check` passes.
- `npm audit --omit=dev` reports zero known vulnerabilities.
- The local health, site, config, run, status, thumbnail, and download routes return expected responses.
- At least one desktop and one mobile live pass validates the dynamic Nuveen states.
- Full-page output width equals the selected viewport width and includes the footer.
