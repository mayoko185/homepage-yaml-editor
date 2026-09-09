// D1 async ownership coverage: save batches must stay bound to their originating directory
// session, and stale/reversed directory load responses must never install over a newer session.
// Every intercepted request still reaches the real server (real sha256 revisions, real disk
// writes); only its response is held until the test releases it, so overlap ordering is fully
// deterministic without sleeps or fabricated payloads.
const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  accountBrowserErrors,
  registerExpectedError,
  watchConsoleErrors
} = require('./browser-error-accounting');

const configDir = process.env.HOMEPAGE_BROWSER_TEST_DIR;
const dirA = path.join(configDir, 'dir-a');
const dirB = path.join(configDir, 'dir-b');
const partialDir = path.join(configDir, 'dir-partial');
const examplesDir = path.resolve(__dirname, '..', '..', 'examples');

const servicesA = '- Main:\n    - Alpha:\n        href: https://alpha.example\n';
const settingsA = 'title: Directory A\nlayout:\n  Main:\n    style: row\n    columns: 2\n';
const servicesB = '- Main:\n    - Beta:\n        href: https://beta.example\n';
const settingsB = 'title: Directory B\nlayout:\n  Main:\n    style: column\n    columns: 1\n';
const configTabNames = ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'];

const consoleErrorsByPage = new WeakMap();
const expectedErrorsByPage = new WeakMap();
const heldRequestsByPage = new WeakMap();

async function setEditorValue(page, value) {
  await page.locator('.CodeMirror').evaluate((element, nextValue) => {
    element.CodeMirror.setValue(nextValue);
  }, value);
}

async function getEditorValue(page) {
  return page.locator('.CodeMirror').evaluate((element) => element.CodeMirror.getValue());
}

async function getLoadedState(page, tabName) {
  return page.evaluate(async (name) => {
    const state = await import('/js/state.js');
    return {
      content: state.loadedFiles[name],
      original: state.originalLoadedFiles[name],
      revision: state.loadedFileRevisions[name],
      present: state.loadedFilePresent[name]
    };
  }, tabName);
}

async function getDirectorySessionState(page) {
  return page.evaluate(async () => {
    const state = await import('/js/state.js');
    return {
      currentTab: state.currentTab,
      currentDirectoryPath: state.currentDirectoryPath,
      currentDirectoryWasAutoloaded: state.currentDirectoryWasAutoloaded,
      sampleModeEnabled: state.sampleModeEnabled,
      directorySessionGeneration: state.getDirectorySessionGeneration(),
      directorySessionOperationToken: state.getDirectorySessionOperationToken(),
      loadedFiles: state.loadedFiles,
      originalLoadedFiles: state.originalLoadedFiles,
      loadedFileRevisions: state.loadedFileRevisions,
      loadedFilePresent: state.loadedFilePresent,
      loadedFileNames: state.loadedFileNames
    };
  });
}

// --- Deterministic request barriers -------------------------------------------------
// Directory load and save requests pass through to the real server, but their responses are
// held in a per-page queue until a test releases them. Releasing in any order is what creates
// the reversed/overlapping response scenarios deterministically.
function installRequestBarriers(page) {
  const state = { loads: [], saves: [], transforms: [], startupDirectories: [] };
  heldRequestsByPage.set(page, state);
  page.route('**/api/directory/load', async (route) => {
    const request = route.request();
    const response = await route.fetch();
    state.loads.push({ route, request, response, body: JSON.parse(request.postData() || '{}') });
  });
  page.route('**/api/directory/file/save', async (route) => {
    const request = route.request();
    const response = await route.fetch();
    state.saves.push({ route, request, response, body: JSON.parse(request.postData() || '{}') });
  });
  page.route('**/api/transform', async (route) => {
    const request = route.request();
    const response = await route.fetch();
    state.transforms.push({ route, request, response, body: JSON.parse(request.postData() || '{}') });
  });
}

function heldRequests(page, kind) {
  return heldRequestsByPage.get(page)[kind];
}

async function waitForHeldCount(page, kind, count) {
  await expect.poll(() => heldRequests(page, kind).length).toBe(count);
}

// Releases one held response. `matchDir` selects by the request's dirPath; otherwise the oldest
// (index 0) or newest entry is released. Returns the released entry for payload assertions.
async function releaseHeldRequest(page, kind, { matchDir = undefined, index } = {}) {
  const list = heldRequests(page, kind);
  let chosenIndex;
  if (matchDir !== undefined) {
    chosenIndex = list.findIndex((entry) => entry.body.dirPath === matchDir);
  } else if (index !== undefined) {
    chosenIndex = index < 0 ? list.length + index : index;
  } else {
    chosenIndex = 0;
  }
  const [entry] = list.splice(chosenIndex, 1);
  await entry.route.fulfill({ response: entry.response });
  return entry;
}

async function enableInteractivePreview(page) {
  await page.locator('#preview-edit-toggle').check({ force: true });
}

async function startHeldServiceDuplicate(page, serviceName = 'Alpha') {
  const pendingBefore = heldRequests(page, 'transforms').length;
  const card = page.locator('.dashboard-card', { hasText: serviceName }).first();
  await card.hover();
  await card.locator('[data-preview-action="service.duplicate"]').click();
  await waitForHeldCount(page, 'transforms', pendingBefore + 1);
}

async function startHeldServiceRemoval(page, serviceName = 'Alpha') {
  const pendingBefore = heldRequests(page, 'transforms').length;
  const card = page.locator('.dashboard-card', { hasText: serviceName }).first();
  await card.hover();
  await card.locator('[data-preview-action="service.remove"]').click();
  await expect(page.locator('#confirmation-modal')).toBeVisible();
  await page.locator('#confirmation-modal-confirm').click();
  await waitForHeldCount(page, 'transforms', pendingBefore + 1);
}
// --- UI flows ------------------------------------------------------------------------
async function openLoadDialog(page) {
  await page.locator('#load-directory-button').click();
  await expect(page.locator('#directoryModal')).toBeVisible();
}

// Submits a directory load through the real dialog. The response stays held. With
// `reenableSubmit`, the (disabled) submit button is re-enabled first so an overlapping load can
// be injected while an earlier one is still pending — the deterministic race mechanism.
async function submitLoad(page, dirPath, { reenableSubmit = false } = {}) {
  const submitButton = page.locator('#load-directory-submit');
  if (reenableSubmit) await submitButton.evaluate((button) => { button.disabled = false; });
  await page.locator('#serverPathInput').fill(dirPath);
  await submitButton.click();
}

