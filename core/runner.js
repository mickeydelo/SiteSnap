import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { launchBrowser, createContext, DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from './browser.js';
import { executeActions } from './actions.js';
import { captureScreenshot } from './capture.js';
import { waitForCondition, waitForNetworkIdle, firstVisible } from './utils.js';
import { zipDirectory } from './zip.js';

const DEFAULT_DEVICES = {
  desktop: { enabled: true, viewport: DESKTOP_VIEWPORT, deviceScaleFactor: 1 },
  mobile:  { enabled: true, viewport: MOBILE_VIEWPORT, deviceScaleFactor: 1 },
};
const PREVIEW_WIDTH = 264;
const PREVIEW_HEIGHT = 152;
const PREVIEW_TIMEOUT_MS = 6000;

class Sequence {
  constructor() { this.number = 1; }
  next(name) {
    const prefix = String(this.number++).padStart(2, '0');
    return `${prefix}_${sanitizeName(name)}.png`;
  }
}

/** Run all enabled capture states and return the archive plus an auditable manifest. */
export async function run(
  siteDir,
  credentials,
  configOverride = null,
  onProgress = null,
  outputBaseDir = null,
  _unusedExecutablePath = null,
  runtimeOptions = {},
) {
  const config = configOverride
    ?? JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));
  validateConfig(config);

  const log = async message => {
    if (typeof message === 'string') console.log(message);
    await onProgress?.(message);
  };

  const devices = enabledDevices(config);
  const expectedCaptures = countTotalCaptures(config);
  const parallelDevices = runtimeOptions.parallelDevices !== false && devices.length > 1;
  const startedAt = new Date();
  await log({ type: 'total', total: expectedCaptures });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputRoot = outputBaseDir ?? path.join(siteDir, 'output');
  const runDir = path.join(outputRoot, `run-${timestamp}`);
  fs.mkdirSync(runDir, { recursive: true });

  await log('Preparing capture workspace…');
  await log(parallelDevices
    ? `[${devices.join(' + ')} — one Chromium process, isolated contexts in parallel]`
    : `[${devices.join(' + ')} — one Chromium process, one isolated context at a time]`);
  await log('Launching Chromium…');
  const browser = await launchBrowser();
  let browserVersion = null;
  let results;
  try {
    browserVersion = browser.version();
    const runOneDevice = device => {
      const outputDir = path.join(runDir, device);
      fs.mkdirSync(outputDir, { recursive: true });
      return runDevice(browser, config, credentials, outputDir, runDir, device, log, runtimeOptions);
    };
    if (parallelDevices) {
      results = await Promise.allSettled(devices.map(runOneDevice));
    } else {
      results = [];
      for (const device of devices) {
        try {
          results.push({ status: 'fulfilled', value: await runOneDevice(device) });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }
    }
  } finally {
    await withTimeout(browser.close(), 5000, 'Browser cleanup timed out').catch(() => {});
  }

  const captures = [];
  const failures = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const device = devices[index];
    if (result.status === 'fulfilled') {
      captures.push(...result.value.captures);
      failures.push(...result.value.failures);
      continue;
    }
    const message = result.reason?.message ?? String(result.reason);
    const pendingStates = configuredCaptureStates(config, device);
    const deviceFailures = pendingStates.length
      ? pendingStates.map(({ pageConfig, step }) => ({
        device,
        pageId: pageConfig.id,
        stepId: step.id,
        label: step.label,
        message: `Browser setup failed before this state: ${message}`,
        debugFilename: null,
      }))
      : [{
        device,
        pageId: null,
        stepId: null,
        label: `${device} capture pass`,
        message,
        debugFilename: null,
      }];
    failures.push(...deviceFailures);
    for (const failure of deviceFailures) await log({ type: 'failure', ...failure });
  }

  const completedAt = new Date();
  const status = failures.length === 0 ? 'done' : (captures.length ? 'partial' : 'error');
  const manifest = {
    schemaVersion: 1,
    status,
    runtime: process.env.VERCEL === '1' ? 'vercel' : 'local',
    target: config.baseUrl,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    expectedCaptures,
    completedCaptures: captures.length,
    failedCaptures: failures.length,
    browser: { name: 'Chromium', version: browserVersion },
    node: process.version,
    configSha256: sha256(Buffer.from(JSON.stringify(config))),
    devices: Object.fromEntries(devices.map(device => [device, resolveDeviceConfig(config, device)])),
    captures,
    failures,
  };
  fs.writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  await log('Packaging screenshots…');
  const zipPath = path.join(outputRoot, `run-${timestamp}.zip`);
  await zipDirectory(runDir, zipPath);
  await log({
    type: 'complete',
    status,
    completed: captures.length,
    failed: failures.length,
    zipPath,
  });
  return { zipPath, runDir, status, captures, failures, manifest };
}

