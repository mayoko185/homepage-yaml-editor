const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  accountBrowserErrors,
  watchConsoleErrors
} = require('./browser-error-accounting');

const configDir = process.env.HOMEPAGE_BROWSER_TEST_DIR;
const servicesPath = path.join(configDir, 'services.yaml');
const settingsPath = path.join(configDir, 'settings.yaml');
const bookmarksPath = path.join(configDir, 'bookmarks.yaml');
const widgetsPath = path.join(configDir, 'widgets.yaml');

const services = '- Main:\n    - Alpha:\n        href: https://alpha.example\n        description: Alpha service\n    - Beta:\n        href: https://beta.example\n        description: Beta service\n';
const commentedServices = '- Main:\n    # - Alpha:\n        # href: https://alpha.example\n        # description: Alpha service\n    - Beta:\n        href: https://beta.example\n        description: Beta service\n';
const settings = 'title: WP6 Preview Undo\nlayout:\n  Main:\n    style: row\n    columns: 2\n';
const bookmarks = '[]\n';
const commentedWidgets = '# - resources:\n#     type: resources\n#     url: https://resources.example\n';
const uncommentedWidgets = '- resources:\n    type: resources\n    url: https://resources.example\n';

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

async function writeFixtures() {
  await Promise.all([
    fs.writeFile(servicesPath, services, 'utf8'),
    fs.writeFile(settingsPath, settings, 'utf8'),
    fs.writeFile(bookmarksPath, bookmarks, 'utf8'),
    fs.writeFile(widgetsPath, commentedWidgets, 'utf8')
  ]);
}

async function enableCommentedPreview(page) {
  await page.locator('#preview-edit-toggle').check({ force: true });
  await page.locator('#preview-comments-toggle').check({ force: true });
}

async function getPreviewAction(page, action) {
  const button = page.locator(`[data-preview-action="${action}"]`).first();
  await expect(button).toHaveCount(1);
  return button;
}

async function renameCommentedWidget(page, name = 'resources-renamed') {
  const editButton = await getPreviewAction(page, 'widget.edit');
  await editButton.click({ force: true });
  await expect(page.locator('#preview-edit-modal')).toBeVisible();
  await page.locator('#preview-edit-name').fill(name);
  await page.locator('#preview-edit-submit').click();
  await expect(page.locator('#preview-edit-modal')).toBeHidden();
}

async function deleteCommentedWidget(page) {
  const removeButton = await getPreviewAction(page, 'widget.remove');
  await removeButton.click({ force: true });
  await expect(page.locator('#confirmation-modal')).toBeVisible();
  await page.locator('#confirmation-modal-confirm').click();
  await expect(page.locator('#confirmation-modal')).toBeHidden();
}

async function duplicateServiceWithComments(page) {
  const card = page.locator('.dashboard-card', { hasText: 'Alpha' }).first();
  await expect(card).toBeVisible();
  await card.hover();
  await card.locator('[data-preview-action="service.duplicate"]').click({ force: true });
  await expect.poll(() => getEditorValue(page)).toContain('Alpha (cloned)');
}

async function commentService(page) {
  const card = page.locator('.dashboard-card', { hasText: 'Alpha' }).first();
  await expect(card).toBeVisible();
  await card.hover();
  await card.locator('[data-preview-action="service.comment"]').click({ force: true });
}

async function toggleWidgetComment(page) {
  const button = await getPreviewAction(page, 'widget.comment');
  await button.click({ force: true });
}

