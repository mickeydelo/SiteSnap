import assert from 'node:assert/strict';

const origin = (process.env.SITESNAP_BASE_URL || 'https://site-snap-three.vercel.app').replace(/\/$/, '');
const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(30000) });
const health = await healthResponse.json();
assert.equal(healthResponse.status, 200);
assert.equal(health.mode, 'vercel-capture');
assert.equal(health.captureEnabled, true);

const configResponse = await fetch(`${origin}/api/config/nuveen`, { signal: AbortSignal.timeout(30000) });
const config = await configResponse.json();
assert.equal(configResponse.status, 200);
config.devices.desktop.enabled = true;
config.devices.mobile.enabled = false;
for (const page of config.pages) {
  for (const step of page.steps ?? []) step.enabled = step.id === 'performance-medalist-ratings';
  page.enabled = page.steps.some(step => step.enabled);
}

const headers = { 'Content-Type': 'application/json' };
if (health.captureKey) headers.Authorization = `Bearer ${health.captureKey}`;
const startedAt = Date.now();
const runResponse = await fetch(`${origin}/api/run`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ siteId: 'nuveen', config }),
  signal: AbortSignal.timeout(290000),
});
const result = await runResponse.json();
assert.equal(runResponse.status, 200, JSON.stringify(result));
assert.equal(result.status, 'done', JSON.stringify(result));
assert.equal(result.entries.length, 1);
assert.equal(result.failureCount, 0);
assert.ok(result.downloadUrl);

const archiveResponse = await fetch(result.downloadUrl, {
  method: 'HEAD',
  signal: AbortSignal.timeout(30000),
});
assert.equal(archiveResponse.status, 200);
assert.match(archiveResponse.headers.get('content-type') || '', /application\/zip/);

console.log(JSON.stringify({
  check: 'vercel-live-capture',
  status: result.status,
  durationMs: Date.now() - startedAt,
  outputs: result.entries.length,
  archiveBytes: Number(archiveResponse.headers.get('content-length')) || null,
  blobHost: new URL(result.downloadUrl).host,
}));
