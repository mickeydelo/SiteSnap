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

config.devices.desktop.enabled = true;
config.devices.mobile.enabled = true;
for (const page of config.pages) {
  for (const step of page.steps ?? []) step.enabled = step.id === 'performance-medalist-ratings';
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
    { includePreviews: true },
  );
  assert.equal(result.status, 'done');
  assert.equal(result.manifest.expectedCaptures, 2);
  assert.equal(result.manifest.completedCaptures, 2);
  assert.equal(result.manifest.failedCaptures, 0);
  assert.ok(fs.statSync(result.zipPath).size > 1000);

  const desktop = result.captures.find(capture => capture.device === 'desktop');
  const mobile = result.captures.find(capture => capture.device === 'mobile');
  assert.ok(desktop.width >= 1000 && desktop.height >= 300, JSON.stringify(desktop));
  assert.ok(mobile.width >= 320 && mobile.width <= 450 && mobile.height >= 300, JSON.stringify(mobile));
  assert.equal(desktop.sha256.length, 64);
  assert.equal(mobile.sha256.length, 64);
  assert.equal(progressEvents.length, 2);
  progressEvents.forEach(event => assert.match(event.thumbnailUrl || '', /^data:image\/jpeg;base64,/));

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
