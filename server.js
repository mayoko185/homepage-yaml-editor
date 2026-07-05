const express = require('express');
const fs = require('fs-extra');
const YAML = require('yaml');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8081;

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: 'Invalid JSON request body',
      details: error.message
    });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request body is too large',
      details: 'Try saving first, then download from the loaded server-side directory'
    });
  }
  next(error);
});
app.use(express.static('public'));

// Ensure the data directory exists
const DEFAULT_DATA_DIR = '/hp_config';
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const AUTOLOAD_DIR = process.env.AUTOLOAD_DIR;
const EXTRA_ALLOWED_CONFIG_DIRS = (process.env.ALLOWED_CONFIG_DIRS || '')
  .split(',')
  .map((dirPath) => dirPath.trim())
  .filter(Boolean);
fs.ensureDirSync(DATA_DIR);

async function getStartupDirectory() {
  if (AUTOLOAD_DIR) {
    return AUTOLOAD_DIR;
  }

  if (await fs.pathExists(DEFAULT_DATA_DIR)) {
    return DEFAULT_DATA_DIR;
  }

  return null;
}

async function loadDirectoryContents(dirPath) {
  const configBaseNames = ['bookmarks', 'settings', 'services', 'widgets'];
  const fileContents = {};
  let loadedCount = 0;

  for (const baseName of configBaseNames) {
    const yamlPath = path.join(dirPath, `${baseName}.yaml`);
    const ymlPath = path.join(dirPath, `${baseName}.yml`);
    let filePath = null;

    if (await fs.pathExists(yamlPath)) {
      filePath = yamlPath;
    } else if (await fs.pathExists(ymlPath)) {
      filePath = ymlPath;
    }

    if (filePath) {
      const content = await fs.readFile(filePath, 'utf8');
      fileContents[path.basename(filePath)] = content;
      loadedCount++;
    }
  }

  return { fileContents, loadedCount, totalCount: configBaseNames.length };
}

async function applyStartupDirectoryLoad() {
  const startupDir = await getStartupDirectory();
  if (!startupDir) {
    return;
  }

  try {
    const stats = await fs.stat(startupDir);
    if (!stats.isDirectory()) {
      return;
    }

    const { fileContents } = await loadDirectoryContents(startupDir);
    app.locals.startupDirectory = startupDir;
    app.locals.startupFiles = fileContents;
  } catch (error) {
    console.warn('Startup directory load failed:', error.message);
  }
}

app.locals.startupDirectory = null;
app.locals.startupFiles = {};
applyStartupDirectoryLoad();

// Define allowed config files with metadata
const ALLOWED_CONFIG_FILES = {
  'bookmarks.yaml': {
    type: 'array',
    description: 'Bookmarks configuration'
  },
  'bookmarks.yml': {
    type: 'array',
    description: 'Bookmarks configuration'
  },
  'settings.yaml': {
    type: 'object', 
    description: 'Application settings'
  },
  'settings.yml': {
    type: 'object',
    description: 'Application settings'
  },
  'services.yaml': {
    type: 'object',
    description: 'Services configuration'  
  },
  'services.yml': {
    type: 'object',
    description: 'Services configuration'
  },
  'widgets.yaml': {
    type: 'object',
    description: 'Widget configuration'
  },
  'widgets.yml': {
    type: 'object',
    description: 'Widget configuration'
  }
};

const DEFAULT_CONFIG_CONTENT = {
  services: { 
    "My First Group": [
      {
        "My First Service": {
          href: "http://localhost/",
          description: "Homepage is awesome"
        }
      }
    ]
  },
  settings: { 
    providers: {
      openweathermap: "openweathermapapikey",
      weatherapi: "weatherapiurl"
    }
  },
  bookmarks: [
    {
      "My First Bookmark": {
        href: "http://localhost/",
        description: "Homepage is awesome"
      }
    }
  ],
  widgets: {
    weather: {
      location: "London",
      units: "metric"
    },
    clock: {
      format: "12h"
    }
  }
};

// Helper function to validate file names
function isValidConfigFile(filename) {
  return Object.keys(ALLOWED_CONFIG_FILES).includes(filename);
}

function getConfigBaseName(filename) {
  if (!isValidConfigFile(filename)) {
    return null;
  }

  return filename.replace(/\.ya?ml$/i, '');
}

function getDefaultConfigContent(filename) {
  return DEFAULT_CONFIG_CONTENT[getConfigBaseName(filename)];
}

function resolveConfigFilePath(dirPath, filename) {
  const resolvedDir = path.resolve(dirPath);
  const resolvedFile = path.resolve(resolvedDir, filename);

  if (path.dirname(resolvedFile) !== resolvedDir) {
    throw new Error('Invalid filename - path traversal is not allowed');
  }

  return resolvedFile;
}

