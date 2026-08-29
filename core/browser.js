export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
export const MOBILE_VIEWPORT  = { width: 390, height: 844 };

const IS_VERCEL = process.env.VERCEL === '1';
let browserRuntimePromise = null;

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const TRACKER_HOSTS =
  /google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|adobedtm\.com|adobe\.com\/b\/ss|omtrdc\.net|demdex\.net|everesttech\.net|scorecardresearch\.com|quantserve\.com|hotjar\.com|segment\.io|segment\.com|sentry\.io|newrelic\.com|nr-data\.net|optimizely\.com|heap\.io|mixpanel\.com|clarity\.ms|marketo\.com|pardot\.com|hubspot\.com|connect\.facebook\.net|twitter\.com\/i\/adsct|ads\.linkedin\.com|snap\.licdn\.com/i;

/** Launch a deterministic local browser context with no persisted storage. */
export async function launchContext(
  viewport = DESKTOP_VIEWPORT,
  credentials = null,
  _unusedExecutablePath = null,
  options = {},
) {
  const isMobile = viewport.width <= 768;
  const debug = !IS_VERCEL && process.env.SITESNAP_DEBUG === '1';
  const { chromium, launchOptions } = await loadBrowserRuntime();

  const browser = await chromium.launch({
    ...launchOptions,
    headless: !debug,
    slowMo: debug ? 250 : 0,
    args: [
      ...(launchOptions.args ?? []),
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const context = await browser.newContext({
    viewport,
    ...(isMobile ? { userAgent: MOBILE_UA, isMobile: true, hasTouch: true } : {}),
    deviceScaleFactor: Number(options.deviceScaleFactor) || 1,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
    ...(credentials && {
      httpCredentials: {
        username: credentials.username,
        password: credentials.password,
      },
    }),
  });

  context.setDefaultTimeout(Number(options.actionTimeoutMs) || 10000);
  context.setDefaultNavigationTimeout(Number(options.navigationTimeoutMs) || 45000);

  await context.route('**/*', route => {
    const request = route.request();
    if (TRACKER_HOSTS.test(request.url())) return route.abort();
    if (options.blockMedia && request.resourceType() === 'media') return route.abort();
    return route.continue();
  });

  await context.addInitScript(() => {
    const stabilize = () => {
      if (document.getElementById('sitesnap-stability')) return;
      const style = document.createElement('style');
      style.id = 'sitesnap-stability';
      style.textContent = `
        html { scroll-behavior: auto !important; }
        *, *::before, *::after {
          transition-duration: 0ms !important;
          animation-duration: 0ms !important;
          animation-delay: 0ms !important;
          caret-color: transparent !important;
        }
      `;
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', stabilize, { once: true });
    } else {
      stabilize();
    }
  });

  const page = await context.newPage();
  return { browser, context, page };
}

function loadBrowserRuntime() {
  browserRuntimePromise ??= IS_VERCEL ? loadHostedBrowserRuntime() : loadLocalBrowserRuntime();
  return browserRuntimePromise;
}

async function loadLocalBrowserRuntime() {
  const { chromium } = await import('playwright');
  return { chromium, launchOptions: {} };
}

async function loadHostedBrowserRuntime() {
  const [{ chromium }, { default: serverlessChromium }] = await Promise.all([
    import('playwright-core'),
    import('@sparticuz/chromium'),
  ]);
  return {
    chromium,
    launchOptions: {
      args: serverlessChromium.args,
      executablePath: await serverlessChromium.executablePath(),
    },
  };
}
