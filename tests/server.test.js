const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const YAML = require('yaml');

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
  assert.match(dockerfile, /^COPY yaml-transform\.js \.\/$/m);
  assert.match(dockerfile, /^COPY option-types\.default\.json \.\/$/m);
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
      autoIndent: true,
      previewAutoRefresh: true,
      editorVisible: true,
      interactiveEditor: false,
      visibleTabs: ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes'],
      tabOrder: ['services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox', 'kubernetes']
    });
    const settingsSaveResponse = await fetch(`${baseUrl}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          theme: 'dark', autoIndent: false, previewAutoRefresh: false, editorVisible: false, interactiveEditor: true,
          visibleTabs: ['kubernetes', 'services'], tabOrder: ['kubernetes', 'services'], ignored: 'value'
        }
      })
    });
    assert.equal(settingsSaveResponse.status, 200);
    assert.deepEqual((await settingsSaveResponse.json()).settings, {
      theme: 'dark',
      autoIndent: false,
      previewAutoRefresh: false,
      editorVisible: false,
      interactiveEditor: true,
      visibleTabs: ['kubernetes', 'services'],
      tabOrder: ['kubernetes', 'services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox']
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(appDataDir, 'settings.json'), 'utf8')), {
      theme: 'dark',
      autoIndent: false,
      previewAutoRefresh: false,
      editorVisible: false,
      interactiveEditor: true,
      visibleTabs: ['kubernetes', 'services'],
      tabOrder: ['kubernetes', 'services', 'settings', 'bookmarks', 'widgets', 'docker', 'proxmox']
    });

    const optionTypesResponse = await fetch(`${baseUrl}/api/option-types`);
    const optionTypes = await optionTypesResponse.json();
    assert.equal(optionTypesResponse.status, 200);
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'description'), {
      name: 'description', type: 'text'
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'localOnly'), {
      name: 'localOnly', type: 'boolean'
    });
    assert.deepEqual(optionTypes.options.find((option) => option.name === 'target'), {
      name: 'target', type: 'select', values: ['_blank', '_self', '_top']
    });
    const optionTypesSaveResponse = await fetch(`${baseUrl}/api/option-types`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ options: [{ name: 'customFlag', type: 'boolean' }, { name: 'customText', type: 'text' }] })
    });
    assert.equal(optionTypesSaveResponse.status, 200);
    assert.deepEqual((await optionTypesSaveResponse.json()).options, [
      { name: 'customFlag', type: 'boolean' },
      { name: 'customText', type: 'text' }
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(appDataDir, 'option-types.json'), 'utf8')), [
      { name: 'customFlag', type: 'boolean' },
      { name: 'customText', type: 'text' }
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
      body: JSON.stringify({ dirPath: tempRoot, filename: 'services.yaml', content: yamlContent })
    });
    assert.equal((await unchangedResponse.json()).changed, false);

    const proxmoxContent = 'pve:\n  url: https://proxmox.example:8006\n';
    const proxmoxSaveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'proxmox.yaml', content: proxmoxContent })
    });
    assert.equal(proxmoxSaveResponse.status, 200);
    assert.equal(await fs.readFile(path.join(tempRoot, 'proxmox.yaml'), 'utf8'), proxmoxContent);

    const updatedYamlContent = `${yamlContent}\n        description: Updated after startup`;
    const updatedSaveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'services.yaml', content: updatedYamlContent })
    });
    assert.equal(updatedSaveResponse.status, 200);
    assert.equal((await updatedSaveResponse.json()).changed, true);

    const startupAfterDirectorySave = await (await fetch(`${baseUrl}/api/startup-directory`)).json();
    assert.equal(startupAfterDirectorySave.files['services.yaml'], updatedYamlContent);

    const documentResponse = await fetch(`${baseUrl}/`);
    assert.equal(documentResponse.headers.get('cache-control'), 'no-cache');
    assert.match(documentResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(documentResponse.headers.get('x-frame-options'), 'DENY');
    assert.equal(documentResponse.headers.get('x-content-type-options'), 'nosniff');

    const runtimeConfigResponse = await fetch(`${baseUrl}/runtime-config.js`);
    assert.equal(runtimeConfigResponse.status, 200);
    assert.equal(runtimeConfigResponse.headers.get('cache-control'), 'no-store');
    assert.match(await runtimeConfigResponse.text(), /"defaultTheme":"light"/);

    const assetResponse = await fetch(`${baseUrl}/app.js?v=8`, {
      headers: { 'accept-encoding': 'gzip' }
    });
    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get('cache-control'), /max-age=86400/);
    assert.equal(assetResponse.headers.get('content-encoding'), 'gzip');

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
      error: 'Failed to load configs from directory',
      details: 'Directory is not allowed'
    });

    const linkedConfigPath = path.join(tempRoot, 'services.yaml');
    await fs.symlink(path.join(outsideRoot, 'services.yaml'), linkedConfigPath, 'file');
    const saveResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'services.yaml', content: '- Safe: []\n' })
    });
    assert.equal(saveResponse.status, 400);
    assert.deepEqual(await saveResponse.json(), {
      error: 'Failed to save file',
      details: 'Configuration file must be a regular file'
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
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
  }
});