// Submits a load and releases its response, waiting until the client has installed it.
async function loadAndInstall(page, dirPath, options = {}) {
  if (options.openDialog !== false) await openLoadDialog(page);
  const pendingBefore = heldRequests(page, 'loads').length;
  await submitLoad(page, dirPath, options);
  // Wait until the route handler has queued this request's response before releasing it.
  await expect.poll(() => heldRequests(page, 'loads').length).toBe(pendingBefore + 1);
  const entry = await releaseHeldRequest(page, 'loads', { index: pendingBefore });
  const payload = await entry.response.json();
  await expect(page.locator('#directory-info')).toContainText(path.basename(payload.directory));
  return payload;
}

// Releases a load response that must be discarded as stale. The continuation finishes without
// installing: the submit button is re-enabled in its finally block, which proves completion.
async function releaseStaleLoad(page, options = {}) {
  await releaseHeldRequest(page, 'loads', options);
  await expect(page.locator('#load-directory-submit')).toBeEnabled();
}

// Releases a held save response; the Save button is re-enabled in saveConfig's finally block.
async function releaseSaveAndAwaitCompletion(page) {
  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();
}

async function createPartialDirectory() {
  await fs.rm(partialDir, { recursive: true, force: true });
  await fs.mkdir(partialDir);
  await fs.writeFile(path.join(partialDir, 'services.yaml'), servicesA, 'utf8');
}

async function createEmptyDirectory() {
  await fs.rm(partialDir, { recursive: true, force: true });
  await fs.mkdir(partialDir);
}

async function hideStartupDirectory(page) {
  await page.route('**/api/startup-directory', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ directory: null, files: {}, revisions: {}, hasStartupDirectory: false })
    });
  });
}

// Install this only after the initial page load. The initial page uses the real startup response
// in beforeEach; this barrier is for the reload whose startup response must remain pending while B
// installs through the real manual-load flow.
async function installStartupDirectoryBarrier(page) {
  const state = heldRequestsByPage.get(page);
  await page.route('**/api/startup-directory', async (route) => {
    const response = await route.fetch();
    state.startupDirectories.push({ route, request: route.request(), response, body: {} });
  });
}

async function expectBlankCleanEditors(page) {
  for (const tabName of configTabNames) {
    await page.locator('.tab[data-tab="' + tabName + '"]').click();
    expect(await getEditorValue(page)).toBe('');
    await expect(page.locator('.tab[data-tab="' + tabName + '"].unsaved')).toHaveCount(0);
  }
  await expect(page.locator('#unsaved-status')).toBeHidden();
}

async function readExampleSamples() {
  return Object.fromEntries(await Promise.all(configTabNames.map(async (tabName) => [
    tabName,
    await fs.readFile(path.join(examplesDir, `${tabName}.yaml`), 'utf8')
  ])));
}

function registerExpectedFailedDirectoryLoad(page) {
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && /\/api\/directory\/load(?:\?|$)/.test(entry.url)
      && entry.text.startsWith('Failed to load resource: the server responded with a status of '),
    'the expected failed bootstrap-era directory load'
  );
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && /\/js\/app\.js(?:\?|$)/.test(entry.url)
      && entry.text.split('\n')[0] === 'Directory load error: Error: Directory does not exist or cannot be accessed. Check the path and permissions',
    'the application must report the failed bootstrap-era directory load'
  );
}

test.beforeEach(async ({ page }) => {
  consoleErrorsByPage.set(page, watchConsoleErrors(page));
  expectedErrorsByPage.set(page, []);
  for (const [dir, services, settings] of [[dirA, servicesA, settingsA], [dirB, servicesB, settingsB]]) {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir);
    await Promise.all([
      fs.writeFile(path.join(dir, 'services.yaml'), services, 'utf8'),
      fs.writeFile(path.join(dir, 'settings.yaml'), settings, 'utf8')
    ]);
  }
  installRequestBarriers(page);
  await page.goto('/');
  // The root fixture directory autoloads at startup (session generation 1).
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

test('manual load started during bootstrap supersedes startup autoload', async ({ page }) => {
  await installStartupDirectoryBarrier(page);
  await page.reload();
  await waitForHeldCount(page, 'startupDirectories', 1);

  // The real startup response is now held after bootstrap has reached the production endpoint.
  // This test deliberately does not gate /api/examples: the startup barrier itself proves that
  // sample initialization finished and that the race is between startup A and manual B.
  const startupEntry = heldRequests(page, 'startupDirectories')[0];
  expect(startupEntry.request.url()).toContain('/api/startup-directory');
  const startupPayload = await startupEntry.response.json();
  expect(startupPayload).toMatchObject({
    directory: configDir,
    hasStartupDirectory: true
  });
  expect(Object.keys(startupPayload.files || {})).not.toHaveLength(0);
  expect(startupPayload.files['services.yaml']).toEqual(expect.any(String));
  expect(startupPayload.files['services.yaml']).not.toBe(servicesB);

  await openLoadDialog(page);
  const pendingLoads = heldRequests(page, 'loads').length;
  await submitLoad(page, dirB);
  await expect.poll(() => heldRequests(page, 'loads').length).toBe(pendingLoads + 1);

  // B installs while startup A remains held. Nothing can make A stale by timing accident: the
  // explicit startup barrier is still occupied until every B assertion below has passed.
  const manualEntry = await releaseHeldRequest(page, 'loads', { index: pendingLoads });
  const manualPayload = await manualEntry.response.json();
  expect(manualPayload.directory).toBe(dirB);

  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);

  const bDirectoryInfo = await page.locator('#directory-info').textContent();
  const bSaveStatus = await page.locator('#save-status').evaluate((element) => ({
    hidden: element.hidden,
    text: element.textContent,
    className: element.className,
    directoryOperationToken: element.dataset.directoryOperationToken || null
  }));
  const bSessionState = await getDirectorySessionState(page);
  expect(bSessionState).toMatchObject({
    currentDirectoryPath: dirB,
    currentDirectoryWasAutoloaded: false,
    sampleModeEnabled: false,
    loadedFiles: expect.objectContaining({ services: servicesB, settings: settingsB }),
    originalLoadedFiles: expect.objectContaining({ services: servicesB, settings: settingsB }),
    loadedFileRevisions: expect.objectContaining({
      services: manualPayload.revisions['services.yaml'],
      settings: manualPayload.revisions['settings.yaml']
    }),
    loadedFilePresent: expect.objectContaining({ services: true, settings: true })
  });
  expect(heldRequests(page, 'startupDirectories')).toHaveLength(1);

  // Release the real startup A response only after B is visibly installed. The warning is the
  // synchronization point proving the stale startup continuation finished and was discarded.
  const staleStartupWarning = page.waitForEvent('console', {
    predicate: (message) => message.type() === 'warning'
      && message.text().startsWith('Discarding stale directory load result for')
  });
  await releaseHeldRequest(page, 'startupDirectories');
  const warning = await staleStartupWarning;
  expect(warning.text()).toContain(startupPayload.directory);

  // If startup ownership were removed, these exact B content, baseline, revision, presence, and
  // notice assertions would instead observe the distinct real A response above.
  expect(await getEditorValue(page)).toBe(servicesB);
  expect(await page.locator('#directory-info').textContent()).toBe(bDirectoryInfo);
  expect(await page.locator('#directory-info').textContent()).not.toContain(path.basename(startupPayload.directory));
  expect(await page.locator('#save-status').evaluate((element) => ({
    hidden: element.hidden,
    text: element.textContent,
    className: element.className,
    directoryOperationToken: element.dataset.directoryOperationToken || null
  }))).toEqual(bSaveStatus);
  expect(await getDirectorySessionState(page)).toEqual(bSessionState);
  await page.unroute('**/api/startup-directory');
});

