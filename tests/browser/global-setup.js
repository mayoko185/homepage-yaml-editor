const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

module.exports = async function globalSetup() {
  const configDir = path.resolve(process.env.HOMEPAGE_BROWSER_TEST_DIR || '');
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!configDir.startsWith(tempRoot)) throw new Error('Browser test directory must be inside the system temporary directory');

  const fixtures = {
    'services.yaml': '- Main:\n    - Alpha:\n        href: https://example.test\n        description: First service\n',
    'settings.yaml': 'title: Browser Test\nlayout:\n  Main:\n    style: row\n    columns: 2\n',
    'bookmarks.yaml': '[]\n',
    'widgets.yaml': '[]\n',
    'docker.yaml': '{}\n',
    'proxmox.yaml': '{}\n',
    'kubernetes.yaml': '{}\n'
  };

  await fs.rm(configDir, { recursive: true, force: true });
  await fs.mkdir(path.join(configDir, 'app-data'), { recursive: true });
  await Promise.all(Object.entries(fixtures).map(([filename, content]) => (
    fs.writeFile(path.join(configDir, filename), content, 'utf8')
  )));

  process.env.PORT = '4173';
  process.env.DATA_DIR = configDir;
  process.env.AUTOLOAD_DIR = configDir;
  process.env.APP_DATA_DIR = path.join(configDir, 'app-data');
  process.env.REQUIRE_LOGIN_USER = '';
  process.env.REQUIRE_LOGIN_PASSWORD = '';
  const { startServer } = require('../../server');
  const server = await startServer();

  return async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(configDir, { recursive: true, force: true });
  };
};
