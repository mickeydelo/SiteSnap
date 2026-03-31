import { waitForNetworkIdle } from './utils.js';

/**
 * Execute an ordered list of actions, waiting for the network to settle
 * between each step.
 *
 * @param {import('playwright').Page} page
 * @param {object[]} actions
 */
export async function executeActions(page, actions) {
  for (const action of actions) {
    await executeAction(page, action);
    await page.waitForTimeout(300);
    await waitForNetworkIdle(page, 3000);
  }
}

async function executeAction(page, action) {
  switch (action.type) {
    case 'acceptCookies': return acceptCookies(page);
    case 'click':         return clickByText(page, action.text);
    case 'input':         return fillInput(page, action.label, action.value);
    case 'select':        return selectOption(page, action.label, action.value);
    case 'checkbox':      return handleCheckbox(page, action.label, action.value);
    default:
      console.warn(`[actions] Unknown action type: "${action.type}"`);
  }
}

// ---------------------------------------------------------------------------
// Cookie consent
// ---------------------------------------------------------------------------

async function acceptCookies(page) {
  const candidates = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    'button[id*="accept" i]',
    '[aria-label*="accept" i][role="button"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow All")',
  ];

  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // try next candidate
    }
  }
}

// ---------------------------------------------------------------------------
// Click by visible text
// ---------------------------------------------------------------------------

async function clickByText(page, text) {
  const strategies = [
    () => page.getByRole('button', { name: text, exact: false }).first().click({ timeout: 5000 }),
    () => page.getByRole('link',   { name: text, exact: false }).first().click({ timeout: 5000 }),
    () => page.getByText(text, { exact: false }).first().click({ timeout: 5000 }),
  ];

  for (const attempt of strategies) {
    try {
      await attempt();
      return;
    } catch {
      // try next strategy
    }
  }

  throw new Error(`Could not click element with text: "${text}"`);
}

// ---------------------------------------------------------------------------
// Input fill
// ---------------------------------------------------------------------------

async function fillInput(page, label, value) {
  // Primary: Playwright label association (for/aria-labelledby)
  try {
    await page.getByLabel(label, { exact: false }).first().fill(value);
    return;
  } catch {
    // fallback
  }

  // Secondary: match placeholder text
  try {
    await page.getByPlaceholder(label, { exact: false }).first().fill(value);
    return;
  } catch {
    // fallback
  }

  throw new Error(`Could not find input for label: "${label}"`);
}

// ---------------------------------------------------------------------------
// Select / custom dropdown
// ---------------------------------------------------------------------------

async function selectOption(page, label, value) {
  // 1. Native <select> via label association
  try {
    const el = page.getByLabel(label, { exact: false }).first();
    const isNative = await el.evaluate(e => e.tagName === 'SELECT').catch(() => false);
    if (isNative) {
      await el.selectOption({ label: value });
      return;
    }
  } catch {
    // not a native select
  }

  // 2. ARIA combobox
  try {
    const combo = page.getByRole('combobox', { name: label, exact: false }).first();
    if (await combo.isVisible({ timeout: 1000 })) {
      await combo.click();
      await page.waitForTimeout(350);
      await page.getByRole('option', { name: value, exact: false }).first().click({ timeout: 5000 });
      return;
    }
  } catch {
    // not a combobox
  }

  // 3. Generic: click the label text to open the custom dropdown, then pick option
  const trigger = page.getByText(label, { exact: false }).first();
  await trigger.click({ timeout: 5000 });
  await page.waitForTimeout(350);
  await page.getByRole('option', { name: value, exact: false }).first().click({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

async function handleCheckbox(page, label, value) {
  const cb = page.getByLabel(label, { exact: false }).first();
  const checked = await cb.isChecked();
  if (value === true  && !checked) await cb.check();
  if (value === false &&  checked) await cb.uncheck();
}

// ---------------------------------------------------------------------------
// Login injection (auto-detect form after entry actions)
// ---------------------------------------------------------------------------

/**
 * After entry actions, detect a login form and inject credentials.
 * Credentials are never logged or stored.
 *
 * @param {import('playwright').Page} page
 * @param {{ username: string, password: string }} credentials
 * @returns {boolean} true if login was performed
 */
export async function injectLogin(page, credentials) {
  const pwdField = page.locator('input[type="password"]').first();

  try {
    await pwdField.waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    return false; // No login form present
  }

  // Find the username / email field
  const usernameSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[id*="email" i]',
    'input[id*="username" i]',
  ];

  for (const sel of usernameSelectors) {
    const el = page.locator(sel).first();
    try {
      if (await el.isVisible({ timeout: 500 })) {
        await el.fill(credentials.username);
        await pwdField.fill(credentials.password);
        await pwdField.press('Enter');
        await waitForNetworkIdle(page, 10000);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Password-only form (token / PIN)
  await pwdField.fill(credentials.password);
  await pwdField.press('Enter');
  await waitForNetworkIdle(page, 10000);
  return true;
}
