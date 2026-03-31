export const DESKTOP_VIEWPORT = { width: 1442, height: 900 };
export const MOBILE_VIEWPORT  = { width: 390,  height: 800 };

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Launch a Playwright browser + context + page.
 * Each call returns an isolated session with no shared state.
 *
 * On Netlify/Lambda: uses @sparticuz/chromium + playwright-core.
 * Locally:           uses the installed playwright package.
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ username: string, password: string } | null} credentials
 * @returns {{ browser, context, page }}
 */
export async function launchContext(viewport = DESKTOP_VIEWPORT, credentials = null) {
  const isMobile = viewport.width <= 768;

  let browser;

  if (process.env.NETLIFY) {
    // ── Netlify / Lambda ───────────────────────────────────────────────────
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: pw } = await import('playwright-core');
    browser = await pw.launch({
      args:           chromium.args,
      executablePath: await chromium.executablePath(),
      headless:       true,
    });
  } else {
    // ── Local development ──────────────────────────────────────────────────
    const debug = process.env.SITESNAP_DEBUG === '1';
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: !debug,
      slowMo:   debug ? 600 : 0,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
  }

  const context = await browser.newContext({
    viewport,
    userAgent: isMobile ? MOBILE_UA : DESKTOP_UA,
    deviceScaleFactor: isMobile ? 2 : 1,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
    ...(credentials && {
      httpCredentials: {
        username: credentials.username,
        password: credentials.password,
      },
    }),
  });

  const page = await context.newPage();
  return { browser, context, page };
}
