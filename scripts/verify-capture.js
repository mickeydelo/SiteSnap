import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.VERCEL;
const { run } = await import('../core/runner.js');

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteDir = path.join(rootDir, 'sites', 'nuveen');
const config = JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitesnap-local-verify-'));
const VERIFY_STEP_IDS = new Set([
  'cookie-notice',
  'clean-viewport',
  'full-page',
  'performance-medalist-ratings',
]);

config.devices.desktop.enabled = true;
config.devices.mobile.enabled = true;
for (const page of config.pages) {
  for (const step of page.steps ?? []) {
    step.enabled = VERIFY_STEP_IDS.has(step.id)
      && (step.id !== 'full-page' || page.id === 'home');
  }
  page.enabled = page.steps.some(step => step.enabled);
}

try {
  const progressEvents = [];
  const result = await run(
    siteDir,
    null,
    config,
    event => { if (event?.type === 'capture') progressEvents.push(event); },
    outputDir,
    null,
    {
      includePreviews: true,
      mobileFirst: true,
      nativeFullPage: true,
      parallelDevices: false,
    },
  );
  assert.equal(result.status, 'done');
  assert.equal(result.manifest.expectedCaptures, 7);
  assert.equal(result.manifest.completedCaptures, 7);
  assert.equal(result.manifest.failedCaptures, 0);
  assert.ok(fs.statSync(result.zipPath).size > 1000);

  const desktop = result.captures.find(capture => (
    capture.device === 'desktop' && capture.stepId === 'performance-medalist-ratings'
  ));
  const mobile = result.captures.find(capture => (
    capture.device === 'mobile' && capture.stepId === 'performance-medalist-ratings'
  ));
  assert.ok(desktop.width >= 1000 && desktop.height >= 300, JSON.stringify(desktop));
  assert.ok(mobile.width >= 320 && mobile.width <= 450 && mobile.height >= 300, JSON.stringify(mobile));
  const fullPage = result.captures.find(capture => (
    capture.device === 'desktop' && capture.stepId === 'full-page'
  ));
  assert.equal(fullPage.width, 1440, JSON.stringify(fullPage));
  assert.ok(fullPage.height > 900, JSON.stringify(fullPage));
  assert.equal(desktop.sha256.length, 64);
  assert.equal(mobile.sha256.length, 64);
  for (const device of ['desktop', 'mobile']) {
    const cookie = result.captures.find(capture => (
      capture.device === device && capture.stepId === 'cookie-notice'
    ));
    const clean = result.captures.find(capture => (
      capture.device === device && capture.stepId === 'clean-viewport'
    ));
    assert.notEqual(cookie.sha256, clean.sha256, `${device} cookie notice was not dismissed`);
  }
  assert.equal(progressEvents.length, 7);
  progressEvents.forEach(event => {
    assert.match(event.thumbnailUrl || '', /^data:image\/jpeg;base64,/);
    assert.deepEqual(readJpegDimensions(event.thumbnailUrl), { width: 264, height: 152 });
  });

  console.log(JSON.stringify({
    check: 'local-live-capture',
    status: result.status,
    durationMs: result.manifest.durationMs,
    previews: progressEvents.length,
    outputs: result.captures.map(({ device, width, height, bytes }) => ({ device, width, height, bytes })),
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

function readJpegDimensions(dataUrl) {
  const encoded = String(dataUrl).split(',')[1] || '';
  const buffer = Buffer.from(encoded, 'base64');
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
