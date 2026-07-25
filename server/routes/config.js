const path = require('node:path');
const express = require('express');

const router = express.Router();

let configFiles;
let appSettings;
let optionTypes;
let transformPreviewYaml;
let formatYamlParseError;
let CONFIG_BASE_NAMES;
let EXAMPLES_DIR;
let APP_DATA_DIR;
let APP_SETTINGS_PATH;

function init(config) {
  configFiles = config.configFiles;
  appSettings = config.appSettings;
  optionTypes = config.optionTypes;
  transformPreviewYaml = config.transformPreviewYaml;
  formatYamlParseError = config.formatYamlParseError;
  CONFIG_BASE_NAMES = config.CONFIG_BASE_NAMES;
  EXAMPLES_DIR = config.EXAMPLES_DIR;
  APP_DATA_DIR = config.APP_DATA_DIR;
  APP_SETTINGS_PATH = config.APP_SETTINGS_PATH;
}

async function loadExampleConfigs() {
  const fs = require('node:fs/promises');
  const entries = await Promise.all(CONFIG_BASE_NAMES.map(async (baseName) => {
    const content = await fs.readFile(path.join(EXAMPLES_DIR, `${baseName}.yaml`), 'utf8');
    return [baseName, content];
  }));
  return Object.fromEntries(entries);
}

router.get('/api/examples', async (req, res) => {
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

router.post('/api/transform', (req, res) => {
  try {
    const body = req.body;
    const operation = body && body.operation;
    if (operation && ['group.add', 'group.edit', 'group.rename'].includes(operation.type)) {
      const definitions = req.app.locals.optionDefinitions || [];
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

router.post('/api/directory/load', async (req, res) => {
  try {
    const configDir = await configFiles.resolveRealAllowedConfigDirectory(req.body.dirPath);
    await configFiles.assertDirectory(configDir);
    const { fileContents, revisions, loadedCount, totalCount } = await configFiles.loadDirectoryContents(configDir);
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

router.post('/api/directory/file/save', async (req, res) => {
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

    const configDir = await configFiles.resolveRealAllowedConfigDirectory(dirPath);
    await configFiles.assertDirectory(configDir);
    const settings = await appSettings.loadAppSettings(APP_SETTINGS_PATH);
    const backupOptions = settings.autoBackup
      ? { backupDir: path.join(APP_DATA_DIR, 'backups'), backupCount: settings.backupCount }
      : {};
    const result = await configFiles.saveConfigFile(configDir, filename, content, { expectedRevision, ...backupOptions });
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

module.exports = { router, init };
