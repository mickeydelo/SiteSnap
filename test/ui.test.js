import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('UI source uses external styles and scripts', () => {
  for (const page of ['index.html', 'run.html']) {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', page), 'utf8');
    assert.doesNotMatch(html, /<style[\s>]/i);
    assert.doesNotMatch(html, /<script>(.|\n)*<\/script>/i);
    assert.match(html, /rel="stylesheet"/);
    assert.match(html, /<script src=/);
  }
  assert.ok(fs.statSync(path.join(ROOT_DIR, 'ui', 'styles', 'run.css')).size > 1000);
  assert.ok(fs.statSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js')).size > 1000);
});

test('hosted capture UI never asks the presenter for a key', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'scripts', 'run.js'), 'utf8');
  assert.doesNotMatch(script, /window\.prompt|Enter the SiteSnap server capture key/i);
  assert.match(script, /health\.captureKey/);
});

test('generated public assets exactly mirror maintained UI source', () => {
  for (const relativePath of [
    'index.html',
    'run.html',
    'styles/home.css',
    'styles/run.css',
    'scripts/home.js',
    'scripts/run.js',
  ]) {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'ui', relativePath));
    const generated = fs.readFileSync(path.join(ROOT_DIR, 'public', relativePath));
    assert.deepEqual(generated, source, `${relativePath} is out of sync`);
  }
});
