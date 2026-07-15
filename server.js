const express = require('express');
const compression = require('compression');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');
const { transformPreviewYaml } = require('./yaml-transform');

const app = express();
const PORT = process.env.PORT || 8081;
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXAMPLES_DIR = path.join(__dirname, 'examples');
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
const ALLOWED_CONFIG_FILES = new Set(
  CONFIG_BASE_NAMES.flatMap((baseName) => CONFIG_EXTENSIONS.map((extension) => `${baseName}${extension}`))
);
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

app.locals.startupDirectory = null;
app.locals.startupFiles = {};

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON request body', details: error.message });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request body is too large',
      details: 'Try saving first, then download from the loaded server-side directory'
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
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProtocol === 'https';
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
    const error = new Error(`Only ${CONFIG_BASE_NAMES.join(', ')} YAML files are supported`);
    error.statusCode = 400;
    throw error;
  }

  const resolvedDir = path.resolve(dirPath);
  const resolvedFile = path.resolve(resolvedDir, filename);
  if (path.dirname(resolvedFile) !== resolvedDir) {
    const error = new Error('Invalid filename - path traversal is not allowed');
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
    const error = new Error('Directory path is required');
    error.statusCode = 400;
    throw error;
  }

  const resolvedDir = path.resolve(dirPath);
  if (!ALLOWED_CONFIG_DIRECTORIES.some((allowedDir) => isSameOrChildPath(resolvedDir, allowedDir))) {
    const error = new Error(`Directory is not in the allowed config paths: ${ALLOWED_CONFIG_DIRECTORIES.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return resolvedDir;
}

async function assertDirectory(dirPath) {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      const error = new Error('Provided path is not a directory');
      error.statusCode = 400;
      throw error;
    }
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    const wrappedError = new Error('Directory does not exist or is not accessible');
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

async function saveConfigFile(dirPath, filename, content, { skipUnchanged = false } = {}) {
  const filePath = resolveConfigFilePath(dirPath, filename);
  const yamlContent = typeof content === 'string' ? content : YAML.stringify(content);
  YAML.parse(yamlContent);

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

  await fs.writeFile(filePath, yamlContent, 'utf8');
  return { filePath, changed: true };
}

async function applyStartupDirectoryLoad() {
  const startupDir = AUTOLOAD_DIR || DEFAULT_DATA_DIR;
  try {
    const resolvedStartupDir = resolveAllowedConfigDirectory(startupDir);
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
      error: 'Failed to load example configurations',
      details: error.message
    });
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
      error: 'Failed to refresh startup directory',
      details: error.message
    });
  }
});

app.post('/api/yaml/transform', (req, res) => {
  try {
    return res.json(transformPreviewYaml(req.body));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? 'Could not apply preview edit' : 'Preview edit failed',
      details: error.message
    });
  }
});

app.post('/api/directory/load', async (req, res) => {
  try {
    const configDir = resolveAllowedConfigDirectory(req.body.dirPath);
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
      error: 'Failed to load configs from directory',
      details: error.message
    });
  }
});

app.post('/api/directory/file/save', async (req, res) => {
  try {
    const { dirPath, filename, content } = req.body;
    if (!dirPath || !filename || content === undefined) {
      return res.status(400).json({
        error: 'Directory path, filename and content are required'
      });
    }

    const configDir = resolveAllowedConfigDirectory(dirPath);
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
      error: isYamlError ? 'Invalid YAML' : 'Failed to save file',
      details: error.message
    });
  }
});

async function startServer() {
  if (LOGIN_PARTIALLY_CONFIGURED) {
    throw new Error('REQUIRE_LOGIN_USER and REQUIRE_LOGIN_PASSWORD must both be set to enable login');
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await applyStartupDirectoryLoad();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});
