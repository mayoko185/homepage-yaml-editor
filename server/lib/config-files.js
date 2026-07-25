const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');

let CONFIG_BASE_NAMES;
let CONFIG_EXTENSIONS;
let ALLOWED_CONFIG_FILES;
let ALLOWED_CONFIG_DIRECTORIES;

function init(config) {
  CONFIG_BASE_NAMES = config.CONFIG_BASE_NAMES;
  CONFIG_EXTENSIONS = config.CONFIG_EXTENSIONS;
  ALLOWED_CONFIG_FILES = config.ALLOWED_CONFIG_FILES;
  ALLOWED_CONFIG_DIRECTORIES = config.ALLOWED_CONFIG_DIRECTORIES;
}

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

module.exports = {
  init,
  isValidConfigFile,
  parseBackupFilename,
  resolveConfigFilePath,
  isSameOrChildPath,
  resolveAllowedConfigDirectory,
  resolveRealAllowedConfigDirectory,
  assertDirectory,
  loadDirectoryContents,
  assertRegularConfigFile,
  createContentRevision,
  createConfigConflictError,
  readConfigFileState,
  replaceConfigFileAtomically,
  createBackup,
  saveConfigFile,
  writeJsonAtomically
};
