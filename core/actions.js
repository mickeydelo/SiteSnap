import { waitForNetworkIdle } from './utils.js';

/**
 * Execute an ordered list of actions, waiting for the network to settle
 * between each step.
 *
 * @param {import('playwright').Page} page
 * @param {object[]} actions
 */
// Actions that may trigger network requests and need an idle wait after them.
const NETWORK_ACTIONS = new Set(['click', 'acceptCookies', 'select']);

export async function executeActions(page, actions) {
  for (const action of actions) {
    await executeAction(page, action);
    if (NETWORK_ACTIONS.has(action.type)) {
      await waitForNetworkIdle(page, 2000);
    } else {
      await page.waitForTimeout(100); // input / checkbox — no network, just a repaint tick
    }
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
  // Scoped selectors first so we don't accidentally click a non-cookie button
  const candidates = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#onetrust-banner-sdk button[class*="accept"]',
    '.ot-sdk-container button[class*="accept"]',
    '[id*="cookie"] button[id*="accept" i]',
    '[class*="cookie"] button[id*="accept" i]',
    '[class*="cookie-banner"] button',
    '[class*="cookie-consent"] button',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Allow All")',
  ];

  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        // Give the page time to animate the banner out and render what's next
        await page.waitForTimeout(900);
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
  // Wait up to 15 s for the element to be attached to the DOM before trying
  // any click strategy. 'attached' fires earlier than 'visible' and lets us
  // confirm the node exists even if it's still animating in.
  try {
    await page.getByText(text, { exact: false }).first()
      .waitFor({ state: 'attached', timeout: 15000 });
  } catch {
    // Not found via getByText — keep going; the DOM-walk fallback will catch it.
  }

  const strategies = [
    // 0. Wait for .modal__content to be visible, then click .button--primary
    //    inside it. Does NOT rely on text matching — works even if the label has
    //    invisible characters or non-breaking spaces.
    async () => {
      await page.locator('.modal__content').first()
        .waitFor({ state: 'visible', timeout: 8000 });
      await page.locator('.modal__content .button--primary').first()
        .click({ timeout: 5000 });
    },
    // 1. .button--primary filtered by text, normal click
    async () => page.locator('button.button--primary, a.button--primary')
      .filter({ hasText: text }).first().click({ timeout: 5000 }),
    // 2. .button--primary filtered by text, force-click (mid-animation)
    async () => page.locator('button.button--primary, a.button--primary')
      .filter({ hasText: text }).first().click({ force: true, timeout: 5000 }),
    // 3. Any modal/dialog container
    async () => page
      .locator('.modal__content, .modal, [role="dialog"], [class*="modal"]').first()
      .getByText(text, { exact: false }).first().click({ timeout: 5000 }),
    // 4. Standard ARIA roles
    async () => page.getByRole('button', { name: text, exact: false }).first().click({ timeout: 5000 }),
    async () => page.getByRole('link',   { name: text, exact: false }).first().click({ timeout: 5000 }),
    // 5. Plain text locator
    async () => page.getByText(text, { exact: false }).first().click({ timeout: 5000 }),
    // 6. JavaScript DOM walk — normalises whitespace and &nbsp;, calls
    //    .click() directly on the node, bypassing all Playwright checks.
    async () => {
      const hit = await page.evaluate(searchText => {
        const norm = t => t.toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim();
        const needle = norm(searchText);
        const els = [...document.querySelectorAll('button, a, [role="button"], [class*="btn"]')];
        const match = els.find(el => norm(el.textContent).includes(needle));
        if (match) { match.click(); return true; }
        return false;
      }, text);
      if (!hit) throw new Error('DOM walk: no match');
    },
  ];

  for (const attempt of strategies) {
    try {
      await attempt();
      return;
    } catch {
      // try next
    }
  }

  // ── All strategies failed — save a diagnostic screenshot ──────────────────
  try {
    const debugPath = `/tmp/sitesnap-click-debug-${Date.now()}.png`;
    await page.screenshot({ path: debugPath, fullPage: false });
    console.error(`\n[debug] Saved screenshot → ${debugPath}`);
    const html = await page.evaluate(() => document.body.innerHTML.slice(0, 4000));
    console.error('[debug] Body (first 4000 chars):\n', html, '\n');
  } catch { /* best-effort */ }

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
  // 1. Native <select>
  try {
    const el = page.getByLabel(label, { exact: false }).first();
    const isNative = await el.evaluate(e => e.tagName === 'SELECT').catch(() => false);
    if (isNative) {
      await el.selectOption({ label: value });
      return;
    }
  } catch { /* not native */ }

  // 2. Mobile: filters may be behind a toggle button (e.g. a "Filters" pill that opens
  //    a modal dialog containing the real dropdowns). Open it if not already open.
  try {
    const alreadyOpen = await page.locator('.filters-modal.is-open').count();
    if (alreadyOpen === 0) {
      const toggle = page.locator(
        '.filters-toggle button, [class*="filters-toggle"] button'
      ).first();
      if (await toggle.isVisible({ timeout: 800 })) {
        await toggle.click();
        await page.waitForTimeout(500);
      }
    }
  } catch { /* not present on this page/device */ }

  // 3. Open the custom dropdown via any of these triggers
  await openDropdownTrigger(page, label);

  // 4. Pick the option — try every known pattern for custom dropdown lists
  await pickDropdownOption(page, value);
}

