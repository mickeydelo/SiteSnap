import { jobsStore } from './_blobs.mjs';

export const handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId
    || event.path?.split('/').filter(Boolean).pop();

  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };
  }

  const job = await jobsStore().get(jobId, { type: 'json' });

  if (!job) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Job not found.' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  };
};
