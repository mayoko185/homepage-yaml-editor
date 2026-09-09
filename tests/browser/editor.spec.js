const fs = require('node:fs/promises');
const path = require('node:path');
const jsyaml = require('js-yaml');
const { test, expect } = require('@playwright/test');
const {
  accountBrowserErrors,
  registerExpectedError,
  watchConsoleErrors
} = require('./browser-error-accounting');

const configDir = process.env.HOMEPAGE_BROWSER_TEST_DIR;
const servicesPath = path.join(configDir, 'services.yaml');
const settingsPath = path.join(configDir, 'settings.yaml');
const bookmarksPath = path.join(configDir, 'bookmarks.yaml');
const widgetsPath = path.join(configDir, 'widgets.yaml');
const baseServices = '- Main:\n    - Alpha:\n        href: https://example.test\n        description: First service\n';
const saveConflictMessage = 'Failed to load resource: the server responded with a status of 409 (Conflict)';
const saveConflictUrl = 'http://127.0.0.1:4173/api/directory/file/save';
const consoleErrorsByPage = new WeakMap();
const expectedErrorsByPage = new WeakMap();

async function setEditorValue(page, value) {
  await page.locator('.CodeMirror').evaluate((element, nextValue) => {
    element.CodeMirror.setValue(nextValue);
  }, value);
}

async function getEditorValue(page) {
  return page.locator('.CodeMirror').evaluate((element) => element.CodeMirror.getValue());
}

async function getEditorPosition(page) {
  return page.locator('.CodeMirror').evaluate((element) => {
    const editor = element.CodeMirror;
    const cursor = editor.getCursor();
    return { line: cursor.line, ch: cursor.ch, text: editor.getLine(cursor.line) };
  });
}

test.beforeEach(async ({ page }) => {
  consoleErrorsByPage.set(page, watchConsoleErrors(page));
  expectedErrorsByPage.set(page, []);
  await fs.writeFile(servicesPath, baseServices, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
});

test.afterEach(async ({ page }) => {
  const { missingExpected, unexpected } = accountBrowserErrors(
    consoleErrorsByPage.get(page),
    expectedErrorsByPage.get(page)
  );
  expect(missingExpected, 'Every registered browser error must occur').toEqual([]);
  expect(unexpected, 'Unexpected browser errors must fail normal teardown').toEqual([]);
});

test('browser error accounting preserves one expected save conflict and rejects a duplicate', () => {
  const conflict = {
    type: 'console',
    text: saveConflictMessage,
    url: saveConflictUrl
  };
  const duplicateConflict = { ...conflict };
  const expectedErrors = [];

  registerExpectedError(
    expectedErrors,
    (entry) => entry.type === 'console'
      && entry.text === saveConflictMessage
      && entry.url === saveConflictUrl,
    'the expected configuration-file save conflict'
  );

  const result = accountBrowserErrors([conflict, duplicateConflict], expectedErrors);
  expect(result.missingExpected).toEqual([]);
  expect(result.unexpected).toEqual([duplicateConflict]);

  expect(() => {
    const { missingExpected, unexpected } = accountBrowserErrors(
      [conflict, duplicateConflict],
      expectedErrors
    );
    expect(missingExpected, 'Every registered browser error must occur').toEqual([]);
    expect(unexpected, 'Unexpected browser errors must fail normal teardown').toEqual([]);
  }).toThrow();
});

test('shows the persistent no-login warning without console errors', async ({ page }) => {
  await page.reload();
  await expect(page.locator('#security-status')).toBeVisible();
  await expect(page.locator('#security-status')).toContainText('Authentication is disabled');
});

test('retains unsaved YAML while switching tabs and navigates preview items to source', async ({ page }) => {
  const changedServices = `${baseServices}    - Beta:\n        href: https://beta.example\n`;
  await setEditorValue(page, changedServices);
  await page.locator('.tab[data-tab="settings"]').click();
  await page.locator('.tab[data-tab="services"]').click();
  expect(await getEditorValue(page)).toBe(changedServices);

  await page.locator('#preview-edit-toggle').uncheck({ force: true });

  await page.locator('.dashboard-card', { hasText: 'Alpha' }).click();
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
});

test('rejects stale saves while preserving disk and editor content', async ({ page }) => {
  const browserContent = '- Main:\n    - Browser edit: {}\n';
  const externalContent = '- Main:\n    - External edit: {}\n';
  await setEditorValue(page, browserContent);
  await fs.writeFile(servicesPath, externalContent, 'utf8');
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text === saveConflictMessage
      && entry.url === saveConflictUrl,
    'the expected stale configuration-file save conflict'
  );
  await page.locator('#save-config-button').click();

  await expect(page.locator('#save-status')).toContainText('changed on disk');
  expect(await fs.readFile(servicesPath, 'utf8')).toBe(externalContent);
  expect(await getEditorValue(page)).toBe(browserContent);
  await expect(page.locator('#unsaved-status')).toBeVisible();
});

