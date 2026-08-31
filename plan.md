# Halux product plan

## Purpose

Halux is a local-first studio for making responsive pages and deterministic interactive states fully visible through accurate, repeatable screenshots. Nuveen is the reference suite; the High Yield Municipal Bond Fund page is the priority target.

## Product principles

1. **Accuracy** — capture framing and dimensions match configuration, and the manifest makes output verifiable.
2. **Truthful status** — failed states are never presented as a successful run.
3. **Determinism** — clean contexts, fixed browser settings, disabled motion, explicit actions, and asset settling reduce visual drift.
4. **Speed** — one browser process, parallel device contexts, shared page loads, blocked trackers/media, CDN UI assets, and low-cost ZIP packaging.
5. **Isolation** — device storage never crosses contexts; a failed state reloads cleanly before the next state.
6. **Control** — every state, device, viewport, editable sample value, and supported framing mode remains configurable.
7. **Local-first resilience** — hosted changes cannot make the demo depend on Vercel, Blob, or a network service other than the capture target.

## Current Nuveen coverage

- Homepage cookie notice, clean viewport, and full page.
- Fund-page full-page baseline.
- Share classes I/NHMRX, A/NHMAX, C/NHCCX, and R6/NHMFX.
- Average annual total returns (quarterly/monthly), calendar year returns, Morningstar Medalist Ratings, and Morningstar Ratings.
- Editable Taxable Equivalent Yield sample modal.
- Distributions overview and since-inception history modal.
- Characteristics maturity, top states, sector allocation, credit quality, and optional details modal.
- Literature Fund literature and Prospectuses & reports.

## Current release standard

- Local and Vercel UI/assets load with external CSS/JS and restrictive security headers.
- Local HTTP, configuration validation, hosted sanitization, and authorization modes have automated checks.
- One desktop/mobile live local capture and one hosted Blob capture pass.
- Every archive contains checksummed capture metadata and failure details.
- Zero known production dependency vulnerabilities.
- Developer architecture and demo recovery steps are current.

## Next-version candidates

- Versioned JSON schema and editor validation for third-party capture suites.
- Distributed queue, durable status, cancellation, and per-user authorization for multi-user hosted runs.
- Configurable Blob retention/lifecycle cleanup.
- Visual baseline comparison and pixel-diff reports using manifest checksums.
- Saved UI presets and named capture profiles.
- CI selector canaries for target sites that change frequently.
