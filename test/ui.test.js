import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readNdjson } from '../ui/scripts/stream.js';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('UI source uses external styles and scripts', () => {
  for (const page of ['index.html', 'run.html']) {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', page), 'utf8');
    assert.doesNotMatch(html, /<style[\s>]/i);
    assert.doesNotMatch(html, /<script>(.|\n)*<\/script>/i);
    assert.match(html, /rel="stylesheet"/);
    assert.match(html, /<script[^>]+src=/);
  }
  assert.ok(fs.statSync(path.join(ROOT_DIR, 'ui', 'styles', 'run.css')).size > 1000);
  assert.ok(fs.statSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js')).size > 1000);
});

test('hosted capture UI never asks the presenter for a key', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'run.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js'), 'utf8');
  assert.doesNotMatch(script, /window\.prompt|Enter the SiteSnap server capture key/i);
  assert.doesNotMatch(html, /runtime-banner|Hosted capture ready/i);
  assert.doesNotMatch(script, /getElementById\(['"]runtime-(?:banner|title|message)/);
  assert.match(script, /console\.(?:info|warn)/);
  assert.match(script, /health\.captureKey/);
  assert.match(script, /application\/x-ndjson/);
  assert.match(script, /consumeHostedStream/);
  assert.match(script, /\/api\/warmup/);
  assert.match(script, /Opening a clean browser session/);
  assert.match(script, /classList\.add\(['"]indeterminate/);
});

test('maintained styles keep declarations on readable lines', () => {
  for (const stylesheet of ['home.css', 'run.css']) {
    const css = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'styles', stylesheet), 'utf8');
    assert.doesNotMatch(css, /\{[^{}\n]+;?\s*\}/, `${stylesheet} contains a compressed rule`);
  }
});

test('capture controls expose polished keyboard and progress feedback', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'run.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js'), 'utf8');
  assert.match(html, /aria-keyshortcuts="\/"/);
  assert.match(html, /aria-busy="false"/);
  assert.match(html, /class="captures"[^>]+role="list"/);
  assert.match(script, /event\.key === '\/'/);
  assert.match(script, /button\.textContent = 'Capturing…'/);
  assert.match(script, /entry\.filename \|\| 'PNG captured'/);
  assert.match(script, /classList\.add\('modal-open'\)/);
  assert.match(script, /'aria-current': index === state\.activePage \? 'page' : null/);
});

test('hosted progress events are parsed before the response closes', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    '{"type":"start","total":2}\n{"type":"capt',
    'ure","processed":1,"entry":{"label":"Desktop"}}\n',
    '{"type":"complete","result":{"status":"done"}}\n',
  ];
  const response = new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  const events = [];
  const count = await readNdjson(response, event => events.push(event));
  assert.equal(count, 3);
  assert.deepEqual(events.map(event => event.type), ['start', 'capture', 'complete']);
  assert.equal(events[1].entry.label, 'Desktop');
});

test('generated public assets exactly mirror maintained UI source', () => {
  for (const relativePath of [
    'index.html',
    'run.html',
    'styles/home.css',
    'styles/run.css',
    'scripts/home.js',
    'scripts/run.js',
    'scripts/stream.js',
  ]) {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'ui', relativePath));
    const generated = fs.readFileSync(path.join(ROOT_DIR, 'public', relativePath));
    assert.deepEqual(generated, source, `${relativePath} is out of sync`);
  }
});
