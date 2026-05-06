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
/**
 * @param {string}  siteDir        Absolute path to the site folder
 * @param {{ username: string, password: string }} credentials
 * @param {object|null} configOverride  Optional modified config from the UI
 * @param {(msg: object|string) => Promise<void>} [onProgress]
 * @param {string|null} outputBaseDir   Override for the output root (used on Netlify/Lambda
 *                                      to write to /tmp instead of siteDir/output)
 * @returns {string} Absolute path to the output ZIP
 */
export async function run(siteDir, credentials, configOverride = null, onProgress = null, outputBaseDir = null) {
  const config = configOverride
    ?? JSON.parse(fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8'));

  const log = async msg => { if (typeof msg === 'string') console.log(msg); await onProgress?.(msg); };

  await log({ type: 'total', total: countTotalCaptures(config) });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outBase    = outputBaseDir ?? path.join(siteDir, 'output');
  const runDir     = path.join(outBase, `run-${timestamp}`);
  const desktopDir = path.join(runDir, 'desktop');
  const mobileDir  = path.join(runDir, 'mobile');

  fs.mkdirSync(desktopDir, { recursive: true });
  fs.mkdirSync(mobileDir,  { recursive: true });

  try {
    await log('[Desktop + Mobile — running in parallel]');
    await Promise.all([
      runDevice(config, credentials, desktopDir, 'desktop', log),
      runDevice(config, credentials, mobileDir,  'mobile',  log),
    ]);
  } catch (err) {
    fs.rmSync(runDir, { recursive: true, force: true });
    throw err;
  }

  await log('Packaging…');
  const zipPath = path.join(outBase, `run-${timestamp}.zip`);
  await zipDirectory(runDir, zipPath);

  // runDir is intentionally kept so thumbnails remain serveable after the run.
  // Callers that manage their own storage (e.g. Netlify /tmp) clean it up themselves.
  return zipPath;
}

// ---------------------------------------------------------------------------
// Device pass
// ---------------------------------------------------------------------------

async function runDevice(config, credentials, outputDir, device, log) {
  const { browser, page } = await launchContext(DEFAULTS[device], credentials);
  const seq = new Sequence();

  try {
    // ── Entry sequence (always runs, even if the home page is disabled for capture)
    // Dismisses cookie banners, HCP gate, and logs in so subsequent pages are clean.
    const entryPage = config.pages.find(p => p.includesEntry);
    if (entryPage) {
      const entryUrl      = `${config.baseUrl}${entryPage.path}`;
      const captureEnabled = entryPage.enabled !== false;
      const steps          = enabledSteps(entryPage, device);

      await navigate(page, entryUrl);

      if (captureEnabled) {
        for (const step of steps.filter(s => s.phase === 'pre-entry')) {
          try {
            await captureStep(page, step, outputDir, seq, entryPage.id, device, log);
          } catch (err) {
            await log(`  [skip] ${device}: ${entryPage.id}-${step.id} — ${err.message}`);
          }
        }
      }

      // Run entry actions. If they fail, navigate fresh and retry once —
      // on Lambda the cookie-banner animation can still be running when the
      // HCP gate click fires, causing it to miss. A fresh load gives a clean state.
      let entryOk = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt === 2) {
            await log(`  [retry] Entry actions failed on attempt 1 — retrying on fresh page`);
            await navigate(page, entryUrl);
          }
          if (entryPage.entryActions?.length) {
            await executeActions(page, entryPage.entryActions);
          }
          if (credentials) await injectLogin(page, credentials);
          entryOk = true;
          break;
        } catch (err) {
          if (attempt === 2) {
            await log(`  [skip] Entry actions failed after retry — ${err.message}. Continuing with remaining pages.`);
          }
        }
      }

      if (captureEnabled && entryOk) {
        for (const step of steps.filter(s => s.phase === 'post-entry')) {
          try {
            await captureStep(page, step, outputDir, seq, entryPage.id, device, log);
          } catch (err) {
            await log(`  [skip] ${device}: ${entryPage.id}-${step.id} — ${err.message}`);
          }
        }
        for (const step of steps.filter(s => !s.phase || s.phase === 'authenticated')) {
          await prepareAndCapture(page, step, outputDir, seq, entryPage.id, device, log);
          if (device === 'mobile' && step.captureHamburger) {
            await captureHamburger(page, outputDir, seq, log);
          }
        }
      }
    }

    // ── Remaining pages
    for (const pageCfg of config.pages) {
      if (pageCfg.includesEntry) continue; // already handled above
      if (pageCfg.enabled === false) continue;
      const steps = enabledSteps(pageCfg, device);
      if (!steps.length) continue;

      if (pageCfg.type === 'external') {
        for (const step of steps) {
          await captureExternal(page, config, pageCfg, step, outputDir, seq, device, log);
        }
      } else {
        const pageUrl = `${config.baseUrl}${pageCfg.path}`;
        try {
          await navigate(page, pageUrl);
        } catch (err) {
          await log(`  [skip] ${pageCfg.label} — navigation failed: ${err.message}`);
          continue;
        }
        let prevSkipped = false;
        for (const step of steps) {
          // Re-navigate if a previous step navigated away (e.g. form submit).
          // Check both URL drift AND the skip flag — a POST can land on the same URL.
          if (prevSkipped || !page.url().startsWith(pageUrl)) {
            try { await navigate(page, pageUrl); } catch (navErr) {
              await log(`  [skip] ${pageCfg.label} — re-navigation failed: ${navErr.message}`);
              break;
            }
          }
          prevSkipped = await prepareAndCapture(page, step, outputDir, seq, pageCfg.id, device, log);
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

    await log({ type: 'capture', label: `  ${device}: ${filename}`, filepath });
  } catch (err) {
    await log(`  [skip] ${pageCfg.label} — ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Returns true if the step was skipped (so the caller can re-navigate before the next step).
async function prepareAndCapture(page, step, outputDir, seq, pageId, device, log) {
  try {
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
    return false;
  } catch (err) {
    await log(`  [skip] ${device}: ${pageId}-${step.id} — ${err.message}`);
    return true;
  }
}

async function captureStep(page, step, outputDir, seq, pageId, device, log) {
  const filename = seq.next(`${pageId}-${step.id}`);
  const filepath  = path.join(outputDir, filename);

  if (step.captureMode === 'element') {
    // Screenshot a single element — no scroll, no page.evaluate.
    // Use this for forms showing validation errors where a POST might fire after the click.
    const el = page.locator(step.selector).first();
    await el.waitFor({ state: 'visible', timeout: 10000 });
    await el.screenshot({ path: filepath });
  } else if (step.captureMode === 'viewport') {
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

  await log({ type: 'capture', label: `  ${device}: ${filename}`, filepath });
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
        await log({ type: 'capture', label: `  mobile: ${filename}`, filepath });

        await btn.click(); // close before next navigation
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      // try next
    }
  }
  await log('  [skip] Hamburger menu not found');
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
    if (page.includesEntry && mobileSteps.some(s => s.captureHamburger)) total += 1; // hamburger
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
