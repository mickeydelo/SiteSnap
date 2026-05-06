const ON_LAMBDA = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

export async function captureScreenshot(page, filepath, { fullPage = true, afterScroll = null } = {}) {
  if (fullPage) {
    // On Lambda: skip the lazy-load scroll. scrollForLazyLoad decodes every image into
    // Chromium memory; the subsequent setViewportSize then OOM-crashes the browser.
    // Without the pre-scroll there is no memory spike and setViewportSize works fine.
    // Trade-off: lazy-loaded images below the fold won't appear in Lambda captures.
    // NOTE: page.screenshot({ fullPage: true }) does NOT work with @sparticuz/chromium —
    // it silently returns a viewport-sized image, so we always use the expand-viewport path.
    if (!ON_LAMBDA) await scrollForLazyLoad(page);
    if (afterScroll) await afterScroll();
    const viewport   = page.viewportSize();
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    // Cap at 15000px — taller viewports can OOM-crash Chromium on Lambda.
    const safeHeight = Math.min(fullHeight, 15000);
    await page.setViewportSize({ width: viewport.width, height: safeHeight });
    await page.screenshot({ path: filepath, fullPage: false });
    await page.setViewportSize(viewport); // restore
  } else {
    await page.screenshot({ path: filepath, fullPage: false });
  }
}

/**
 * Scroll the page in 6 large jumps to trigger lazy-loaded images, then
 * return to the top. Total time: ~700 ms regardless of page length.
 */
export async function scrollForLazyLoad(page) {
  await page.evaluate(async () => {
    const totalHeight = document.documentElement.scrollHeight;
    const jumps = 6;

    for (let i = 1; i <= jumps; i++) {
      window.scrollTo(0, Math.round((totalHeight / jumps) * i));
      await new Promise(r => setTimeout(r, 60));
    }

    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 100));
  });

  await page.waitForTimeout(100);
}