async function runDevice(browser, config, credentials, outputDir, runDir, device, log, runtimeOptions) {
  const deviceConfig = resolveDeviceConfig(config, device);
  await log(`[${device}] Opening an isolated browser context…`);
  const { context, page } = await createContext(
    browser,
    deviceConfig.viewport,
    credentials,
    {
      deviceScaleFactor: deviceConfig.deviceScaleFactor,
      blockMedia: config.browser?.blockMedia === true,
      actionTimeoutMs: config.browser?.actionTimeoutMs,
      navigationTimeoutMs: config.browser?.navigationTimeoutMs,
    },
  );
  const sequence = new Sequence();
  const captures = [];
  const failures = [];
  const pending = new Map(configuredCaptureStates(config, device).map(({ pageConfig, step }) => [
    captureStateKey(pageConfig.id, step.id),
    { pageConfig, step },
  ]));

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
          const capture = await captureStep(
            page,
            step,
            outputDir,
            runDir,
            sequence,
            pageConfig.id,
            device,
            deviceConfig,
            log,
            pageConfig.elementHideSelectors,
            runtimeOptions,
          );
          captures.push(capture);
          pending.delete(captureStateKey(pageConfig.id, step.id));
        } catch (error) {
          dirty = true;
          const debugPath = path.join(outputDir, `debug_${sanitizeName(pageConfig.id)}_${sanitizeName(step.id)}.png`);
          await page.screenshot({ path: debugPath, fullPage: false }).catch(() => {});
          const failure = {
            device,
            pageId: pageConfig.id,
            stepId: step.id,
            label: step.label,
            message: error.message,
            debugFilename: fs.existsSync(debugPath) ? toArchivePath(runDir, debugPath) : null,
          };
          failures.push(failure);
          pending.delete(captureStateKey(pageConfig.id, step.id));
          await log({ type: 'failure', ...failure });
          await log(`  [skip] ${device}: ${pageConfig.id}-${step.id} — ${error.message}`);
          if (failure.debugFilename) await log(`  [debug] ${failure.debugFilename}`);
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
  } catch (error) {
    const message = error?.message ?? String(error);
    for (const { pageConfig, step } of pending.values()) {
      const failure = {
        device,
        pageId: pageConfig.id,
        stepId: step.id,
        label: step.label,
        message: `Capture pass stopped before this state: ${message}`,
        debugFilename: null,
      };
      failures.push(failure);
      await log({ type: 'failure', ...failure });
    }
  } finally {
    await withTimeout(context.close(), 3000, 'Browser context cleanup timed out').catch(() => {});
  }
  return { captures, failures };
}

async function loadPage(page, url, pageConfig, log) {
  await log(`  [${viewportLabel(page)}] Loading ${pageConfig.label}…`);
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (response && response.status() >= 400) {
    throw new Error(`Target returned HTTP ${response.status()}: ${url}`);
  }
  await log(`  [${viewportLabel(page)}] Waiting for ${pageConfig.label} to settle…`);
  const ready = pageConfig.readySelector
    ? firstVisible(page, pageConfig.readySelector).waitFor({
      state: 'visible',
      timeout: Number(pageConfig.readyTimeoutMs) || 20000,
    })
    : Promise.resolve();
  await Promise.all([
    waitForNetworkIdle(page, Number(pageConfig.networkIdleTimeoutMs) || 3000),
    ready,
  ]);
  await Promise.race([
    page.evaluate(() => document.fonts?.ready).catch(() => {}),
    page.waitForTimeout(3000),
  ]);
  if (pageConfig.settleMs) await page.waitForTimeout(Number(pageConfig.settleMs));
  if (pageConfig.actions?.length) await executeActions(page, pageConfig.actions, log);
}

function viewportLabel(page) {
  return (page.viewportSize()?.width ?? 0) <= 768 ? 'mobile' : 'desktop';
}

