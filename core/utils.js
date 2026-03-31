/**
 * Wait for network to go idle. Tolerates timeout — some pages never fully idle.
 *
 * @param {import('playwright').Page} page
 * @param {number} timeout ms
 */
export async function waitForNetworkIdle(page, timeout = 5000) {
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
      // Let any in-flight filter XHRs complete, then allow DOM to settle
      await waitForNetworkIdle(page);
      await page.waitForTimeout(1500);
      break;
    case 'network-idle':
      await waitForNetworkIdle(page);
      break;
    default:
      await waitForNetworkIdle(page);
  }
}