test('failed bootstrap-era manual load recovers valid examples and keeps startup stale', async ({ page }) => {
  const heldExamples = [];
  await page.route('**/api/examples', async (route) => {
    const response = await route.fetch();
    heldExamples.push({ route, response });
  });
  await installStartupDirectoryBarrier(page);
  await page.reload();
  await expect.poll(() => heldExamples.length).toBe(1);
  expect(await getDirectorySessionState(page)).toMatchObject({
    currentDirectoryPath: null,
    directorySessionGeneration: 0
  });
  expect(heldRequests(page, 'startupDirectories')).toHaveLength(0);

  await openLoadDialog(page);
  const missingDir = path.join(configDir, 'missing-bootstrap-directory');
  await submitLoad(page, missingDir);
  await waitForHeldCount(page, 'loads', 1);
  registerExpectedFailedDirectoryLoad(page);
  await releaseHeldRequest(page, 'loads');

  // B has failed while examples are still pending, so its recovery must wait rather than
  // publishing a partial fallback or allowing bootstrap to advance on an unowned boundary.
  await expect(page.locator('#directory-modal-status')).toContainText('Could not load the directory.');
  await expect(page.locator('#load-directory-submit')).toBeDisabled();
  expect(heldRequests(page, 'startupDirectories')).toHaveLength(0);

  const [examplesEntry] = heldExamples.splice(0, 1);
  await examplesEntry.route.fulfill({ response: examplesEntry.response });
  await waitForHeldCount(page, 'startupDirectories', 1);
  await expect(page.locator('#directory-info')).toHaveText('Examples loaded (read-only).');
  await expect(page.locator('#load-directory-submit')).toBeEnabled();

  const sampleFiles = await readExampleSamples();
  const expectedRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));
  const expectedPresence = Object.fromEntries(configTabNames.map((tabName) => [tabName, false]));
  const expectedFileNames = Object.fromEntries(configTabNames.map((tabName) => [tabName, `${tabName}.yaml`]));
  const recoveredState = await getDirectorySessionState(page);
  expect(recoveredState).toMatchObject({
    currentTab: 'services',
    currentDirectoryPath: null,
    currentDirectoryWasAutoloaded: false,
    sampleModeEnabled: true,
    directorySessionGeneration: 0,
    loadedFileRevisions: expectedRevisions,
    loadedFilePresent: expectedPresence,
    loadedFileNames: expectedFileNames
  });
  expect(recoveredState.loadedFiles).toEqual(sampleFiles);
  expect(recoveredState.originalLoadedFiles).toEqual(sampleFiles);
  expect(await getEditorValue(page)).toBe(sampleFiles.services);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('#save-config-button')).toBeDisabled();
  await expect(page.locator('#reload-directory-button')).toBeHidden();

  const startupEntry = heldRequests(page, 'startupDirectories')[0];
  const startupPayload = await startupEntry.response.json();
  expect(startupPayload.directory).toBe(configDir);
  expect(startupPayload.files['services.yaml']).not.toBe(sampleFiles.services);

  const staleStartupWarning = page.waitForEvent('console', {
    predicate: (message) => message.type() === 'warning'
      && message.text().startsWith('Discarding stale directory load result for')
  });
  await releaseHeldRequest(page, 'startupDirectories');
  const warning = await staleStartupWarning;
  expect(warning.text()).toContain(configDir);

  // Startup A remains discarded after fallback recovery; it cannot replace any sample state or
  // status because recovery never revives startupToken.
  expect(await getDirectorySessionState(page)).toEqual(recoveredState);
  expect(await getEditorValue(page)).toBe(sampleFiles.services);
  await expect(page.locator('#directory-info')).toHaveText('Examples loaded (read-only).');
  await expect(page.locator('#directory-modal-status')).toContainText('Could not load the directory.');
  await page.unroute('**/api/examples');
  await page.unroute('**/api/startup-directory');
});

test('failed bootstrap-era manual load keeps examples-unavailable fallback blank', async ({ page }) => {
  const heldExamples = [];
  await page.route('**/api/examples', async (route) => {
    heldExamples.push({ route });
  });
  await installStartupDirectoryBarrier(page);
  await page.reload();
  await expect.poll(() => heldExamples.length).toBe(1);
  expect(await getDirectorySessionState(page)).toMatchObject({
    currentDirectoryPath: null,
    directorySessionGeneration: 0
  });
  expect(heldRequests(page, 'startupDirectories')).toHaveLength(0);

  await openLoadDialog(page);
  const missingDir = path.join(configDir, 'missing-bootstrap-directory-without-examples');
  await submitLoad(page, missingDir);
  await waitForHeldCount(page, 'loads', 1);
  registerExpectedFailedDirectoryLoad(page);
  await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#directory-modal-status')).toContainText('Could not load the directory.');
  await expect(page.locator('#load-directory-submit')).toBeDisabled();
  expect(heldRequests(page, 'startupDirectories')).toHaveLength(0);

  const [examplesEntry] = heldExamples.splice(0, 1);
  await examplesEntry.route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ samples: { services: servicesA } })
  });
  await waitForHeldCount(page, 'startupDirectories', 1);
  await expect(page.locator('#directory-info')).toHaveText('Example configurations unavailable; absent tabs are blank because example configurations could not be loaded; files are created only when edited and saved.');
  await expectBlankCleanEditors(page);
  await page.locator('.tab[data-tab="services"]').click();
  await expect(page.locator('#load-directory-submit')).toBeEnabled();

  const emptyFiles = Object.fromEntries(configTabNames.map((tabName) => [tabName, '']));
  const expectedRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));
  const expectedPresence = Object.fromEntries(configTabNames.map((tabName) => [tabName, false]));
  const expectedFileNames = Object.fromEntries(configTabNames.map((tabName) => [tabName, `${tabName}.yaml`]));
  const recoveredState = await getDirectorySessionState(page);
  expect(recoveredState).toMatchObject({
    currentTab: 'services',
    currentDirectoryPath: null,
    currentDirectoryWasAutoloaded: false,
    sampleModeEnabled: true,
    directorySessionGeneration: 0,
    loadedFileRevisions: expectedRevisions,
    loadedFilePresent: expectedPresence,
    loadedFileNames: expectedFileNames
  });
  expect(recoveredState.loadedFiles).toEqual(emptyFiles);
  expect(recoveredState.originalLoadedFiles).toEqual(emptyFiles);
  expect(await getEditorValue(page)).toBe('');
  await expect(page.locator('#save-config-button')).toBeDisabled();
  await expect(page.locator('#reload-directory-button')).toBeHidden();

  const startupEntry = heldRequests(page, 'startupDirectories')[0];
  const startupPayload = await startupEntry.response.json();
  expect(startupPayload.directory).toBe(configDir);
  const staleStartupWarning = page.waitForEvent('console', {
    predicate: (message) => message.type() === 'warning'
      && message.text().startsWith('Discarding stale directory load result for')
  });
  await releaseHeldRequest(page, 'startupDirectories');
  const warning = await staleStartupWarning;
  expect(warning.text()).toContain(configDir);

  expect(await getDirectorySessionState(page)).toEqual(recoveredState);
  expect(await getEditorValue(page)).toBe('');
  await expect(page.locator('#directory-info')).toHaveText('Example configurations unavailable; absent tabs are blank because example configurations could not be loaded; files are created only when edited and saved.');
  await page.unroute('**/api/examples');
  await page.unroute('**/api/startup-directory');
});

