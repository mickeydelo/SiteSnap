import { waitForCondition, waitForNetworkIdle, firstVisible } from './utils.js';

const NETWORK_ACTIONS = new Set(['click', 'select', 'acceptCookies']);

/** Execute a declarative action list. Optional actions never fail the step. */
export async function executeActions(page, actions = [], onLog = null) {
  for (const action of actions) {
    try {
      await executeAction(page, action);
    } catch (error) {
      if (!action.optional) throw error;
      await onLog?.(`    [optional] ${describeAction(action)} — ${error.message}`);
    }

    if (action.settle === 'network-idle' || action.settle === true) {
      await waitForNetworkIdle(page, Number(action.settleTimeoutMs) || 4000);
    } else if (NETWORK_ACTIONS.has(action.type) && action.settle !== false) {
      await waitForNetworkIdle(page, Number(action.settleTimeoutMs) || 1800);
    }

    const delay = Number(action.delayMs);
    if (delay > 0) await page.waitForTimeout(delay);
    else await page.waitForTimeout(action.type === 'input' ? 50 : 150);
  }
}

async function executeAction(page, action) {
  switch (action.type) {
    case 'acceptCookies':
      return acceptCookies(page, action);
    case 'click':
      return action.selector
        ? clickBySelector(page, action.selector, action)
        : clickByText(page, action.text, action);
    case 'input':
      return fillInput(page, action);
    case 'select':
      return selectOption(page, action);
    case 'checkbox':
      return handleCheckbox(page, action);
    case 'wait':
      return page.waitForTimeout(Number(action.ms) || 500);
    case 'waitFor':
      return waitForCondition(page, action);
    case 'scrollTo':
      return scrollTo(page, action);
    case 'press':
      return page.keyboard.press(action.key || 'Escape');
    default:
      throw new Error(`Unknown action type: "${action.type}"`);
  }
}

async function acceptCookies(page, action = {}) {
  const candidates = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#onetrust-banner-sdk button[class*="accept" i]',
    '[id*="cookie" i] button[id*="accept" i]',
    '[class*="cookie-banner" i] button',
    '[class*="cookie-consent" i] button',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Allow All")',
  ];

  const selector = candidates.join(', ');
  const deadline = Date.now() + (Number(action.timeoutMs) || 3000);
  do {
    const elements = page.locator(selector);
    const count = await elements.count();
    for (let index = 0; index < count; index += 1) {
      const element = elements.nth(index);
      if (await element.isVisible().catch(() => false)) {
        await element.click({ timeout: 3000 });
        await page.waitForTimeout(250);
        return true;
      }
    }
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);

  throw new Error('Cookie notice was not present');
}

async function clickBySelector(page, selector, action = {}) {
  const element = await visibleLocator(page, selector, Number(action.timeoutMs) || 10000);
  await element.click({
    timeout: Number(action.timeoutMs) || 10000,
    force: action.force === true,
  });
}

export async function clickByText(page, text, action = {}) {
  if (!text) throw new Error('Click action requires text or selector');
  const timeout = Number(action.timeoutMs) || 10000;
  const exact = action.exact !== false;
  const strategies = [
    page.getByRole('button', { name: text, exact }).filter({ visible: true }).first(),
    page.getByRole('link', { name: text, exact }).filter({ visible: true }).first(),
    page.getByText(text, { exact }).filter({ visible: true }).first(),
  ];

  for (const locator of strategies) {
    try {
      await locator.waitFor({ state: 'visible', timeout: Math.min(timeout, 3500) });
      await locator.click({ timeout, force: action.force === true });
      return;
    } catch {
      // Try the next semantic locator.
    }
  }
  throw new Error(`Could not click visible text: "${text}"`);
}

async function fillInput(page, action) {
  const timeout = Number(action.timeoutMs) || 10000;
  let element;
  if (action.selector) {
    element = await visibleLocator(page, action.selector, timeout);
  } else if (action.label) {
    element = page.getByLabel(action.label, { exact: action.exact === true }).filter({ visible: true }).first();
    await element.waitFor({ state: 'visible', timeout });
  } else {
    throw new Error('Input action requires a selector or label');
  }
  await element.fill(String(action.value ?? ''));
}

async function selectOption(page, action) {
  const timeout = Number(action.timeoutMs) || 10000;
  let element;
  if (action.selector) {
    element = await visibleLocator(page, action.selector, timeout);
  } else if (action.label) {
    element = page.getByLabel(action.label, { exact: action.exact === true }).filter({ visible: true }).first();
    await element.waitFor({ state: 'visible', timeout });
  } else {
    throw new Error('Select action requires a selector or label');
  }

  const isNative = await element.evaluate(node => node.tagName === 'SELECT');
  if (isNative) {
    try {
      await element.selectOption({ label: String(action.value) });
    } catch {
      await element.selectOption(String(action.value));
    }
    return;
  }

  await element.click();
  await clickByText(page, String(action.value), { exact: true, timeoutMs: timeout });
}

async function handleCheckbox(page, action) {
  const timeout = Number(action.timeoutMs) || 10000;
  const element = action.selector
    ? await attachedLocator(page, action.selector, timeout)
    : page.getByLabel(action.label, { exact: action.exact === true }).first();
  await element.waitFor({ state: 'attached', timeout });
  if (action.value === false) await element.uncheck({ force: action.force === true });
  else await element.check({ force: action.force === true });
}

async function scrollTo(page, action) {
  if (action.selector) {
    const element = await visibleLocator(page, action.selector, Number(action.timeoutMs) || 10000);
    await element.scrollIntoViewIfNeeded();
  } else {
    await page.evaluate(position => window.scrollTo(0, Number(position) || 0), action.y || 0);
  }
  if (action.offset) {
    await page.evaluate(offset => window.scrollBy(0, Number(offset) || 0), action.offset);
  }
}

async function visibleLocator(page, selector, timeout) {
  const visible = firstVisible(page, selector);
  await visible.waitFor({ state: 'visible', timeout });
  return visible;
}

async function attachedLocator(page, selector, timeout) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'attached', timeout });
  return locator;
}

function describeAction(action) {
  return `${action.type}${action.text ? ` "${action.text}"` : ''}${action.selector ? ` ${action.selector}` : ''}`;
}
