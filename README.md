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

## Run captures on Vercel

The Vercel deployment can run the same capture configuration with a server-compatible Chromium build. Local mode remains the reference workflow and is unchanged; hosted mode is useful when a capture needs to run away from the demo computer.

The repository includes `vercel.json`. In the Vercel import screen use:

- Application preset: **Express**
- Root directory: `./`
- Build and output settings: leave the detected defaults
- Function duration: supplied by `vercel.json` as 300 seconds

After importing the project:

1. Create a **public Vercel Blob** store and connect it to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.
2. Recommended: add `SITESNAP_CAPTURE_KEY` as a Production and Preview environment variable. The studio asks for this key before a hosted run so public visitors cannot spend capture resources.
3. Confirm Fluid Compute is enabled for the project, then redeploy.

Hosted runs are synchronous, support up to 60 screenshots at 1×, and require the browser tab to remain open. The completed ZIP is uploaded directly to a unique public Blob URL because capture archives can exceed Vercel's function-response limit. Review or remove old archives from the Blob store when they are no longer needed.

If Blob is not connected, the hosted UI stays available for configuration and shows a setup-required banner instead of a capture button.

Then select **Deploy**. `npm start` remains the primary local application and continues to support live thumbnails, local ZIP retention, 2× output, and unrestricted local runs.

Run `npm run check:vercel` to smoke-test hosted runtime detection, configuration delivery, and capture-key protection without launching Chromium.
