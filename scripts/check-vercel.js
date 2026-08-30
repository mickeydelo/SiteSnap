import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VERCEL = '1';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
process.env.SITESNAP_CAPTURE_KEY = 'test-capture-key';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'vercel.json'), 'utf8'));
assert.equal(config.framework, 'express');
assert.equal(config.buildCommand, 'npm run build');
assert.equal(config.functions?.['index.js']?.maxDuration, 300);
assert.match(config.functions?.['index.js']?.includeFiles, /core/);

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
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'vercel-capture');
  assert.equal(health.captureEnabled, true);
  assert.equal(health.captureKeyRequired, false);
  assert.equal(health.captureKey, 'test-capture-key');
  assert.equal(health.version, '1.1.0');
  assert.deepEqual(health.limits, { maxCaptures: 60, maxDeviceScale: 1 });
  assert.equal(
    health.message,
    'Hosted capture · Chromium runs on Vercel and uploads the ZIP to Blob. Local mode remains the reference runtime.',
  );

  const sitesResponse = await fetch(`${origin}/api/sites`);
  const sites = await sitesResponse.json();
  assert.equal(sitesResponse.status, 200);
  assert.ok(sites.some(site => site.id === 'nuveen'));

  const configResponse = await fetch(`${origin}/api/config/nuveen`);
  const nuveen = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.equal(nuveen.baseUrl, 'https://www.nuveen.com');

  const runResponse = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: 'nuveen' }),
  });
  const runResult = await runResponse.json();
  assert.equal(runResponse.status, 401);
  assert.equal(runResult.code, 'CAPTURE_KEY_REQUIRED');

  nuveen.pages.forEach(page => page.steps.forEach(step => { step.enabled = false; }));
  const emptyRunResponse = await fetch(`${origin}/api/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-capture-key',
    },
    body: JSON.stringify({ siteId: 'nuveen', config: nuveen }),
  });
  const emptyRunResult = await emptyRunResponse.json();
  assert.equal(emptyRunResponse.status, 400);
  assert.equal(emptyRunResult.code, 'HOSTED_LIMIT');

  const pageResponse = await fetch(`${origin}/run.html?site=nuveen`);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /styles\/run\.css/);
  assert.match(page, /scripts\/run\.js/);

  const stylesheetResponse = await fetch(`${origin}/styles/run.css`);
  assert.equal(stylesheetResponse.status, 200);
  assert.match(stylesheetResponse.headers.get('content-type') || '', /text\/css/);

  const scriptResponse = await fetch(`${origin}/scripts/run.js`);
  assert.equal(scriptResponse.status, 200);
  const script = await scriptResponse.text();
  assert.doesNotMatch(script, /window\.prompt/);

  console.log('Vercel hosted-capture smoke check passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