test('directory response waits for examples before installing missing samples', async ({ page }) => {
  await createPartialDirectory();
  const heldExamples = [];
  await page.route('**/api/examples', async (route) => {
    const response = await route.fetch();
    heldExamples.push({ route, response });
  });

  await page.reload();
  await expect.poll(() => heldExamples.length).toBe(1);
  await openLoadDialog(page);
  await submitLoad(page, partialDir);
  await waitForHeldCount(page, 'loads', 1);

  // The directory response arrives first, but installation remains pending on examples.
  await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#directoryModal')).toBeVisible();
  await expect(page.locator('#load-directory-submit')).toBeDisabled();
  await expect(page.locator('#directory-info')).not.toContainText(path.basename(partialDir));

  const [examplesEntry] = heldExamples.splice(0, 1);
  await examplesEntry.route.fulfill({ response: examplesEntry.response });
  await expect(page.locator('#directory-info')).toContainText(path.basename(partialDir));
  await expect(page.locator('#directoryModal')).toBeHidden();

  const settingsSample = await fs.readFile(path.join(examplesDir, 'settings.yaml'), 'utf8');
  await page.locator('.tab[data-tab="settings"]').click();
  expect(await getEditorValue(page)).toBe(settingsSample);
  await expect(page.locator('.tab[data-tab="settings"].unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();

  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('No unsaved changes.');
  expect(await fs.readdir(partialDir)).toEqual(['services.yaml']);
  await page.unroute('**/api/examples');
});

test('directory status does not claim samples when examples fail', async ({ page }) => {
  await createPartialDirectory();
  await page.route('**/api/examples', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Example load intentionally failed' })
    });
  });

  await page.reload();
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await openLoadDialog(page);
  await submitLoad(page, partialDir);
  await waitForHeldCount(page, 'loads', 1);
  await releaseHeldRequest(page, 'loads');

  await expect(page.locator('#directory-info')).toContainText('absent tabs are blank because example configurations could not be loaded');
  await expect(page.locator('#directory-info')).not.toContainText('example content is shown');

  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text.split('\n')[0] === 'Example configuration load failed: Error: Example load intentionally failed'
      && /\/js\/app\.js(?:\?|$)/.test(entry.url),
    'the application must report the intentionally failed /api/examples request'
  );
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text === 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
      && /\/api\/examples(?:\?|$)/.test(entry.url),
    'the browser resource error must identify /api/examples specifically'
  );

  const unrelatedConsoleError = 'Unrelated async-ownership console failure';
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console' && entry.text === unrelatedConsoleError,
    'the intentionally injected unrelated console error'
  );
  await page.evaluate((message) => console.error(message), unrelatedConsoleError);
  await page.unroute('**/api/examples');
});

test('no-startup bootstrap keeps HTTP-failed examples unavailable and clean', async ({ page }) => {
  await createEmptyDirectory();
  await hideStartupDirectory(page);
  await page.route('**/api/examples', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Example load intentionally failed without startup directory' })
    });
  });

  await page.reload();
  await expect(page.locator('#directory-info')).toHaveText('Example configurations unavailable; absent tabs are blank because example configurations could not be loaded; files are created only when edited and saved.');
  await expect(page.locator('#directory-info')).not.toContainText('Examples loaded (read-only)');
  await expectBlankCleanEditors(page);
  await expect(page.locator('#save-config-button')).toBeDisabled();

  await page.locator('#save-config-button').evaluate((button) => {
    button.disabled = false;
    button.click();
  });
  await expect(page.locator('#save-status')).toContainText('Examples are read-only.');
  expect(await fs.readdir(partialDir)).toEqual([]);

  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text.split('\n')[0] === 'Example configuration load failed: Error: Example load intentionally failed without startup directory'
      && /\/js\/app\.js(?:\?|$)/.test(entry.url),
    'the application must report the failed examples request without a startup directory'
  );
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text === 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
      && /\/api\/examples(?:\?|$)/.test(entry.url),
    'the browser resource error must identify the failed examples request'
  );
});

test('no-startup bootstrap keeps malformed HTTP 200 examples unavailable and blank', async ({ page }) => {
  await createEmptyDirectory();
  await hideStartupDirectory(page);
  await page.route('**/api/examples', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ samples: { services: servicesA } })
    });
  });

  await page.reload();
  await expect(page.locator('#directory-info')).toHaveText('Example configurations unavailable; absent tabs are blank because example configurations could not be loaded; files are created only when edited and saved.');
  await expect(page.locator('#directory-info')).not.toContainText('Examples loaded (read-only)');
  await expectBlankCleanEditors(page);
  await expect(page.locator('#save-config-button')).toBeDisabled();

  await page.locator('#save-config-button').evaluate((button) => {
    button.disabled = false;
    button.click();
  });
  await expect(page.locator('#save-status')).toContainText('Examples are read-only.');
  expect(await fs.readdir(partialDir)).toEqual([]);

  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text.split('\n')[0] === 'Example configuration load failed: Error: The server did not return the settings.yaml example configuration'
      && /\/js\/app\.js(?:\?|$)/.test(entry.url),
    'the application must report the malformed examples payload without a startup directory'
  );
});

test('no-startup bootstrap keeps valid examples available in read-only mode', async ({ page }) => {
  await hideStartupDirectory(page);

  await page.reload();
  await expect(page.locator('#directory-info')).toHaveText('Examples loaded (read-only).');
  const servicesSample = await fs.readFile(path.join(examplesDir, 'services.yaml'), 'utf8');
  expect(await getEditorValue(page)).toBe(servicesSample);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();
});

