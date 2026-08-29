import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
delete process.env.SITESNAP_CAPTURE_KEY;

const { default: app } = await import('../index.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

try {
  const healthResponse = await fetch(`${origin}/api/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.mode, 'vercel-setup');
  assert.equal(health.captureEnabled, false);
  assert.equal(health.captureKeyRequired, false);
  assert.match(health.message, /SITESNAP_CAPTURE_KEY/);

  const runResponse = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: 'nuveen' }),
  });
  const result = await runResponse.json();
  assert.equal(runResponse.status, 503);
  assert.equal(result.code, 'HOSTED_CAPTURE_KEY_REQUIRED');

  console.log('Vercel safe-setup smoke check passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
