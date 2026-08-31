import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readNdjson } from '../ui/scripts/stream.js';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UI_DIR = path.join(ROOT_DIR, 'ui');

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  }).sort();
}

test('UI source uses external styles and scripts', () => {
  for (const page of ['index.html', 'run.html']) {
    const html = fs.readFileSync(path.join(UI_DIR, page), 'utf8');
    assert.doesNotMatch(html, /<style[\s>]/i);
    assert.doesNotMatch(html, /<script>(.|\n)*<\/script>/i);
    assert.match(html, /rel="stylesheet" href="\/styles\/index\.css"/);
    assert.match(html, /<script[^>]+src=/);
    assert.match(html, /Halux/);
    assert.doesNotMatch(html, /SiteSnap/);
  }
  assert.ok(fs.statSync(path.join(UI_DIR, 'styles', 'index.css')).size > 1000);
  assert.ok(fs.statSync(path.join(UI_DIR, 'scripts', 'run.js')).size > 1000);
});

test('Halux brand mark is a transparent four-bar SVG', () => {
  const logo = fs.readFileSync(path.join(UI_DIR, 'assets', 'halux-prism.svg'), 'utf8');
  assert.match(logo, /<svg[^>]+viewBox="0 0 88 48"/);
  assert.equal((logo.match(/<path\b/g) || []).length, 4);
  assert.doesNotMatch(logo, /<rect\b|<image\b/);
});

test('hosted capture UI never asks the presenter for a key', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'run.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js'), 'utf8');
  assert.doesNotMatch(script, /window\.prompt|Enter the Halux server capture key/i);
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

test('maintained styles stay readable and follow the layered module contract', () => {
  const stylesDirectory = path.join(UI_DIR, 'styles');
  const stylesheets = listFiles(stylesDirectory).filter(file => file.endsWith('.css'));
  const entrypoint = fs.readFileSync(path.join(stylesDirectory, 'index.css'), 'utf8');

  assert.match(entrypoint, /^@layer settings, base, layout, components, utilities, overrides;/);
  assert.doesNotMatch(entrypoint, /responsive\.css/);

  let lastLayer = -1;
  const importedStylesheets = [];
  for (const match of entrypoint.matchAll(/@import url\("\.\/((\d{2})-[^"]+)"\) layer\(([^)]+)\);/g)) {
    const layer = ['settings', 'base', 'layout', 'components', 'utilities', 'overrides'].indexOf(match[3]);
    assert.ok(layer >= lastLayer, `${match[0]} is imported outside layer order`);
    lastLayer = layer;
    importedStylesheets.push(match[1]);
  }

  assert.deepEqual(importedStylesheets.sort(), stylesheets.filter(file => file !== 'index.css').sort(), 'stylesheet imports are incomplete');

  for (const stylesheet of stylesheets) {
    const css = fs.readFileSync(path.join(stylesDirectory, stylesheet), 'utf8');
    assert.doesNotMatch(css, /\{[^{}\n]+;?\s*\}/, `${stylesheet} contains a compressed rule`);
    assert.doesNotMatch(css, /!important/, `${stylesheet} uses !important`);
  }

  for (const stylesheet of stylesheets.filter(file => file.startsWith('01-settings/'))) {
    const css = fs.readFileSync(path.join(stylesDirectory, stylesheet), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((css.match(/\{/g) || []).length, 1, `${stylesheet} must contain one variable scope`);
    assert.equal((css.match(/:root\s*\{/g) || []).length, 1, `${stylesheet} must only use :root`);
    for (const line of css.split('\n').map(value => value.trim()).filter(Boolean)) {
      assert.ok(line === ':root {' || line === '}' || line.startsWith('--'), `${stylesheet} emits non-variable CSS: ${line}`);
    }
  }

  for (const stylesheet of stylesheets.filter(file => file.startsWith('05-utilities/'))) {
    const css = fs.readFileSync(path.join(stylesDirectory, stylesheet), 'utf8');
    for (const rule of css.matchAll(/[^{}]+\{([^{}]+)\}/g)) {
      assert.equal((rule[1].match(/;/g) || []).length, 1, `${stylesheet} utility has more than one declaration`);
    }
  }

  for (const stylesheet of stylesheets.filter(file => file.startsWith('04-components/'))) {
    const component = path.basename(stylesheet, '.css').replace(/^_/, '');
    const css = fs.readFileSync(path.join(stylesDirectory, stylesheet), 'utf8');
    assert.match(css, new RegExp(`\\.${component}(?:\\s|\\{|,|:|\\.)`), `${stylesheet} does not own .${component}`);
  }
});

test('capture controls expose polished keyboard and progress feedback', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'run.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js'), 'utf8');
  assert.match(html, /aria-keyshortcuts="\/"/);
  assert.match(html, /aria-busy="false"/);
  assert.match(html, /class="capture-list"[^>]+role="list"/);
  assert.match(script, /event\.key === '\/'/);
  assert.match(script, /button\.textContent = 'Capturing…'/);
  assert.match(script, /entry\.filename \|\| 'PNG captured'/);
  assert.match(script, /classList\.add\('has-open-modal'\)/);
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
  const sourceFiles = listFiles(UI_DIR);
  const generatedFiles = listFiles(path.join(ROOT_DIR, 'public'));
  assert.deepEqual(generatedFiles, sourceFiles, 'public file tree is out of sync');

  for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(path.join(UI_DIR, relativePath));
    const generated = fs.readFileSync(path.join(ROOT_DIR, 'public', relativePath));
    assert.deepEqual(generated, source, `${relativePath} is out of sync`);
  }
});
