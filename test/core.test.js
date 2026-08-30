import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  countTotalCaptures,
  sanitizeName,
  validateConfig,
} from '../core/runner.js';
import { executeActions } from '../core/actions.js';
import {
  countConfiguredCaptures,
  enforceHostedLimits,
  sanitizeHostedConfig,
} from '../index.js';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG_PATH = path.join(ROOT_DIR, 'sites', 'nuveen', 'config.json');

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

test('Nuveen suite is valid and has stable capture counts', () => {
  const config = readConfig();
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(countTotalCaptures(config), 36);

  config.pages.forEach(page => page.steps.forEach(step => { step.enabled = true; }));
  assert.equal(countTotalCaptures(config), 44);
});

test('capture config rejects unsafe or ambiguous structures', () => {
  const config = readConfig();
  const duplicate = structuredClone(config);
  duplicate.pages[0].steps[1].id = duplicate.pages[0].steps[0].id;
  assert.throws(() => validateConfig(duplicate), /duplicate step id/i);

  const invalidUrl = structuredClone(config);
  invalidUrl.baseUrl = 'file:///etc/passwd';
  assert.throws(() => validateConfig(invalidUrl), /HTTP or HTTPS/);

  const invalidViewport = structuredClone(config);
  invalidViewport.devices.desktop.viewport.width = 100000;
  assert.throws(() => validateConfig(invalidViewport), /320 to 3840/);
});

test('hosted overrides cannot replace checked-in targets or selectors', () => {
  const defaults = readConfig();
  const requested = structuredClone(defaults);
  requested.baseUrl = 'https://example.invalid';
  requested.pages[1].path = '/untrusted';
  requested.pages[1].steps[0].selector = 'body';
  requested.devices.desktop.viewport = { width: 9999, height: 1 };

  const tey = requested.pages[1].steps.find(step => step.id === 'tey-sample');
  tey.actions.find(action => action.selector === '#annual-income').value = '175000';

  const sanitized = sanitizeHostedConfig(defaults, requested);
  assert.equal(sanitized.baseUrl, defaults.baseUrl);
  assert.equal(sanitized.pages[1].path, defaults.pages[1].path);
  assert.equal(sanitized.pages[1].steps[0].selector, defaults.pages[1].steps[0].selector);
  assert.deepEqual(sanitized.devices.desktop.viewport, { width: 1920, height: 320 });
  assert.equal(
    sanitized.pages[1].steps.find(step => step.id === 'tey-sample')
      .actions.find(action => action.selector === '#annual-income').value,
    '175000',
  );
});

test('hosted overrides disable omitted devices and pages', () => {
  const defaults = readConfig();
  const requested = {
    devices: { desktop: structuredClone(defaults.devices.desktop) },
    pages: [structuredClone(defaults.pages[1])],
  };
  requested.pages[0].steps.forEach(step => { step.enabled = step.id === 'performance-medalist-ratings'; });

  const sanitized = sanitizeHostedConfig(defaults, requested);
  assert.equal(sanitized.devices.mobile.enabled, false);
  assert.equal(sanitized.pages[0].enabled, false);
  assert.equal(countConfiguredCaptures(sanitized), 1);
  assert.doesNotThrow(() => enforceHostedLimits(sanitized));
});

test('filenames are deterministic and filesystem-safe', () => {
  assert.equal(sanitizeName('Morningstar Ratings · Class I'), 'morningstar-ratings-class-i');
  assert.equal(sanitizeName('../../'), 'capture');
  assert.equal(sanitizeName('A'.repeat(150)).length, 100);
});

test('native select actions skip waits when the requested option is already selected', async () => {
  let selectCalls = 0;
  let networkWaits = 0;
  let delayCalls = 0;
  const element = {
    waitFor: async () => {},
    evaluate: async (callback, argument) => callback({
      tagName: 'SELECT',
      value: 'I',
      selectedOptions: [{ label: 'I | NHMRX', textContent: 'I | NHMRX' }],
    }, argument),
    selectOption: async () => { selectCalls += 1; },
  };
  const first = () => element;
  const filter = () => ({ first });
  const page = {
    locator: () => ({ filter }),
    waitForLoadState: async () => { networkWaits += 1; },
    waitForTimeout: async () => { delayCalls += 1; },
  };

  await executeActions(page, [{
    type: 'select',
    selector: '#share-class',
    value: 'I | NHMRX',
    settle: 'network-idle',
    delayMs: 500,
  }]);

  assert.equal(selectCalls, 0);
  assert.equal(networkWaits, 0);
  assert.equal(delayCalls, 0);
});