test.beforeEach(async ({ page }) => {
  consoleErrorsByPage.set(page, watchConsoleErrors(page));
  expectedErrorsByPage.set(page, []);
  await writeFixtures();
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

test('Show Comments duplicate creates one exact Preview Undo transaction', async ({ page }) => {
  await enableCommentedPreview(page);
  const originalServices = await getEditorValue(page);

  await duplicateServiceWithComments(page);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalServices);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
});

test('Preview service comment creates one exact Undo transaction across a tab switch', async ({ page }) => {
  await enableCommentedPreview(page);
  await page.locator('.tab[data-tab="settings"]').click();
  const originalSettings = await getEditorValue(page);
  const originalServices = services;

  await commentService(page);
  expect(await getEditorValue(page)).toBe(originalSettings);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('.tab[data-tab="services"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(commentedServices);
  await page.locator('.tab[data-tab="settings"]').click();
  expect(await getEditorValue(page)).toBe(originalSettings);

  await page.locator('#preview-undo-button').click();
  expect(await getEditorValue(page)).toBe(originalSettings);
  await page.locator('.tab[data-tab="services"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalServices);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
});

test('Preview widget uncomment restores exact YAML when Widgets is active', async ({ page }) => {
  await enableCommentedPreview(page);
  await page.locator('.tab[data-tab="widgets"]').click();
  const originalWidgets = await getEditorValue(page);

  await toggleWidgetComment(page);
  await expect.poll(() => getEditorValue(page)).toBe(uncommentedWidgets);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalWidgets);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
});

test('Preview widget uncomment restores exact inactive YAML without changing the active tab', async ({ page }) => {
  await enableCommentedPreview(page);
  const originalServices = await getEditorValue(page);
  const originalWidgets = commentedWidgets;

  await toggleWidgetComment(page);
  expect(await getEditorValue(page)).toBe(originalServices);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('.tab[data-tab="widgets"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(uncommentedWidgets);
  await page.locator('.tab[data-tab="services"]').click();
  expect(await getEditorValue(page)).toBe(originalServices);

  await page.locator('#preview-undo-button').click();
  expect(await getEditorValue(page)).toBe(originalServices);
  await page.locator('.tab[data-tab="widgets"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalWidgets);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
});

test('ordinary editor typing after Preview comment invalidates Preview Undo', async ({ page }) => {
  await enableCommentedPreview(page);
  await commentService(page);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('.CodeMirror').evaluate((element) => {
    const editor = element.CodeMirror;
    const lastLine = editor.lastLine();
    const lastCharacter = editor.getLine(lastLine).length;
    editor.replaceRange(
      '\n# direct editor typing',
      { line: lastLine, ch: lastCharacter },
      { line: lastLine, ch: lastCharacter },
      '+input'
    );
  });
  await expect(page.locator('#preview-undo-button')).toBeHidden();
});

test('commented widget edit restores exact YAML when Widgets is active', async ({ page }) => {
  await enableCommentedPreview(page);
  await page.locator('.tab[data-tab="widgets"]').click();
  const originalWidgets = await getEditorValue(page);
  const originalServices = services;

  await renameCommentedWidget(page);
  await expect.poll(() => getEditorValue(page)).toContain('# - resources-renamed:');
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalWidgets);
  await page.locator('.tab[data-tab="services"]').click();
  expect(await getEditorValue(page)).toBe(originalServices);
});

test('commented widget edit restores exact YAML when Widgets is inactive', async ({ page }) => {
  await enableCommentedPreview(page);
  const originalServices = await getEditorValue(page);
  const originalWidgets = commentedWidgets;

  await renameCommentedWidget(page);
  expect(await getEditorValue(page)).toBe(originalServices);
  await page.locator('#preview-undo-button').click();

  await page.locator('.tab[data-tab="widgets"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalWidgets);
  await page.locator('.tab[data-tab="services"]').click();
  expect(await getEditorValue(page)).toBe(originalServices);
});

test('commented widget delete restores exact YAML when Widgets is active', async ({ page }) => {
  await enableCommentedPreview(page);
  await page.locator('.tab[data-tab="widgets"]').click();
  const originalWidgets = await getEditorValue(page);

  await deleteCommentedWidget(page);
  await expect.poll(() => getEditorValue(page)).not.toContain('resources:');
  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalWidgets);
});

test('commented widget delete restores exact YAML when Widgets is inactive', async ({ page }) => {
  await enableCommentedPreview(page);
  const originalServices = await getEditorValue(page);
  const originalWidgets = commentedWidgets;

  await deleteCommentedWidget(page);
  expect(await getEditorValue(page)).toBe(originalServices);
  await page.locator('#preview-undo-button').click();

  await page.locator('.tab[data-tab="widgets"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalWidgets);
});

test('switching tabs before Undo restores the exact affected document', async ({ page }) => {
  await enableCommentedPreview(page);
  const originalServices = await getEditorValue(page);

  await duplicateServiceWithComments(page);
  await page.locator('.tab[data-tab="settings"]').click();
  expect(await getEditorValue(page)).toBe(settings);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('#preview-undo-button').click();
  expect(await getEditorValue(page)).toBe(settings);
  await page.locator('.tab[data-tab="services"]').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalServices);
});

test('ordinary editor typing still invalidates client-side Preview Undo', async ({ page }) => {
  await enableCommentedPreview(page);
  await duplicateServiceWithComments(page);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('.CodeMirror').evaluate((element) => {
    const editor = element.CodeMirror;
    const lastLine = editor.lastLine();
    const lastCharacter = editor.getLine(lastLine).length;
    editor.replaceRange(
      '\n# direct editor typing',
      { line: lastLine, ch: lastCharacter },
      { line: lastLine, ch: lastCharacter },
      '+input'
    );
  });
  await expect(page.locator('#preview-undo-button')).toBeHidden();
});

test('Preview comment supersedes a pending async transform', async ({ page }) => {
  const heldTransforms = [];
  await page.route('**/api/transform', async (route) => {
    const response = await route.fetch();
    heldTransforms.push({ route, response });
  });

  await page.locator('#preview-edit-toggle').check({ force: true });
  const originalServices = await getEditorValue(page);
  const alphaCard = page.locator('.dashboard-card', { hasText: 'Alpha' }).first();
  await alphaCard.hover();
  await alphaCard.locator('[data-preview-action="service.duplicate"]').click({ force: true });
  await expect.poll(() => heldTransforms.length).toBe(1);

  await page.locator('#preview-comments-toggle').check({ force: true });
  await commentService(page);
  const clientSideServices = await getEditorValue(page);
  expect(clientSideServices).toBe(commentedServices);
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  const [pendingTransform] = heldTransforms;
  heldTransforms.splice(0, 1);
  await pendingTransform.route.fulfill({ response: pendingTransform.response });

  await expect.poll(() => getEditorValue(page)).toBe(clientSideServices);
  await expect(page.locator('#preview-undo-button')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveText('Item commented out. Save to write the pending YAML changes.');

  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalServices);
});

test('Preview Undo remains authoritative when Undo precedes stale async release', async ({ page }) => {
  const heldTransforms = [];
  await page.route('**/api/transform', async (route) => {
    const response = await route.fetch();
    heldTransforms.push({ route, response });
  });

  await page.locator('#preview-edit-toggle').check({ force: true });
  const originalServices = await getEditorValue(page);
  expect(originalServices).toBe(services);

  const alphaCard = page.locator('.dashboard-card', { hasText: 'Alpha' }).first();
  await alphaCard.hover();
  await alphaCard.locator('[data-preview-action="service.duplicate"]').click({ force: true });
  await expect.poll(() => heldTransforms.length).toBe(1);

  await page.locator('#preview-comments-toggle').check({ force: true });
  await commentService(page);
  await expect.poll(() => getEditorValue(page)).toBe(commentedServices);
  await expect(page.locator('#save-status')).toHaveText('Item commented out. Save to write the pending YAML changes.');
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await page.locator('#preview-undo-button').click();
  await expect.poll(() => getEditorValue(page)).toBe(originalServices);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
  await expect(page.locator('#save-status')).toHaveText('Undid: Item commented out.');

  const [pendingTransform] = heldTransforms;
  heldTransforms.splice(0, 1);
  await pendingTransform.route.fulfill({ response: pendingTransform.response });

  await expect.poll(() => getEditorValue(page)).toBe(originalServices);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
  await expect(page.locator('#save-status')).toHaveText('Undid: Item commented out.');
  expect(await getEditorValue(page)).not.toContain('Alpha (cloned)');
});
