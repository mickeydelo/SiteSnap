import { getStore } from '@netlify/blobs';

/**
 * Regular (fast) function — validates the request, writes the initial job
 * state to Blobs so polling can start immediately, then kicks off the
 * background worker and returns 200 right away.
 */
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { jobId, siteId, username, password } = body;
  if (!jobId || !siteId || !username || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'jobId, siteId, username, and password are required.' }),
    };
  }

  // Write initial state NOW so the status poll finds the job immediately.
  const store = getStore('sitesnap-jobs');
  await store.setJSON(jobId, {
    status:  'running',
    total:   0,
    entries: [],
    lastLog: 'Starting…',
    error:   null,
  });

  // Fire-and-forget: trigger the background worker.
  // The HTTP request is sent before we return, so Netlify's background
  // function runtime receives it even though we don't await the response.
  const siteUrl = process.env.URL || 'http://localhost:3000';
  fetch(`${siteUrl}/.netlify/functions/api-run-background`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    event.body,
  }).catch(err => console.error('[api-run] Background trigger failed:', err));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  };
};
