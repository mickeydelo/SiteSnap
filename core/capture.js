import fs from 'fs';

/** Capture a stable screenshot without truncating long local full-page runs. */
export async function captureScreenshot(
  page,
  filepath,
  { fullPage = true, afterScroll = null, nativeFullPage = false } = {},
) {
  if (fullPage) {
    await scrollForLazyLoad(page);
    await afterScroll?.();
    await settleVisualAssets(page);
    await page.evaluate(() => window.scrollTo(0, 0));

    const viewport = page.viewportSize();
    const fullHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    ));

    if (nativeFullPage) {
      let session;
      try {
        session = await page.context().newCDPSession(page);
        const { data } = await withTimeout(
          session.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: true,
            clip: {
              x: 0,
              y: 0,
              width: viewport.width,
              height: fullHeight,
              scale: 1,
            },
          }),
          30000,
          'Full-page screenshot timed out',
        );
        await fs.promises.writeFile(filepath, Buffer.from(data, 'base64'));
      } finally {
        if (session) {
          await withTimeout(session.detach(), 750, 'Screenshot session cleanup timed out').catch(() => {});
        }
      }
      return;
    }

    // Expanding only the height keeps output at the requested viewport width.
    // Native fullPage capture includes Nuveen's off-canvas utility drawer and
    // silently widens a 1440px capture to 1722px.
    try {
      await page.setViewportSize({ width: viewport.width, height: fullHeight });
      await page.screenshot({
        path: filepath,
        fullPage: false,
        animations: 'disabled',
        caret: 'hide',
        timeout: 30000,
      });
    } finally {
      await page.setViewportSize(viewport);
    }
    return;
  }

  await page.screenshot({
    path: filepath,
    fullPage,
    animations: 'disabled',
    caret: 'hide',
    timeout: 30000,
  });
}

/** Trigger IntersectionObserver content using viewport-sized hops. */
export async function scrollForLazyLoad(page) {
  await page.evaluate(async () => {
    const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const viewport = Math.max(window.innerHeight, 600);
    const hops = Math.min(14, Math.max(3, Math.ceil(height / (viewport * 1.5))));

    for (let i = 1; i <= hops; i += 1) {
      window.scrollTo(0, Math.round((height / hops) * i));
      await new Promise(resolve => setTimeout(resolve, 75));
    }

    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(150);
}

async function settleVisualAssets(page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const pending = [...document.images]
      .filter(image => !image.complete)
      .slice(0, 80)
      .map(image => new Promise(resolve => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        setTimeout(done, 1500);
      }));
    await Promise.all(pending);
  }).catch(() => {});
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
