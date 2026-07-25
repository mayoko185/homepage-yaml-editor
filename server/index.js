const express = require('express');
const compression = require('compression');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');
const { formatYamlParseError, transformPreviewYaml } = require('./yaml');
const { pruneExpiredAuthState, setBoundedMapEntry } = require('./auth/state');
const defaultOptionDefinitions = require('../defaults/option-types.default.json');
const defaultAppSettingsTemplate = require('../defaults/app-settings.default.json');
const configFiles = require('./lib/config-files');
const optionTypes = require('./lib/option-types');
const appSettings = require('./lib/app-settings');
const { mountRoutes } = require('./routes');

const app = express();
const PORT = process.env.PORT || 8081;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');
const APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const APP_SETTINGS_PATH = path.join(APP_DATA_DIR, 'settings.json');
const OPTION_TYPES_PATH = path.join(APP_DATA_DIR, 'option-types.json');
const HOMEPAGE_CONFIGS = process.env.HOMEPAGE_CONFIGS;
const ENV_DEFAULT_THEME = process.env.DEFAULT_THEME ? String(process.env.DEFAULT_THEME).trim().toLowerCase() : '';
const DEFAULT_THEME = ENV_DEFAULT_THEME
  ? (ENV_DEFAULT_THEME === 'light' ? 'light' : 'dark')
  : (defaultAppSettingsTemplate.theme === 'light' ? 'light' : 'dark');
const LOGIN_USER = process.env.REQUIRE_LOGIN_USER || '';
const LOGIN_PASSWORD = process.env.REQUIRE_LOGIN_PASSWORD || '';
const LOGIN_ENABLED = Boolean(LOGIN_USER && LOGIN_PASSWORD);
const LOGIN_PARTIALLY_CONFIGURED = Boolean(LOGIN_USER || LOGIN_PASSWORD) && !LOGIN_ENABLED;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const SESSION_COOKIE_NAME = 'homepage_editor_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_AUTH_STATE_ENTRIES = 10_000;
const AUTH_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const CONFIG_BASE_NAMES = Object.freeze([
  'services',
  'settings',
  'bookmarks',
  'widgets',
  'docker',
  'proxmox',
  'kubernetes'
]);
const CONFIG_EXTENSIONS = Object.freeze(['.yaml', '.yml']);
const DEFAULT_CONFIG_TAB_ORDER = Object.freeze([...CONFIG_BASE_NAMES]);
const ALLOWED_CONFIG_FILES = new Set(
  CONFIG_BASE_NAMES.flatMap((baseName) => CONFIG_EXTENSIONS.map((extension) => `${baseName}${extension}`))
);
const OPTION_VALUE_TYPES = new Set(['text', 'textarea', 'boolean', 'tab', 'mapping', 'select']);
const OPTION_TARGETS = Object.freeze(['service', 'group', 'bookmark', 'widget']);
const OPTION_TARGET_SET = new Set(OPTION_TARGETS);
const ALLOWED_CONFIG_DIRECTORIES = Object.freeze(
  HOMEPAGE_CONFIGS ? [path.resolve(HOMEPAGE_CONFIGS)] : []
);

configFiles.init({
  CONFIG_BASE_NAMES,
  CONFIG_EXTENSIONS,
  ALLOWED_CONFIG_FILES,
  ALLOWED_CONFIG_DIRECTORIES
});

appSettings.init({
  DEFAULT_CONFIG_TAB_ORDER,
  defaultAppSettingsTemplate,
  DEFAULT_THEME
});

app.set('trust proxy', TRUST_PROXY);
app.locals.startupDirectory = null;
app.locals.startupFiles = {};

function pruneAuthenticationState() {
  pruneExpiredAuthState({ sessions, loginAttempts, loginAttemptWindowMs: LOGIN_ATTEMPT_WINDOW_MS });
}

const authCleanupTimer = setInterval(pruneAuthenticationState, AUTH_CLEANUP_INTERVAL_MS);
authCleanupTimer.unref();

// getDefaultAppSettings, normalizeLiveHomepageUrl, normalizeTabOrder, normalizeVisibleTabs
// moved to server/lib/app-settings.js

// getDefaultOptionDefinitions, createOptionTypeError, normalizeOptionDefinitions
// moved to server/lib/option-types.js

// writeJsonAtomically moved to server/lib/config-files.js

// loadOptionDefinitions, saveOptionDefinitions, ensureOptionDefinitions moved to server/lib/option-types.js

// normalizeAppSettings, loadAppSettings, saveAppSettings moved to server/lib/app-settings.js

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: 'Request body is not valid JSON',
      details: 'Check the request format and try again'
    });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request body is too large',
      details: 'Save the current YAML first, then download the configuration files instead'
    });
  }
  return next(error);
});
app.get('/runtime-config.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript').send(
    `window.APP_CONFIG = Object.freeze(${JSON.stringify({
      defaultTheme: DEFAULT_THEME,
      loginRequired: LOGIN_ENABLED
    })});`
  );
});

