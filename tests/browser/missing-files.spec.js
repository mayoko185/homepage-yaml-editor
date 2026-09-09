// D3 regression coverage: configuration files absent from the loaded directory must not
// become phantom unsaved changes and must not be created by Save unless actually edited.
// Uses an isolated sub-directory of the global browser fixture so unrelated tests keep
// using the full seven-file directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  accountBrowserErrors,
  registerExpectedError,
  watchConsoleErrors
} = require('./browser-error-accounting');

const configDir = process.env.HOMEPAGE_BROWSER_TEST_DIR;
const repoRoot = path.resolve(__dirname, '..', '..');
const partialDir = path.join(configDir, 'partial');
const partialServicesPath = path.join(partialDir, 'services.yaml');
const partialServices = '- Main:\n    - Alpha:\n        href: https://example.test\n        description: First service\n';
const absentTabNames = ['settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'];
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

async function readSample(tabName) {
  return fs.readFile(path.join(repoRoot, 'examples', `${tabName}.yaml`), 'utf8');
}

// Loads the services-only directory through the real Load dialog flow.
async function loadPartialDirectory(page) {
  await page.locator('#load-directory-button').click();
  await expect(page.locator('#directoryModal')).toBeVisible();
  await page.locator('#serverPathInput').fill(partialDir);
  await page.locator('#load-directory-submit').click();
  await expect(page.locator('#directory-info')).toContainText('Loaded 1/7');
}

test.beforeEach(async ({ page }) => {
  consoleErrorsByPage.set(page, watchConsoleErrors(page));
  expectedErrorsByPage.set(page, []);
  await fs.rm(partialDir, { recursive: true, force: true });
  await fs.mkdir(partialDir, { recursive: true });
  await fs.writeFile(partialServicesPath, partialServices, 'utf8');
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

test('browser error accounting matches one expected save conflict and preserves a second conflict', () => {
  const conflict = {
    type: 'console',
    text: 'Failed to load resource: the server responded with a status of 409 (Conflict)',
    url: 'http://127.0.0.1:4173/api/directory/file/save'
  };
  const secondUnexpectedConflict = { ...conflict };
  const expectedErrors = [];

  registerExpectedError(
    expectedErrors,
    (entry) => entry.type === 'console'
      && entry.text === conflict.text
      && entry.url === conflict.url,
    'the expected configuration-file save conflict'
  );

  const result = accountBrowserErrors([conflict, secondUnexpectedConflict], expectedErrors);
  expect(result.missingExpected).toEqual([]);
  expect(result.unexpected).toEqual([secondUnexpectedConflict]);
});

test('absent configuration tabs start clean with no phantom unsaved indicators', async ({ page }) => {
  await loadPartialDirectory(page);

  await expect(page.locator('#directory-info')).toContainText('6 YAML files missing');
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
});

test('visiting absent tabs keeps the sample view without marking them dirty', async ({ page }) => {
  const settingsSample = await readSample('settings');
  const widgetsSample = await readSample('widgets');

  await loadPartialDirectory(page);

  await page.locator('.tab[data-tab="settings"]').click();
  expect(await getEditorValue(page)).toBe(settingsSample);

  await page.locator('.tab[data-tab="widgets"]').click();
  expect(await getEditorValue(page)).toBe(widgetsSample);

  // Returning to the existing tab must leave every tab clean.
  await page.locator('.tab[data-tab="services"]').click();
  expect(await getEditorValue(page)).toBe(partialServices);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
});

test('save without edits reports no changes and creates no absent files', async ({ page }) => {
  await loadPartialDirectory(page);
  // Visit an absent tab first so the phantom-dirty regression is covered end to end.
  await page.locator('.tab[data-tab="settings"]').click();
  await page.locator('#save-config-button').click();

  await expect(page.locator('#save-status')).toContainText('No unsaved changes.');
  const entries = (await fs.readdir(partialDir)).sort();
  expect(entries).toEqual(['services.yaml']);
});

test('editing one absent tab marks only it dirty and saves only that file', async ({ page }) => {
  const settingsSample = await readSample('settings');
  const editedSettings = `${settingsSample}# added by test\n`;

  await loadPartialDirectory(page);
  await page.locator('.tab[data-tab="settings"]').click();
  await setEditorValue(page, editedSettings);

  // Only the edited absent tab is dirty.
  await expect(page.locator('.tab[data-tab="settings"].unsaved')).toHaveCount(1);
  await expect(page.locator('.tab.unsaved')).toHaveCount(1);
  await expect(page.locator('#unsaved-status')).toContainText('settings.yaml');

  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved settings.yaml.');
  await expect(page.locator('#unsaved-status')).toBeHidden();

  const entries = (await fs.readdir(partialDir)).sort();
  expect(entries).toEqual(['services.yaml', 'settings.yaml']);
  expect(await fs.readFile(path.join(partialDir, 'settings.yaml'), 'utf8')).toBe(editedSettings);
});

test('reverting an absent tab to its sample text makes it clean again', async ({ page }) => {
  const widgetsSample = await readSample('widgets');

  await loadPartialDirectory(page);
  await page.locator('.tab[data-tab="widgets"]').click();
  await setEditorValue(page, `${widgetsSample}# temporary edit\n`);
  await expect(page.locator('.tab[data-tab="widgets"].unsaved')).toHaveCount(1);

  // Restore exactly the baseline/sample text.
  await setEditorValue(page, widgetsSample);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);

  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('No unsaved changes.');
  const entries = (await fs.readdir(partialDir)).sort();
  expect(entries).toEqual(['services.yaml']);
});

test('existing file edits save normally while visited absent tabs stay absent', async ({ page }) => {
  const editedServices = `${partialServices}# appended edit\n`;

  await loadPartialDirectory(page);
  // Visit an absent tab without editing it, then return to the existing file.
  await page.locator('.tab[data-tab="settings"]').click();
  await page.locator('.tab[data-tab="services"]').click();
  await setEditorValue(page, editedServices);

  await expect(page.locator('.tab[data-tab="services"].unsaved')).toHaveCount(1);
  await expect(page.locator('#unsaved-status')).toContainText('services.yaml');

  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved services.yaml.');
  await expect(page.locator('#unsaved-status')).toBeHidden();

  // Only the edited existing file is written; visited absent tabs remain absent.
  expect(await fs.readFile(partialServicesPath, 'utf8')).toBe(editedServices);
  const entries = (await fs.readdir(partialDir)).sort();
  expect(entries).toEqual(['services.yaml']);
});
