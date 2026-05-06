export async function captureScreenshot(page, filepath, { fullPage = true, afterScroll = null } = {}) {
  if (fullPage) {
    await scrollForLazyLoad(page);
    if (afterScroll) await afterScroll();

    // Expand viewport to full document height and shoot a single viewport screenshot.
    // This is faster and more reliable than fullPage: true, which composites tiles
    // and fails on tall pages in Lambda/mobile environments.
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
