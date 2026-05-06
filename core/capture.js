const ON_LAMBDA = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

export async function captureScreenshot(page, filepath, { fullPage = true, afterScroll = null } = {}) {
  if (fullPage) {
    if (ON_LAMBDA) {
      // On Lambda: skip the lazy-load scroll — loading all images into Chromium memory
      // before a full-page capture reliably OOMs the browser. Use Playwright's native
      // fullPage (CDP captureBeyondViewport) which scrolls in smaller chunks internally.
      if (afterScroll) await afterScroll();
      try {
        await page.screenshot({ path: filepath, fullPage: true });
      } catch {
        // Last resort — capture whatever is in the current viewport.
        await page.screenshot({ path: filepath, fullPage: false });
      }
    } else {
      // Local: pre-scroll to trigger lazy loading, then expand viewport for a single capture.
      await scrollForLazyLoad(page);
      if (afterScroll) await afterScroll();
      const viewport   = page.viewportSize();
      const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      // Cap at 15000px — taller viewports can OOM-crash Chromium on Lambda.
      const safeHeight = Math.min(fullHeight, 15000);
      await page.setViewportSize({ width: viewport.width, height: safeHeight });
      await page.screenshot({ path: filepath, fullPage: false });
      await page.setViewportSize(viewport); // restore
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
