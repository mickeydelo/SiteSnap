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
  assert.equal(health.mode, 'vercel-capture');
  assert.equal(health.captureEnabled, true);
  assert.equal(health.captureKeyRequired, false);
  assert.equal(health.captureKey, null);
  assert.match(health.message, /Hosted capture/);

  const config = await fetch(`${origin}/api/config/nuveen`).then(response => response.json());
  config.pages.forEach(page => page.steps.forEach(step => { step.enabled = false; }));
  const runResponse = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: 'nuveen', config }),
  });
  const result = await runResponse.json();
  assert.equal(runResponse.status, 400);
  assert.equal(result.code, 'HOSTED_LIMIT');

  console.log('Vercel public-access smoke check passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
