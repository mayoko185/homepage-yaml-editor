const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const YAML = require('yaml');

function revisionFor(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function createServerEnv(overrides) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === 'REQUIRE_LOGIN_USER' || name.toUpperCase() === 'REQUIRE_LOGIN_PASSWORD') {
      delete env[name];
    }
  }
  return { ...env, ...overrides };
}

test('Docker image copies every runtime server module', async () => {
  const dockerfile = await fs.readFile(path.resolve(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY server\.js \.\/$/m);
  assert.match(dockerfile, /^COPY auth-state\.js \.\/$/m);
  assert.match(dockerfile, /^COPY yaml-transform\.js \.\/$/m);
  assert.match(dockerfile, /^COPY option-types\.default\.json \.\/$/m);
  assert.match(dockerfile, /^COPY app-settings\.default\.json \.\/$/m);
});

test('app-settings.default.json ships well-formed editor setting defaults', async () => {
  const defaults = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', 'app-settings.default.json'), 'utf8'));
  assert.equal(typeof defaults, 'object');
  assert.equal(Array.isArray(defaults), false);
  for (const key of ['customPageTitle', 'liveHomepageUrl']) {
    assert.equal(typeof defaults[key], 'string', `app-settings.default.json "${key}" must be a string`);
  }
  for (const key of ['autoIndent', 'previewAutoRefresh', 'editorVisible', 'interactiveEditor', 'showComments']) {
    assert.equal(typeof defaults[key], 'boolean', `app-settings.default.json "${key}" must be a boolean`);
  }
  assert.ok(['light', 'dark'].includes(defaults.theme), 'app-settings.default.json "theme" must be "light" or "dark"');
  for (const key of ['visibleTabs', 'tabOrder']) {
    assert.ok(Array.isArray(defaults[key]), `app-settings.default.json "${key}" must be an array`);
    defaults[key].forEach((tab) => {
      assert.equal(typeof tab, 'string', `app-settings.default.json "${key}" entries must be strings`);
    });
  }
  const supportedTabs = ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'];
  assert.deepEqual(defaults.tabOrder.slice().sort(), [...supportedTabs].sort(), 'app-settings.default.json "tabOrder" must list every supported tab');
  assert.deepEqual(defaults.visibleTabs.slice().sort(), [...supportedTabs].sort(), 'app-settings.default.json "visibleTabs" must list every supported tab');
  assert.equal(typeof defaults.editBarOptions, 'object', 'app-settings.default.json "editBarOptions" must be an object');
  assert.equal(typeof defaults.editBarOptions.comment, 'boolean', 'app-settings.default.json "editBarOptions.comment" must be a boolean');
  assert.equal(typeof defaults.editBarOptions.duplicate, 'boolean', 'app-settings.default.json "editBarOptions.duplicate" must be a boolean');
  assert.equal(typeof defaults.editBarOptions.moveUpDown, 'boolean', 'app-settings.default.json "editBarOptions.moveUpDown" must be a boolean');
});

test('footer version in public/index.html matches package.json', async () => {
  const pkg = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const indexHtml = await fs.readFile(path.resolve(__dirname, '..', 'public', 'index.html'), 'utf8');
  const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    indexHtml,
    new RegExp(`<span>v${escapedVersion}</span>`),
    `public/index.html footer must show v${pkg.version}. Update the footer when bumping the package version.`
  );
});

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/runtime-config.js`);
      if (response.ok) {
        return;
      }
    } catch {
      // The listener may not be bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Server did not become ready');
}

test('serves optimized assets and supports the active configuration APIs', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-test-'));
  const appDataDir = path.join(tempRoot, 'app-data');
  const yamlContent = '- Test:\n    - Service:\n        href: http://localhost/';
  await fs.writeFile(path.join(tempRoot, 'services.yaml'), yamlContent, 'utf8');
  await fs.mkdir(appDataDir);
  await fs.writeFile(path.join(appDataDir, 'option-types.json'), JSON.stringify([
    { name: 'description', type: 'text' },
    { name: 'localOnly', type: 'boolean' }
  ]), 'utf8');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: appDataDir,
      DEFAULT_THEME: 'light'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);
    const startup = await (await fetch(`${baseUrl}/api/startup-directory`)).json();
    assert.equal(startup.hasStartupDirectory, true);
    assert.equal(startup.directory, tempRoot);
    assert.equal(startup.files['services.yaml'], yamlContent);
    assert.equal(startup.revisions['services.yaml'], revisionFor(yamlContent));
    const mergedOptionTypesOnDisk = JSON.parse(await fs.readFile(path.join(appDataDir, 'option-types.json'), 'utf8'));
    assert.deepEqual(mergedOptionTypesOnDisk.slice(0, 2), [
      { name: 'description', type: 'text', appliesTo: ['service'], defaultForAdd: ['service'], defaultOrder: { service: 1 } },
      { name: 'localOnly', type: 'boolean', appliesTo: ['service', 'group'] }
    ]);

    const examplesResponse = await fetch(`${baseUrl}/api/examples`);
    const examples = await examplesResponse.json();
    assert.equal(examplesResponse.status, 200);
    assert.equal(examplesResponse.headers.get('cache-control'), 'no-store');
    for (const baseName of ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes']) {
      const expectedExample = await fs.readFile(path.join('examples', `${baseName}.yaml`), 'utf8');
      assert.equal(examples.samples[baseName], expectedExample);
    }

    const defaultAppSettings = await (await fetch(`${baseUrl}/api/app-settings`)).json();
    assert.deepEqual(defaultAppSettings.settings, {
      theme: 'light',
      customPageTitle: '',
      liveHomepageUrl: '',
      autoIndent: true,
      previewAutoRefresh: true,
      editorVisible: false,
      interactiveEditor: true,
      showComments: false,
      editBarOptions: { comment: true, duplicate: true, moveUpDown: true },
      visibleTabs: ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'],
      tabOrder: ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'],
      autoBackup: true,
      backupCount: 10
    });
    const settingsSaveResponse = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          theme: 'dark', autoIndent: false, previewAutoRefresh: false, editorVisible: false, interactiveEditor: true,
          customPageTitle: '  My YAML Dashboard  ',
          liveHomepageUrl: '  https://homepage.example.com/  ',
          visibleTabs: ['kubernetes', 'services'], tabOrder: ['kubernetes', 'services'], ignored: 'value'
        }
      })
    });
    assert.equal(settingsSaveResponse.status, 200);
    assert.deepEqual((await settingsSaveResponse.json()).settings, {
      theme: 'dark',
      customPageTitle: 'My YAML Dashboard',
      liveHomepageUrl: 'https://homepage.example.com/',
      autoIndent: false,
      previewAutoRefresh: false,
      editorVisible: false,
      interactiveEditor: true,
      showComments: false,
      editBarOptions: { comment: true, duplicate: true, moveUpDown: true },
      visibleTabs: ['kubernetes', 'services'],
      tabOrder: ['kubernetes', 'services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox'],
      autoBackup: true,
      backupCount: 10
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(appDataDir, 'settings.json'), 'utf8')), {
      theme: 'dark',
      customPageTitle: 'My YAML Dashboard',
      liveHomepageUrl: 'https://homepage.example.com/',
      autoIndent: false,
      previewAutoRefresh: false,
      editorVisible: false,
      interactiveEditor: true,
      showComments: false,
      editBarOptions: { comment: true, duplicate: true, moveUpDown: true },
      visibleTabs: ['kubernetes', 'services'],
      tabOrder: ['kubernetes', 'services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox'],
      autoBackup: true,
      backupCount: 10
    });

    const invalidSettingsResponse = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          theme: 'dark', autoIndent: true, previewAutoRefresh: true, editorVisible: true, interactiveEditor: false,
          customPageTitle: '', liveHomepageUrl: 'javascript:alert(1)'
        }
      })
    });
    assert.equal(invalidSettingsResponse.status, 200);
    assert.equal((await invalidSettingsResponse.json()).settings.liveHomepageUrl, '');

    // Regression: partial PUT must not overwrite previously saved values
    const preMergeSave = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: { customPageTitle: 'Should Survive', showComments: true }
      })
    });
    assert.equal(preMergeSave.status, 200);
    const partialUpdate = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: { theme: 'dark' }
      })
    });
    assert.equal(partialUpdate.status, 200);
    const partialResult = (await partialUpdate.json()).settings;
    assert.equal(partialResult.customPageTitle, 'Should Survive', 'partial PUT must preserve existing customPageTitle');
    assert.equal(partialResult.showComments, true, 'partial PUT must preserve existing showComments');
    assert.equal(partialResult.theme, 'dark', 'partial PUT must apply the new value');

    const optionTypesResponse = await fetch(`${baseUrl}/api/option-types`);
    const optionTypes = await optionTypesResponse.json();
    assert.equal(optionTypesResponse.status, 200);
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'description'), {
      name: 'description', type: 'text', appliesTo: ['service'], defaultForAdd: ['service'], defaultOrder: { service: 1 }
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'localOnly'), {
      name: 'localOnly', type: 'boolean', appliesTo: ['service', 'group']
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'target'), {
      name: 'target', type: 'select', appliesTo: ['service', 'bookmark'], values: ['_blank', '_self', '_top']
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'href'), {
      name: 'href', type: 'text', appliesTo: ['service', 'bookmark'], defaultForAdd: ['service', 'bookmark'], defaultOrder: { service: 2, bookmark: 0 }
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'abbr'), {
      name: 'abbr', type: 'text', appliesTo: ['bookmark'], defaultForAdd: ['bookmark'], defaultOrder: { bookmark: 1 }
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'icon'), {
      name: 'icon', type: 'text', appliesTo: ['service', 'group', 'bookmark'], defaultForAdd: ['service'], defaultOrder: { service: 0 }
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'type'), {
      name: 'type', type: 'text', appliesTo: ['widget'], defaultForAdd: ['widget'], defaultOrder: { widget: 0 }
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'tab'), {
      name: 'tab', type: 'tab', appliesTo: ['group'], defaultForAdd: ['group'], defaultOrder: { group: 3 }
    });
    const optionTypesSaveResponse = await fetch(`${baseUrl}/api/option-types`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ options: [
        { name: 'customText', type: 'text', appliesTo: ['service', 'bookmark'] },
        { name: 'customFlag', type: 'boolean', appliesTo: ['group'] },
        { name: 'customWidget', type: 'text', appliesTo: ['widget'], defaultForAdd: ['widget'], defaultOrder: { widget: 0 } },
        { name: 'customChoice', type: 'select', appliesTo: ['service'], values: ['', 'something', 'another thing'] }
      ] })
    });
    assert.equal(optionTypesSaveResponse.status, 200);
    assert.deepEqual((await optionTypesSaveResponse.json()).options, [
      { name: 'customText', type: 'text', appliesTo: ['service', 'bookmark'] },
      { name: 'customFlag', type: 'boolean', appliesTo: ['group'] },
      { name: 'customWidget', type: 'text', appliesTo: ['widget'], defaultForAdd: ['widget'], defaultOrder: { widget: 0 } },
      { name: 'customChoice', type: 'select', appliesTo: ['service'], values: ['', 'something', 'another thing'] }
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(appDataDir, 'option-types.json'), 'utf8')), [
      { name: 'customText', type: 'text', appliesTo: ['service', 'bookmark'] },
      { name: 'customFlag', type: 'boolean', appliesTo: ['group'] },
      { name: 'customWidget', type: 'text', appliesTo: ['widget'], defaultForAdd: ['widget'], defaultOrder: { widget: 0 } },
      { name: 'customChoice', type: 'select', appliesTo: ['service'], values: ['', 'something', 'another thing'] }
    ]);
    const invalidApplicabilityResponse = await fetch(`${baseUrl}/api/option-types`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ options: [{ name: 'invalid', type: 'text', appliesTo: ['bookmark', 'unknown'] }] })
    });
    assert.equal(invalidApplicabilityResponse.status, 400);
    assert.match((await invalidApplicabilityResponse.json()).details, /service, group, bookmark, or widget/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(appDataDir, 'option-types.json'), 'utf8')), [
      { name: 'customText', type: 'text', appliesTo: ['service', 'bookmark'] },
      { name: 'customFlag', type: 'boolean', appliesTo: ['group'] },
      { name: 'customWidget', type: 'text', appliesTo: ['widget'], defaultForAdd: ['widget'], defaultOrder: { widget: 0 } },
      { name: 'customChoice', type: 'select', appliesTo: ['service'], values: ['', 'something', 'another thing'] }
    ]);

    const removedSaveResponse = await fetch(`${baseUrl}/api/config/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'services.yaml', content: yamlContent })
    });
    assert.equal(removedSaveResponse.status, 404);

    const refreshedStartupResponse = await fetch(`${baseUrl}/api/startup-directory`);
    const refreshedStartup = await refreshedStartupResponse.json();
    assert.equal(refreshedStartupResponse.status, 200);
    assert.equal(refreshedStartupResponse.headers.get('cache-control'), 'no-store');
    assert.equal(refreshedStartup.files['services.yaml'], yamlContent);

    const loadResponse = await fetch(`${baseUrl}/api/directory/load`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot })
    });
    const loaded = await loadResponse.json();
    assert.equal(loadResponse.status, 200);
    assert.equal(loaded.files['services.yaml'], yamlContent);

    const transformResponse = await fetch(`${baseUrl}/api/yaml/transform`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: { services: yamlContent, settings: '' },
        operation: {
          type: 'service.add',
          target: { groupName: 'Test', groupIndex: 0 },
          values: { name: 'Preview Service', href: 'https://preview.example' }
        }
      })
    });
    const transformed = await transformResponse.json();
    assert.equal(transformResponse.status, 200);
    assert.equal(YAML.parse(transformed.files.services)[0].Test[1]['Preview Service'].href, 'https://preview.example');
    assert.equal(await fs.readFile(path.join(tempRoot, 'services.yaml'), 'utf8'), yamlContent);

    // Server must inject groupOptionNames from cached option definitions
    // and reject sub-group names that collide with custom group options.
    const nestedServices = `- Top Group:
    - Inner Group:
        - Service A:
            href: https://a.example
`;
    const nestedSettings = `title: Test
layout:
  Top Group:
    tab: Main
    Inner Group:
      icon: inner.png
`;
    const collisionResponse = await fetch(`${baseUrl}/api/yaml/transform`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: { services: nestedServices, settings: nestedSettings },
        operation: {
          type: 'group.add',
          target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Inner Group', index: 0 }] },
          values: { name: 'customFlag', fields: [] }
        }
      })
    });
    assert.equal(collisionResponse.status, 400);
    const collisionBody = await collisionResponse.json();
    assert.match(collisionBody.details, /conflicts with a group option name/);

    // Server must reject even when client provides an empty groupOptionNames array
    // (bypass attempt via Array.isArray truthiness).
    const emptyArrayBypassResponse = await fetch(`${baseUrl}/api/yaml/transform`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: { services: nestedServices, settings: nestedSettings },
        operation: {
          type: 'group.add',
          target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Inner Group', index: 0 }] },
          values: { name: 'customFlag', fields: [] },
          groupOptionNames: []
        }
      })
    });
    assert.equal(emptyArrayBypassResponse.status, 400);
    const emptyArrayBody = await emptyArrayBypassResponse.json();
    assert.match(emptyArrayBody.details, /conflicts with a group option name/);

    const unchangedResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: tempRoot,
        filename: 'services.yaml',
        content: yamlContent,
        expectedRevision: startup.revisions['services.yaml']
      })
    });
    const unchanged = await unchangedResponse.json();
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.revision, revisionFor(yamlContent));

    const missingRevisionResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'services.yaml', content: yamlContent })
    });
    assert.equal(missingRevisionResponse.status, 428);

    const invalidSaveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: tempRoot,
        filename: 'settings.yaml',
        content: 'layout:\n  First:\n    tab: Main\n  First:\n    tab: Other\n',
        expectedRevision: null
      })
    });
    const invalidSave = await invalidSaveResponse.json();
    assert.equal(invalidSaveResponse.status, 400);
    assert.equal(invalidSave.error, 'Invalid YAML in configuration file');
    assert.match(invalidSave.details, /Duplicate mapping key/);
    assert.match(invalidSave.details, /line 4, column 3/);

    const proxmoxContent = 'pve:\n  url: https://proxmox.example:8006\n';
    const proxmoxSaveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'proxmox.yaml', content: proxmoxContent, expectedRevision: null })
    });
    assert.equal(proxmoxSaveResponse.status, 200);
    assert.equal(await fs.readFile(path.join(tempRoot, 'proxmox.yaml'), 'utf8'), proxmoxContent);

    const updatedYamlContent = `${yamlContent}\n        description: Updated after startup`;
    if (process.platform !== 'win32') await fs.chmod(path.join(tempRoot, 'services.yaml'), 0o640);
    const updatedSaveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: tempRoot,
        filename: 'services.yaml',
        content: updatedYamlContent,
        expectedRevision: startup.revisions['services.yaml']
      })
    });
    assert.equal(updatedSaveResponse.status, 200);
    const updatedSave = await updatedSaveResponse.json();
    assert.equal(updatedSave.changed, true);
    assert.equal(updatedSave.revision, revisionFor(updatedYamlContent));
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(path.join(tempRoot, 'services.yaml'))).mode & 0o777, 0o640);
    }
    assert.deepEqual(
      (await fs.readdir(tempRoot)).filter((filename) => filename.endsWith('.tmp')),
      []
    );

    const startupAfterDirectorySave = await (await fetch(`${baseUrl}/api/startup-directory`)).json();
    assert.equal(startupAfterDirectorySave.files['services.yaml'], updatedYamlContent);

    const externalYamlContent = '- External change: []\n';
    await fs.writeFile(path.join(tempRoot, 'services.yaml'), externalYamlContent, 'utf8');
    const conflictResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: tempRoot,
        filename: 'services.yaml',
        content: '- Browser change: []\n',
        expectedRevision: updatedSave.revision
      })
    });
    assert.equal(conflictResponse.status, 409);
    const conflict = await conflictResponse.json();
    assert.equal(conflict.currentRevision, revisionFor(externalYamlContent));
    assert.equal(await fs.readFile(path.join(tempRoot, 'services.yaml'), 'utf8'), externalYamlContent);

    const equivalentNoOpResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: tempRoot,
        filename: 'services.yaml',
        content: externalYamlContent,
        expectedRevision: updatedSave.revision
      })
    });
    assert.equal(equivalentNoOpResponse.status, 200);
    assert.equal((await equivalentNoOpResponse.json()).changed, false);

    const documentResponse = await fetch(`${baseUrl}/`);
    assert.equal(documentResponse.headers.get('cache-control'), 'no-cache');
    assert.match(documentResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(documentResponse.headers.get('x-frame-options'), 'DENY');
    assert.equal(documentResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.doesNotMatch(documentResponse.headers.get('content-security-policy'), /unsafe-inline|cdn\.jsdelivr/);
    assert.match(await documentResponse.text(), /id="security-status"/);

    const runtimeConfigResponse = await fetch(`${baseUrl}/runtime-config.js`);
    assert.equal(runtimeConfigResponse.status, 200);
    assert.equal(runtimeConfigResponse.headers.get('cache-control'), 'no-store');
    assert.match(await runtimeConfigResponse.text(), /"defaultTheme":"light"/);

    const assetResponse = await fetch(`${baseUrl}/app.js?v=146`, {
      headers: { 'accept-encoding': 'gzip' }
    });
    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get('cache-control'), /max-age=86400/);
    assert.equal(assetResponse.headers.get('content-encoding'), 'gzip');

    const vendorAssetResponse = await fetch(`${baseUrl}/vendor/js-yaml/js-yaml.min.js?v=4.3.0`);
    assert.equal(vendorAssetResponse.status, 200);
    assert.match(vendorAssetResponse.headers.get('cache-control'), /max-age=86400/);

    assert.equal((await fetch(`${baseUrl}/api/files`)).status, 404);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});