test('malformed HTTP 200 examples leave every absent tab blank and clean', async ({ page }) => {
  await createEmptyDirectory();
  await page.route('**/api/examples', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ samples: { services: servicesA } })
    });
  });

  await page.reload();
  await expect(page.locator('#directory-info')).toContainText('Autoloaded');
  await openLoadDialog(page);
  await submitLoad(page, partialDir);
  await waitForHeldCount(page, 'loads', 1);
  await releaseHeldRequest(page, 'loads');

  await expect(page.locator('#directory-info')).toContainText('7 YAML files missing; absent tabs are blank because example configurations could not be loaded');
  for (const tabName of ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes']) {
    await page.locator('.tab[data-tab="' + tabName + '"]').click();
    expect(await getEditorValue(page)).toBe('');
    await expect(page.locator('.tab[data-tab="' + tabName + '"].unsaved')).toHaveCount(0);
  }
  await expect(page.locator('#unsaved-status')).toBeHidden();

  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text.split('\n')[0] === 'Example configuration load failed: Error: The server did not return the settings.yaml example configuration'
      && /\/js\/app\.js(?:\?|$)/.test(entry.url),
    'the application must report the malformed HTTP 200 examples payload'
  );

  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('No unsaved changes.');
  expect(await fs.readdir(partialDir)).toEqual([]);
  await page.unroute('**/api/examples');
});

test('stale preview transform cannot overwrite typing or establish Preview Undo', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await enableInteractivePreview(page);
  await startHeldServiceDuplicate(page);

  const typedText = `${servicesA}# typed while preview transform is pending\n`;
  await setEditorValue(page, typedText);
  await releaseHeldRequest(page, 'transforms');

  expect(await getEditorValue(page)).toBe(typedText);
  await expect(page.locator('.tab[data-tab="services"].unsaved')).toHaveCount(1);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();
});

test('reload invalidates a pending preview transform before the old response arrives', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await enableInteractivePreview(page);
  await startHeldServiceDuplicate(page);

  const reloadedText = `${servicesA}# installed by reload\n`;
  await fs.writeFile(path.join(dirA, 'services.yaml'), reloadedText, 'utf8');
  await page.locator('#reload-directory-button').click();
  await waitForHeldCount(page, 'loads', 1);
  await releaseHeldRequest(page, 'loads');

  await expect(page.locator('#save-status')).toContainText('Reloaded');
  expect(await getEditorValue(page)).toBe(reloadedText);
  await expect(page.locator('#preview-undo-button')).toBeHidden();

  await releaseHeldRequest(page, 'transforms');
  expect(await getEditorValue(page)).toBe(reloadedText);
  await expect(page.locator('#save-status')).toContainText('Reloaded');
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
});

test('Preview success notice is superseded by a newer directory load', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await enableInteractivePreview(page);
  await startHeldServiceDuplicate(page);
  await releaseHeldRequest(page, 'transforms');
  await expect(page.locator('#save-status')).toContainText('Duplicated service Alpha.');

  await loadAndInstall(page, dirB);

  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('#save-status')).toBeHidden();
});

test('older reload error notice is superseded by a newer directory load', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await fs.rm(dirA, { recursive: true, force: true });

  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.url === 'http://127.0.0.1:4173/api/directory/load'
      && entry.text.startsWith('Failed to load resource: the server responded with a status of 400'),
    'the expected failed directory reload request'
  );
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.url.startsWith('http://127.0.0.1:4173/js/app.js')
      && entry.text.split('\n')[0] === 'Directory reload error: Error: Directory does not exist or cannot be accessed. Check the path and permissions',
    'the application must report the expected failed directory reload'
  );

  await page.locator('#reload-directory-button').click();
  await waitForHeldCount(page, 'loads', 1);
  await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#save-status')).toContainText('Could not reload the directory.');

  await loadAndInstall(page, dirB);

  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('#save-status')).toBeHidden();
});

test('newer preview ownership prevents an older transform from overwriting it', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await enableInteractivePreview(page);
  await startHeldServiceDuplicate(page);
  await startHeldServiceRemoval(page);

  const newerEntry = await releaseHeldRequest(page, 'transforms', { index: 1 });
  const newerPayload = await newerEntry.response.json();
  await expect.poll(() => getEditorValue(page)).toBe(newerPayload.files.services);
  await expect(page.locator('#save-status')).toContainText('Deleted service Alpha.');
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await releaseHeldRequest(page, 'transforms', { index: 0 });
  expect(await getEditorValue(page)).toBe(newerPayload.files.services);
  await expect(page.locator('#save-status')).toContainText('Deleted service Alpha.');
});

test('Preview Undo invalidates a pending transform and preserves the undone documents', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await enableInteractivePreview(page);
  await startHeldServiceDuplicate(page);
  await releaseHeldRequest(page, 'transforms');
  await expect(page.locator('#preview-undo-button')).toBeVisible();

  await startHeldServiceDuplicate(page);
  await page.locator('#preview-undo-button').click();
  await expect(page.locator('#save-status')).toContainText('Undid: Duplicated service Alpha.');
  expect(await getEditorValue(page)).toBe(servicesA);

  await releaseHeldRequest(page, 'transforms');
  expect(await getEditorValue(page)).toBe(servicesA);
  await expect(page.locator('#preview-undo-button')).toBeHidden();
  await expect(page.locator('#save-status')).toContainText('Undid: Duplicated service Alpha.');
});

test('A-B-A directory generations cannot revive an old preview response', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await enableInteractivePreview(page);
  await startHeldServiceDuplicate(page);

  const newerA = `${servicesA}# newer A generation\n`;
  await fs.writeFile(path.join(dirA, 'services.yaml'), newerA, 'utf8');
  await loadAndInstall(page, dirB);
  await loadAndInstall(page, dirA);
  expect(await getEditorValue(page)).toBe(newerA);
  await expect(page.locator('#preview-undo-button')).toBeHidden();

  await releaseHeldRequest(page, 'transforms');
  expect(await getEditorValue(page)).toBe(newerA);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirA));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#save-status')).toBeHidden();
});
test('stale load cleanup cannot close or re-enable a newer load', async ({ page }) => {
  await openLoadDialog(page);
  await submitLoad(page, dirA);
  await waitForHeldCount(page, 'loads', 1);

  // A newer load starts while A is still pending. Releasing stale A must not clean up B's
  // still-owned modal or submit button.
  await submitLoad(page, dirB, { reenableSubmit: true });
  await waitForHeldCount(page, 'loads', 2);
  await releaseHeldRequest(page, 'loads', { matchDir: dirA });

  await expect(page.locator('#directoryModal')).toBeVisible();
  await expect(page.locator('#load-directory-submit')).toBeDisabled();

  const payloadB = await releaseHeldRequest(page, 'loads', { matchDir: dirB });
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadB.response.json()).directory));
  await expect(page.locator('#directoryModal')).toBeHidden();
  await expect(page.locator('#load-directory-submit')).toBeEnabled();
  expect(await getEditorValue(page)).toBe(servicesB);
});

