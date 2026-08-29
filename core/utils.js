/** Wait for network quiet without treating analytics or long polling as fatal. */
export async function waitForNetworkIdle(page, timeout = 2500) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Some third-party pages never become perfectly idle.
  }
}

/** Wait for a string shortcut or a structured selector/text condition. */
export async function waitForCondition(page, condition) {
  if (!condition) return;

  if (typeof condition === 'number') {
    await page.waitForTimeout(condition);
    return;
  }

  if (typeof condition === 'object') {
    const timeout = Number(condition.timeoutMs) || 10000;
    if (condition.selector) {
      await firstVisible(page, condition.selector).waitFor({
        state: condition.state || 'visible',
        timeout,
      });
    } else if (condition.text) {
      await page.getByText(condition.text, { exact: condition.exact === true })
        .filter({ visible: true })
        .first()
        .waitFor({ state: condition.state || 'visible', timeout });
    }
    if (condition.delayMs) await page.waitForTimeout(Number(condition.delayMs));
    return;
  }

  if (condition === 'network-idle') {
    await waitForNetworkIdle(page, 4000);
    return;
  }

  await page.waitForTimeout(350);
}

export function firstVisible(page, selector) {
  return page.locator(selector).filter({ visible: true }).first();
}
