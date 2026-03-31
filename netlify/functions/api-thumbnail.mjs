import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  // Path: /api/thumbnail/<jobId>/<index>
  const qs       = event.queryStringParameters ?? {};
  const segments = event.path?.split('/').filter(Boolean) ?? [];

  const jobId = qs.jobId || segments[segments.length - 2];
  const index = qs.index ?? segments[segments.length - 1];

  if (!jobId || index == null) return { statusCode: 400, body: 'Bad request' };

  const store  = getStore('sitesnap-screenshots');
  const buffer = await store.get(`${jobId}/${index}`, { type: 'arrayBuffer' });

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