test('stale reload cleanup cannot re-enable a newer reload', async ({ page }) => {
  const servicesV2 = `${servicesA}# disk change\n`;
  await loadAndInstall(page, dirA);

  await page.locator('#reload-directory-button').click();
  await waitForHeldCount(page, 'loads', 1);
  await fs.writeFile(path.join(dirA, 'services.yaml'), servicesV2, 'utf8');

  // Inject a second same-directory reload while the first request is pending.
  await page.locator('#reload-directory-button').evaluate((button) => { button.disabled = false; });
  await page.locator('#reload-directory-button').click();
  await waitForHeldCount(page, 'loads', 2);

  // The older response is stale, but the newer reload still owns loading state and its button.
  await releaseHeldRequest(page, 'loads', { index: 0 });
  await expect(page.locator('#reload-directory-button')).toBeDisabled();
  await expect(page.locator('#save-status')).toContainText('Reloading directory...');

  await releaseHeldRequest(page, 'loads', { index: 0 });
  await expect(page.locator('#save-status')).toContainText('Reloaded');
  await expect(page.locator('#reload-directory-button')).toBeEnabled();
  expect(await getEditorValue(page)).toBe(servicesV2);
});

test('stale Save cleanup cannot erase a newer reload notice', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await setEditorValue(page, `${servicesA}# save before reload\n`);

  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);

  await page.locator('#reload-directory-button').click();
  await expect(page.locator('#confirmation-modal')).toBeVisible();
  await page.locator('#confirmation-modal-confirm').click();
  await waitForHeldCount(page, 'loads', 1);
  await expect(page.locator('#save-status')).toHaveText('Reloading directory...');

  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();
  await expect(page.locator('#save-status')).toHaveText('Reloading directory...');

  await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#save-status')).toContainText('Reloaded');
});

test('stale save cannot reconcile into a later A-B-A session generation', async ({ page }) => {
  await loadAndInstall(page, dirA);
  const firstGenerationText = `${servicesA}# first generation save\n`;
  await setEditorValue(page, firstGenerationText);

  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);

  await loadAndInstall(page, dirB);
  const laterGenerationText = `${servicesA}# later A generation\n`;
  await fs.writeFile(path.join(dirA, 'services.yaml'), laterGenerationText, 'utf8');
  await loadAndInstall(page, dirA);

  // The new A session is clean before the original A response arrives, despite sharing its path.
  expect(await getEditorValue(page)).toBe(laterGenerationText);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#save-status')).toBeHidden();

  await releaseSaveAndAwaitCompletion(page);

  // The old response cannot replace the new A baseline, revision, dirty state, or notice.
  expect(await getEditorValue(page)).toBe(laterGenerationText);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();
  expect(await fs.readFile(path.join(dirA, 'services.yaml'), 'utf8')).toBe(laterGenerationText);
});

test('reload confirmation continuation is rejected after the directory session changes', async ({ page }) => {
  await loadAndInstall(page, dirA);
  await setEditorValue(page, `${servicesA}# pending edit\n`);

  await page.locator('#reload-directory-button').click();
  await expect(page.locator('#confirmation-modal')).toBeVisible();

  // The confirmation overlay is intentionally bypassed here to model another already-started
  // directory operation completing before the user answers the old confirmation.
  await page.locator('#load-directory-button').evaluate((button) => { button.click(); });
  await expect(page.locator('#directoryModal')).toBeVisible();
  await page.locator('#serverPathInput').fill(dirB);
  await page.locator('#load-directory-submit').evaluate((button) => { button.click(); });
  await waitForHeldCount(page, 'loads', 1);
  await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('#confirmation-modal')).toBeVisible();

  await page.locator('#confirmation-modal-confirm').click();
  await expect.poll(() => heldRequests(page, 'loads').length).toBe(0);
  await expect(page.locator('#reload-directory-button')).toBeEnabled();
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('#save-status')).toBeHidden();
});
test('frozen multi-file save keeps targeting its originating directory after a switch', async ({ page }) => {
  const payloadA = await loadAndInstall(page, dirA);

  // Dirty both files so the batch contains two requests (services first, per tab order).
  const editedServicesA = `${servicesA}    - Alpha2:\n        href: https://alpha2.example\n`;
  await setEditorValue(page, editedServicesA);
  await page.locator('.tab[data-tab="settings"]').click();
  const editedSettingsA = `${settingsA}# A settings edit\n`;
  await setEditorValue(page, editedSettingsA);

  // Save batches send requests sequentially: the next request is only issued after the previous
  // response arrives. Hold the first one (services) and verify its frozen payload.
  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);
  const [servicesBody] = heldRequests(page, 'saves').map((entry) => entry.body);
  expect(servicesBody).toMatchObject({
    dirPath: payloadA.directory,
    filename: 'services.yaml',
    content: editedServicesA,
    expectedRevision: payloadA.revisions['services.yaml']
  });

  // Switch to B while the batch is still in progress.
  await loadAndInstall(page, dirB);

  // Release the first response (stale now); the client then issues the second request,
  // which must still target A with A's frozen fields even though it was sent after the switch.
  await releaseHeldRequest(page, 'saves');
  await waitForHeldCount(page, 'saves', 1);
  const [settingsBody] = heldRequests(page, 'saves').map((entry) => entry.body);
  expect(settingsBody).toMatchObject({
    dirPath: payloadA.directory,
    filename: 'settings.yaml',
    content: editedSettingsA,
    expectedRevision: payloadA.revisions['settings.yaml']
  });

  // Release the second response (also stale); the batch continuation finishes in its finally block.
  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();

  // B's session is untouched: content, baselines (clean), dirty state, and notices. The install
  // restored the tab that was current when the load started (settings); switch back to services
  // for the content assertion.
  await page.locator('.tab[data-tab="services"]').click();
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();

  // The disk-side saves completed against A's frozen destinations.
  expect(await fs.readFile(path.join(dirA, 'services.yaml'), 'utf8')).toBe(editedServicesA);
  expect(await fs.readFile(path.join(dirA, 'settings.yaml'), 'utf8')).toBe(editedSettingsA);
});

