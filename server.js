const express = require('express');
const compression = require('compression');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');
const { formatYamlParseError, transformPreviewYaml } = require('./yaml-transform');
const { pruneExpiredAuthState, setBoundedMapEntry } = require('./auth-state');
const defaultOptionDefinitions = require('./option-types.default.json');
const defaultAppSettingsTemplate = require('./app-settings.default.json');

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

function pruneAuthenticationState() {
  pruneExpiredAuthState({ sessions, loginAttempts, loginAttemptWindowMs: LOGIN_ATTEMPT_WINDOW_MS });
}

const authCleanupTimer = setInterval(pruneAuthenticationState, AUTH_CLEANUP_INTERVAL_MS);
authCleanupTimer.unref();

function getDefaultAppSettings() {
  const template = defaultAppSettingsTemplate;
  return {
    theme: DEFAULT_THEME,
    customPageTitle: template.customPageTitle,
    liveHomepageUrl: template.liveHomepageUrl,
    autoIndent: template.autoIndent,
    previewAutoRefresh: template.previewAutoRefresh,
    editorVisible: template.editorVisible,
    interactiveEditor: template.interactiveEditor,
    showComments: template.showComments === true,
    editBarOptions: template.editBarOptions && typeof template.editBarOptions === 'object'
      ? { comment: template.editBarOptions.comment !== false, duplicate: template.editBarOptions.duplicate !== false, moveUpDown: template.editBarOptions.moveUpDown !== false }
      : { comment: true, duplicate: true, moveUpDown: true },
    visibleTabs: Array.isArray(template.visibleTabs) ? [...template.visibleTabs] : [...DEFAULT_CONFIG_TAB_ORDER],
    tabOrder: Array.isArray(template.tabOrder) ? [...template.tabOrder] : [...DEFAULT_CONFIG_TAB_ORDER],
    autoBackup: template.autoBackup !== false,
    backupCount: Number.isFinite(template.backupCount) ? Math.max(1, Math.min(100, Math.round(template.backupCount))) : 10
  };
}

function normalizeLiveHomepageUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
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
  if (!Array.isArray(value)) throw createOptionTypeError('Option types must be provided as a JSON list');
  const names = new Set();
  return value.map((definition) => {
    const name = String(definition && definition.name || '').trim();
    const type = String(definition && definition.type || '').trim();
    const rawAppliesTo = definition && definition.appliesTo;
    const appliesTo = Array.isArray(rawAppliesTo)
      ? rawAppliesTo.map((target) => String(target).trim())
      : String(rawAppliesTo || 'both').trim() === 'both'
        ? ['service', 'group']
        : [String(rawAppliesTo || '').trim()];
    if (!name || /[\r\n]/.test(name)) throw createOptionTypeError('Each option type needs a single-line name');
    if (names.has(name)) throw createOptionTypeError(`Option type "${name}" is listed more than once. Remove the duplicate definition`);
    names.add(name);
    if (!OPTION_VALUE_TYPES.has(type)) throw createOptionTypeError(`Option type "${name}" has unsupported value type "${type}". Choose text, textarea, boolean, tab, mapping, or select`);
    if (appliesTo.length === 0 || appliesTo.some((target) => !OPTION_TARGET_SET.has(target))) {
      throw createOptionTypeError(`Option type "${name}" must apply to at least one supported target: service, group, bookmark, or widget`);
    }
    const normalizedAppliesTo = OPTION_TARGETS.filter((target) => appliesTo.includes(target));
    const normalized = { name, type, appliesTo: normalizedAppliesTo };
    if (definition && Object.prototype.hasOwnProperty.call(definition, 'defaultForAdd')) {
      const defaultForAdd = Array.isArray(definition.defaultForAdd)
        ? definition.defaultForAdd.map((target) => String(target).trim())
        : [];
      if (defaultForAdd.some((target) => !normalizedAppliesTo.includes(target))) {
        throw createOptionTypeError(`Option type "${name}" can only be added by default where it applies`);
      }
      normalized.defaultForAdd = OPTION_TARGETS.filter((target) => defaultForAdd.includes(target));
      const rawDefaultOrder = definition.defaultOrder && typeof definition.defaultOrder === 'object' && !Array.isArray(definition.defaultOrder)
        ? definition.defaultOrder : {};
      if (Object.keys(rawDefaultOrder).some((target) => !normalized.defaultForAdd.includes(target))) {
        throw createOptionTypeError(`Option type "${name}" can only have a default order where it is added by default`);
      }
      const defaultOrder = {};
      normalized.defaultForAdd.forEach((target) => {
        const order = Number(rawDefaultOrder[target]);
        if (Number.isFinite(order) && order >= 0) defaultOrder[target] = Math.round(order);
      });
      if (Object.keys(defaultOrder).length > 0) normalized.defaultOrder = defaultOrder;
    }
    if (type === 'select') {
      const values = Array.isArray(definition.values) ? definition.values : [];
      normalized.values = Array.from(new Set(values.map((item) => String(item).trim())));
      if (!normalized.values.some(Boolean)) throw createOptionTypeError(`Select option "${name}" needs at least one choice. Add a comma-separated choice`);
    }
    if (type === 'textarea' && Number.isFinite(Number(definition.rows))) {
      normalized.rows = Math.max(2, Math.min(12, Math.round(Number(definition.rows))));
    }
    return normalized;
  });
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(payload, 'utf8');
    await handle.close();
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function loadOptionDefinitions() {
  try {
    const definitions = normalizeOptionDefinitions(JSON.parse(await fs.readFile(OPTION_TYPES_PATH, 'utf8')));
    app.locals.optionDefinitions = definitions;
    return definitions;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read option type definitions:', error.message);
    const defaults = getDefaultOptionDefinitions();
    app.locals.optionDefinitions = defaults;
    return defaults;
  }
}