test('keeps an empty startup directory in read-only sample mode', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-sample-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: path.join(tempRoot, 'app-data')
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);
    const startupResponse = await fetch(`${baseUrl}/api/startup-directory`);
    const startup = await startupResponse.json();
    assert.equal(startupResponse.status, 200);
    assert.deepEqual(startup, {
      directory: null,
      files: {},
      revisions: {},
      hasStartupDirectory: false
    });
    assert.equal((await fetch(`${baseUrl}/api/config/save`, { method: 'POST' })).status, 404);
    assert.deepEqual(await fs.readdir(tempRoot), ['app-data']);
    assert.deepEqual(await fs.readdir(path.join(tempRoot, 'app-data')), ['option-types.json']);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});

test('rejects allowed-root symlink escapes', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-symlink-test-'));
  const outsideRoot = `${tempRoot}-outside`;
  const escapePath = path.join(tempRoot, 'escape');
  await fs.mkdir(outsideRoot);
  await fs.writeFile(path.join(outsideRoot, 'services.yaml'), '- Outside: []\n', 'utf8');
  await fs.symlink(outsideRoot, escapePath, 'junction');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: path.join(tempRoot, 'app-data')
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);
    const response = await fetch(`${baseUrl}/api/directory/load`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: escapePath })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Could not load configuration directory',
      details: 'Directory is not allowed. Choose a directory inside one of the configured allowed locations'
    });

    const linkedConfigPath = path.join(tempRoot, 'services.yaml');
    await fs.symlink(path.join(outsideRoot, 'services.yaml'), linkedConfigPath, 'file');
    const saveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'services.yaml', content: '- Safe: []\n', expectedRevision: null })
    });
    assert.equal(saveResponse.status, 400);
    assert.deepEqual(await saveResponse.json(), {
      error: 'Could not save configuration file',
      details: 'Configuration file must be a regular file. Symlinks and special files are not supported'
    });
    assert.equal(await fs.readFile(path.join(outsideRoot, 'services.yaml'), 'utf8'), '- Outside: []\n');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  }
});

