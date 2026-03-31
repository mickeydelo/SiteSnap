import { screenshotsStore } from './_blobs.mjs';

export const handler = async (event) => {
  const segments = event.path?.split('/').filter(Boolean) ?? [];
  const qs       = event.queryStringParameters ?? {};

  const jobId = qs.jobId || segments[segments.length - 2];
  const index = qs.index ?? segments[segments.length - 1];

  if (!jobId || index == null) return { statusCode: 400, body: 'Bad request' };

  const buffer = await screenshotsStore().get(`${jobId}/${index}`, { type: 'arrayBuffer' });
  if (!buffer) return { statusCode: 404, body: 'Not found' };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=600',
    },
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true,
  };
};