test('escapes hostile YAML names in the preview', async ({ page }) => {
  const hostileName = '<img src=x onerror="window.previewInjected=true">';
  await setEditorValue(page, `- Main:\n    - "${hostileName.replace(/"/g, '\\"')}": {}\n`);
  await expect(page.locator('.dashboard-card-title')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.previewInjected)).toBeUndefined();
  await expect(page.locator('#visual-preview img[src="x"]')).toHaveCount(0);
});

test('nested commented service card is visible in preview', async ({ page }) => {
  const nestedServices = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
        - Beta:
            href: https://beta.test
`;
  await setEditorValue(page, nestedServices);
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });
  await expect(page.locator('.dashboard-card', { hasText: 'Alpha' })).toBeVisible();
  await expect(page.locator('.dashboard-card', { hasText: 'Beta' })).toBeVisible();

  // Comment out Beta by editing the YAML directly
  const commentedNested = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
        # - Beta:
        #     href: https://beta.test
`;
  await setEditorValue(page, commentedNested);
  await page.waitForTimeout(500);
  // The commented Beta card should still be visible with commented styling
  await expect(page.locator('.dashboard-card', { hasText: 'Beta' })).toBeVisible();
  await expect(page.locator('.dashboard-card--commented', { hasText: 'Beta' })).toHaveCount(1);
});

