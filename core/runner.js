import path from 'path';
import fs from 'fs';
import { launchContext, DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from './browser.js';
import { executeActions, injectLogin, clickByText } from './actions.js';
import { captureScreenshot } from './capture.js';
import { waitForNetworkIdle, hideISITray, waitForCondition } from './utils.js';
import { zipDirectory } from './zip.js';

const DEFAULTS = {
  desktop: DESKTOP_VIEWPORT,
  mobile:  MOBILE_VIEWPORT,
};

// ---------------------------------------------------------------------------
// Sequential file-name counter
// ---------------------------------------------------------------------------

class Sequence {
  constructor() { this.n = 1; }
  next(name) {
    return `${String(this.n++).padStart(2, '0')}_${name}.png`;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {string}  siteDir         Absolute path to the site folder
 * @param {{ username: string, password: string }} credentials
 * @param {object|null} configOverride  Optional modified config from the UI
 * @param {(msg: string) => void} [onProgress]
 * @returns {string} Absolute path to the output ZIP
 */
export async function run(siteDir, credentials, configOverride = null, onProgress = null) {
  const config = configOverride
    ?? JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));

  const log = msg => { if (typeof msg === 'string') console.log(msg); onProgress?.(msg); };

  log({ type: 'total', total: countTotalCaptures(config) });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir     = path.join(siteDir, 'output', `run-${timestamp}`);
  const desktopDir = path.join(runDir, 'desktop');
  const mobileDir  = path.join(runDir, 'mobile');

  fs.mkdirSync(desktopDir, { recursive: true });
  fs.mkdirSync(mobileDir,  { recursive: true });

  try {
    log('[Desktop]');
    await runDevice(config, credentials, desktopDir, 'desktop', log);

    log('[Mobile]');
    await runDevice(config, credentials, mobileDir, 'mobile', log);
  } catch (err) {
    fs.rmSync(runDir, { recursive: true, force: true });
    throw err;
  }

  log('Packaging…');
  const zipPath = path.join(siteDir, 'output', `run-${timestamp}.zip`);
  await zipDirectory(runDir, zipPath);
  fs.rmSync(runDir, { recursive: true });

  return zipPath;
}

// ---------------------------------------------------------------------------
// Device pass
// ---------------------------------------------------------------------------

async function runDevice(config, credentials, outputDir, device, log) {
  const { browser, page } = await launchContext(DEFAULTS[device], credentials);
  const seq = new Sequence();

  try {
    for (const pageCfg of config.pages) {
      if (pageCfg.enabled === false) continue;
      const steps = enabledSteps(pageCfg, device);
      if (!steps.length) continue;

      if (pageCfg.type === 'external') {
        // ── External / interstitial captures
        for (const step of steps) {
          await captureExternal(page, config, pageCfg, step, outputDir, seq, device, log);
        }

      } else if (pageCfg.includesEntry) {
        // ── Entry page (home) — interleaved auth sequence
        await navigate(page, `${config.baseUrl}${pageCfg.path}`);

        // Phase 1: pre-entry (raw state, all overlays visible)
        for (const step of steps.filter(s => s.phase === 'pre-entry')) {
          await captureStep(page, step, outputDir, seq, pageCfg.id, device, log);
        }

        // Run entry actions (dismiss cookie banner + HCP gate)
        if (pageCfg.entryActions?.length) {
          await executeActions(page, pageCfg.entryActions);
        }

        // Auto-login if a login form is now present
        await injectLogin(page, credentials);

        // Phase 2: post-entry (overlays gone, ISI tray still showing)
        for (const step of steps.filter(s => s.phase === 'post-entry')) {
          await captureStep(page, step, outputDir, seq, pageCfg.id, device, log);
        }

        // Mobile only: capture hamburger menu after login
        if (device === 'mobile') {
          await captureHamburger(page, outputDir, seq, log);
        }

        // Phase 3: authenticated (ISI tray can be hidden)
        for (const step of steps.filter(s => !s.phase || s.phase === 'authenticated')) {
          await prepareAndCapture(page, step, outputDir, seq, pageCfg.id, device, log);
        }

      } else {
        // ── Regular authenticated page
        await navigate(page, `${config.baseUrl}${pageCfg.path}`);

        for (const step of steps) {
          await prepareAndCapture(page, step, outputDir, seq, pageCfg.id, device, log);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// External / interstitial captures
// ---------------------------------------------------------------------------

async function captureExternal(page, config, pageCfg, step, outputDir, seq, device, log) {
  try {
    const triggerUrl = `${config.baseUrl}${pageCfg.triggerPage ?? '/'}`;
    await navigate(page, triggerUrl);
    await hideISITray(page);

    const filename = seq.next(`${pageCfg.id}-${step.id}`);
    const filepath  = path.join(outputDir, filename);

    // Listen for a popup before clicking — the interstitial may open in a new tab
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);

    const triggerText = step.trigger?.text;
    if (!triggerText) throw new Error('step.trigger.text is required for external captures');

    await clickByText(page, triggerText);

    const popup = await popupPromise;

    if (popup) {
      // Opened in a new tab — capture it and close
      await waitForNetworkIdle(popup);
      const stepViewport = step[device];
      if (stepViewport) await popup.setViewportSize(stepViewport);
      await popup.screenshot({ path: filepath, fullPage: false });
      await popup.close();
    } else {
      // Interstitial appeared as a modal/overlay on the current page
      await page.waitForTimeout(800);
      const stepViewport = step[device];
      if (stepViewport) await page.setViewportSize(stepViewport);
      await page.screenshot({ path: filepath, fullPage: false });
      if (stepViewport) await page.setViewportSize(DEFAULTS[device]);
      // Dismiss modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    log({ type: 'capture', label: `  ${device}: ${filename}`, filepath });
  } catch (err) {
    log(`  [skip] ${pageCfg.label} — ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function prepareAndCapture(page, step, outputDir, seq, pageId, device, log) {
  if (step.actions?.length) {
    await executeActions(page, step.actions);
  }
  if (step.waitFor) {
    await waitForCondition(page, step.waitFor);
  }
  if (step.hideISI) {
    await hideISITray(page);
  }
  await captureStep(page, step, outputDir, seq, pageId, device, log);
}

async function captureStep(page, step, outputDir, seq, pageId, device, log) {
  const filename = seq.next(`${pageId}-${step.id}`);
  const filepath  = path.join(outputDir, filename);

  if (step.captureMode === 'viewport') {
    const stepViewport = step[device]; // e.g. step.desktop or step.mobile
    if (stepViewport) await page.setViewportSize(stepViewport);
    await page.screenshot({ path: filepath, fullPage: false });
    if (stepViewport) await page.setViewportSize(DEFAULTS[device]); // restore
  } else {
    // fullPage — scrolls to trigger lazy load, then captures.
    // Re-hide ISI drawer after scroll in case the sticky element re-attached.
    await captureScreenshot(page, filepath, {
      fullPage: true,
      afterScroll: step.hideISI ? () => hideISITray(page) : null,
    });
  }

  log({ type: 'capture', label: `  ${device}: ${filename}`, filepath });
}

async function captureHamburger(page, outputDir, seq, log) {
  const selectors = [
    // Site-specific: Gatsby header nav toggle
    '#gatsby-focus-wrapper > header > div.container > div > button',
    // Generic ARIA / class patterns
    'button[aria-label*="menu" i]',
    'button[aria-label*="navigation" i]',
    'button[aria-label*="nav" i]',
    '[role="button"][aria-label*="menu" i]',
    'button[aria-expanded]',
    '.hamburger',
    '.nav-toggle',
    '.menu-toggle',
    '[class*="hamburger"]',
    '[class*="menu-toggle"]',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForTimeout(600);

        const filename = seq.next('nav-open-mobile');
        const filepath = path.join(outputDir, filename);
        await page.screenshot({ path: filepath, fullPage: false });
        log({ type: 'capture', label: `  mobile: ${filename}`, filepath });

        await btn.click(); // close before next navigation
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      // try next
    }
  }
  log('  [skip] Hamburger menu not found');
}

async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForNetworkIdle(page);
}

function countTotalCaptures(config) {
  let total = 0;
  for (const page of config.pages) {
    if (page.enabled === false) continue;
    total += enabledSteps(page, 'desktop').length;
    const mobileSteps = enabledSteps(page, 'mobile');
    total += mobileSteps.length;
    if (page.includesEntry && mobileSteps.length > 0) total += 1; // hamburger
  }
  return total;
}

/**
 * Return enabled steps for the given device, respecting `includeMobile` and
 * `mobileOnly` / `desktopOnly` flags.
 */
function enabledSteps(pageCfg, device) {
  return (pageCfg.steps ?? []).filter(step => {
    if (!step.enabled) return false;
    if (step.mobileOnly  && device === 'desktop') return false;
    if (step.desktopOnly && device === 'mobile')  return false;
    if (device === 'mobile' && step.includeMobile === false) return false;
    return true;
  });
}
