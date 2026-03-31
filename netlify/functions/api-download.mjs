import { jobsStore, zipsStore } from './_blobs.mjs';

// v2 function format — returns a native Response so the ZIP streams directly
// from Netlify Blobs to the browser without hitting the 6 MB Lambda payload limit.
export default async (req) => {
  const url      = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const jobId    = segments[segments.length - 1];

  if (!jobId) return new Response('Bad request', { status: 400 });

  const job = await jobsStore().get(jobId, { type: 'json' });
  if (!job || job.status !== 'done') {
    return new Response('Not ready', { status: 404 });
  }

  const stream = await zipsStore().get(jobId, { type: 'stream' });
  if (!stream) return new Response('ZIP not found', { status: 404 });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sitesnap-${jobId.slice(0, 8)}.zip"`,
    },
  });
};

// v2 path config — Netlify registers this route directly, no redirect needed.
export const config = { path: '/api/download/:jobId' };
