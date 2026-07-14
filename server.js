const express = require('express');
const compression = require('compression');
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');

const app = express();
const PORT = process.env.PORT || 8081;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_DIR = '/hp_config';
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const AUTOLOAD_DIR = process.env.AUTOLOAD_DIR;
const CONFIG_BASE_NAMES = Object.freeze(['bookmarks', 'settings', 'services', 'widgets']);
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
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (/\.(?:css|js|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }
}));

function isValidConfigFile(filename) {
  return typeof filename === 'string' && ALLOWED_CONFIG_FILES.has(filename.toLowerCase());
}

function resolveConfigFilePath(dirPath, filename) {
  if (!isValidConfigFile(filename)) {
    const error = new Error('Only bookmarks, settings, services, and widgets YAML files are supported');
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
    const { fileContents } = await loadDirectoryContents(resolvedStartupDir);
    app.locals.startupDirectory = resolvedStartupDir;
    app.locals.startupFiles = fileContents;
  } catch (error) {
    console.warn('Startup directory load failed:', error.message);
  }
}

app.get('/api/startup-directory', (req, res) => {
  res.json({
    directory: app.locals.startupDirectory,
    files: app.locals.startupFiles,
    hasStartupDirectory: Boolean(app.locals.startupDirectory)
  });
});

app.post('/api/config/save', async (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }
    await saveConfigFile(DATA_DIR, filename, content);
    return res.json({ message: 'File saved successfully' });
  } catch (error) {
    const isYamlError = error && (error.name === 'YAMLParseError' || error.code === 'BAD_INDENT');
    return res.status(error.statusCode || (isYamlError ? 400 : 500)).json({
      error: isYamlError ? 'Invalid YAML' : 'Failed to save file',
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
