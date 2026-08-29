import path from 'path';
import fs from 'fs';
import { launchContext, DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from './browser.js';
import { executeActions } from './actions.js';
import { captureScreenshot } from './capture.js';
import { waitForCondition, waitForNetworkIdle, firstVisible } from './utils.js';
import { zipDirectory } from './zip.js';

const DEFAULT_DEVICES = {
  desktop: { enabled: true, viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 },
  mobile:  { enabled: true, viewport: MOBILE_VIEWPORT, deviceScaleFactor: 1 },
};

class Sequence {
  constructor() { this.number = 1; }
  next(name) {
    const prefix = String(this.number++).padStart(2, '0');
    return `${prefix}_${sanitizeName(name)}.png`;
  }
}

/** Run all enabled capture states and return the absolute ZIP path. */
export async function run(
  siteDir,
  credentials,
  configOverride = null,
  onProgress = null,
  outputBaseDir = null,
  _unusedExecutablePath = null,
) {
  const config = configOverride
    ?? JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));
  validateConfig(config);

  const log = async message => {
    if (typeof message === 'string') console.log(message);
    await onProgress?.(message);
  };

  const devices = enabledDevices(config);
  await log({ type: 'total', total: countTotalCaptures(config) });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputRoot = outputBaseDir ?? path.join(siteDir, 'output');
  const runDir = path.join(outputRoot, `run-${timestamp}`);
  fs.mkdirSync(runDir, { recursive: true });

  await log(`[${devices.join(' + ')} — running in parallel]`);
  const results = await Promise.allSettled(devices.map(device => {
    const outputDir = path.join(runDir, device);
    fs.mkdirSync(outputDir, { recursive: true });
    return runDevice(config, credentials, outputDir, device, log);
  }));

  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    const detail = failures.map(result => result.reason?.message ?? String(result.reason)).join('; ');
    throw new Error(`Capture pass failed: ${detail}`);
  }

  await log('Packaging screenshots…');
  const zipPath = path.join(outputRoot, `run-${timestamp}.zip`);
  await zipDirectory(runDir, zipPath);
  return zipPath;
}

