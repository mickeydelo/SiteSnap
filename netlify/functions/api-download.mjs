import { jobsStore, zipsStore } from './_blobs.mjs';

export default async (req) => {
  const url      = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const jobId    = segments[segments.length - 1];

  if (!jobId) return new Response('Bad request', { status: 400 });

  const job = await jobsStore().get(jobId, { type: 'json' });
  if (!job || job.status !== 'done') {
    return new Response('Not ready', { status: 404 });
  }

  // Use arrayBuffer — more reliable than stream when Blobs uses explicit credentials.
  // The v2 function Response handles large buffers without the 6 MB Lambda limit.
  const buffer = await zipsStore().get(jobId, { type: 'arrayBuffer' });
  if (!buffer) return new Response('ZIP not found', { status: 404 });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sitesnap-${jobId.slice(0, 8)}.zip"`,
      'Content-Length': String(buffer.byteLength),
    },
  });
};

export const config = { path: '/api/download/:jobId' };
