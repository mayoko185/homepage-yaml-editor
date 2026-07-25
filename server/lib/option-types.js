const fs = require('node:fs/promises');
const { writeJsonAtomically } = require('./config-files');

const OPTION_VALUE_TYPES = new Set(['text', 'textarea', 'boolean', 'tab', 'mapping', 'select']);
const OPTION_TARGETS = Object.freeze(['service', 'group', 'bookmark', 'widget']);
const OPTION_TARGET_SET = new Set(OPTION_TARGETS);

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

function getDefaultOptionDefinitions(defaultOptionDefinitions) {
  return defaultOptionDefinitions.map((definition) => ({
    ...definition,
    ...(definition.values ? { values: [...definition.values] } : {})
  }));
}

async function loadOptionDefinitions(OPTION_TYPES_PATH, app, defaultOptionDefinitions) {
  try {
    const definitions = normalizeOptionDefinitions(JSON.parse(await fs.readFile(OPTION_TYPES_PATH, 'utf8')));
    app.locals.optionDefinitions = definitions;
    return definitions;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read option type definitions:', error.message);
    const defaults = getDefaultOptionDefinitions(defaultOptionDefinitions);
    app.locals.optionDefinitions = defaults;
    return defaults;
  }
}

async function saveOptionDefinitions(OPTION_TYPES_PATH, app, definitions) {
  const normalized = normalizeOptionDefinitions(definitions);
  await writeJsonAtomically(OPTION_TYPES_PATH, normalized);
  app.locals.optionDefinitions = normalized;
  return normalized;
}

async function ensureOptionDefinitions(OPTION_TYPES_PATH, app, defaultOptionDefinitions) {
  try {
    const storedDefinitions = JSON.parse(await fs.readFile(OPTION_TYPES_PATH, 'utf8'));
    const normalizedStoredDefinitions = normalizeOptionDefinitions(storedDefinitions);
    const defaultDefinitions = getDefaultOptionDefinitions(defaultOptionDefinitions);
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
      await saveOptionDefinitions(OPTION_TYPES_PATH, app, getDefaultOptionDefinitions(defaultOptionDefinitions));
      return;
    }
    console.warn('Could not merge default option type definitions; keeping the existing file unchanged:', error.message);
  }
}

module.exports = {
  OPTION_VALUE_TYPES,
  OPTION_TARGETS,
  OPTION_TARGET_SET,
  createOptionTypeError,
  normalizeOptionDefinitions,
  getDefaultOptionDefinitions,
  loadOptionDefinitions,
  saveOptionDefinitions,
  ensureOptionDefinitions
};
