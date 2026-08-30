# Working notes — SiteSnap

Read `docs/ARCHITECTURE.md` before changing runtime boundaries or capture semantics. Read `docs/DEMO_RUNBOOK.md` before a presentation.

## Non-negotiable invariants

- Local mode is the canonical runtime and must pass after every hosted change.
- Vercel configuration cannot override checked-in URLs, paths, selectors, or action types.
- A run is `done` only when every requested screenshot succeeds. Preserve `partial` results, debug images, and the manifest.
- Desktop and mobile always use isolated browser state. Local mode shares one Chromium process; hosted mode uses a fresh bounded process per device because its serverless Chromium cannot safely reuse contexts after capture work.
- Do not pre-dismiss OneTrust globally; the homepage cookie-notice state depends on a clean context.
- Keep `ui/` as source. Never edit generated `public/`; run `npm run build`.
- Keep styles in CSS files and behavior in JavaScript files. The zero-build client is intentional.
- Hosted output is 1× and Blob-backed. Local supports 1×/2×, thumbnails, and retained archives.
- Hosted progress uses NDJSON events and compact inline previews; retain the JSON response fallback for API clients.
- The hosted key is intentionally bootstrapped to the UI with no prompt. Treat it as demo convenience, not security.

## Nuveen selector strategy

- Use native controls such as `#myselect`, `#tey-filing-status`, and `#annual-income`.
- Scope data tables by visible headings rather than generated GUIDs.
- Prefer modal data attributes with visible-text fallbacks.
- Performance, Characteristics, and Literature element captures target the whole tabbed product section, not only the active tab header.
- Restore the relevant tab before opening a details modal when other tabs hide its trigger.

## Release gate

```bash
npm run check
npm audit --omit=dev
npm run verify:capture
npm run verify:hosted
```

Then inspect Vercel runtime logs, verify Blob download, confirm `git status -sb` is clean, and ensure the milestone commit is pushed.