// Auth functions (parseCookies, getAuthenticatedSessionToken, credentialsMatch,
// getLoginAttemptState, isSecureRequest, setSessionCookie, clearSessionCookie)
// and auth routes (GET /login, POST /login, POST /logout) moved to server/routes/auth.js
// Auth middleware moved to server/routes/auth.js (authMiddleware)

// API route handlers moved to:
//   server/routes/config.js  — /api/examples, /api/transform, /api/directory/load, /api/directory/file/save
//   server/routes/settings.js — /api/app-settings, /api/option-types
//   server/routes/startup.js  — /api/startup-directory

// Mount all route modules
mountRoutes(app, {
  LOGIN_ENABLED,
  LOGIN_USER,
  LOGIN_PASSWORD,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  LOGIN_ATTEMPT_WINDOW_MS,
  MAX_LOGIN_ATTEMPTS,
  MAX_AUTH_STATE_ENTRIES,
  PUBLIC_DIR,
  sessions,
  loginAttempts,
  setBoundedMapEntry,
  configFiles,
  appSettings,
  optionTypes,
  transformPreviewYaml,
  formatYamlParseError,
  CONFIG_BASE_NAMES,
  EXAMPLES_DIR,
  APP_DATA_DIR,
  APP_SETTINGS_PATH,
  OPTION_TYPES_PATH,
  defaultOptionDefinitions
});

// Vendor assets (CodeMirror, js-yaml)
const VENDOR_ASSETS = Object.freeze({
  '/vendor/codemirror/codemirror.min.css': require.resolve('codemirror/lib/codemirror.css'),
  '/vendor/codemirror/codemirror.min.js': require.resolve('codemirror/lib/codemirror.js'),
  '/vendor/codemirror/yaml.min.js': require.resolve('codemirror/mode/yaml/yaml.js'),
  '/vendor/js-yaml/js-yaml.min.js': path.join(path.dirname(require.resolve('js-yaml')), 'dist', 'js-yaml.min.js')
});

Object.entries(VENDOR_ASSETS).forEach(([routePath, assetPath]) => {
  app.get(routePath, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    return res.sendFile(assetPath);
  });
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    const relativePath = path.relative(PUBLIC_DIR, filePath);
    const isPublicJsAsset = relativePath.startsWith(`js${path.sep}`);
    if (isPublicJsAsset) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(?:css|js|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }
}));

// isValidConfigFile, parseBackupFilename, resolveConfigFilePath, isSameOrChildPath,
// resolveAllowedConfigDirectory, resolveRealAllowedConfigDirectory, assertDirectory,
// loadDirectoryContents, assertRegularConfigFile, createContentRevision,
// createConfigConflictError, readConfigFileState, replaceConfigFileAtomically,
// createBackup, saveConfigFile moved to server/lib/config-files.js

async function applyStartupDirectoryLoad() {
  if (!HOMEPAGE_CONFIGS) {
    return;
  }
  const startupDir = HOMEPAGE_CONFIGS;
  try {
    const resolvedStartupDir = await configFiles.resolveRealAllowedConfigDirectory(startupDir);
    await configFiles.assertDirectory(resolvedStartupDir);
    const { fileContents, loadedCount } = await configFiles.loadDirectoryContents(resolvedStartupDir);
    if (loadedCount === 0) {
      app.locals.startupDirectory = null;
      app.locals.startupFiles = {};
      return;
    }
    app.locals.startupDirectory = resolvedStartupDir;
    app.locals.startupFiles = fileContents;
  } catch (error) {
    console.warn('Startup directory load failed:', error.message);
  }
}

// loadExampleConfigs moved to server/routes/config.js
// API route handlers moved to server/routes/config.js, server/routes/settings.js, server/routes/startup.js

async function startServer() {
  if (LOGIN_PARTIALLY_CONFIGURED) {
    throw new Error('REQUIRE_LOGIN_USER and REQUIRE_LOGIN_PASSWORD must both be set together to enable login');
  }
  if (HOMEPAGE_CONFIGS) {
    await fs.mkdir(HOMEPAGE_CONFIGS, { recursive: true });
  }
  await fs.mkdir(APP_DATA_DIR, { recursive: true });
  await optionTypes.ensureOptionDefinitions(OPTION_TYPES_PATH, app, defaultOptionDefinitions);
  await optionTypes.loadOptionDefinitions(OPTION_TYPES_PATH, app, defaultOptionDefinitions);
  await applyStartupDirectoryLoad();
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Server startup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
