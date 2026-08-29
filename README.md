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
- Toggle individual states such as NHMAX/NHCCX/NHMFX, every performance tab (including quarterly/monthly average returns), TEY sample data, distribution history, and characteristic views.
- Change any state between viewport, full-page, or element capture when the target supports it.
- Download the completed ZIP. Runs are also retained under `sites/nuveen/output/` for local review.

Run `npm run check` for syntax validation.

## Deploy the preview to Vercel

The Vercel deployment is intentionally a fast configuration preview. It serves the complete Nuveen UI and all toggles, but keeps Chromium capture execution local so screenshot accuracy, job state, and ZIP output never depend on ephemeral serverless storage.

The repository includes `vercel.json`; no environment variables are required. In the Vercel import screen use:

- Application preset: **Express**
- Root directory: `./`
- Build and output settings: leave the detected defaults
- Environment variables: none

Then select **Deploy**. `npm start` remains the primary full application and is unchanged from the local workflow above.

Run `npm run check:vercel` to smoke-test the hosted-preview API locally without launching Chromium.
