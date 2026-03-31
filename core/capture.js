export async function captureScreenshot(page, filepath, { fullPage = true, afterScroll = null } = {}) {
  if (fullPage) {
    await scrollForLazyLoad(page);
    // Re-apply any suppression (e.g. ISI drawer) after scroll — sticky elements
    // can re-attach to the DOM during the lazy-load scroll pass.
    if (afterScroll) await afterScroll();
  }
  await page.screenshot({ path: filepath, fullPage });
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
