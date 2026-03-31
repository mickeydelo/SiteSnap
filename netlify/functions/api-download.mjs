import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) return { statusCode: 400, body: 'Bad request' };

  const jobsStore = getStore('sitesnap-jobs');
  const job = await jobsStore.get(jobId, { type: 'json' });
  if (!job || job.status !== 'done') return { statusCode: 404, body: 'Not ready' };

  const zipsStore = getStore('sitesnap-zips');
  const buffer = await zipsStore.get(jobId, { type: 'arrayBuffer' });
  if (!buffer) return { statusCode: 404, body: 'ZIP not found' };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sitesnap-${jobId.slice(0, 8)}.zip"`,
    },
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true,
  };
};
