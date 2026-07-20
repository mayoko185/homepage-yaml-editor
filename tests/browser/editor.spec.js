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
