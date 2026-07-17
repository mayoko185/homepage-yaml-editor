const express = require('express');
const compression = require('compression');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');
const { formatYamlParseError, transformPreviewYaml } = require('./yaml-transform');
const defaultOptionDefinitions = require('./option-types.default.json');

const app = express();
const PORT = process.env.PORT || 8081;
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXAMPLES_DIR = path.join(__dirname, 'examples');
const APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, 'data');
const APP_SETTINGS_PATH = path.join(APP_DATA_DIR, 'settings.json');
const OPTION_TYPES_PATH = path.join(APP_DATA_DIR, 'option-types.json');
const DEFAULT_DATA_DIR = '/hp_config';
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const AUTOLOAD_DIR = process.env.AUTOLOAD_DIR;
const DEFAULT_THEME = String(process.env.DEFAULT_THEME || 'dark').trim().toLowerCase() === 'light'
  ? 'light'
  : 'dark';
const LOGIN_USER = process.env.REQUIRE_LOGIN_USER || '';
const LOGIN_PASSWORD = process.env.REQUIRE_LOGIN_PASSWORD || '';
const LOGIN_ENABLED = Boolean(LOGIN_USER && LOGIN_PASSWORD);
const LOGIN_PARTIALLY_CONFIGURED = Boolean(LOGIN_USER || LOGIN_PASSWORD) && !LOGIN_ENABLED;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const SESSION_COOKIE_NAME = 'homepage_editor_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
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
const EXTRA_ALLOWED_CONFIG_DIRS = (process.env.ALLOWED_CONFIG_DIRS || '')
  .split(',')
  .map((dirPath) => dirPath.trim())
  .filter(Boolean);
const ALLOWED_CONFIG_DIRECTORIES = Object.freeze(
  Array.from(new Set([
    DEFAULT_DATA_DIR,
    DATA_DIR,
    AUTOLOAD_DIR,
    ...EXTRA_ALLOWED_CONFIG_DIRS
  ].filter(Boolean))).map((dirPath) => path.resolve(dirPath))
);

app.set('trust proxy', TRUST_PROXY);
app.locals.startupDirectory = null;
app.locals.startupFiles = {};

function getDefaultAppSettings() {
  return {
    theme: DEFAULT_THEME,
    autoIndent: true,
    previewAutoRefresh: true,
    editorVisible: true,
    interactiveEditor: false,
    visibleTabs: [...DEFAULT_CONFIG_TAB_ORDER],
    tabOrder: [...DEFAULT_CONFIG_TAB_ORDER]
  };
}

function normalizeTabOrder(value) {
  const requestedOrder = Array.isArray(value) ? value : [];
  const uniqueKnownTabs = requestedOrder.filter((tabName, index) => (
    typeof tabName === 'string'
      && DEFAULT_CONFIG_TAB_ORDER.includes(tabName)
      && requestedOrder.indexOf(tabName) === index
  ));
  return [...uniqueKnownTabs, ...DEFAULT_CONFIG_TAB_ORDER.filter((tabName) => !uniqueKnownTabs.includes(tabName))];
}

function normalizeVisibleTabs(value, tabOrder) {
  const requestedTabs = Array.isArray(value) ? value : [];
  const visibleTabs = tabOrder.filter((tabName) => requestedTabs.includes(tabName));
  return visibleTabs.length > 0 ? visibleTabs : [...tabOrder];
}

function getDefaultOptionDefinitions() {
  return defaultOptionDefinitions.map((definition) => ({
    ...definition,
    ...(definition.values ? { values: [...definition.values] } : {})
  }));
}