test('nested commented group keeps descendants visible in preview', async ({ page }) => {
  const nestedGroup = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
        - Beta:
            href: https://beta.test
`;
  await setEditorValue(page, nestedGroup);
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });
  await expect(page.locator('.dashboard-card', { hasText: 'Alpha' })).toBeVisible();
  await expect(page.locator('.dashboard-card', { hasText: 'Beta' })).toBeVisible();

  // Comment out the entire SubGroup
  const commentedGroup = `- Main:
    # - SubGroup:
    #     - Alpha:
    #         href: https://alpha.test
    #     - Beta:
    #         href: https://beta.test
`;
  await setEditorValue(page, commentedGroup);
  await page.waitForTimeout(500);
  // SubGroup should be visible as a commented group
  await expect(page.locator('.dashboard-nested-group', { hasText: 'SubGroup' })).toBeVisible();
  await expect(page.locator('.dashboard-nested-group--commented', { hasText: 'SubGroup' })).toHaveCount(1);
  // Descendants should also be visible with commented styling
  await expect(page.locator('.dashboard-card--commented', { hasText: 'Alpha' })).toHaveCount(1);
  await expect(page.locator('.dashboard-card--commented', { hasText: 'Beta' })).toHaveCount(1);
});

test('commented service card is not draggable', async ({ page }) => {
  const yaml = `- Active Group:
    - Alpha:
        href: https://alpha.test
# - Commented Group:
#     - Beta:
#         href: https://beta.test
`;
  await fs.writeFile(servicesPath, yaml, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Commented service card must not have draggable attribute
  const commentedCard = page.locator('.dashboard-card--commented', { hasText: 'Beta' });
  await expect(commentedCard).toBeVisible();
  await expect(commentedCard).not.toHaveAttribute('draggable', 'true');

  // Active service card must still be draggable
  const activeCard = page.locator('.dashboard-card:not(.dashboard-card--commented)', { hasText: 'Alpha' });
  await expect(activeCard).toHaveAttribute('draggable', 'true');
});

test('commented group has no drop zone and no movement buttons', async ({ page }) => {
  const yaml = `- Active Group:
    - Alpha:
        href: https://alpha.test
# - Commented Group:
#     - Beta:
#         href: https://beta.test
`;
  await fs.writeFile(servicesPath, yaml, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Commented group must not have a drop zone
  const commentedGroup = page.locator('.dashboard-group--commented', { hasText: 'Commented Group' });
  await expect(commentedGroup).toBeVisible();
  await expect(commentedGroup.locator('[data-preview-service-drop-zone]')).toHaveCount(0);

  // Commented group must not have move-up/move-down buttons
  await expect(commentedGroup.locator('.preview-edit-move-up')).toHaveCount(0);
  await expect(commentedGroup.locator('.preview-edit-move-down')).toHaveCount(0);

  // Active group must still have group-level movement buttons
  const activeGroup = page.locator('.dashboard-group:not(.dashboard-group--commented)', { hasText: 'Active Group' });
  await expect(activeGroup.locator('.dashboard-group-title > .preview-edit-actions > .preview-edit-move-up')).toHaveCount(1);
  await expect(activeGroup.locator('.dashboard-group-title > .preview-edit-actions > .preview-edit-move-down')).toHaveCount(1);
});

test('comment an option, save, reopen, and verify it remains commented and non-movable', async ({ page }) => {
  const yaml = `- Main:
    - Alpha:
        href: https://alpha.test
        description: First service
`;
  await fs.writeFile(servicesPath, yaml, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Open the edit dialog for Alpha
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).hover();
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).locator('.preview-edit-modify').click();
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  // Comment the description option
  const descriptionRow = page.locator('[data-preview-option-row]', { hasText: 'description' });
  await expect(descriptionRow).toBeVisible();
  await descriptionRow.locator('.preview-edit-comment').click();

  // Verify the option row now has commented styling
  await expect(descriptionRow).toHaveAttribute('data-preview-option-commented', 'true');

  // Verify commented option has no move-up/move-down buttons
  await expect(descriptionRow.locator('.preview-edit-move-up')).toHaveCount(0);
  await expect(descriptionRow.locator('.preview-edit-move-down')).toHaveCount(0);

  // Save the edit
  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('#preview-edit-modal')).not.toBeVisible();

  // Save the file
  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved');

  // Reopen the page
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Open the edit dialog again
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).hover();
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).locator('.preview-edit-modify').click();
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  // The description option must still be commented
  const reopenedRow = page.locator('[data-preview-option-row]', { hasText: 'description' });
  await expect(reopenedRow).toHaveAttribute('data-preview-option-commented', 'true');

  // Verify it still has no move-up/move-down buttons
  await expect(reopenedRow.locator('.preview-edit-move-up')).toHaveCount(0);
  await expect(reopenedRow.locator('.preview-edit-move-down')).toHaveCount(0);
});

test('commenting a widget option comments nested options visually', async ({ page }) => {
  const yaml = `- Main:
    - Alpha:
        href: https://alpha.test
        widget:
          type: customapi
          key: example
 `;
  await fs.writeFile(servicesPath, yaml, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  await page.locator('.dashboard-card', { hasText: 'Alpha' }).hover();
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).locator('.preview-edit-modify').click();
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  const widgetRow = page.locator('[data-preview-option-row]', { hasText: 'widget' }).first();
  const widgetNested = widgetRow.locator('[data-preview-nested-options]');
  await widgetRow.locator(':scope > .preview-edit-option-actions > .preview-edit-comment').click();

  await expect(widgetRow).toHaveAttribute('data-preview-option-commented', 'true');
  for (const optionName of ['type', 'key']) {
    const optionRow = widgetNested.locator('[data-preview-option-row]', { hasText: optionName });
    await expect(optionRow).toHaveAttribute('data-preview-option-commented', 'true');
    await expect(optionRow).toHaveClass(/preview-edit-option-row--commented/);
  }
});

test('service edit preserves a commented nested widget mapping', async ({ page }) => {
  const yaml = `- Main:
    - Emby:
        icon: emby.png
        href: https://emby.mayoko.page
        siteMonitor: https://emby.mayoko.page
        statusStyle: dot
        description: Movie/TV Show Media Server
        # widget:
        #   type: emby
        #   fields:
        #     - movies
        #     - series
        #     - episodes
        #   url: https://emby.lan.mayoko.page
        #   key: 8476b1e2dfbe4e1f93976dea207c5c77
        #   enableBlocks: true
`;
  await fs.writeFile(servicesPath, yaml, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  const card = page.locator('.dashboard-card', { hasText: 'Emby' });
  await card.hover();
  await card.locator('.preview-edit-modify').click();
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  const widgetRow = page.locator('[data-preview-option-row]').filter({ hasText: 'widget' }).first();
  const widgetNested = widgetRow.locator(':scope > [data-preview-nested-options]');
  await expect(widgetRow.locator(':scope > [data-preview-option-key]')).toHaveText('widget');
  await expect(widgetRow).toHaveAttribute('data-preview-option-commented', 'true');
  await expect(widgetNested.locator(':scope > [data-preview-option-row]')).toHaveCount(5);
  for (const optionName of ['type', 'fields', 'url', 'key', 'enableBlocks']) {
    await expect(widgetNested.locator(':scope > [data-preview-option-row]').filter({ hasText: optionName })).toHaveCount(1);
  }
  await expect(widgetNested.locator(':scope > [data-preview-option-row]').filter({ hasText: 'fields' }).locator('.preview-edit-option-value')).toHaveValue('["movies","series","episodes"]');

  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('#preview-edit-modal')).toBeHidden();

  const edited = await getEditorValue(page);
  expect(edited).toMatch(/^ {8}# widget:/m);
  expect(edited).toMatch(/^ {8}#   type: emby$/m);
  expect(edited).toMatch(/^ {8}#   fields:$/m);
  expect(edited).toMatch(/^ {8}#     - movies$/m);
  expect(edited).toMatch(/^ {8}#     - series$/m);
  expect(edited).toMatch(/^ {8}#     - episodes$/m);
  expect(edited).not.toMatch(/^ {8}# (?:type|fields|url|key|enableBlocks):/m);
});

test('adds a nested widget option, saves, reopens, and verifies it persists', async ({ page }) => {
  const yaml = `- Main:
    - Alpha:
        href: https://alpha.test
        widget:
          type: customapi
`;
  await fs.writeFile(servicesPath, yaml, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Open the edit dialog for Alpha
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).hover();
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).locator('.preview-edit-modify').click();
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  // Find the widget nested options container
  const widgetNested = page.locator('[data-preview-option-row]').filter({ hasText: 'widget' }).locator('[data-preview-nested-options]');
  await expect(widgetNested).toBeVisible();

  // Add a nested option inside widget
  await widgetNested.locator('[data-preview-option-add-child]').click();
  await page.waitForTimeout(300);

  // Select "key" from the new row's key dropdown
  const newOptionRow = widgetNested.locator('[data-preview-option-row]').last();
  await newOptionRow.locator('[data-preview-option-key]').selectOption('key');
  await page.waitForTimeout(300);

  // Fill the value
  await newOptionRow.locator('.preview-edit-option-value').fill('my-api-key');

  // Save the edit
  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('#preview-edit-modal')).not.toBeVisible();

  // Save the file
  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved');

  // Reopen the page
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Open the edit dialog again
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).hover();
  await page.locator('.dashboard-card', { hasText: 'Alpha' }).locator('.preview-edit-modify').click();
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  // The widget section should still have the key option with the saved value
  const reopenedWidgetNested = page.locator('[data-preview-option-row]').filter({ hasText: 'widget' }).locator('[data-preview-nested-options]');
  const keyRow = reopenedWidgetNested.locator('[data-preview-option-row]', { hasText: 'key' });
  await expect(keyRow).toBeVisible();
  await expect(keyRow.locator('.preview-edit-option-value')).toHaveValue('my-api-key');
});

test('nested group edit dialog hides convert button and tab location', async ({ page }) => {
  const services = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
        - Beta:
            href: https://beta.test
`;
  await fs.writeFile(servicesPath, services, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  // Open the edit dialog for the nested group SubGroup
  const nestedGroup = page.locator('.dashboard-nested-group', { hasText: 'SubGroup' });
  await expect(nestedGroup).toBeVisible();
  await nestedGroup.locator('.dashboard-nested-group-title .preview-edit-modify').click({ force: true });
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  // The convert button must not be present in the DOM
  await expect(page.locator('#preview-edit-group-convert')).toHaveCount(0);

  // The tab location section must be hidden
  await expect(page.locator('#preview-edit-group-location')).toBeHidden();
});

test('rejects nested-group drag and drop across parent scopes', async ({ page }) => {
  const services = `- Main:
    - Parent A:
        - Child A:
            - Alpha:
                href: https://alpha.test
- Other:
    - Parent B:
        - Child B:
            - Beta:
                href: https://beta.test
`;
  await setEditorValue(page, services);
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  const nestedGroups = page.locator('.dashboard-nested-group');
  await expect(nestedGroups).toHaveCount(4);
  const dragItems = await nestedGroups.evaluateAll((elements) => elements.map((element) => ({
    name: element.querySelector('.preview-jump-target')?.textContent.trim(),
    scope: element.dataset.previewDragScope
  })));
  expect(dragItems).toEqual([
    { name: 'Parent A', scope: 'group-Main-0' },
    { name: 'Child A', scope: 'group-Main-0/nested-Parent A-0' },
    { name: 'Parent B', scope: 'group-Other-0' },
    { name: 'Child B', scope: 'group-Other-0/nested-Parent B-0' }
  ]);

  const sourceIndex = await nestedGroups.evaluateAll((elements) => elements.findIndex((element) => (
    element.querySelector(':scope > .dashboard-nested-group-title > .preview-jump-target')?.textContent.trim() === 'Child A'
  )));
  const destinationIndex = await nestedGroups.evaluateAll((elements) => elements.findIndex((element) => (
    element.querySelector(':scope > .dashboard-nested-group-title > .preview-jump-target')?.textContent.trim() === 'Child B'
  )));
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  expect(destinationIndex).toBeGreaterThanOrEqual(0);
  const source = nestedGroups.nth(sourceIndex);
  const destination = nestedGroups.nth(destinationIndex);
  const originalServices = await getEditorValue(page);
  await source.dragTo(destination);
  await page.waitForTimeout(300);
  expect(await getEditorValue(page)).toBe(originalServices);
});

test('adds a nested group option, saves, reloads, and verifies it persists', async ({ page }) => {
  const services = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
`;
  const settings = `title: Browser Test
layout:
  Main:
    style: row
    columns: 2
`;
  await fs.writeFile(servicesPath, services, 'utf8');
  await fs.writeFile(settingsPath, settings, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);

  const nestedGroup = page.locator('.dashboard-nested-group', { hasText: 'SubGroup' });
  await expect(nestedGroup).toBeVisible();
  const nestedRoot = page.locator('details.dashboard-group-nested-root').first();
  await expect(nestedRoot.locator(':scope > .preview-add-group')).toHaveCSS('margin-top', '10px');
  await nestedGroup.locator('.dashboard-nested-group-title .preview-edit-modify').click({ force: true });
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  await page.locator('#preview-edit-add-option').click();
  const newGroupOption = page.locator('#preview-edit-options > [data-preview-option-row]').last();
  await newGroupOption.locator('[data-preview-option-key]').selectOption('columns');
  await newGroupOption.locator('.preview-edit-option-value').fill('3');
  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('#preview-edit-modal')).not.toBeVisible();

  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved');

  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.waitForTimeout(500);
  await page.locator('.dashboard-nested-group', { hasText: 'SubGroup' })
    .locator('.dashboard-nested-group-title .preview-edit-modify').click({ force: true });
  await expect(page.locator('#preview-edit-modal')).toBeVisible();

  const reopenedGroupOption = page.locator('#preview-edit-options > [data-preview-option-row]').last();
  await expect(reopenedGroupOption.locator('[data-preview-option-key]')).toHaveText('columns');
  await expect(reopenedGroupOption.locator('.preview-edit-option-value')).toHaveValue('3');
});

test('Jump to Settings targets the matching layout group', async ({ page }) => {
  await fs.writeFile(settingsPath, `title: Browser Jump Test
layout:
  Main:
    tab: Home
    style: row
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');

  await page.getByRole('checkbox', { name: 'Show editor' }).check({ force: true });
  await expect(page.locator('#jump-section-button')).toHaveAttribute('aria-label', 'Jump to Settings');
  await page.locator('#jump-section-button').click();

  await expect(page.locator('.tab[data-tab="settings"]')).toHaveClass(/active/);
  await expect.poll(() => getEditorPosition(page)).toEqual({ line: 2, ch: 2, text: '  Main:' });
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('Jump to Services targets the matching service group', async ({ page }) => {
  await fs.writeFile(settingsPath, `title: Browser Jump Test
layout:
  Main:
    tab: Home
    style: row
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');

  await page.getByRole('checkbox', { name: 'Show editor' }).check({ force: true });
  await page.locator('.tab[data-tab="settings"]').click();
  await page.locator('.CodeMirror').evaluate((element) => {
    element.CodeMirror.setCursor({ line: 2, ch: 2 });
  });
  await expect(page.locator('#jump-section-button')).toHaveAttribute('aria-label', 'Jump to Services');
  await page.locator('#jump-section-button').click();

  await expect(page.locator('.tab[data-tab="services"]')).toHaveClass(/active/);
  await expect.poll(() => getEditorPosition(page)).toEqual({ line: 0, ch: 0, text: '- Main:' });
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('opens Service Edit with populated select options and no page error', async ({ page }) => {
  await fs.writeFile(servicesPath, `- Main:
    - Alpha:
        href: https://alpha.test
        description: First service
        statusStyle: dot
`, 'utf8');
  await fs.writeFile(settingsPath, `title: Browser Test
layout:
  Main:
    tab: Home
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });

  const card = page.locator('.dashboard-card', { hasText: 'Alpha' });
  await card.hover();
  await card.locator('[data-preview-action="service.edit"]').click();

  await expect(page.locator('#preview-edit-modal')).toBeVisible();
  await expect(page.locator('#preview-edit-service-group option')).toHaveText(['Main — Home tab']);
  const statusStyleRow = page.locator('[data-preview-option-row]', { hasText: 'statusStyle' });
  const statusStyleSelect = statusStyleRow.locator('select');
  await expect(statusStyleSelect).toHaveValue('dot');
  expect(await statusStyleSelect.locator('option').allTextContents()).toEqual(expect.arrayContaining(['dot']));
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('preview tab interactions restore focus and stay console-safe', async ({ page }) => {
  await fs.writeFile(settingsPath, `title: Browser Test
layout:
  Main:
    tab: Home
  Other:
    tab: Admin
`, 'utf8');
  await fs.writeFile(bookmarksPath, `- Links:
    - Docs:
        abbr: DOCS
        href: https://docs.test
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });

  const homeTab = page.locator('.preview-tab:has(button[data-preview-tab="Home"])');
  const homeButton = homeTab.locator('.preview-tab-btn');
  const addTabButton = page.locator('.preview-tab-strip > .preview-add-tab');
  await expect(addTabButton).toHaveCount(1);
  await expect(addTabButton).toHaveText('+ Add tab');
  await expect(addTabButton).toHaveCSS('margin-left', '8px');
  await expect(page.locator('.preview-tab-strip > *').last()).toHaveClass(/preview-add-tab/);
  const tabHost = page.locator('#preview-tab-host');
  await expect(tabHost).toHaveCount(1);
  await expect(tabHost.locator(':scope > .preview-tab-navigation')).toHaveCount(1);
  await expect(page.locator('.preview-header > .preview-tab-navigation')).toHaveCount(0);
  await expect(page.locator('#visual-preview .preview-tab-navigation')).toHaveCount(0);
  await expect(page.locator('.dashboard-shell > .preview-tab-navigation')).toHaveCount(0);
  const tabItems = page.locator('.preview-tab-items');
  await expect(tabItems).toHaveCSS('border-bottom-width', '0px');
  const tabItemsBox = await tabItems.boundingBox();
  const lastTabBox = await tabItems.locator(':scope > .preview-tab').last().boundingBox();
  expect(tabItemsBox && lastTabBox).not.toBeNull();
  expect(Math.abs((tabItemsBox.x + tabItemsBox.width) - (lastTabBox.x + lastTabBox.width))).toBeLessThanOrEqual(1);
  const tabNavigation = page.locator('.preview-tab-navigation');
  await expect(tabNavigation).toHaveCSS('border-top-width', '0px');
  const pageContainer = page.locator('.container');
  await expect(pageContainer).toHaveCSS('padding-left', '12px');
  await expect(pageContainer).toHaveCSS('padding-right', '12px');
  const previewSection = page.locator('.preview-section.homepage-preview');
  await expect(previewSection).toHaveCSS('border-top-width', '0px');
  const previewCanvas = page.locator('.preview-canvas');
  await expect(previewCanvas).toHaveCSS('border-top-width', '0px');
  await expect(previewCanvas).toHaveCSS('margin-left', '6px');
  await expect(previewCanvas).toHaveCSS('margin-right', '6px');
  await expect(previewCanvas).toHaveCSS('padding-top', '4px');
  await expect(previewCanvas).toHaveCSS('padding-left', '6px');
  await expect(previewCanvas).toHaveCSS('padding-right', '6px');
  const serviceGroup = page.locator('.dashboard-group').first();
  await expect(serviceGroup).toHaveCSS('border-top-width', '1px');
  await expect(serviceGroup).toHaveCSS('padding-top', '12px');
  await expect(serviceGroup).toHaveCSS('padding-right', '12px');
  const serviceGroupTitle = serviceGroup.locator(':scope > .dashboard-group-title');
  await expect(serviceGroupTitle).toHaveCSS('padding-top', '0px');
  await expect(serviceGroupTitle).toHaveCSS('padding-left', '0px');
  const serviceCard = serviceGroup.locator('.dashboard-card').first();
  const groupBackground = await serviceGroup.evaluate((element) => getComputedStyle(element).backgroundColor);
  const cardBackground = await serviceCard.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(groupBackground).not.toBe(cardBackground);
  for (const selector of ['.dashboard-nested-group', '.bookmark-group']) {
    const group = page.locator(selector).first();
    if (await group.count()) {
      const background = await group.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(background).toBe(groupBackground);
    }
  }
  const bookmarkCard = page.locator('.bookmark-card').first();
  if (await bookmarkCard.count()) {
    const background = await bookmarkCard.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe(cardBackground);
  }
  const bookmarkSection = page.locator('.dashboard-bookmarks');
  await expect(bookmarkSection).toHaveCount(1);
  await expect(page.locator('.dashboard-shell > .dashboard-bookmarks')).toHaveCount(1);
  const bookmarkHeading = bookmarkSection.locator(':scope > .bookmark-panel-heading');
  await expect(bookmarkHeading.locator('.bookmark-panel-title')).toHaveText(/Bookmarks/);
  await expect(bookmarkSection).toHaveCSS('border-top-width', '0px');
  await expect(bookmarkSection).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(bookmarkSection).toHaveCSS('margin-top', '8px');
  await expect(bookmarkHeading).toHaveCSS('border-bottom-width', '1px');
  const previewSectionBox = await previewSection.boundingBox();
  const bookmarkHeadingBox = await bookmarkHeading.boundingBox();
  expect(previewSectionBox && bookmarkHeadingBox).not.toBeNull();
  expect(Math.abs(bookmarkHeadingBox.x - previewSectionBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((bookmarkHeadingBox.x + bookmarkHeadingBox.width) - (previewSectionBox.x + previewSectionBox.width))).toBeLessThanOrEqual(1);
  await expect(bookmarkSection.locator(':scope > .bookmark-groups > .bookmark-group')).toHaveCSS('border-top-width', '1px');
  const addGroupButton = page.locator('.preview-add-group').first();
  if (await addGroupButton.count()) {
    await expect(addGroupButton).toHaveCSS('margin-top', '0px');
    await expect(addGroupButton).toHaveCSS('margin-bottom', '0px');
  }
  await homeTab.hover();
  const tabBox = await homeButton.boundingBox();
  const toolbarBox = await homeTab.locator(':scope > .preview-edit-actions').boundingBox();
  expect(tabBox && toolbarBox).not.toBeNull();
  expect(Math.abs(toolbarBox.x - tabBox.x)).toBeLessThanOrEqual(1);
  await homeButton.focus();
  await expect(homeButton).toBeFocused();

  await addTabButton.click();
  await expect(page.locator('#preview-add-tab-modal')).toBeVisible();
  await page.locator('#preview-add-tab-cancel').click();
  await expect(page.locator('#preview-add-tab-modal')).toBeHidden();

  await homeTab.locator('[data-preview-action="tab.edit"]').click({ force: true });
  await expect(page.locator('[data-preview-tab-rename-input]')).toBeVisible();
  await page.locator('[data-preview-tab-rename-input]').press('Escape');
  await expect(page.locator('[data-preview-tab-rename-input]')).toHaveCount(0);
  await expect(homeTab.locator('.preview-tab-btn')).toBeFocused();

  await page.locator('.preview-tab:has(button[data-preview-tab="Admin"])').dragTo(homeTab);
  await expect(page.locator('.preview-tab-btn')).toHaveText(['Admin', 'Home']);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('downloads all configurations successfully without an error status', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-config-button').click()
  ]);

  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^homepage-config-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.locator('#save-status')).not.toContainText('Could not create the configuration download');
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('first bookmark navigation targets the bookmark line', async ({ page }) => {
  await fs.writeFile(bookmarksPath, `- Links:
    - Docs:
        href: https://docs.test
- More:
    - Status:
        href: https://status.test
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').uncheck({ force: true });

  await page.locator('a[data-source*="Docs"]').click();

  await expect(page.locator('.tab[data-tab="bookmarks"]')).toHaveClass(/active/);
  await expect.poll(() => getEditorPosition(page)).toEqual({ line: 1, ch: 4, text: '    - Docs:' });
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('nested group navigation targets the nested group', async ({ page }) => {
  await fs.writeFile(servicesPath, `- Main:
    - Parent:
        - Nested:
            - Alpha:
                href: https://alpha.test
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').uncheck({ force: true });

  await page.locator('.dashboard-nested-group-title .preview-jump-target', { hasText: 'Nested' }).click();

  await expect(page.locator('.tab[data-tab="services"]')).toHaveClass(/active/);
  await expect.poll(() => getEditorPosition(page)).toEqual({ line: 2, ch: 8, text: '        - Nested:' });
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('YAML error card navigation targets its reported line', async ({ page }) => {
  const invalidServices = '- Main:\n    - Alpha:\n        href: [\n        broken\n';
  await setEditorValue(page, invalidServices);
  const errorCard = page.locator('.yaml-error-card');
  await expect(errorCard).toBeVisible();

  const source = JSON.parse(await errorCard.getAttribute('data-source'));
  expect(source.line).toBe(5);
  await errorCard.click();

  await expect.poll(() => getEditorPosition(page)).toEqual({ line: 4, ch: 0, text: '' });
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('commented service navigation uses commented-source metadata', async ({ page }) => {
  await fs.writeFile(servicesPath, `- Main:
    - Alpha:
        href: https://alpha.test
    # - Beta:
    #     href: https://beta.test
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });
  const commentedCard = page.locator('.dashboard-card--commented', { hasText: 'Beta' });
  await expect(commentedCard).toBeVisible();

  await page.locator('#preview-edit-toggle').evaluate((input) => {
    input.checked = false;
  });
  await commentedCard.click();

  await expect.poll(() => getEditorPosition(page)).toEqual({ line: 3, ch: 4, text: '    # - Beta:' });
  await expect(page.locator('.CodeMirror-linebackground.source-line-highlight')).toHaveCount(1);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('commenting one service affects only that service block', async ({ page }) => {
  await fs.writeFile(servicesPath, `- Main:
    - Alpha:
        href: https://alpha.test
        description: Alpha service
    - Beta:
        href: https://beta.test
        description: Beta service
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });

  const alphaCard = page.locator('.dashboard-card', { hasText: 'Alpha' });
  await alphaCard.hover();
  await alphaCard.locator('[data-preview-action="service.comment"]').click();

  const lines = (await getEditorValue(page)).split('\n');
  expect(lines[1]).toMatch(/^\s+# - Alpha:/);
  expect(lines[2]).toMatch(/^\s+#\s+href:/);
  expect(lines[4]).toMatch(/^\s+- Beta:/);
  expect(lines[5]).not.toMatch(/^\s+#/);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('commented widget Edit preserves all widget fields', async ({ page }) => {
  await fs.writeFile(widgetsPath, `# - resources:
#     type: resources
#     url: https://resources.test
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });

  const widgetEdit = page.locator('[data-preview-action="widget.edit"]');
  await expect(widgetEdit).toHaveCount(1);
  await widgetEdit.click({ force: true });
  await expect(page.locator('#preview-edit-modal')).toBeVisible();
  await expect(page.locator('#preview-edit-name')).toHaveValue('resources');

  await page.locator('#preview-edit-name').fill('resources-renamed');
  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('#preview-edit-modal')).toBeHidden();
  await page.locator('.tab[data-tab="widgets"]').click();

  const editedWidgets = await getEditorValue(page);
  expect(editedWidgets).toContain('#     type: resources');
  expect(editedWidgets).toContain('#     url: https://resources.test');
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('Reload after direct editor edits confirms discard and preserves both outcomes', async ({ page }) => {
  const marker = '# direct reload edit';
  await setEditorValue(page, `${baseServices}${marker}\n`);
  await expect(page.locator('.tab[data-tab="services"]')).toHaveClass(/unsaved/);
  await expect(page.locator('#unsaved-status')).toBeVisible();

  await page.locator('#reload-directory-button').click();
  await expect(page.locator('#confirmation-modal')).toBeVisible();
  await page.locator('#confirmation-modal-cancel').click();
  await expect(page.locator('#confirmation-modal')).toBeHidden();
  expect(await getEditorValue(page)).toContain(marker);

  await page.locator('#reload-directory-button').click();
  await page.locator('#confirmation-modal-confirm').click();
  await expect.poll(() => getEditorValue(page)).not.toContain(marker);
  await expect(page.locator('.tab[data-tab="services"]')).not.toHaveClass(/unsaved/);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});

test('preview add, remove, and reorder actions support Undo', async ({ page }) => {
  await fs.writeFile(servicesPath, `- Main:
    - Alpha:
        href: https://alpha.test
    - Beta:
        href: https://beta.test
`, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await page.locator('#preview-edit-toggle').check({ force: true });
  const original = await getEditorValue(page);

  await page.locator('[data-preview-action="service.add"]').first().click({ force: true });
  await expect(page.locator('#preview-edit-modal')).toBeVisible();
  await page.locator('#preview-edit-name').fill('Delta');
  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('.dashboard-card', { hasText: 'Delta' })).toBeVisible();
  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(original);

  const alphaCard = page.locator('.dashboard-card', { hasText: 'Alpha' });
  const betaCard = page.locator('.dashboard-card', { hasText: 'Beta' });
  await betaCard.dragTo(alphaCard, { targetPosition: { x: 4, y: 4 } });
  await expect.poll(async () => {
    const value = await getEditorValue(page);
    return value.indexOf('- Beta:') < value.indexOf('- Alpha:');
  }).toBe(true);
  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(original);

  await alphaCard.hover();
  await alphaCard.locator('[data-preview-action="service.remove"]').click({ force: true });
  await expect(page.locator('#confirmation-modal')).toBeVisible();
  await page.locator('#confirmation-modal-confirm').click();
  await expect.poll(() => getEditorValue(page)).not.toContain('Alpha:');
  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(original);
  expect(consoleErrorsByPage.get(page)).toEqual([]);
});
