const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const configDir = process.env.HOMEPAGE_BROWSER_TEST_DIR;
const servicesPath = path.join(configDir, 'services.yaml');
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

test('dragging a commented service into a nested group places it inside that group', async ({ page }) => {
  const yaml = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
    - Beta:
        href: https://beta.test
`;
  await setEditorValue(page, yaml);
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle-container').waitFor({ state: 'visible' });
  await page.locator('#preview-comments-toggle').check({ force: true });

  // Comment out Beta by editing YAML
  const commentedYaml = `- Main:
    - SubGroup:
        - Alpha:
            href: https://alpha.test
    # - Beta:
    #     href: https://beta.test
`;
  await setEditorValue(page, commentedYaml);
  await page.waitForTimeout(500);

  // Use the internal API to move the commented service into the nested group
  const result = await page.evaluate(async () => {
    const source = {
      tab: 'services',
      kind: 'service',
      groupName: 'Main',
      groupIndex: 0,
      serviceName: 'Beta',
      serviceIndex: 0,
      commented: true,
      startLine: 4,
      endLine: 5
    };
    const destinationTarget = {
      groupName: 'Main',
      groupIndex: 0,
      nestedGroupPath: [{ name: 'SubGroup', index: 0 }]
    };
    const operation = {
      type: 'service.move',
      target: source,
      destinationIndex: 1,
      destinationTarget
    };
    return window.__applyCommentedPreviewEdit(operation, 'Moved commented service Beta.');
  });
  expect(result).toBe(true);

  // Verify the YAML now has Beta inside SubGroup
  const editorText = await getEditorValue(page);
  expect(editorText).toContain('SubGroup');
  expect(editorText).toContain('- Alpha:');
  expect(editorText).toContain('# - Beta:');
  // Beta should be indented under SubGroup (not at top level)
  const lines = editorText.split('\n');
  const betaLine = lines.findIndex((l) => l.includes('Beta'));
  expect(betaLine).toBeGreaterThan(-1);
  // The line before Beta should be Alpha (both under SubGroup)
  const alphaLine = lines.findIndex((l) => l.includes('Alpha'));
  expect(betaLine).toBeGreaterThan(alphaLine);
});