function createOptionTypeError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeOptionDefinitions(value) {
  if (!Array.isArray(value)) throw createOptionTypeError('Preview option types must be provided as a JSON list');
  const names = new Set();
  return value.map((definition) => {
    const name = String(definition && definition.name || '').trim();
    const type = String(definition && definition.type || '').trim();
    if (!name || /[\r\n]/.test(name)) throw createOptionTypeError('Each Preview option type needs a single-line name');
    if (names.has(name)) throw createOptionTypeError(`Preview option type "${name}" is listed more than once. Remove the duplicate definition`);
    names.add(name);
    if (!OPTION_VALUE_TYPES.has(type)) throw createOptionTypeError(`Preview option type "${name}" has unsupported value type "${type}". Choose text, textarea, boolean, tab, mapping, or select`);
    const normalized = { name, type };
    if (type === 'select') {
      const values = Array.isArray(definition.values) ? definition.values : [];
      normalized.values = Array.from(new Set(values.map((item) => String(item).trim()).filter(Boolean)));
      if (normalized.values.length === 0) throw createOptionTypeError(`Select option "${name}" needs at least one choice. Add a comma-separated choice`);
    }
    if (type === 'textarea' && Number.isFinite(Number(definition.rows))) {
      normalized.rows = Math.max(2, Math.min(12, Math.round(Number(definition.rows))));
    }
    return normalized;
  });
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function loadOptionDefinitions() {
  try {
    return normalizeOptionDefinitions(JSON.parse(await fs.readFile(OPTION_TYPES_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read option type definitions:', error.message);
    return getDefaultOptionDefinitions();
  }
}

async function saveOptionDefinitions(definitions) {
  const normalized = normalizeOptionDefinitions(definitions);
  await writeJsonAtomically(OPTION_TYPES_PATH, normalized);
  return normalized;
}

async function ensureOptionDefinitions() {
  try {
    const localDefinitions = normalizeOptionDefinitions(JSON.parse(await fs.readFile(OPTION_TYPES_PATH, 'utf8')));
    const localNames = new Set(localDefinitions.map((definition) => definition.name));
    const missingDefaults = getDefaultOptionDefinitions().filter((definition) => !localNames.has(definition.name));
    if (missingDefaults.length > 0) {
      await writeJsonAtomically(OPTION_TYPES_PATH, [...localDefinitions, ...missingDefaults]);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveOptionDefinitions(getDefaultOptionDefinitions());
      return;
    }
    console.warn('Could not merge default option type definitions; keeping the existing file unchanged:', error.message);
  }
}

function normalizeAppSettings(value) {
  const defaults = getDefaultAppSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }
  const tabOrder = normalizeTabOrder(value.tabOrder);
  return {
    theme: value.theme === 'light' ? 'light' : value.theme === 'dark' ? 'dark' : defaults.theme,
    autoIndent: typeof value.autoIndent === 'boolean' ? value.autoIndent : defaults.autoIndent,
    previewAutoRefresh: typeof value.previewAutoRefresh === 'boolean'
      ? value.previewAutoRefresh : defaults.previewAutoRefresh,
    editorVisible: typeof value.editorVisible === 'boolean' ? value.editorVisible : defaults.editorVisible,
    interactiveEditor: typeof value.interactiveEditor === 'boolean'
      ? value.interactiveEditor : defaults.interactiveEditor,
    visibleTabs: normalizeVisibleTabs(value.visibleTabs, tabOrder),
    tabOrder
  };
}

async function loadAppSettings() {
  try {
    return normalizeAppSettings(JSON.parse(await fs.readFile(APP_SETTINGS_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Could not read persistent app settings:', error.message);
    }
    return getDefaultAppSettings();
  }
}

async function saveAppSettings(settings) {
  const normalized = normalizeAppSettings(settings);
  await writeJsonAtomically(APP_SETTINGS_PATH, normalized);
  return normalized;
}

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
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

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, cookiePart) => {
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex === -1) {
      return cookies;
    }
    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (name) {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function getAuthenticatedSessionToken(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function credentialsMatch(actual, expected) {
  const actualDigest = crypto.createHash('sha256').update(String(actual || '')).digest();
  const expectedDigest = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function getLoginAttemptState(req) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || now - existing.startedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
    const state = { key, count: 0, startedAt: now };
    loginAttempts.set(key, state);
    return state;
  }
  return { key, ...existing };
}

function isSecureRequest(req) {
  return req.secure;
}

function setSessionCookie(req, res, token) {
  const secureAttribute = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureAttribute}`
  );
}

function clearSessionCookie(req, res) {
  const secureAttribute = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`
  );
}

app.get('/login', (req, res) => {
  if (!LOGIN_ENABLED || getAuthenticatedSessionToken(req)) {
    return res.redirect(302, '/');
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/login', (req, res) => {
  if (!LOGIN_ENABLED) {
    return res.redirect(303, '/');
  }

  const attempt = getLoginAttemptState(req);
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    return res.redirect(303, '/login?error=locked');
  }

  const validUser = credentialsMatch(req.body.username, LOGIN_USER);
  const validPassword = credentialsMatch(req.body.password, LOGIN_PASSWORD);
  if (!validUser || !validPassword) {
    loginAttempts.set(attempt.key, {
      count: attempt.count + 1,
      startedAt: attempt.startedAt
    });
    return res.redirect(303, '/login?error=invalid');
  }

  loginAttempts.delete(attempt.key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  setSessionCookie(req, res, token);
  return res.redirect(303, '/');
});

app.post('/logout', (req, res) => {
  const token = getAuthenticatedSessionToken(req);
  if (token) {
    sessions.delete(token);
  }
  clearSessionCookie(req, res);
  return res.redirect(303, LOGIN_ENABLED ? '/login' : '/');
});

app.use((req, res, next) => {
  if (!LOGIN_ENABLED || getAuthenticatedSessionToken(req)) {
    return next();
  }

  if (req.method === 'GET' && (req.path === '/styles.css' || req.path === '/favicon.ico')) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(302, '/login');
  }
  return res.status(401).send('Authentication required');
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(?:css|js|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }
}));

function isValidConfigFile(filename) {
  return typeof filename === 'string' && ALLOWED_CONFIG_FILES.has(filename.toLowerCase());
}

function resolveConfigFilePath(dirPath, filename) {
  if (!isValidConfigFile(filename)) {
    const supportedFiles = CONFIG_BASE_NAMES.flatMap((baseName) => CONFIG_EXTENSIONS.map((extension) => `${baseName}${extension}`));
    const error = new Error(`Unsupported configuration filename. Choose one of: ${supportedFiles.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const resolvedDir = path.resolve(dirPath);
  const resolvedFile = path.resolve(resolvedDir, filename);
  if (path.dirname(resolvedFile) !== resolvedDir) {
    const error = new Error('Invalid filename. Path traversal is not allowed');
    error.statusCode = 400;
    throw error;
  }
  return resolvedFile;
}

function isSameOrChildPath(candidatePath, parentPath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

function resolveAllowedConfigDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    const error = new Error('Directory path is required. Choose the server directory containing your Homepage YAML files');
    error.statusCode = 400;
    throw error;
  }

  const resolvedDir = path.resolve(dirPath);
  if (!ALLOWED_CONFIG_DIRECTORIES.some((allowedDir) => isSameOrChildPath(resolvedDir, allowedDir))) {
    const error = new Error('Directory is not allowed. Choose a directory inside one of the configured allowed locations');
    error.statusCode = 400;
    throw error;
  }
  return resolvedDir;
}

async function resolveRealAllowedConfigDirectory(dirPath) {
  const resolvedDir = resolveAllowedConfigDirectory(dirPath);
  let realDir;
  try {
    realDir = await fs.realpath(resolvedDir);
  } catch {
    const error = new Error('Directory does not exist or cannot be accessed. Check the path and permissions');
    error.statusCode = 400;
    throw error;
  }

  const realAllowedDirectories = (await Promise.all(ALLOWED_CONFIG_DIRECTORIES.map(async (allowedDir) => {
    try {
      return await fs.realpath(allowedDir);
    } catch {
      return null;
    }
  }))).filter(Boolean);
  if (!realAllowedDirectories.some((allowedDir) => isSameOrChildPath(realDir, allowedDir))) {
    const error = new Error('Directory is not allowed. Choose a directory inside one of the configured allowed locations');
    error.statusCode = 400;
    throw error;
  }
  return realDir;
}

async function assertDirectory(dirPath) {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      const error = new Error('The selected path is not a directory. Choose the folder containing your Homepage YAML files');
      error.statusCode = 400;
      throw error;
    }
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    const wrappedError = new Error('Directory does not exist or cannot be accessed. Check the path and permissions');
    wrappedError.statusCode = 400;
    throw wrappedError;
  }
}

async function loadDirectoryContents(dirPath) {
  const directoryEntries = await fs.readdir(dirPath, { withFileTypes: true });
  const availableFiles = new Map(
    directoryEntries
      .filter((entry) => entry.isFile() && isValidConfigFile(entry.name))
      .map((entry) => [entry.name.toLowerCase(), entry.name])
  );
  const selectedFiles = CONFIG_BASE_NAMES
    .map((baseName) => CONFIG_EXTENSIONS
      .map((extension) => availableFiles.get(`${baseName}${extension}`))
      .find(Boolean))
    .filter(Boolean);
  const loadedFiles = await Promise.all(selectedFiles.map(async (filename) => [
    filename,
    await fs.readFile(path.join(dirPath, filename), 'utf8')
  ]));

  return {
    fileContents: Object.fromEntries(loadedFiles),
    loadedCount: loadedFiles.length,
    totalCount: CONFIG_BASE_NAMES.length
  };
}

async function assertRegularConfigFile(filePath, { allowMissing = false } = {}) {
  try {
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      const error = new Error('Configuration file must be a regular file. Symlinks and special files are not supported');
      error.statusCode = 400;
      throw error;
    }
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return;
    if (error.statusCode) throw error;
    const wrappedError = new Error('Configuration file does not exist or cannot be accessed. Check the path and permissions');
    wrappedError.statusCode = 400;
    throw wrappedError;
  }
}

async function saveConfigFile(dirPath, filename, content, { skipUnchanged = false } = {}) {
  const filePath = resolveConfigFilePath(dirPath, filename);
  const yamlContent = typeof content === 'string' ? content : YAML.stringify(content);
  YAML.parse(yamlContent);

  await assertRegularConfigFile(filePath, { allowMissing: true });

  if (skipUnchanged) {
    try {
      const existingContent = await fs.readFile(filePath, 'utf8');
      if (existingContent.replace(/\r\n/g, '\n') === yamlContent.replace(/\r\n/g, '\n')) {
        return { filePath, changed: false };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  // Check again immediately before the write so an existing file cannot be
  // replaced with a symlink between validation and persistence.
  await assertRegularConfigFile(filePath, { allowMissing: true });
  await fs.writeFile(filePath, yamlContent, 'utf8');
  return { filePath, changed: true };
}

async function applyStartupDirectoryLoad() {
  const startupDir = AUTOLOAD_DIR || DEFAULT_DATA_DIR;
  try {
    const resolvedStartupDir = await resolveRealAllowedConfigDirectory(startupDir);
    await assertDirectory(resolvedStartupDir);
    const { fileContents, loadedCount } = await loadDirectoryContents(resolvedStartupDir);
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

async function loadExampleConfigs() {
  const entries = await Promise.all(CONFIG_BASE_NAMES.map(async (baseName) => {
    const content = await fs.readFile(path.join(EXAMPLES_DIR, `${baseName}.yaml`), 'utf8');
    return [baseName, content];
  }));
  return Object.fromEntries(entries);
}

app.get('/api/examples', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.json({ samples: await loadExampleConfigs() });
  } catch (error) {
    console.error('Example configuration load failed:', error);
    return res.status(500).json({
      error: 'Could not load example configurations',
      details: error.message
    });
  }
});

app.get('/api/app-settings', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ settings: await loadAppSettings() });
});

app.put('/api/app-settings', async (req, res) => {
  try {
    return res.json({ settings: await saveAppSettings(req.body && req.body.settings) });
  } catch (error) {
    console.error('Could not save persistent app settings:', error);
    return res.status(500).json({ error: 'Could not save editor settings', details: error.message });
  }
});

app.get('/api/option-types', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ options: await loadOptionDefinitions() });
});

app.put('/api/option-types', async (req, res) => {
  try {
    return res.json({ options: await saveOptionDefinitions(req.body && req.body.options) });
  } catch (error) {
    console.error('Could not save option type definitions:', error);
    return res.status(error.statusCode || 500).json({ error: 'Could not save Preview option types', details: error.message });
  }
});

app.get('/api/startup-directory', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const startupDirectory = app.locals.startupDirectory;
  if (!startupDirectory) {
    return res.json({
      directory: null,
      files: {},
      hasStartupDirectory: false
    });
  }

  try {
    const { fileContents, loadedCount } = await loadDirectoryContents(startupDirectory);
    if (loadedCount === 0) {
      app.locals.startupDirectory = null;
      app.locals.startupFiles = {};
      return res.json({
        directory: null,
        files: {},
        hasStartupDirectory: false
      });
    }
    app.locals.startupFiles = fileContents;
    return res.json({
      directory: startupDirectory,
      files: fileContents,
      hasStartupDirectory: true
    });
  } catch (error) {
    console.error('Startup directory refresh failed:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Could not refresh the startup directory',
      details: error.message
    });
  }
});

app.post('/api/yaml/transform', (req, res) => {
  try {
    return res.json(transformPreviewYaml(req.body));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? 'Could not apply Preview edit' : 'Preview edit failed unexpectedly',
      details: error.message
    });
  }
});

app.post('/api/directory/load', async (req, res) => {
  try {
    const configDir = await resolveRealAllowedConfigDirectory(req.body.dirPath);
    await assertDirectory(configDir);
    const { fileContents, loadedCount, totalCount } = await loadDirectoryContents(configDir);
    return res.json({
      directory: configDir,
      files: fileContents,
      message: `Successfully loaded ${loadedCount} of ${totalCount} configuration files`
    });
  } catch (error) {
    console.error('Directory load error:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Could not load configuration directory',
      details: error.statusCode ? error.message : 'The requested directory could not be loaded'
    });
  }
});

app.post('/api/directory/file/save', async (req, res) => {
  try {
    const { dirPath, filename, content } = req.body;
    if (!dirPath || !filename || content === undefined) {
      return res.status(400).json({
        error: 'Directory path, filename, and file content are required to save a configuration'
      });
    }

    const configDir = await resolveRealAllowedConfigDirectory(dirPath);
    await assertDirectory(configDir);
    const result = await saveConfigFile(configDir, filename, content, { skipUnchanged: true });
    return res.json({
      message: result.changed ? 'File saved successfully' : 'No changes detected',
      details: result.changed ? `Saved to ${result.filePath}` : `Skipped writing ${result.filePath}`,
      changed: result.changed
    });
  } catch (error) {
    console.error('Directory file save error:', error);
    const isYamlError = error && (error.name === 'YAMLParseError' || error.code === 'BAD_INDENT');
    return res.status(error.statusCode || (isYamlError ? 400 : 500)).json({
      error: isYamlError ? 'Invalid YAML in configuration file' : 'Could not save configuration file',
      details: isYamlError ? formatYamlParseError(error) : (error.statusCode ? error.message : 'The configuration file could not be saved')
    });
  }
});

async function startServer() {
  if (LOGIN_PARTIALLY_CONFIGURED) {
    throw new Error('REQUIRE_LOGIN_USER and REQUIRE_LOGIN_PASSWORD must both be set together to enable login');
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(APP_DATA_DIR, { recursive: true });
  await ensureOptionDefinitions();
  await applyStartupDirectoryLoad();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});