async function openDropdownTrigger(page, label) {
  const triggers = [
    () => page.getByRole('combobox', { name: label, exact: false }).first().click({ timeout: 4000 }),
    () => page.getByLabel(label, { exact: false }).first().click({ timeout: 4000 }),
    // Heading / visible label text that acts as a dropdown toggle
    () => page.getByText(label, { exact: false }).first().click({ timeout: 4000 }),
  ];

  for (const t of triggers) {
    try {
      await t();
      // Wait for the dropdown list to open — look for any newly visible list
      // container. If nothing matches in 2 s, fall through to the next trigger.
      try {
        await page.locator(
          '[role="listbox"], [class*="dropdown__menu"], [class*="select__menu"], ' +
          '[class*="dropdown-menu"], ul[class*="list"], [class*="options"]'
        ).first().waitFor({ state: 'visible', timeout: 2000 });
      } catch { /* dropdown may use different markup — keep going */ }
      await page.waitForTimeout(300);
      return;
    } catch { /* try next trigger */ }
  }
  throw new Error(`Could not open dropdown labelled: "${label}"`);
}

async function pickDropdownOption(page, value) {
  // After the dropdown opens, try every reasonable way to locate the option.
  // Custom dropdowns render as <li>, <div>, <span>, etc. — not always role=option.
  const strategies = [
    // ARIA roles
    () => page.getByRole('option',  { name: value, exact: false }).first().click({ timeout: 4000 }),
    () => page.getByRole('listbox').getByText(value, { exact: false }).first().click({ timeout: 4000 }),
    // Common CSS patterns for custom dropdowns
    () => page.locator(`[role="listbox"] [role="option"]:has-text("${value}")`).first().click({ timeout: 4000 }),
    () => page.locator(`ul[role="listbox"] li`).filter({ hasText: value }).first().click({ timeout: 4000 }),
    () => page.locator(`ul li`).filter({ hasText: value }).first().click({ timeout: 4000 }),
    () => page.locator(`[class*="dropdown"] [class*="option"]`).filter({ hasText: value }).first().click({ timeout: 4000 }),
    () => page.locator(`[class*="dropdown"] [class*="item"]`).filter({ hasText: value }).first().click({ timeout: 4000 }),
    () => page.locator(`[class*="select"] [class*="option"]`).filter({ hasText: value }).first().click({ timeout: 4000 }),
    () => page.locator(`[class*="menu"] [class*="item"]`).filter({ hasText: value }).first().click({ timeout: 4000 }),
    // Broad fallback — any newly visible text node
    () => page.getByText(value, { exact: true  }).first().click({ timeout: 4000 }),
    () => page.getByText(value, { exact: false }).first().click({ timeout: 4000 }),
    // JavaScript click on any element whose trimmed text matches
    async () => {
      const hit = await page.evaluate(val => {
        const norm = t => t.replace(/[\s\u00a0]+/g, ' ').trim();
        const needle = norm(val);
        const candidates = [...document.querySelectorAll('li, [role="option"], [class*="item"], [class*="option"]')];
        const match = candidates.find(el => norm(el.textContent) === needle
          || norm(el.textContent).startsWith(needle));
        if (match) { match.click(); return true; }
        return false;
      }, value);
      if (!hit) throw new Error('DOM walk: no option match');
    },
  ];

  for (const s of strategies) {
    try { await s(); return; } catch { /* try next */ }
  }

  // Diagnostic screenshot so the dropdown state is visible
  try {
    const debugPath = `/tmp/sitesnap-select-debug-${Date.now()}.png`;
    await page.screenshot({ path: debugPath });
    console.error(`[debug] Select failed — screenshot → ${debugPath}`);
  } catch { /* best-effort */ }

  throw new Error(`Could not select option: "${value}"`);
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

async function handleCheckbox(page, label, value) {
  const strategies = [
    // 1. Standard label association with a short timeout
    async () => {
      const cb = page.getByLabel(label, { exact: false }).first();
      await cb.waitFor({ state: 'attached', timeout: 5000 });
      if (value === true  && !(await cb.isChecked())) await cb.check();
      if (value === false &&  (await cb.isChecked())) await cb.uncheck();
    },
    // 2. <label> element containing the text, with a nested checkbox
    async () => {
      const cb = page.locator(`label:has-text("${label}") input[type="checkbox"]`).first();
      await cb.waitFor({ state: 'attached', timeout: 3000 });
      if (value === true  && !(await cb.isChecked())) await cb.check();
      if (value === false &&  (await cb.isChecked())) await cb.uncheck();
    },
    // 3. Force-check the first attached checkbox — handles custom-styled checkboxes
    //    where the native <input> is visually hidden (opacity:0, width:0, etc.)
    async () => {
      const cb = page.locator('input[type="checkbox"]').first();
      await cb.waitFor({ state: 'attached', timeout: 3000 });
      if (value === true  && !(await cb.isChecked())) await cb.check({ force: true });
      if (value === false &&  (await cb.isChecked())) await cb.uncheck({ force: true });
    },
    // 4. Any checkbox adjacent to text containing the label
    async () => {
      const cb = page.locator('input[type="checkbox"]')
        .filter({ has: page.locator(`xpath=./following-sibling::*[contains(., "${label}")]`) })
        .first();
      await cb.waitFor({ state: 'attached', timeout: 3000 });
      if (value === true  && !(await cb.isChecked())) await cb.check({ force: true });
      if (value === false &&  (await cb.isChecked())) await cb.uncheck({ force: true });
    },
    // 5. JavaScript — find by label text, fall back to first attached checkbox.
    //    Dispatches both click and change events for React/Vue forms.
    async () => {
      const done = await page.evaluate((searchLabel, targetValue) => {
        const norm = t => t.toLowerCase().replace(/\s+/g, ' ').trim();
        const needle = norm(searchLabel);

        // Try to find via <label> element
        let cb = null;
        for (const lbl of document.querySelectorAll('label')) {
          if (norm(lbl.textContent).includes(needle)) {
            const forId = lbl.getAttribute('for');
            cb = forId
              ? document.getElementById(forId)
              : lbl.querySelector('input[type="checkbox"]');
            if (cb) break;
          }
        }

        // Fall back to any non-disabled checkbox (including visually hidden ones)
        if (!cb) {
          cb = [...document.querySelectorAll('input[type="checkbox"]')]
            .find(el => !el.disabled);
        }

        if (!cb) return false;
        if (targetValue && !cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (!targetValue && cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }, label, value);

      if (!done) throw new Error('JS: checkbox not found');
    },
  ];

  for (const s of strategies) {
    try { await s(); return; } catch { /* try next */ }
  }

  throw new Error(`Could not handle checkbox: "${label}"`);
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
