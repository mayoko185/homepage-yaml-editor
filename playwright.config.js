const os = require('node:os');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const port = 4173;
const testConfigDir = path.join(os.tmpdir(), `homepage-editor-browser-${port}`);
process.env.HOMEPAGE_BROWSER_TEST_DIR = testConfigDir;

module.exports = defineConfig({
  testDir: './tests/browser',
  globalSetup: require.resolve('./tests/browser/global-setup'),
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    trace: 'retain-on-failure'
  }
});
