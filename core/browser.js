// Always use playwright-core. Locally it auto-discovers the chromium that
// `npx playwright install chromium` downloads to ~/.cache/ms-playwright/.
// On Netlify, @sparticuz/chromium supplies the executable and launch args.
import { chromium } from 'playwright-core';

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
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ username: string, password: string } | null} credentials
 * @returns {{ browser, context, page }}
 */
export async function launchContext(viewport = DESKTOP_VIEWPORT, credentials = null) {
  const isMobile = viewport.width <= 768;

  let executablePath = undefined; // undefined = playwright-core auto-discovers locally
  let args           = ['--no-first-run', '--no-default-browser-check'];
  let headless       = true;
  let slowMo         = 0;

  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Lambda / Netlify Functions runtime: use @sparticuz/chromium.
    // Use a unique --user-data-dir per launch so desktop and mobile passes
    // within the same invocation never share cookies or cached state.
    const sparticuz  = (await import('@sparticuz/chromium')).default;
    executablePath   = await sparticuz.executablePath();
    const dataDir    = `/tmp/chromium-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    args             = [...sparticuz.args, `--user-data-dir=${dataDir}`];
  } else {
    // Local: playwright-core finds the playwright-installed chromium automatically
    const debug = process.env.SITESNAP_DEBUG === '1';
    headless    = !debug;
    slowMo      = debug ? 600 : 0;
  }

  const browser = await chromium.launch({ executablePath, args, headless, slowMo });

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
