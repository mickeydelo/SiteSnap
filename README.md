# SiteSnap

Local screenshot studio configured for Nuveen, with the High Yield Municipal Bond Fund page as the primary capture target.

## Run locally

```bash
npm run setup
npm start
```

`npm run setup` installs dependencies and the matching Chromium build. `npm start` opens the studio at `http://localhost:3000` (or the next free port).

Use `npm run dev` to run Chromium visibly with slowed interactions for selector debugging.

## Capture workflow

- Choose **Nuveen** and configure the recommended, essential, or all-states preset.
- Enable desktop and/or mobile, adjust viewport dimensions, and choose 1× or 2× output.
- Toggle individual states such as NHMAX/NHCCX/NHMFX, performance periods, TEY sample data, distribution history, and characteristic views.
- Change any state between viewport, full-page, or element capture when the target supports it.
- Download the completed ZIP. Runs are also retained under `sites/nuveen/output/` for local review.

Run `npm run check` for syntax validation.
