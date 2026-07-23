const fs = require('node:fs/promises');
const path = require('node:path');
const jsyaml = require('js-yaml');
const { test, expect } = require('@playwright/test');

const configDir = process.env.HOMEPAGE_BROWSER_TEST_DIR;
const servicesPath = path.join(configDir, 'services.yaml');
const settingsPath = path.join(configDir, 'settings.yaml');
const baseServices = '- Main:\n    - Alpha:\n        href: https://example.test\n        description: First service\n';
const consoleErrorsByPage = new WeakMap();

function watchConsoleErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 409 \(Conflict\)/.test(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function setEditorValue(page, value) {
  await page.locator('.CodeMirror').evaluate((element, nextValue) => {
    element.CodeMirror.setValue(nextValue);
  }, value);
}

async function getEditorValue(page) {
  return page.locator('.CodeMirror').evaluate((element) => element.CodeMirror.getValue());
}

test.beforeEach(async ({ page }) => {
  consoleErrorsByPage.set(page, watchConsoleErrors(page));
  await fs.writeFile(servicesPath, baseServices, 'utf8');
  await page.goto('/');
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
});

test.afterEach(async ({ page }) => {
  expect(consoleErrorsByPage.get(page)).toEqual([]);
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