test('optional login protects the editor and APIs with a form-based session', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-auth-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: path.join(tempRoot, 'app-data'),
      REQUIRE_LOGIN_USER: 'test-user',
      REQUIRE_LOGIN_PASSWORD: 'test-password',
      TRUST_PROXY: 'true'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);

    const runtimeConfig = await (await fetch(`${baseUrl}/runtime-config.js`)).text();
    assert.match(runtimeConfig, /"loginRequired":true/);

    const documentResponse = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert.equal(documentResponse.status, 302);
    assert.equal(documentResponse.headers.get('location'), '/login');

    const apiResponse = await fetch(`${baseUrl}/api/startup-directory`);
    assert.equal(apiResponse.status, 401);
    assert.deepEqual(await apiResponse.json(), { error: 'Authentication required' });

    const loginPageResponse = await fetch(`${baseUrl}/login`);
    assert.equal(loginPageResponse.status, 200);
    const loginPage = await loginPageResponse.text();
    assert.match(loginPage, /<form method="post" action="\/login"/);
    assert.match(loginPage, /This connection is using HTTP/);

    const invalidLoginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'test-user', password: 'wrong-password' }),
      redirect: 'manual'
    });
    assert.equal(invalidLoginResponse.status, 303);
    assert.equal(invalidLoginResponse.headers.get('location'), '/login?error=invalid');

    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'test-user', password: 'test-password' }),
      redirect: 'manual'
    });
    assert.equal(loginResponse.status, 303);
    assert.equal(loginResponse.headers.get('location'), '/');
    const sessionCookie = loginResponse.headers.get('set-cookie');
    assert.match(sessionCookie, /homepage_editor_session=/);
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Strict/i);

    const authenticatedResponse = await fetch(`${baseUrl}/`, {
      headers: { cookie: sessionCookie.split(';')[0] },
      redirect: 'manual'
    });
    assert.equal(authenticatedResponse.status, 200);
    assert.match(await authenticatedResponse.text(), /Homepage YAML Editor/);

    const logoutResponse = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { cookie: sessionCookie.split(';')[0] },
      redirect: 'manual'
    });
    assert.equal(logoutResponse.status, 303);
    assert.equal(logoutResponse.headers.get('location'), '/login');
    assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0/);

    const secureLoginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-proto': 'https'
      },
      body: new URLSearchParams({ username: 'test-user', password: 'test-password' }),
      redirect: 'manual'
    });
    assert.match(secureLoginResponse.headers.get('set-cookie'), /; Secure/);

    for (let attempt = 0; attempt < 5; attempt++) {
      const failedResponse = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: 'test-user', password: 'wrong-password' }),
        redirect: 'manual'
      });
      assert.equal(failedResponse.status, 303);
    }
    const lockedResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'test-user', password: 'test-password' }),
      redirect: 'manual'
    });
    assert.equal(lockedResponse.status, 303);
    assert.equal(lockedResponse.headers.get('location'), '/login?error=locked');
    assert.ok(Number(lockedResponse.headers.get('retry-after')) > 0);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});

