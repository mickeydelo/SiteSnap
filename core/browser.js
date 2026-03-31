import { chromium } from 'playwright';

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
 * @param {{ width: number, height: number }} viewport
 * @returns {{ browser, context, page }}
 */
export async function launchContext(viewport = DESKTOP_VIEWPORT) {
  const isMobile = viewport.width <= 768;

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport,
    userAgent: isMobile ? MOBILE_UA : DESKTOP_UA,
    deviceScaleFactor: isMobile ? 2 : 1,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  return { browser, context, page };
}
