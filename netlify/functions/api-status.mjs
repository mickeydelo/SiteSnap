import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };
  }

  const store = getStore('sitesnap-jobs');
  const job   = await store.get(jobId, { type: 'json' });

  if (!job) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Job not found.' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  };
};