test('backup permission hardening applies to existing directories and files', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-backup-perm-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: path.join(tempRoot, 'app-data')
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);

    // Create a backup directory with broad permissions and an old backup file
    const backupDir = path.join(tempRoot, 'app-data', 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    if (process.platform !== 'win32') {
      await fs.chmod(backupDir, 0o777);
    }

    // Create old backup files with broad permissions (both legacy 2-part and current 4-part)
    const oldBackupPath = path.join(backupDir, '000101_00000000_0000_services.yaml');
    await fs.writeFile(oldBackupPath, 'old: content\n', { encoding: 'utf8' });
    const legacyBackupPath = path.join(backupDir, '250723_services.yaml');
    await fs.writeFile(legacyBackupPath, 'legacy: content\n', { encoding: 'utf8' });
    if (process.platform !== 'win32') {
      await fs.chmod(oldBackupPath, 0o666);
      await fs.chmod(legacyBackupPath, 0o666);
    }

    // Create unrelated entries that should NOT be hardened
    const unrelatedDir = path.join(backupDir, 'unrelated-subdir');
    await fs.mkdir(unrelatedDir, { recursive: true });
    const unrelatedFilePath = path.join(backupDir, 'readme.txt');
    await fs.writeFile(unrelatedFilePath, 'not a backup\n', { encoding: 'utf8' });
    // A 4-part non-YAML file that the old >=4 heuristic would have incorrectly hardened
    const fourPartNonYaml = path.join(backupDir, 'a_b_c_d.txt');
    await fs.writeFile(fourPartNonYaml, 'not a backup\n', { encoding: 'utf8' });
    const numericPrefixedYaml = path.join(backupDir, '250723_notes.yaml');
    await fs.writeFile(numericPrefixedYaml, 'not a backup\n', { encoding: 'utf8' });
    if (process.platform !== 'win32') {
      await fs.chmod(unrelatedDir, 0o755);
      await fs.chmod(unrelatedFilePath, 0o644);
      await fs.chmod(fourPartNonYaml, 0o644);
      await fs.chmod(numericPrefixedYaml, 0o644);
    }

    // Save a file to trigger createBackup
    const yamlContent = 'services:\n  - name: Test\n    icon: test\n    href: https://example.com\n';
    const saveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: tempRoot,
        filename: 'services.yaml',
        content: yamlContent,
        expectedRevision: null
      })
    });
    assert.equal(saveResponse.status, 200);

    if (process.platform !== 'win32') {
      // Verify directory permissions are hardened
      const dirStat = await fs.stat(backupDir);
      assert.equal(dirStat.mode & 0o777, 0o700, 'Backup directory must be 0o700');

      // Verify old backup file permissions are hardened (both legacy 2-part and current 4-part)
      const oldFileStat = await fs.stat(oldBackupPath);
      assert.equal(oldFileStat.mode & 0o777, 0o600, 'Existing 4-part backup files must be 0o600');
      const legacyFileStat = await fs.stat(legacyBackupPath);
      assert.equal(legacyFileStat.mode & 0o777, 0o600, 'Existing legacy 2-part backup files must be 0o600');

      // Verify new backup file permissions are hardened
      const entries = await fs.readdir(backupDir);
      const newBackup = entries.find((e) => e.endsWith('_services.yaml') && e !== '000101_00000000_0000_services.yaml');
      assert.ok(newBackup, 'New backup file should exist');
      const newFileStat = await fs.stat(path.join(backupDir, newBackup));
      assert.equal(newFileStat.mode & 0o777, 0o600, 'New backup files must be 0o600');

      // Verify unrelated entries are NOT hardened
      const unrelatedDirStat = await fs.stat(unrelatedDir);
      assert.equal(unrelatedDirStat.mode & 0o777, 0o755, 'Unrelated subdirectory must not be hardened');
      const unrelatedFileStat = await fs.stat(unrelatedFilePath);
      assert.equal(unrelatedFileStat.mode & 0o777, 0o644, 'Unrelated files must not be hardened');
      const fourPartStat = await fs.stat(fourPartNonYaml);
      assert.equal(fourPartStat.mode & 0o777, 0o644, 'Four-part non-YAML files must not be hardened');
      const numericPrefixedYamlStat = await fs.stat(numericPrefixedYaml);
      assert.equal(numericPrefixedYamlStat.mode & 0o777, 0o644, 'Unsupported numeric-prefixed YAML files must not be hardened');
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});

