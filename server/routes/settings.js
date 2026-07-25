const express = require('express');

const router = express.Router();

let appSettings;
let optionTypes;
let APP_SETTINGS_PATH;
let OPTION_TYPES_PATH;
let defaultOptionDefinitions;

function init(config) {
  appSettings = config.appSettings;
  optionTypes = config.optionTypes;
  APP_SETTINGS_PATH = config.APP_SETTINGS_PATH;
  OPTION_TYPES_PATH = config.OPTION_TYPES_PATH;
  defaultOptionDefinitions = config.defaultOptionDefinitions;
}

router.get('/api/app-settings', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ settings: await appSettings.loadAppSettings(APP_SETTINGS_PATH) });
});

router.put('/api/app-settings', async (req, res) => {
  try {
    return res.json({ settings: await appSettings.saveAppSettings(APP_SETTINGS_PATH, req.body && req.body.settings) });
  } catch (error) {
    console.error('Could not save persistent app settings:', error);
    return res.status(500).json({ error: 'Could not save editor settings', details: error.message });
  }
});

router.get('/api/option-types', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ options: await optionTypes.loadOptionDefinitions(OPTION_TYPES_PATH, req.app, defaultOptionDefinitions) });
});

router.put('/api/option-types', async (req, res) => {
  try {
    return res.json({ options: await optionTypes.saveOptionDefinitions(OPTION_TYPES_PATH, req.app, req.body && req.body.options) });
  } catch (error) {
    console.error('Could not save option type definitions:', error);
    return res.status(error.statusCode || 500).json({ error: 'Could not save option types', details: error.message });
  }
});

module.exports = { router, init };