async function runDevice(config, credentials, outputDir, device, log) {
  const deviceConfig = resolveDeviceConfig(config, device);
  await log(`[${device}] Launching Chromium…`);
  const { browser, context, page } = await launchContext(
    deviceConfig.viewport,
    credentials,
    null,
    {
      deviceScaleFactor: deviceConfig.deviceScaleFactor,
      blockMedia: config.browser?.blockMedia === true,
      actionTimeoutMs: config.browser?.actionTimeoutMs,
      navigationTimeoutMs: config.browser?.navigationTimeoutMs,
    },
  );
  const sequence = new Sequence();

  try {
    if (config.browser?.cookies?.length) {
      await context.addCookies(config.browser.cookies);
    }
    await log(`[${device}] Ready.`);

    for (const pageConfig of config.pages) {
      if (pageConfig.enabled === false) continue;
      const steps = enabledSteps(pageConfig, device);
      if (!steps.length) continue;

      const pageUrl = toUrl(config.baseUrl, pageConfig.path);
      let dirty = false;
      await loadPage(page, pageUrl, pageConfig, log);

      for (const step of steps) {
        const stepUrl = step.url || (step.path ? toUrl(config.baseUrl, step.path) : pageUrl);
        const hasOwnTarget = Boolean(step.url || step.path);
        if (dirty || step.resetBefore || (hasOwnTarget && !sameTarget(page.url(), stepUrl))) {
          await loadPage(page, stepUrl, pageConfig, log);
          dirty = false;
        }

        try {
          await log(`  [${device}] ${step.group ? `${step.group} · ` : ''}${step.label}`);
          await executeActions(page, step.actions, log);
          if (step.waitFor) await waitForCondition(page, step.waitFor);
          if (step.delayMs) await page.waitForTimeout(Number(step.delayMs));
          await captureStep(
            page,
            step,
            outputDir,
            sequence,
            pageConfig.id,
            device,
            deviceConfig,
            log,
            pageConfig.elementHideSelectors,
          );
        } catch (error) {
          dirty = true;
          const debugPath = path.join(outputDir, `debug_${sanitizeName(pageConfig.id)}_${sanitizeName(step.id)}.png`);
          await page.screenshot({ path: debugPath, fullPage: false }).catch(() => {});
          await log(`  [skip] ${device}: ${pageConfig.id}-${step.id} — ${error.message}`);
          await log(`  [debug] ${debugPath}`);
        } finally {
          if (step.cleanupActions?.length) {
            await executeActions(
              page,
              step.cleanupActions.map(action => ({ ...action, optional: true })),
              log,
            ).catch(() => {});
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
}

async function loadPage(page, url, pageConfig, log) {
  await log(`  Loading ${pageConfig.label}…`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForNetworkIdle(page, Number(pageConfig.networkIdleTimeoutMs) || 3000);
  if (pageConfig.readySelector) {
    await firstVisible(page, pageConfig.readySelector).waitFor({
      state: 'visible',
      timeout: Number(pageConfig.readyTimeoutMs) || 20000,
    });
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  if (pageConfig.settleMs) await page.waitForTimeout(Number(pageConfig.settleMs));
  if (pageConfig.actions?.length) await executeActions(page, pageConfig.actions, log);
}

async function captureStep(
  page,
  step,
  outputDir,
  sequence,
  pageId,
  device,
  deviceConfig,
  log,
  pageHideSelectors = [],
) {
  const filename = sequence.next(`${pageId}-${step.id}`);
  const filepath = path.join(outputDir, filename);
  const baseViewport = deviceConfig.viewport;
  const stepViewport = step[device] || baseViewport;
  const mode = step.captureMode || 'viewport';

  if (mode === 'fullPage') {
    await captureScreenshot(page, filepath, { fullPage: true });
  } else if (mode === 'element') {
    const selector = step.selector || step.focusSelector;
    if (!selector) throw new Error('Element capture requires a selector');
    const element = firstVisible(page, selector);
    await element.waitFor({ state: 'visible', timeout: 12000 });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
    await element.screenshot({
      path: filepath,
      animations: 'disabled',
      caret: 'hide',
      style: buildHideStyle([
        ...toSelectorArray(pageHideSelectors),
        ...toSelectorArray(step.hideSelectors),
      ]),
    });
  } else {
    await page.setViewportSize(stepViewport);
    try {
      if (step.focusSelector) {
        const focus = firstVisible(page, step.focusSelector);
        await focus.waitFor({ state: 'visible', timeout: 12000 });
        await focus.scrollIntoViewIfNeeded();
        if (step.focusOffset) {
          await page.evaluate(offset => window.scrollBy(0, Number(offset) || 0), step.focusOffset);
        }
        await page.waitForTimeout(150);
      } else if (step.scrollTop !== false) {
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await captureScreenshot(page, filepath, { fullPage: false });
    } finally {
      if (stepViewport.width !== baseViewport.width || stepViewport.height !== baseViewport.height) {
        await page.setViewportSize(baseViewport);
      }
    }
  }

  await log({
    type: 'capture',
    label: `${device} · ${step.group || pageId} · ${step.label}`,
    filename,
    filepath,
  });
}

function buildHideStyle(selectors) {
  const safeSelectors = selectors.filter(selector => typeof selector === 'string' && selector.trim());
  if (!safeSelectors.length) return undefined;
  return `${safeSelectors.join(',\n')} { display: none !important; }`;
}

function toSelectorArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveDeviceConfig(config, device) {
  const base = DEFAULT_DEVICES[device];
  const custom = config.devices?.[device] ?? {};
  return {
    ...base,
    ...custom,
    viewport: { ...base.viewport, ...(custom.viewport ?? {}) },
  };
}

function enabledDevices(config) {
  const devices = Object.keys(DEFAULT_DEVICES).filter(device => resolveDeviceConfig(config, device).enabled !== false);
  if (!devices.length) throw new Error('Enable at least one capture device');
  return devices;
}

function enabledSteps(pageConfig, device) {
  return (pageConfig.steps ?? []).filter(step => {
    if (step.enabled !== true) return false;
    if (step.mobileOnly && device !== 'mobile') return false;
    if (step.desktopOnly && device !== 'desktop') return false;
    if (device === 'mobile' && step.includeMobile === false) return false;
    return true;
  });
}

function countTotalCaptures(config) {
  return enabledDevices(config).reduce((total, device) => total + config.pages.reduce((pageTotal, pageConfig) => {
    if (pageConfig.enabled === false) return pageTotal;
    return pageTotal + enabledSteps(pageConfig, device).length;
  }, 0), 0);
}

function toUrl(baseUrl, target = '/') {
  return new URL(target, baseUrl).toString();
}

function sameTarget(current, expected) {
  try {
    const left = new URL(current);
    const right = new URL(expected);
    return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search;
  } catch {
    return current === expected;
  }
}

function sanitizeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'capture';
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Invalid capture configuration');
  if (!config.baseUrl) throw new Error('Capture configuration requires baseUrl');
  if (!Array.isArray(config.pages) || !config.pages.length) {
    throw new Error('Capture configuration requires at least one page');
  }
}
