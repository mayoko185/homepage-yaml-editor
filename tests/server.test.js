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

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/startup-directory`);
      if (response.ok) {
        return response.json();
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
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempRoot,
      AUTOLOAD_DIR: tempRoot
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const startup = await waitForServer(baseUrl, child);
    assert.equal(startup.hasStartupDirectory, true);
    assert.equal(startup.directory, tempRoot);

    const yamlContent = '- Test:\n    - Service:\n        href: http://localhost/';
    const saveResponse = await fetch(`${baseUrl}/api/config/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'services.yaml', content: yamlContent })
    });
    assert.equal(saveResponse.status, 200);

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

    const assetResponse = await fetch(`${baseUrl}/app.js?v=1`, {
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