async function saveOptionDefinitions(definitions) {
  const normalized = normalizeOptionDefinitions(definitions);
  await writeJsonAtomically(OPTION_TYPES_PATH, normalized);
  app.locals.optionDefinitions = normalized;
  return normalized;
}

async function ensureOptionDefinitions() {
  try {
    const storedDefinitions = JSON.parse(await fs.readFile(OPTION_TYPES_PATH, 'utf8'));
    const normalizedStoredDefinitions = normalizeOptionDefinitions(storedDefinitions);
    const defaultDefinitions = getDefaultOptionDefinitions();
    const defaultByName = new Map(defaultDefinitions.map((definition) => [definition.name, definition]));
    const storedNames = new Set(normalizedStoredDefinitions.map((definition) => definition.name));
    const mergedLocalDefinitions = normalizedStoredDefinitions.map((definition, index) => {
      const defaults = defaultByName.get(definition.name);
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return definition;
      const merged = { ...definition };
      if (!defaults) return merged;
      const storedDefinition = storedDefinitions[index];
      Object.entries(defaults).forEach(([key, value]) => {
        if ((key === 'values' || key === 'rows') && merged.type !== defaults.type) return;
        if (!storedDefinition || !Object.prototype.hasOwnProperty.call(storedDefinition, key)) {
          merged[key] = Array.isArray(value) ? [...value] : value;
        }
      });
      const storedAppliesTo = storedDefinition && storedDefinition.appliesTo;
      const oldDefaultApplicability = {
        href: 'service',
        icon: 'both',
        target: 'service',
        fields: 'service',
        hideVersion: 'service',
        key: 'service',
        showLabel: 'service',
        showName: 'service',
        showStats: 'service',
        showStatus: 'service',
        showTime: 'service',
        type: 'service',
        url: 'service'
      }[definition.name];
      if (oldDefaultApplicability && storedAppliesTo === oldDefaultApplicability) {
        merged.appliesTo = [...defaults.appliesTo];
      }
      return merged;
    });
    const missingDefaults = defaultDefinitions.filter((definition) => !storedNames.has(definition.name));
    const mergedDefinitions = [...mergedLocalDefinitions, ...missingDefaults];
    normalizeOptionDefinitions(mergedDefinitions);
    if (JSON.stringify(mergedDefinitions) !== JSON.stringify(storedDefinitions)) {
      await writeJsonAtomically(OPTION_TYPES_PATH, mergedDefinitions);
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
    customPageTitle: typeof value.customPageTitle === 'string' ? value.customPageTitle.trim() : defaults.customPageTitle,
    liveHomepageUrl: normalizeLiveHomepageUrl(value.liveHomepageUrl),
    autoIndent: typeof value.autoIndent === 'boolean' ? value.autoIndent : defaults.autoIndent,
    previewAutoRefresh: typeof value.previewAutoRefresh === 'boolean'
      ? value.previewAutoRefresh : defaults.previewAutoRefresh,
    editorVisible: typeof value.editorVisible === 'boolean' ? value.editorVisible : defaults.editorVisible,
    interactiveEditor: typeof value.interactiveEditor === 'boolean'
      ? value.interactiveEditor : defaults.interactiveEditor,
    showComments: typeof value.showComments === 'boolean'
      ? value.showComments : defaults.showComments,
    editBarOptions: value.editBarOptions && typeof value.editBarOptions === 'object'
      ? { comment: value.editBarOptions.comment !== false, duplicate: value.editBarOptions.duplicate !== false, moveUpDown: value.editBarOptions.moveUpDown !== false }
      : { ...defaults.editBarOptions },
    visibleTabs: normalizeVisibleTabs(value.visibleTabs, tabOrder),
    tabOrder,
    autoBackup: typeof value.autoBackup === 'boolean' ? value.autoBackup : defaults.autoBackup,
    backupCount: Number.isFinite(value.backupCount) ? Math.max(1, Math.min(100, Math.round(value.backupCount))) : defaults.backupCount
  };
}

async function loadAppSettings() {
  try {
    return normalizeAppSettings(JSON.parse(await fs.readFile(APP_SETTINGS_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Could not read persistent app settings:', error.message);
    }
    return normalizeAppSettings(getDefaultAppSettings());
  }
}

async function saveAppSettings(settings) {
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(APP_SETTINGS_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Could not read existing app settings for merge:', error.message);
    }
  }
  const merged = { ...existing, ...(settings && typeof settings === 'object' ? settings : {}) };
  const normalized = normalizeAppSettings(merged);
  await writeJsonAtomically(APP_SETTINGS_PATH, normalized);
  return normalized;
}

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
    setBoundedMapEntry(loginAttempts, key, state, MAX_AUTH_STATE_ENTRIES);
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
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (attempt.startedAt + LOGIN_ATTEMPT_WINDOW_MS - Date.now()) / 1000
    ));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.redirect(303, '/login?error=locked');
  }

  const validUser = credentialsMatch(req.body.username, LOGIN_USER);
  const validPassword = credentialsMatch(req.body.password, LOGIN_PASSWORD);
  if (!validUser || !validPassword) {
    setBoundedMapEntry(loginAttempts, attempt.key, {
      count: attempt.count + 1,
      startedAt: attempt.startedAt
    }, MAX_AUTH_STATE_ENTRIES);
    return res.redirect(303, '/login?error=invalid');
  }

  loginAttempts.delete(attempt.key);
  const token = crypto.randomBytes(32).toString('hex');
  setBoundedMapEntry(sessions, token, Date.now() + SESSION_TTL_MS, MAX_AUTH_STATE_ENTRIES);
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

  if (req.method === 'GET' && [
    '/styles.css',
    '/favicon.ico',
    '/theme-bootstrap.js',
    '/login.js'
  ].includes(req.path)) {
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

function parseBackupFilename(filename) {
  const parts = filename.split('_');
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && isValidConfigFile(parts[1])) {
    return { filename: parts[1], dirHash: null };
  }
  if (
    parts.length === 4
    && /^\d+$/.test(parts[0])
    && /^[a-f0-9]{8}$/i.test(parts[1])
    && /^[a-f0-9]{4}$/i.test(parts[2])
    && isValidConfigFile(parts[3])
  ) {
    return { filename: parts[3], dirHash: parts[1].toLowerCase() };
  }
  return null;
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
  const loadedFiles = await Promise.all(selectedFiles.map(async (filename) => {
    const content = await fs.readFile(path.join(dirPath, filename), 'utf8');
    return [filename, content, createContentRevision(content)];
  }));

  return {
    fileContents: Object.fromEntries(loadedFiles.map(([filename, content]) => [filename, content])),
    revisions: Object.fromEntries(loadedFiles.map(([filename, , revision]) => [filename, revision])),
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
    return stats;
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return null;
    if (error.statusCode) throw error;
    const wrappedError = new Error('Configuration file does not exist or cannot be accessed. Check the path and permissions');
    wrappedError.statusCode = 400;
    throw wrappedError;
  }
}

