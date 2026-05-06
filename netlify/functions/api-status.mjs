import { jobsStore } from './_blobs.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId
    || event.path?.split('/').filter(Boolean).pop();

  if (!jobId) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'jobId required' }) };
  }

  let job;
  try {
    job = await jobsStore().get(jobId, { type: 'json' });
  } catch {
    // Blobs unavailable — return pending so the client keeps polling
  }

  if (!job) {
    // Background function still cold-starting or Blobs write hasn't landed yet.
    // Return a valid "pending" response so the client keeps polling silently
    // rather than treating the 404 as a fatal error.
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        status:  'pending',
        total:   0,
        entries: [],
        lastLog: 'Waiting for Lambda to start…',
        error:   null,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(job),
  };
};