test('backup retention enforces maxBackups limit', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-retention-test-'));
  const appDataDir = path.join(tempRoot, 'app-data');
  await fs.mkdir(appDataDir);
  const backupDir = path.join(appDataDir, 'backups');
  await fs.mkdir(backupDir);
  await fs.writeFile(path.join(backupDir, '250723_services.yaml'), 'legacy: content\n', 'utf8');
  const yamlContent = '- Test:\n    - Service:\n        href: http://localhost/';
  await fs.writeFile(path.join(tempRoot, 'services.yaml'), yamlContent, 'utf8');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: appDataDir
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);

    // Set backupCount to 2
    const settingsResponse = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { backupCount: 2 } })
    });
    assert.equal(settingsResponse.status, 200);

    // Get the initial revision of the existing file
    const startupResponse = await fetch(`${baseUrl}/api/startup-directory`);
    const startup = await startupResponse.json();
    let revision = startup.revisions['services.yaml'];

    // Save the same file 5 times with different content to trigger backups
    for (let i = 0; i < 5; i++) {
      const saveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dirPath: tempRoot,
          filename: 'services.yaml',
          content: `- Test:\n    - Service:\n        href: http://localhost/${i}`,
          expectedRevision: revision
        })
      });
      assert.equal(saveResponse.status, 200);
      revision = (await saveResponse.json()).revision;
    }

    // Check the backup directory — at most 2 current backups for services.yaml should remain.
    // Legacy backups are unscoped and must not be deleted by directory-scoped cleanup.
    const entries = await fs.readdir(backupDir);
    const matching = entries.filter((e) => e.split('_').length === 4 && e.endsWith('_services.yaml'));
    assert.ok(matching.length <= 2, `Expected at most 2 backups for services.yaml, got ${matching.length}`);
    assert.ok(entries.includes('250723_services.yaml'), 'Legacy services backups must not be pruned by directory-scoped cleanup');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});

