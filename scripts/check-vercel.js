import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VERCEL = '1';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'vercel.json'), 'utf8'));
assert.equal(config.framework, 'express');
assert.equal(config.functions?.['index.js']?.maxDuration, 10);

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
  assert.deepEqual(health, {
    ok: true,
    mode: 'vercel-preview',
    captureEnabled: false,
  });

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
  assert.equal(runResponse.status, 503);
  assert.equal(runResult.code, 'LOCAL_CAPTURE_ONLY');

  const pageResponse = await fetch(`${origin}/run.html?site=nuveen`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Hosted preview/);

  console.log('Vercel preview smoke check passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
