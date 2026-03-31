import path from 'path';
import fs from 'fs';
import { launchContext, DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from './browser.js';
import { executeActions, injectLogin } from './actions.js';
import { captureScreenshot } from './capture.js';
import { waitForNetworkIdle, hideISITray, waitForCondition } from './utils.js';
import { zipDirectory } from './zip.js';

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
 * Run a full desktop + mobile screenshot pass for the given site.
 *
 * @param {string} siteDir      Absolute path to the site folder (contains config.json)
 * @param {{ username: string, password: string }} credentials
 * @returns {string} Absolute path to the output ZIP file
 */
export async function run(siteDir, credentials) {
  const config = JSON.parse(
    fs.readFileSync(path.join(siteDir, 'config.json'), 'utf8')
  );

  // Timestamp: 2024-01-15T10-30-00  (colons replaced so it's filesystem-safe)
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);

  const runDir = path.join(siteDir, 'output', `run-${timestamp}`);
  fs.mkdirSync(runDir, { recursive: true });

  try {
    console.log('\n[Desktop]');
    await runDesktop(config, credentials, runDir);

    console.log('\n[Mobile]');
    await runMobile(config, credentials, runDir);
  } catch (err) {
    fs.rmSync(runDir, { recursive: true, force: true });
    throw err;
  }

  console.log('\nPackaging…');
  const zipPath = path.join(siteDir, 'output', `run-${timestamp}.zip`);
  await zipDirectory(runDir, zipPath);
  fs.rmSync(runDir, { recursive: true });

  return zipPath;
}

// ---------------------------------------------------------------------------
// Desktop pass  (1442 × 900 default, full-height captures)
// ---------------------------------------------------------------------------

async function runDesktop(config, credentials, runDir) {
  const { browser, page } = await launchContext(DESKTOP_VIEWPORT);
  const seq = new Sequence();

  try {
    // ── Entry: capture raw state (cookie banner, HCP gate, ISI tray all visible)
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForNetworkIdle(page);
    await save(page, runDir, seq.next('entry'), { fullPage: true });

    // ── Dismiss overlays via entry actions
    if (config.entry?.actions?.length) {
      await executeActions(page, config.entry.actions);
    }

    // ── Auto-detect and fill login form if present
    await injectLogin(page, credentials);

    // ── Pages
    for (const pageCfg of config.pages) {
      const url = `${config.baseUrl}${pageCfg.path}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForNetworkIdle(page);

      if (pageCfg.actions?.length) {
        await executeActions(page, pageCfg.actions);
      }

      if (pageCfg.waitFor) {
        await waitForCondition(page, pageCfg.waitFor);
      }

      // Hide ISI tray right before every post-entry capture
      await hideISITray(page);
      await save(page, runDir, seq.next(pageCfg.name), {
        fullPage: pageCfg.fullPage !== false,
      });
    }

    // ── External site captures
    if (config.externalCaptures?.length) {
      await captureExternals(page, browser, config, runDir, seq);
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// External captures  (open outbound links in isolated contexts)
// ---------------------------------------------------------------------------

async function captureExternals(page, browser, config, runDir, seq) {
  // Return to home page to locate outbound nav links
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForNetworkIdle(page);
  await hideISITray(page);

  for (const ext of config.externalCaptures) {
    try {
      const link = page.getByText(ext.triggerText, { exact: false }).first();
      const href = await link.getAttribute('href');

      if (!href) {
        console.warn(`  [skip] No href found for "${ext.triggerText}"`);
        continue;
      }

      const fullUrl = href.startsWith('http')
        ? href
        : new URL(href, config.baseUrl).toString();

      // Isolated context — no session cookies from the main site
      const extContext = await browser.newContext({
        viewport: ext.viewport,
        ignoreHTTPSErrors: true,
      });
      const extPage = await extContext.newPage();

      await extPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForNetworkIdle(extPage);

      await save(extPage, runDir, seq.next(ext.name), { fullPage: false });
      await extContext.close();
    } catch (err) {
      console.warn(`  [skip] External capture "${ext.name}": ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Mobile pass  (390 × 800, includes hamburger menu capture)
// ---------------------------------------------------------------------------

async function runMobile(config, credentials, runDir) {
  const { browser, page } = await launchContext(MOBILE_VIEWPORT);
  const seq = new Sequence();

  try {
    // ── Entry: raw state (cookie banner, HCP gate, ISI tray all visible)
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForNetworkIdle(page);
    await save(page, runDir, seq.next('entry-mobile'), { fullPage: true });

    // ── Dismiss overlays + login
    if (config.entry?.actions?.length) {
      await executeActions(page, config.entry.actions);
    }
    await injectLogin(page, credentials);
    await hideISITray(page);

    // ── Hamburger menu: open → capture → close
    await captureHamburger(page, runDir, seq);

    // ── Pages
    for (const pageCfg of config.pages) {
      const url = `${config.baseUrl}${pageCfg.path}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForNetworkIdle(page);

      if (pageCfg.actions?.length) {
        await executeActions(page, pageCfg.actions);
      }

      if (pageCfg.waitFor) {
        await waitForCondition(page, pageCfg.waitFor);
      }

      await hideISITray(page);
      await save(page, runDir, seq.next(`${pageCfg.name}-mobile`), {
        fullPage: pageCfg.fullPage !== false,
      });
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Hamburger nav
// ---------------------------------------------------------------------------

async function captureHamburger(page, runDir, seq) {
  const selectors = [
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
    '[class*="nav-toggle"]',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForTimeout(600); // let menu animation finish
        await save(page, runDir, seq.next('nav-open-mobile'), { fullPage: false });
        await btn.click(); // close before page navigation
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      // try next selector
    }
  }

  console.warn('  [skip] Hamburger menu not found');
}

// ---------------------------------------------------------------------------
// Shared save helper
// ---------------------------------------------------------------------------

async function save(page, runDir, filename, options) {
  const filepath = path.join(runDir, filename);
  await captureScreenshot(page, filepath, options);
  console.log(`  ${filename}`);
}
