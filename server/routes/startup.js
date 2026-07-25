const express = require('express');

const router = express.Router();

let configFiles;
let AUTOLOAD_DIR;
let DEFAULT_DATA_DIR;

function init(config) {
  configFiles = config.configFiles;
  AUTOLOAD_DIR = config.AUTOLOAD_DIR;
  DEFAULT_DATA_DIR = config.DEFAULT_DATA_DIR;
}

router.get('/api/startup-directory', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const startupDirectory = req.app.locals.startupDirectory;
  if (!startupDirectory) {
    return res.json({
      directory: null,
      files: {},
      revisions: {},
      hasStartupDirectory: false
    });
  }

  try {
    const { fileContents, revisions, loadedCount } = await configFiles.loadDirectoryContents(startupDirectory);
    if (loadedCount === 0) {
      req.app.locals.startupDirectory = null;
      req.app.locals.startupFiles = {};
      return res.json({
        directory: null,
        files: {},
        revisions: {},
        hasStartupDirectory: false
      });
    }
    req.app.locals.startupFiles = fileContents;
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

module.exports = { router, init };
