import assert from 'node:assert/strict';
import { readNdjson } from '../ui/scripts/stream.js';

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
config.devices.mobile.enabled = true;
const VERIFY_STEP_IDS = new Set(['cookie-notice', 'clean-viewport', 'full-page']);
for (const page of config.pages) {
  for (const step of page.steps ?? []) {
    step.enabled = page.id === 'home' && VERIFY_STEP_IDS.has(step.id);
  }
  page.enabled = page.steps.some(step => step.enabled);
}
const expectedOutputs = 5;

const headers = { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' };
if (health.captureKey) headers.Authorization = `Bearer ${health.captureKey}`;
const startedAt = Date.now();
const runResponse = await fetch(`${origin}/api/run`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ siteId: 'nuveen', config }),
  signal: AbortSignal.timeout(290000),
});
assert.equal(runResponse.status, 200);
assert.match(runResponse.headers.get('content-type') || '', /application\/x-ndjson/);
const responseMs = Date.now() - startedAt;
const events = [];
await readNdjson(runResponse, event => events.push({ ...event, receivedAtMs: Date.now() - startedAt }));
const startEvent = events.find(event => event.type === 'start');
const captureEvents = events.filter(event => event.type === 'capture');
const captureEvent = captureEvents[0];
const completeEvent = events.find(event => event.type === 'complete');
assert.ok(startEvent, JSON.stringify(events));
assert.ok(captureEvent, JSON.stringify(events));
assert.ok(completeEvent, JSON.stringify(events));
assert.equal(startEvent.total, expectedOutputs);
assert.equal(captureEvent.processed, 1);
assert.equal(captureEvents.length, expectedOutputs, JSON.stringify(events));
captureEvents.forEach(event => {
  assert.match(event.entry.thumbnailUrl || '', /^data:image\/jpeg;base64,/);
  assert.deepEqual(readJpegDimensions(event.entry.thumbnailUrl), { width: 264, height: 152 });
});
const result = completeEvent.result;
assert.equal(result.status, 'done', JSON.stringify(result));
assert.equal(result.entries.length, expectedOutputs);
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
  responseMs,
  firstCaptureMs: captureEvent.receivedAtMs,
  outputs: result.entries.length,
  archiveBytes: Number(archiveResponse.headers.get('content-length')) || null,
  blobHost: new URL(result.downloadUrl).host,
}));

function readJpegDimensions(dataUrl) {
  const buffer = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions were not found');
}
