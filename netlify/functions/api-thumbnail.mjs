import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const { jobId, index } = event.queryStringParameters ?? {};
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