test('stale save response from an older directory does not alter the newer session', async ({ page }) => {
  await loadAndInstall(page, dirA);
  const editedServicesA = `${servicesA}# stale save edit\n`;
  await setEditorValue(page, editedServicesA);

  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);

  // B becomes current while A's save response is still pending.
  await loadAndInstall(page, dirB);

  await releaseSaveAndAwaitCompletion(page);

  // Every dimension of B's session survives: content, baselines (clean), dirty state, notices.
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();

  // B's baselines and revisions are still functional: a fresh edit saves without conflict.
  const editedServicesB = `${servicesB}# fresh B edit\n`;
  await setEditorValue(page, editedServicesB);
  await page.unroute('**/api/directory/file/save');
  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved services.yaml.');
  expect(await fs.readFile(path.join(dirB, 'services.yaml'), 'utf8')).toBe(editedServicesB);

  // A's disk-side save still completed against its frozen destination.
  expect(await fs.readFile(path.join(dirA, 'services.yaml'), 'utf8')).toBe(editedServicesA);
});

test('returning to a directory path does not revive an older response for that path', async ({ page }) => {
  const servicesV1 = '- Main:\n    - V1:\n        href: https://v1.example\n';
  const servicesV2 = '- Main:\n    - V2:\n        href: https://v2.example\n';
  await fs.writeFile(path.join(dirA, 'services.yaml'), servicesV1, 'utf8');

  // Start loading A (reads v1); its response is held.
  await openLoadDialog(page);
  await submitLoad(page, dirA);
  await waitForHeldCount(page, 'loads', 1);

  // The directory changes on disk while the first load is in flight.
  await fs.writeFile(path.join(dirA, 'services.yaml'), servicesV2, 'utf8');

  // B loads and installs before A's response arrives.
  await submitLoad(page, dirB, { reenableSubmit: true });
  await waitForHeldCount(page, 'loads', 2);
  const payloadB = await releaseHeldRequest(page, 'loads', { matchDir: dirB });
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadB.response.json()).directory));

  // Return to A (reads v2 from disk); its response is held.
  await openLoadDialog(page);
  await submitLoad(page, dirA);
  await waitForHeldCount(page, 'loads', 2);
  const payloadNewA = await releaseHeldRequest(page, 'loads', { index: 1 });
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadNewA.response.json()).directory));

  // The original A response (v1) arrives last. Its path matches the current directory, but its
  // operation token is stale, so it must be discarded rather than installed.
  await releaseStaleLoad(page);

  expect(await getEditorValue(page)).toBe(servicesV2);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirA));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
});

test('edits made while a save is pending survive and stay dirty against the submitted baseline', async ({ page }) => {
  await loadAndInstall(page, dirA);
  const textX = `${servicesA}# edit X\n`;
  await setEditorValue(page, textX);

  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);

  // Newer edit while the response is pending.
  const textY = `${servicesA}# edit Y\n`;
  await setEditorValue(page, textY);

  await releaseSaveAndAwaitCompletion(page);

  // X was recorded as the saved baseline/revision; Y remains visible and dirty against it.
  expect(await getEditorValue(page)).toBe(textY);
  await expect(page.locator('#save-status')).toContainText('Saved services.yaml.');
  await expect(page.locator('.tab[data-tab="services"].unsaved')).toHaveCount(1);
  await expect(page.locator('#unsaved-status')).toBeVisible();

  // No edit is lost: saving again writes Y on top of X's revision without a conflict.
  await page.unroute('**/api/directory/file/save');
  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved services.yaml.');
  expect(await fs.readFile(path.join(dirA, 'services.yaml'), 'utf8')).toBe(textY);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
});

test('reversed load responses keep the most recently started load current', async ({ page }) => {
  await openLoadDialog(page);
  await submitLoad(page, dirA);
  await waitForHeldCount(page, 'loads', 1);

  // Start B while A is still pending.
  await submitLoad(page, dirB, { reenableSubmit: true });
  await waitForHeldCount(page, 'loads', 2);

  // B's response arrives first and installs; A's older response must not overwrite it.
  const payloadB = await releaseHeldRequest(page, 'loads', { matchDir: dirB });
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadB.response.json()).directory));
  await releaseStaleLoad(page, { matchDir: dirA });

  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
});

test('an older same-directory reload response cannot overwrite a newer reload', async ({ page }) => {
  const servicesV2 = `${servicesA}# disk change\n`;
  await loadAndInstall(page, dirA);

  // First reload starts (no unsaved changes, so no confirmation dialog).
  await page.locator('#reload-directory-button').click();
  await waitForHeldCount(page, 'loads', 1);

  // The directory changes on disk while the first reload is in flight.
  await fs.writeFile(path.join(dirA, 'services.yaml'), servicesV2, 'utf8');

  // A newer reload of the same directory starts; re-enable the button to inject the overlap.
  await page.locator('#reload-directory-button').evaluate((button) => { button.disabled = false; });
  await page.locator('#reload-directory-button').click();
  await waitForHeldCount(page, 'loads', 2);

  // The newer reload's response installs first (reads v2 from disk).
  await releaseHeldRequest(page, 'loads', { index: 1 });
  await expect.poll(() => getEditorValue(page)).toBe(servicesV2);
  await expect(page.locator('#save-status')).toContainText('Reloaded');

  // The older reload's response (v1) arrives later and must be discarded.
  await releaseHeldRequest(page, 'loads', { index: 0 });
  await expect(page.locator('#reload-directory-button')).toBeEnabled();
  expect(await getEditorValue(page)).toBe(servicesV2);
});

test('a save batch in flight cannot install baselines into a session loaded mid-batch', async ({ page }) => {
  await loadAndInstall(page, dirA);

  // Dirty both files so the batch spans two requests.
  const editedServicesA = `${servicesA}# A services edit\n`;
  await setEditorValue(page, editedServicesA);
  await page.locator('.tab[data-tab="settings"]').click();
  const editedSettingsA = `${settingsA}# A settings edit\n`;
  await setEditorValue(page, editedSettingsA);

  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);

  // The first save response arrives while A still owns the session and reconciles normally
  // (its effect on indicators is only rendered when the batch continuation finishes).
  await releaseHeldRequest(page, 'saves');

  // The second batch request is now in flight; hold it.
  await waitForHeldCount(page, 'saves', 1);

  // A newer load (B) completes while the second save response is still pending. The install
  // switches to the tab that was current when the load started (settings).
  await loadAndInstall(page, dirB);

  // The stale second response must not install A's settings baseline/revision into B's session.
  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();

  expect(await getEditorValue(page)).toBe(settingsB);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();

  // B's settings revision is still functional end-to-end.
  const editedSettingsB = `${settingsB}# fresh B edit\n`;
  await setEditorValue(page, editedSettingsB);
  await page.unroute('**/api/directory/file/save');
  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Saved settings.yaml.');
  expect(await fs.readFile(path.join(dirB, 'settings.yaml'), 'utf8')).toBe(editedSettingsB);
});

