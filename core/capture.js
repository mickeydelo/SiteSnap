const ON_LAMBDA = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

export async function captureScreenshot(page, filepath, { fullPage = true, afterScroll = null } = {}) {
  if (fullPage) {
    // On Lambda: skip the lazy-load scroll. It pre-loads all images into Chromium memory,
    // and the subsequent setViewportSize triggers a repaint of all of them at once → OOM.
    if (!ON_LAMBDA) await scrollForLazyLoad(page);
    if (afterScroll) await afterScroll();

    const viewport   = page.viewportSize();
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    // Mobile layouts stack content vertically and are 2–3× taller than desktop.
    // On Lambda, expanding to full mobile height OOMs Chromium even without pre-scroll
    // (IntersectionObserver fires for all newly-visible elements simultaneously).
    // Cap mobile at 5000px on Lambda — captures all critical content without crashing.
    // Desktop pages are typically shorter, so the 15000px cap is rarely hit.
    const isMobile   = viewport.width <= 768;
    const maxHeight  = ON_LAMBDA && isMobile ? 5000 : 15000;
    const safeHeight = Math.min(fullHeight, maxHeight);

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
