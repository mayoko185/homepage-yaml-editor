const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

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
    for (const baseName of ['bookmarks', 'services', 'settings', 'widgets']) {
      const expectedExample = await fs.readFile(path.join('examples', `${baseName}.yaml`), 'utf8');
      assert.equal(examples.samples[baseName], expectedExample);
    }

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

    const unchangedResponse = await fetch(`${baseUrl}/api/directory/file/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dirPath: tempRoot, filename: 'services.yaml', content: yamlContent })
    });
    assert.equal((await unchangedResponse.json()).changed, false);

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
      AUTOLOAD_DIR: tempRoot
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
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'Refusing cleanup outside the system temp directory');
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
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
      REQUIRE_LOGIN_USER: 'test-user',
      REQUIRE_LOGIN_PASSWORD: 'test-password'
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