function createContentRevision(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

function createConfigConflictError(currentRevision) {
  const error = new Error('The configuration file changed on disk after it was loaded. Reload the directory before saving again');
  error.statusCode = 409;
  error.currentRevision = currentRevision;
  return error;
}

async function readConfigFileState(filePath) {
  const stats = await assertRegularConfigFile(filePath, { allowMissing: true });
  if (!stats) return { content: null, revision: null, mode: null };
  const content = await fs.readFile(filePath, 'utf8');
  return {
    content,
    revision: createContentRevision(content),
    mode: stats.mode & 0o777
  };
}

async function replaceConfigFileAtomically(filePath, content, { mode, expectedDiskRevision }) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`
  );
  let handle = null;
  try {
    handle = await fs.open(temporaryPath, 'wx', mode === null ? 0o666 : mode);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;

    const beforeCommit = await readConfigFileState(filePath);
    const desiredRevision = createContentRevision(content);
    if (beforeCommit.revision === desiredRevision) {
      return { changed: false, revision: desiredRevision };
    }
    if (beforeCommit.revision !== expectedDiskRevision) {
      throw createConfigConflictError(beforeCommit.revision);
    }

    await fs.rename(temporaryPath, filePath);
    return { changed: true, revision: desiredRevision };
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') console.warn('Could not clean up temporary configuration file:', error.message);
    });
  }
}

async function createBackup(backupDir, filename, content, maxBackups, sourceDir) {
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  // Harden existing backup directory (mkdir mode only applies on creation)
  try {
    await fs.chmod(backupDir, 0o700);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not set backup directory permissions:', error.message);
  }
  const now = new Date();
  const timestamp = String(now.getFullYear()).slice(2)
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0')
    + String(now.getMilliseconds()).padStart(3, '0');
  const dirHash = crypto.createHash('md5').update(sourceDir || '').digest('hex').slice(0, 8);
  const randomSuffix = crypto.randomUUID().slice(0, 4);
  const backupPath = path.join(backupDir, `${timestamp}_${dirHash}_${randomSuffix}_${filename}`);
  await fs.writeFile(backupPath, content, { encoding: 'utf8', mode: 0o600 });
  let entries;
  try {
    entries = await fs.readdir(backupDir);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read backup directory for cleanup:', error.message);
    return;
  }
  // Harden permissions on existing backup files only (skip directories, unrelated files)
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(backupDir, entry);
      try {
        const stat = await fs.stat(entryPath);
        if (stat.isFile() && parseBackupFilename(entry)) {
          await fs.chmod(entryPath, 0o600);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('Could not set backup file permissions:', error.message);
      }
    })
  );

  const matching = entries
    .filter((entry) => {
      const backup = parseBackupFilename(entry);
      return backup
        && backup.filename.toLowerCase() === filename.toLowerCase()
        && backup.dirHash === dirHash;
    })
    .sort()
    .reverse();
  if (matching.length > maxBackups) {
    await Promise.all(
      matching.slice(maxBackups).map((entry) =>
        fs.unlink(path.join(backupDir, entry)).catch((error) => {
          if (error.code !== 'ENOENT') console.warn('Could not remove old backup:', error.message);
        })
      )
    );
  }
}

async function saveConfigFile(dirPath, filename, content, { expectedRevision, backupDir, backupCount }) {
  const filePath = resolveConfigFilePath(dirPath, filename);
  const yamlContent = typeof content === 'string' ? content : YAML.stringify(content);
  YAML.parse(yamlContent);
  const currentState = await readConfigFileState(filePath);
  const desiredRevision = createContentRevision(yamlContent);
  if (currentState.revision === desiredRevision) {
    return { filePath, changed: false, revision: desiredRevision };
  }
  if (currentState.revision !== expectedRevision) {
    throw createConfigConflictError(currentState.revision);
  }
  if (backupDir && currentState.content !== null) {
    await createBackup(backupDir, filename, currentState.content, backupCount, dirPath);
  }
  const result = await replaceConfigFileAtomically(filePath, yamlContent, {
    mode: currentState.mode,
    expectedDiskRevision: currentState.revision
  });
  return { filePath, ...result };
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
    return res.status(error.statusCode || 500).json({ error: 'Could not save option types', details: error.message });
  }
});

app.get('/api/startup-directory', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const startupDirectory = app.locals.startupDirectory;
  if (!startupDirectory) {
    return res.json({
      directory: null,
      files: {},
      revisions: {},
      hasStartupDirectory: false
    });
  }

  try {
    const { fileContents, revisions, loadedCount } = await loadDirectoryContents(startupDirectory);
    if (loadedCount === 0) {
      app.locals.startupDirectory = null;
      app.locals.startupFiles = {};
      return res.json({
        directory: null,
        files: {},
        revisions: {},
        hasStartupDirectory: false
      });
    }
    app.locals.startupFiles = fileContents;
    return res.json({
      directory: startupDirectory,
      files: fileContents,
      revisions,
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
    const body = req.body;
    const operation = body && body.operation;
    if (operation && ['group.add', 'group.edit', 'group.rename'].includes(operation.type)) {
      const definitions = app.locals.optionDefinitions || [];
      const serverGroupOptionNames = definitions
        .filter((definition) => definition.appliesTo.includes('group'))
        .map((definition) => definition.name);
      if (Array.isArray(operation.groupOptionNames)) {
        operation.groupOptionNames = [...new Set([...operation.groupOptionNames, ...serverGroupOptionNames])];
      } else {
        operation.groupOptionNames = serverGroupOptionNames;
      }
    }
    return res.json(transformPreviewYaml(body));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? 'Could not apply edit' : 'Edit failed unexpectedly',
      details: error.message
    });
  }
});

app.post('/api/directory/load', async (req, res) => {
  try {
    const configDir = await resolveRealAllowedConfigDirectory(req.body.dirPath);
    await assertDirectory(configDir);
    const { fileContents, revisions, loadedCount, totalCount } = await loadDirectoryContents(configDir);
    return res.json({
      directory: configDir,
      files: fileContents,
      revisions,
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
    const { dirPath, filename, content, expectedRevision } = req.body;
    if (!dirPath || !filename || content === undefined) {
      return res.status(400).json({
        error: 'Directory path, filename, and file content are required to save a configuration'
      });
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'expectedRevision')) {
      return res.status(428).json({
        error: 'A file revision is required before saving',
        details: 'Reload the configuration directory and try again'
      });
    }
    if (expectedRevision !== null && !/^[a-f0-9]{64}$/.test(expectedRevision)) {
      return res.status(400).json({
        error: 'The expected file revision is invalid',
        details: 'Reload the configuration directory and try again'
      });
    }

    const configDir = await resolveRealAllowedConfigDirectory(dirPath);
    await assertDirectory(configDir);
    const appSettings = await loadAppSettings();
    const backupOptions = appSettings.autoBackup
      ? { backupDir: path.join(APP_DATA_DIR, 'backups'), backupCount: appSettings.backupCount }
      : {};
    const result = await saveConfigFile(configDir, filename, content, { expectedRevision, ...backupOptions });
    return res.json({
      message: result.changed ? 'File saved successfully' : 'No changes detected',
      details: result.changed ? `Saved to ${result.filePath}` : `Skipped writing ${result.filePath}`,
      changed: result.changed,
      revision: result.revision
    });
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) console.error('Directory file save error:', error);
    const isYamlError = error && (error.name === 'YAMLParseError' || error.code === 'BAD_INDENT');
    return res.status(error.statusCode || (isYamlError ? 400 : 500)).json({
      error: isYamlError
        ? 'Invalid YAML in configuration file'
        : error.statusCode === 409
          ? 'Configuration file changed on disk'
          : 'Could not save configuration file',
      details: isYamlError ? formatYamlParseError(error) : (error.statusCode ? error.message : 'The configuration file could not be saved'),
      ...(error.statusCode === 409 ? { currentRevision: error.currentRevision } : {})
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
  await loadOptionDefinitions();
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
