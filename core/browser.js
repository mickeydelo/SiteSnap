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
 * @param {{ username: string, password: string } | null} credentials
 *   Pass the user's credentials here if the site is behind HTTP Basic Auth
 *   (e.g. a password-protected dev/staging environment). Playwright will
 *   automatically respond to any 401 challenge with these values.
 * @returns {{ browser, context, page }}
 */
export async function launchContext(viewport = DESKTOP_VIEWPORT, credentials = null) {
  const isMobile = viewport.width <= 768;

  // SITESNAP_DEBUG=1 opens a visible browser window with slow-motion actions —
  // useful for diagnosing click / selector failures.
  const debug = process.env.SITESNAP_DEBUG === '1';

  // Launch with no user-data-dir and no stored state so every run behaves
  // like a fresh incognito session — ensuring interstitials and cookie banners
  // always fire regardless of prior runs.
  const browser = await chromium.launch({
    headless: !debug,
    slowMo:   debug ? 600 : 0,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const context = await browser.newContext({
    viewport,
    userAgent: isMobile ? MOBILE_UA : DESKTOP_UA,
    deviceScaleFactor: isMobile ? 2 : 1,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
    // Automatically answer HTTP Basic Auth challenges (dev/staging gate)
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