function getAllowedConfigDirectories() {
  return Array.from(new Set([
    DEFAULT_DATA_DIR,
    DATA_DIR,
    AUTOLOAD_DIR,
    ...EXTRA_ALLOWED_CONFIG_DIRS
  ].filter(Boolean)));
}

function isSameOrChildPath(candidatePath, parentPath) {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedParent = path.resolve(parentPath);
  const relativePath = path.relative(resolvedParent, resolvedCandidate);

  return relativePath === ''
    || (relativePath
      && relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

function resolveAllowedConfigDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('Directory path is required');
  }

  const resolvedDir = path.resolve(dirPath);
  const isAllowed = getAllowedConfigDirectories()
    .some((allowedDir) => isSameOrChildPath(resolvedDir, allowedDir));

  if (!isAllowed) {
    const error = new Error(`Directory is not in the allowed config paths: ${getAllowedConfigDirectories().join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  return resolvedDir;
}

// Routes - simple and direct approach
app.get('/', (req, res) => {
  // Serve index.html from public folder 
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/startup-directory', (req, res) => {
  res.json({
    directory: app.locals.startupDirectory,
    files: app.locals.startupFiles,
    hasStartupDirectory: Boolean(app.locals.startupDirectory)
  });
});

// Get list of YAML files in the data directory
app.get('/api/files', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const yamlFiles = files.filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    res.json(yamlFiles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read files' });
  }
});

// Load a specific config file from the data directory
app.post('/api/config/load', async (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }
    
    // Only allow loading specific config files
    if (!isValidConfigFile(filename)) {
      return res.status(400).json({ error: 'Invalid filename. Must be bookmarks/settings/services/widgets with .yaml or .yml extension' });
    }
    
    const filePath = path.join(DATA_DIR, filename);
    const fileExists = await fs.pathExists(filePath);
    
    if (!fileExists) {
      return res.json({
        name: filename,
        content: getDefaultConfigContent(filename)
      });
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = YAML.parse(content);
    
    res.json({
      name: filename,
      content: parsed
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Save a config file in the data directory
app.post('/api/config/save', async (req, res) => {
  try {
    const { filename, content } = req.body;
    
    if (!filename || content === undefined) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }
    
    // Only allow saving specific config files
    if (!isValidConfigFile(filename)) {
      return res.status(400).json({ error: 'Invalid filename. Must be bookmarks/settings/services/widgets with .yaml or .yml extension' });
    }
    
    const filePath = path.join(DATA_DIR, filename);
    const yamlContent = typeof content === 'string' ? content : YAML.stringify(content);
    YAML.parse(yamlContent);
    await fs.writeFile(filePath, yamlContent, 'utf8');
    
    res.json({ message: 'File saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Get list of all available configuration files in a directory
app.post('/api/directory/files', async (req, res) => {
  try {
    const { dirPath } = req.body;
    
    const configDir = resolveAllowedConfigDirectory(dirPath);

    if (!fs.existsSync(configDir)) {
      return res.status(400).json({ 
        error: 'Directory path is required and must exist',
        details: 'Valid directory paths must exist and be listed in ALLOWED_CONFIG_DIRS, DATA_DIR, AUTOLOAD_DIR, or /hp_config'
      });
    }
    
    // Read files in the directory
    const files = await fs.readdir(configDir);
    
    // Filter for specified config files
    const yamlFiles = files.filter(file => 
      (file.endsWith('.yaml') || file.endsWith('.yml')) && 
      isValidConfigFile(file)
    );
    
    res.json({
      directory: configDir,
      files: yamlFiles
    });
  } catch (error) {
    console.error('Directory files error:', error);
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to read directory files',
      details: error.message 
    });
  }
});

// Load all config files from a directory
app.post('/api/directory/load', async (req, res) => {
  try {
    const { dirPath } = req.body;
    
    const configDir = resolveAllowedConfigDirectory(dirPath);

    if (!fs.existsSync(configDir)) {
      return res.status(400).json({ 
        error: 'Directory path is required and must exist',
        details: 'Please verify the directory exists and is an allowed config path'
      });
    }
    
    // Verify directory access
    const stats = await fs.stat(configDir);
    if (!stats.isDirectory()) {
      return res.status(400).json({ 
        error: 'Provided path is not a directory',
        details: 'Please provide a valid directory path for configuration files'
      });
    }
    
    // Define the files we expect to find in the directory
    const configBaseNames = ['bookmarks', 'settings', 'services', 'widgets'];
    
    let fileContents = {};
    let loadedCount = 0;
    
    for (const baseName of configBaseNames) {
      const yamlPath = path.join(configDir, `${baseName}.yaml`);
      const ymlPath = path.join(configDir, `${baseName}.yml`);
      let filePath = null;

      if (await fs.pathExists(yamlPath)) {
        filePath = yamlPath;
      } else if (await fs.pathExists(ymlPath)) {
        filePath = ymlPath;
      }

      try {
        if (filePath) {
          const content = await fs.readFile(filePath, 'utf8');
          fileContents[path.basename(filePath)] = content;
          loadedCount++;
        }
      } catch (err) {
        console.warn(`Could not read ${baseName}:`, err.message);
        continue;
      }
    }
    
    res.json({
      directory: configDir,
      files: fileContents,
      message: `Successfully loaded ${loadedCount} of ${configBaseNames.length} configuration files`,
      details: 'Directory loading is designed to work with server-side paths, not browser-selected directories due to web security restrictions'
    });
  } catch (error) {
    console.error('Directory load error:', error);
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to load configs from directory',
      details: error.message 
    });
  }
});

// Load a specific file from the directory
app.post('/api/directory/file', async (req, res) => {
  try {
    const { dirPath, filename } = req.body;
    
    if (!dirPath || !filename) {
      return res.status(400).json({ 
        error: 'Directory path and filename are required',
        details: 'Both directory path and filename must be provided for file loading'
      });
    }

    if (!isValidConfigFile(filename)) {
      return res.status(400).json({
        error: 'Invalid filename',
        details: 'Only bookmarks, settings, services, and widgets files with .yaml or .yml extension can be loaded'
      });
    }
    
    const configDir = resolveAllowedConfigDirectory(dirPath);

    // Verify the directory exists
    const dirExists = await fs.pathExists(configDir);
    if (!dirExists) {
      return res.status(400).json({ 
        error: 'Directory does not exist',
        details: 'Please verify that the provided directory path is valid and accessible'
      });
    }
    
    const filePath = resolveConfigFilePath(configDir, filename);
    const fileExists = await fs.pathExists(filePath);
    if (!fileExists) {
      return res.status(404).json({ 
        error: 'File not found in directory',
        details: `Expected file ${filename} was not found at path: ${filePath}`
      });
    }
    
    // Read and parse the content
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = YAML.parse(content);
    
    res.json({
      name: filename,
      path: filePath,
      content: parsed
    });
  } catch (error) {
    console.error('Directory file read error:', error);
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to read file',
      details: error.message
    });
  }
});

// Save a specific configuration file in the directory
app.post('/api/directory/file/save', async (req, res) => {
  try {
    const { dirPath, filename, content } = req.body;
    
    if (!dirPath || !filename || content === undefined) {
      return res.status(400).json({ 
        error: 'Directory path, filename and content are required',
        details: 'All parameters must be provided for file saving operations'
      });
    }

    if (!isValidConfigFile(filename)) {
      return res.status(400).json({
        error: 'Invalid filename',
        details: 'Only bookmarks, settings, services, and widgets files with .yaml or .yml extension can be saved'
      });
    }
    
    const configDir = resolveAllowedConfigDirectory(dirPath);
    const dirExists = await fs.pathExists(configDir);
    if (!dirExists) {
      return res.status(400).json({ 
        error: 'Directory does not exist',
        details: 'Please verify that the provided directory path is valid and accessible'
      });
    }

    const stats = await fs.stat(configDir);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        error: 'Provided path is not a directory',
        details: 'Please provide a valid directory path for file saving'
      });
    }
    
    const filePath = resolveConfigFilePath(configDir, filename);
    await fs.ensureDir(configDir);
    const yamlContent = typeof content === 'string' ? content : YAML.stringify(content);
    YAML.parse(yamlContent);
    const normalizedYamlContent = yamlContent.replace(/\r\n/g, '\n');
    const existingContent = await fs.pathExists(filePath)
      ? (await fs.readFile(filePath, 'utf8')).replace(/\r\n/g, '\n')
      : null;

    if (existingContent === normalizedYamlContent) {
      return res.json({ 
        message: 'No changes detected',
        details: `Skipped writing ${filePath}`,
        changed: false
      });
    }

    await fs.writeFile(filePath, yamlContent, 'utf8');
    
    res.json({ 
      message: 'File saved successfully',
      details: `Saved to ${filePath}`,
      changed: true
    });
  } catch (error) {
    console.error('Directory file save error:', error);
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to save file',
      details: error.message
    });
  }
});

// Get a list of all YAML files in the current data directory
app.get('/api/data/files', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const yamlFiles = files.filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    res.json(yamlFiles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read data files' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
