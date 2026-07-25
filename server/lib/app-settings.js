const fs = require('node:fs/promises');
const { writeJsonAtomically } = require('./config-files');

let DEFAULT_CONFIG_TAB_ORDER;
let defaultAppSettingsTemplate;
let DEFAULT_THEME;

function init(config) {
  DEFAULT_CONFIG_TAB_ORDER = config.DEFAULT_CONFIG_TAB_ORDER;
  defaultAppSettingsTemplate = config.defaultAppSettingsTemplate;
  DEFAULT_THEME = config.DEFAULT_THEME;
}

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

async function loadAppSettings(APP_SETTINGS_PATH) {
  try {
    return normalizeAppSettings(JSON.parse(await fs.readFile(APP_SETTINGS_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Could not read persistent app settings:', error.message);
    }
    return normalizeAppSettings(getDefaultAppSettings());
  }
}

async function saveAppSettings(APP_SETTINGS_PATH, settings) {
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

module.exports = {
  init,
  getDefaultAppSettings,
  normalizeLiveHomepageUrl,
  normalizeTabOrder,
  normalizeVisibleTabs,
  normalizeAppSettings,
  loadAppSettings,
  saveAppSettings
};
