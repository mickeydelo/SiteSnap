/**
 * Wait for network to go idle. Tolerates timeout — some pages never fully idle.
 *
 * @param {import('playwright').Page} page
 * @param {number} timeout ms
 */
export async function waitForNetworkIdle(page, timeout = 3000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Acceptable — network may not fully idle on SPAs
  }
}

/**
 * Inject a persistent style that permanently suppresses the ISI tray.
 * Must be re-applied after each navigation since addStyleTag is page-scoped.
 *
 * @param {import('playwright').Page} page
 */
export async function hideISITray(page) {
  await page.addStyleTag({
    content: `
      .isi-tray,
      [class*="isi-tray"],
      [id*="isi-tray"],
      [class*="isi_tray"],
      [id*="isi_tray"] {
        display:         none         !important;
        visibility:      hidden       !important;
        opacity:         0            !important;
        pointer-events:  none         !important;
      }
    `.trim(),
  });
}

/**
 * Wait for a named condition before capturing.
 *
 * Supported values:
 *   "no-results"   — wait for filter results to settle after selection
 *   "network-idle" — explicit network idle wait
 *
 * @param {import('playwright').Page} page
 * @param {string} condition
 */
export async function waitForCondition(page, condition) {
  switch (condition) {
    case 'no-results':
      // executeActions already waited for networkidle after each select —
      // just give the DOM a short tick to finish rendering the empty state.
      await page.waitForTimeout(600);
      // Mobile: close the filters modal so the filtered page is visible in the screenshot
      try {
        const modal = page.locator('.filters-modal.is-open, [role="dialog"][aria-modal="true"]').first();
        if (await modal.isVisible({ timeout: 400 })) {
          // Try common close/apply buttons inside the modal first
          const closeBtn = modal.locator(
            'button:has-text("Apply"), button:has-text("Done"), ' +
            'button:has-text("Close"), button[class*="close" i], button[aria-label*="close" i]'
          ).first();
          if (await closeBtn.isVisible({ timeout: 500 })) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(400);
        }
      } catch { /* no modal open */ }
      break;
    case 'network-idle':
      await waitForNetworkIdle(page);
      break;
    default:
      await waitForNetworkIdle(page);
  }
}