async function captureStep(
  page,
  step,
  outputDir,
  runDir,
  sequence,
  pageId,
  device,
  deviceConfig,
  log,
  pageHideSelectors = [],
  runtimeOptions = {},
) {
  const filename = sequence.next(`${pageId}-${step.id}`);
  const filepath = path.join(outputDir, filename);
  const baseViewport = deviceConfig.viewport;
  const stepViewport = step[device] || baseViewport;
  const mode = step.captureMode || 'viewport';

  if (mode === 'fullPage') {
    await captureScreenshot(page, filepath, {
      fullPage: true,
      nativeFullPage: runtimeOptions.nativeFullPage === true,
    });
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

  const metadata = readPngMetadata(filepath);
  if (runtimeOptions.includePreviews) await log(`  [${device}] Preparing live preview…`);
  const thumbnailUrl = runtimeOptions.includePreviews ? await createPreviewDataUrl(page) : null;
  await log({
    type: 'capture',
    label: `${device} · ${step.group || pageId} · ${step.label}`,
    filename,
    filepath,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  });
  return {
    device,
    pageId,
    stepId: step.id,
    group: step.group || null,
    label: step.label,
    mode,
    filename: toArchivePath(runDir, filepath),
    width: metadata.width,
    height: metadata.height,
    bytes: metadata.bytes,
    sha256: metadata.sha256,
  };
}

async function createPreviewDataUrl(page) {
  let session;
  try {
    const viewport = page.viewportSize();
    if (!viewport) return null;
    const offset = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const clip = resolvePreviewClip(viewport, offset);
    session = await page.context().newCDPSession(page);
    const { data } = await withTimeout(
      session.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 78,
        fromSurface: true,
        captureBeyondViewport: false,
        clip,
      }),
      PREVIEW_TIMEOUT_MS,
      'Live preview timed out',
    );
    return data ? `data:image/jpeg;base64,${data}` : null;
  } catch {
    return null;
  } finally {
    if (session) {
      await withTimeout(session.detach(), 750, 'Preview session cleanup timed out').catch(() => {});
    }
  }
}

export function resolvePreviewClip(viewport, offset = { x: 0, y: 0 }) {
  const viewportWidth = Math.max(1, Number(viewport?.width) || 1);
  const viewportHeight = Math.max(1, Number(viewport?.height) || 1);
  const targetRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
  const viewportRatio = viewportWidth / viewportHeight;
  const width = viewportRatio > targetRatio
    ? viewportHeight * targetRatio
    : viewportWidth;
  const height = viewportRatio > targetRatio
    ? viewportHeight
    : viewportWidth / targetRatio;

  return {
    x: Math.max(0, Number(offset?.x) || 0),
    y: Math.max(0, Number(offset?.y) || 0),
    width,
    height,
    scale: Math.min(PREVIEW_WIDTH / width, PREVIEW_HEIGHT / height, 1),
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

function configuredCaptureStates(config, device) {
  return config.pages.flatMap(pageConfig => {
    if (pageConfig.enabled === false) return [];
    return enabledSteps(pageConfig, device).map(step => ({ pageConfig, step }));
  });
}

function captureStateKey(pageId, stepId) {
  return `${pageId}\u0000${stepId}`;
}

export function countTotalCaptures(config) {
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

export function sanitizeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'capture';
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Invalid capture configuration');
  if (!config.baseUrl) throw new Error('Capture configuration requires baseUrl');
  let baseUrl;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch {
    throw new Error('Capture configuration baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('Capture configuration baseUrl must use HTTP or HTTPS');
  }
  if (!Array.isArray(config.pages) || !config.pages.length) {
    throw new Error('Capture configuration requires at least one page');
  }
  const pageIds = new Set();
  for (const page of config.pages) {
    if (!page?.id || pageIds.has(page.id)) throw new Error(`Invalid or duplicate page id: ${page?.id ?? ''}`);
    pageIds.add(page.id);
    if (!Array.isArray(page.steps)) throw new Error(`Capture page "${page.id}" requires a steps array`);
    const stepIds = new Set();
    for (const step of page.steps) {
      if (!step?.id || stepIds.has(step.id)) {
        throw new Error(`Invalid or duplicate step id on "${page.id}": ${step?.id ?? ''}`);
      }
      stepIds.add(step.id);
      if (step.captureMode === 'element' && !(step.selector || step.focusSelector)) {
        throw new Error(`Element capture "${page.id}/${step.id}" requires a selector`);
      }
      for (const deviceName of ['desktop', 'mobile']) {
        if (step[deviceName]) validateViewport(step[deviceName], `pages.${page.id}.${step.id}.${deviceName}`);
      }
    }
  }
  for (const [name, device] of Object.entries(config.devices ?? {})) {
    if (!DEFAULT_DEVICES[name]) throw new Error(`Unsupported capture device: ${name}`);
    validateViewport(device.viewport, `devices.${name}.viewport`);
    if (![1, 2].includes(Number(device.deviceScaleFactor ?? 1))) {
      throw new Error(`Device scale for "${name}" must be 1 or 2`);
    }
  }
}

function validateViewport(viewport, label) {
  for (const dimension of ['width', 'height']) {
    const value = Number(viewport?.[dimension]);
    if (!Number.isInteger(value) || value < 320 || value > 3840) {
      throw new Error(`${label}.${dimension} must be an integer from 320 to 3840`);
    }
  }
}

function readPngMetadata(filepath) {
  const buffer = fs.readFileSync(filepath);
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Capture output is not a valid PNG: ${path.basename(filepath)}`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toArchivePath(runDir, filepath) {
  return path.relative(runDir, filepath).split(path.sep).join('/');
}
