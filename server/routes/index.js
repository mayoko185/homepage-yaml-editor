const path = require('node:path');
const express = require('express');

const auth = require('./auth');
const config = require('./config');
const settings = require('./settings');
const startup = require('./startup');

function mountRoutes(app, deps) {
  // Initialize all route modules with their dependencies
  auth.init({
    LOGIN_ENABLED: deps.LOGIN_ENABLED,
    LOGIN_USER: deps.LOGIN_USER,
    LOGIN_PASSWORD: deps.LOGIN_PASSWORD,
    SESSION_COOKIE_NAME: deps.SESSION_COOKIE_NAME,
    SESSION_TTL_MS: deps.SESSION_TTL_MS,
    LOGIN_ATTEMPT_WINDOW_MS: deps.LOGIN_ATTEMPT_WINDOW_MS,
    MAX_LOGIN_ATTEMPTS: deps.MAX_LOGIN_ATTEMPTS,
    MAX_AUTH_STATE_ENTRIES: deps.MAX_AUTH_STATE_ENTRIES,
    PUBLIC_DIR: deps.PUBLIC_DIR,
    sessions: deps.sessions,
    loginAttempts: deps.loginAttempts,
    setBoundedMapEntry: deps.setBoundedMapEntry
  });

  config.init({
    configFiles: deps.configFiles,
    appSettings: deps.appSettings,
    optionTypes: deps.optionTypes,
    transformPreviewYaml: deps.transformPreviewYaml,
    formatYamlParseError: deps.formatYamlParseError,
    CONFIG_BASE_NAMES: deps.CONFIG_BASE_NAMES,
    EXAMPLES_DIR: deps.EXAMPLES_DIR,
    APP_DATA_DIR: deps.APP_DATA_DIR,
    APP_SETTINGS_PATH: deps.APP_SETTINGS_PATH
  });

  settings.init({
    appSettings: deps.appSettings,
    optionTypes: deps.optionTypes,
    APP_SETTINGS_PATH: deps.APP_SETTINGS_PATH,
    OPTION_TYPES_PATH: deps.OPTION_TYPES_PATH,
    defaultOptionDefinitions: deps.defaultOptionDefinitions
  });

  startup.init({
    configFiles: deps.configFiles
  });

  // Mount auth routes (login/logout) before auth middleware
  app.use(auth.router);

  // Auth middleware — protects everything after it
  app.use(auth.authMiddleware);

  // Mount API routes
  app.use(config.router);
  app.use(settings.router);
  app.use(startup.router);
}

module.exports = { mountRoutes };
