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
  for (const key of ['autoIndent', 'previewAutoRefresh', 'editorVisible', 'interactiveEditor']) {
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
      visibleTabs: ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'],
      tabOrder: ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes']
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
      visibleTabs: ['kubernetes', 'services'],
      tabOrder: ['kubernetes', 'services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox']
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(appDataDir, 'settings.json'), 'utf8')), {
      theme: 'dark',
      customPageTitle: 'My YAML Dashboard',
      liveHomepageUrl: 'https://homepage.example.com/',
      autoIndent: false,
      previewAutoRefresh: false,
      editorVisible: false,
      interactiveEditor: true,
      visibleTabs: ['kubernetes', 'services'],
      tabOrder: ['kubernetes', 'services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox']
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