test('backup namespace isolates backups by source directory', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-editor-namespace-test-'));
  const appDataDir = path.join(tempRoot, 'app-data');
  await fs.mkdir(appDataDir);
  const dirA = path.join(tempRoot, 'config-a');
  const dirB = path.join(tempRoot, 'config-b');
  await fs.mkdir(dirA);
  await fs.mkdir(dirB);
  const backupDir = path.join(appDataDir, 'backups');
  await fs.mkdir(backupDir);
  const legacyBackupPath = path.join(backupDir, '250723_services.yaml');
  await fs.writeFile(legacyBackupPath, 'legacy: content\n', 'utf8');
  const yamlContent = '- Test:\n    - Service:\n        href: http://localhost/';
  await fs.writeFile(path.join(dirA, 'services.yaml'), yamlContent, 'utf8');
  await fs.writeFile(path.join(dirB, 'services.yaml'), yamlContent, 'utf8');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: createServerEnv({
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot,
      APP_DATA_DIR: appDataDir
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);

    // Get the initial revisions for each subdirectory
    const loadA = await (await fetch(`${baseUrl}/api/directory/load`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: dirA })
    })).json();
    const loadB = await (await fetch(`${baseUrl}/api/directory/load`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: dirB })
    })).json();
    const revisionA = loadA.revisions['services.yaml'];
    const revisionB = loadB.revisions['services.yaml'];

    // Save from dirA
    const saveAResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: dirA,
        filename: 'services.yaml',
        content: '- Test:\n    - Service:\n        href: http://a.example',
        expectedRevision: revisionA
      })
    });
    assert.equal(saveAResponse.status, 200);

    // Save from dirB
    const saveBResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dirPath: dirB,
        filename: 'services.yaml',
        content: '- Test:\n    - Service:\n        href: http://b.example',
        expectedRevision: revisionB
      })
    });
    assert.equal(saveBResponse.status, 200);

    // The backup directory should have at least 2 backup files for services.yaml
    const entries = await fs.readdir(backupDir);
    const matching = entries.filter((e) => e.split('_').length === 4 && e.endsWith('_services.yaml'));
    // Each save from a different source dir produces a separate backup
    // because the dirHash in the filename differs
    assert.ok(matching.length >= 2, `Expected at least 2 backup files for services.yaml, got ${matching.length}`);
    // The dirHash portion (second underscore-delimited field) must differ
    const hashes = matching.map((e) => e.split('_')[1]);
    assert.notEqual(hashes[0], hashes[1], 'Backup dirHash from different directories must differ');

    // Set a low backupCount and verify cross-directory retention pruning
    const retentionResponse = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { backupCount: 1 } })
    });
    assert.equal(retentionResponse.status, 200);

    // Save from dirA multiple times — only 1 backup for dirA's hash should remain
    for (let i = 0; i < 3; i++) {
      const loadA2 = await (await fetch(`${baseUrl}/api/directory/load`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dirPath: dirA })
      })).json();
      const revA = loadA2.revisions['services.yaml'];
      const saveA2 = await fetch(`${baseUrl}/api/directory/file/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dirPath: dirA,
          filename: 'services.yaml',
          content: `- Test:\n    - Service:\n        href: http://a${i}.example`,
          expectedRevision: revA
        })
      });
      assert.equal(saveA2.status, 200);
    }

    // Save from dirB multiple times — only 1 backup for dirB's hash should remain
    for (let i = 0; i < 3; i++) {
      const loadB2 = await (await fetch(`${baseUrl}/api/directory/load`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dirPath: dirB })
      })).json();
      const revB = loadB2.revisions['services.yaml'];
      const saveB2 = await fetch(`${baseUrl}/api/directory/file/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dirPath: dirB,
          filename: 'services.yaml',
          content: `- Test:\n    - Service:\n        href: http://b${i}.example`,
          expectedRevision: revB
        })
      });
      assert.equal(saveB2.status, 200);
    }

    // Verify per-directory retention: each dirHash should have at most 1 backup
    const entriesAfter = await fs.readdir(backupDir);
    const matchingA = entriesAfter.filter((e) => e.endsWith('_services.yaml') && e.includes(`_${hashes[0]}_`));
    const matchingB = entriesAfter.filter((e) => e.endsWith('_services.yaml') && e.includes(`_${hashes[1]}_`));
    assert.ok(matchingA.length <= 1, `Expected at most 1 backup for dirA, got ${matchingA.length}`);
    assert.ok(matchingB.length <= 1, `Expected at most 1 backup for dirB, got ${matchingB.length}`);
    assert.ok(entriesAfter.includes('250723_services.yaml'), 'Legacy backups must not be pruned as another directory\'s backups');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});
