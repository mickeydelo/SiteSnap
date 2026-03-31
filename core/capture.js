/**
 * Take a screenshot and write it to disk.
 * When fullPage is true, scrolls through the page first to trigger lazy-loaded
 * images and content before capturing.
 *
 * @param {import('playwright').Page} page
 * @param {string} filepath  Absolute output path (including filename)
 * @param {{ fullPage?: boolean }} options
 */
export async function captureScreenshot(page, filepath, { fullPage = true } = {}) {
  if (fullPage) {
    await scrollForLazyLoad(page);
  }
  await page.screenshot({ path: filepath, fullPage });
}

/**
 * Scroll from top to bottom in small steps to trigger lazy-loaded content,
 * then scroll back to the top before the screenshot is taken.
 *
 * @param {import('playwright').Page} page
 */
export async function scrollForLazyLoad(page) {
  await page.evaluate(async () => {
    const STEP      = 400;  // px per scroll increment
    const DELAY     = 80;   // ms between steps
    const MAX_STEPS = 60;   // cap at ~24 000 px to avoid infinite-scroll traps

    for (let i = 0; i < MAX_STEPS; i++) {
      window.scrollBy(0, STEP);
      await new Promise(r => setTimeout(r, DELAY));

      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 10;

      if (atBottom) break;
    }

    // Return to top so the viewport header is visible in the capture
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
  });

  // Give the browser a tick to repaint after the scroll reset
  await page.waitForTimeout(300);
}