test('a pending load that installs while a save is in flight makes the save response stale', async ({ page }) => {
  await loadAndInstall(page, dirA);
  const editedServicesA = `${servicesA}# edit during pending load\n`;
  await setEditorValue(page, editedServicesA);

  // Start loading B; its request is held while the dialog stays open.
  await openLoadDialog(page);
  await submitLoad(page, dirB);
  await waitForHeldCount(page, 'loads', 1);

  // Close the dialog (Escape) — the pending load keeps running — then start a save against A.
  await page.keyboard.press('Escape');
  await expect(page.locator('#directoryModal')).toBeHidden();
  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);

  // B installs while the save response is still pending.
  const payloadB = await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadB.response.json()).directory));

  // The save response arrives into the newer session and must be discarded as stale.
  await releaseSaveAndAwaitCompletion(page);

  // B's session is untouched: content, baselines (clean), dirty state, notices.
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirB));
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#unsaved-status')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();

  // A's disk-side save completed against its frozen destination.
  expect(await fs.readFile(path.join(dirA, 'services.yaml'), 'utf8')).toBe(editedServicesA);
});

test('a Save completing before a pending load installs cannot reconcile stale A state', async ({ page }) => {
  await createPartialDirectory();
  await loadAndInstall(page, partialDir);
  const settingsSample = await fs.readFile(path.join(examplesDir, 'settings.yaml'), 'utf8');
  const editedSettingsA = `${settingsSample}# save during pending load\n`;

  // Edit an absent A file so the stale response would incorrectly update both its revision and
  // presence metadata if reconciliation were still guarded only by session generation.
  await page.locator('.tab[data-tab="settings"]').click();
  await setEditorValue(page, editedSettingsA);
  const stateBeforeSave = await getLoadedState(page, 'settings');
  expect(stateBeforeSave).toMatchObject({
    original: settingsSample,
    revision: null,
    present: false
  });
  await page.locator('.tab[data-tab="services"]').click();

  // Save A starts first and its real response is held before the newer load begins.
  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);
  const saveEntry = heldRequests(page, 'saves')[0];
  expect(saveEntry.body).toMatchObject({
    dirPath: partialDir,
    filename: 'settings.yaml',
    content: editedSettingsA,
    expectedRevision: null
  });

  await openLoadDialog(page);
  await submitLoad(page, dirB);
  await waitForHeldCount(page, 'loads', 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#directoryModal')).toBeHidden();

  // Release Save A while B is still pending. A remains the installed session, but no longer owns
  // reconciliation because B has already claimed the directory-operation boundary.
  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();
  await expect(page.locator('#save-status')).toBeHidden();
  await page.locator('.tab[data-tab="settings"]').click();
  expect(await getEditorValue(page)).toBe(editedSettingsA);
  await expect(page.locator('.tab[data-tab="settings"].unsaved')).toHaveCount(1);
  await expect(page.locator('#unsaved-status')).toBeVisible();
  expect(await getLoadedState(page, 'settings')).toEqual({
    content: editedSettingsA,
    original: stateBeforeSave.original,
    revision: stateBeforeSave.revision,
    present: stateBeforeSave.present
  });
  expect(await fs.readFile(path.join(partialDir, 'settings.yaml'), 'utf8')).toBe(editedSettingsA);

  const payloadB = await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadB.response.json()).directory));
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#save-status')).toBeHidden();
});

test('a failed newer load does not strand later Save ownership', async ({ page }) => {
  await loadAndInstall(page, dirA);
  const editedServicesA = `${servicesA}# save before failed load\n`;
  await setEditorValue(page, editedServicesA);

  const missingDir = path.join(configDir, 'missing-directory-for-async-ownership');
  await openLoadDialog(page);
  await submitLoad(page, missingDir);
  await waitForHeldCount(page, 'loads', 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#directoryModal')).toBeHidden();

  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);
  expect(heldRequests(page, 'saves')[0].body).toMatchObject({
    dirPath: dirA,
    filename: 'services.yaml',
    content: editedServicesA
  });
  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();
  await expect(page.locator('#save-status')).toBeHidden();

  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.url === 'http://127.0.0.1:4173/api/directory/load'
      && entry.text.startsWith('Failed to load resource: the server responded with a status of '),
    'the expected failed newer directory load'
  );
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.url.startsWith('http://127.0.0.1:4173/js/app.js')
      && entry.text.split('\n')[0] === 'Directory load error: Error: Directory does not exist or cannot be accessed. Check the path and permissions',
    'the application must report the expected failed newer directory load'
  );
  await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#load-directory-submit')).toBeEnabled();
  await expect(page.locator('#directory-info')).toContainText(path.basename(dirA));

  const editedServicesAfterFailure = `${editedServicesA}# save after failed load\n`;
  await setEditorValue(page, editedServicesAfterFailure);
  await page.unroute('**/api/directory/file/save');
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text === 'Failed to load resource: the server responded with a status of 409 (Conflict)'
      && entry.url === 'http://127.0.0.1:4173/api/directory/file/save',
    'the later Save must report the stale revision conflict after the failed newer load'
  );
  await page.locator('#save-config-button').click();
  await expect(page.locator('#save-status')).toContainText('Could not save services.yaml');
  await expect(page.locator('#save-config-button')).toBeEnabled();
  expect(await getEditorValue(page)).toBe(editedServicesAfterFailure);
  await expect(page.locator('.tab[data-tab="services"].unsaved')).toHaveCount(1);
  expect(await fs.readFile(path.join(dirA, 'services.yaml'), 'utf8')).toBe(editedServicesA);
});

test('a save error during a pending load cannot publish stale error status', async ({ page }) => {
  await loadAndInstall(page, dirA);
  const editedServicesA = `${servicesA}# conflicting save during pending load\n`;
  await setEditorValue(page, editedServicesA);

  await openLoadDialog(page);
  await submitLoad(page, dirB);
  await waitForHeldCount(page, 'loads', 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#directoryModal')).toBeHidden();

  // Change A after it was loaded so the real save endpoint returns its normal revision conflict.
  await fs.writeFile(path.join(dirA, 'services.yaml'), `${servicesA}# changed on disk\n`, 'utf8');
  await page.locator('#save-config-button').click();
  await waitForHeldCount(page, 'saves', 1);
  registerExpectedError(
    expectedErrorsByPage.get(page),
    (entry) => entry.type === 'console'
      && entry.text === 'Failed to load resource: the server responded with a status of 409 (Conflict)'
      && entry.url === 'http://127.0.0.1:4173/api/directory/file/save',
    'the expected configuration-file save conflict during a pending directory load'
  );

  await releaseHeldRequest(page, 'saves');
  await expect(page.locator('#save-config-button')).toBeEnabled();
  await expect(page.locator('#save-status')).toBeHidden();

  const payloadB = await releaseHeldRequest(page, 'loads');
  await expect(page.locator('#directory-info')).toContainText(path.basename((await payloadB.response.json()).directory));
  expect(await getEditorValue(page)).toBe(servicesB);
  await expect(page.locator('.tab.unsaved')).toHaveCount(0);
  await expect(page.locator('#save-status')).toBeHidden();
});
