export async function captureScreenshot(page, filepath, { fullPage = true, afterScroll = null } = {}) {
  if (fullPage) {
    await scrollForLazyLoad(page);
    if (afterScroll) await afterScroll();

    // On mobile (and some desktop pages), Playwright's built-in fullPage screenshot
    // fails with "Unable to capture screenshot" when the page is very tall.
    // Work around it by expanding the viewport to the full document height,
    // taking a normal viewport screenshot, then restoring the original size.
    try {
      await page.screenshot({ path: filepath, fullPage: true });
    } catch {
      const viewport   = page.viewportSize();
      const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: viewport.width, height: fullHeight });
      await page.screenshot({ path: filepath, fullPage: false });
      await page.setViewportSize(viewport);
    }
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
