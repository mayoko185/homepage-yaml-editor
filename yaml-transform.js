const YAML = require('yaml');

class YamlTransformError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'YamlTransformError';
    this.statusCode = statusCode;
  }
}

function parseDocument(yamlText, filename) {
  if (typeof yamlText !== 'string') {
    throw new YamlTransformError(`${filename} content is required`);
  }
  const document = YAML.parseDocument(yamlText, {
    keepSourceTokens: true,
    prettyErrors: true
  });
  if (document.errors.length > 0) {
    throw new YamlTransformError(`${filename} is invalid: ${document.errors[0].message}`);
  }
  return document;
}

function scalarValue(node) {
  if (node === null || node === undefined) return '';
  if (YAML.isScalar(node)) return String(node.value ?? '');
  return ['string', 'number', 'boolean'].includes(typeof node) ? String(node) : '';
}

function getSinglePair(mapNode, label) {
  if (!YAML.isMap(mapNode) || mapNode.items.length === 0) {
    throw new YamlTransformError(`${label} has an unsupported YAML structure`);
  }
  return mapNode.items[0];
}

function findNamedSequenceItem(sequence, name, occurrenceIndex, label) {
  if (!YAML.isSeq(sequence)) {
    throw new YamlTransformError(`${label} must be a YAML list`);
  }
  let seen = 0;
  for (let index = 0; index < sequence.items.length; index++) {
    const item = sequence.items[index];
    const pair = getSinglePair(item, label);
    if (scalarValue(pair.key) !== name) {
      continue;
    }
    if (seen === occurrenceIndex) {
      return { item, pair, index };
    }
    seen++;
  }
  throw new YamlTransformError(`${label} "${name}" could not be found`);
}

function getServicesSequence(document) {
  if (document.contents === null) {
    document.contents = document.createNode([]);
  }
  if (!YAML.isSeq(document.contents)) {
    throw new YamlTransformError('services.yaml must contain a list of service groups');
  }
  return document.contents;
}

function getGroup(document, target) {
  return findNamedSequenceItem(
    getServicesSequence(document),
    String(target.groupName || ''),
    Number(target.groupIndex) || 0,
    'Service group'
  );
}

function getService(document, target) {
  const group = getGroup(document, target);
  if (!YAML.isSeq(group.pair.value)) {
    throw new YamlTransformError(`Service group "${target.groupName}" must contain a list`);
  }
  const service = findNamedSequenceItem(
    group.pair.value,
    String(target.serviceName || ''),
    Number(target.serviceIndex) || 0,
    'Service'
  );
  return { group, service, services: group.pair.value };
}

function requireName(value, label) {
  const name = String(value || '').trim();
  if (!name) {
    throw new YamlTransformError(`${label} name is required`);
  }
  if (/\r|\n/.test(name)) {
    throw new YamlTransformError(`${label} name must be a single line`);
  }
  return name;
}

function setScalarPairValue(document, pair, value) {
  if (YAML.isScalar(pair.value)) {
    pair.value.value = value;
  } else {
    pair.value = document.createNode(value);
  }
}

function setServiceFields(document, servicePair, values) {
  if (!YAML.isMap(servicePair.value)) {
    servicePair.value = document.createNode({});
  }
  for (const fieldName of ['href', 'description', 'icon']) {
    const value = String(values[fieldName] || '').trim();
    const existingPair = servicePair.value.items.find((pair) => scalarValue(pair.key) === fieldName);
    if (!value) {
      servicePair.value.delete(fieldName);
    } else if (existingPair) {
      setScalarPairValue(document, existingPair, value);
    } else {
      servicePair.value.set(fieldName, value);
    }
  }
}

function normalizeEditableFields(fields) {
  if (!Array.isArray(fields)) {
    throw new YamlTransformError('Preview options must be a list');
  }
  const seen = new Set();
  return fields.map((field) => {
    const key = requireName(field && field.key, 'Option');
    if (seen.has(key)) {
      throw new YamlTransformError(`Option "${key}" is listed more than once`);
    }
    seen.add(key);
    if (Array.isArray(field && field.fields)) {
      return { key, fields: normalizeEditableFields(field.fields) };
    }
    return { key, value: String((field && field.value) ?? '') };
  });
}

function parseEditableValue(value, key) {
  if (value === '') return '';
  const document = YAML.parseDocument(value, { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new YamlTransformError(`Option "${key}" has an invalid YAML value: ${document.errors[0].message}`);
  }
  return document.toJS();
}

function setMapFields(document, map, fields) {
  if (!YAML.isMap(map)) {
    throw new YamlTransformError('Options must use a YAML mapping');
  }
  const existingPairs = new Map();
  map.items.forEach((pair) => {
    const key = scalarValue(pair.key);
    if (!existingPairs.has(key)) existingPairs.set(key, pair);
  });
  map.items = fields.map(({ key, value, fields: nestedFields }) => {
    const existingPair = existingPairs.get(key);
    if (nestedFields) {
      const nestedMap = existingPair && YAML.isMap(existingPair.value)
        ? existingPair.value : document.createNode({});
      setMapFields(document, nestedMap, nestedFields);
      if (existingPair) {
        existingPair.value = nestedMap;
        return existingPair;
      }
      return document.createPair(key, nestedMap);
    }
    const parsedValue = parseEditableValue(value, key);
    if (existingPair) {
      existingPair.value = document.createNode(parsedValue);
      return existingPair;
    }
    return document.createPair(key, parsedValue);
  });
}

function findTopLevelMapPair(document, key) {
  if (!YAML.isMap(document.contents)) {
    return null;
  }
  return document.contents.items.find((pair) => scalarValue(pair.key) === key) || null;
}

function getLayoutMap(settingsDocument) {
  const layoutPair = findTopLevelMapPair(settingsDocument, 'layout');
  return layoutPair && YAML.isMap(layoutPair.value) ? layoutPair.value : null;
}

function getOrCreateLayoutMap(settingsDocument) {
  if (settingsDocument.contents === null) {
    settingsDocument.contents = settingsDocument.createNode({});
  }
  if (!YAML.isMap(settingsDocument.contents)) {
    throw new YamlTransformError('settings.yaml must contain a YAML mapping');
  }
  let layoutPair = findTopLevelMapPair(settingsDocument, 'layout');
  if (!layoutPair) {
    settingsDocument.contents.set('layout', settingsDocument.createNode({}));
    layoutPair = findTopLevelMapPair(settingsDocument, 'layout');
  }
  if (!YAML.isMap(layoutPair.value)) {
    throw new YamlTransformError('settings.yaml layout must contain a mapping of groups');
  }
  return layoutPair.value;
}

function findLayoutPair(layoutMap, groupName) {
  if (!layoutMap) {
    return null;
  }
  const index = layoutMap.items.findIndex((pair) => scalarValue(pair.key) === groupName);
  return index === -1 ? null : { pair: layoutMap.items[index], index };
}

function syncLayoutRename(settingsDocument, oldName, newName) {
  const layoutEntry = findLayoutPair(getLayoutMap(settingsDocument), oldName);
  if (layoutEntry && YAML.isScalar(layoutEntry.pair.key)) {
    layoutEntry.pair.key.value = newName;
    return true;
  }
  return false;
}

function syncLayoutRemove(settingsDocument, groupName) {
  const layoutMap = getLayoutMap(settingsDocument);
  const layoutEntry = findLayoutPair(layoutMap, groupName);
  if (!layoutEntry) {
    return false;
  }
  layoutMap.items.splice(layoutEntry.index, 1);
  return true;
}

function syncLayoutMove(settingsDocument, groupName, adjacentGroupName) {
  const layoutMap = getLayoutMap(settingsDocument);
  const currentEntry = findLayoutPair(layoutMap, groupName);
  const adjacentEntry = findLayoutPair(layoutMap, adjacentGroupName);
  if (!currentEntry || !adjacentEntry) {
    return false;
  }
  const temporary = layoutMap.items[currentEntry.index];
  layoutMap.items[currentEntry.index] = layoutMap.items[adjacentEntry.index];
  layoutMap.items[adjacentEntry.index] = temporary;
  return true;
}

function getLayoutPairTab(pair) {
  if (!pair || !YAML.isMap(pair.value)) {
    return '';
  }
  const tabPair = pair.value.items.find((item) => scalarValue(item.key) === 'tab');
  return tabPair ? scalarValue(tabPair.value).trim() : '';
}

function getLayoutTabs(layoutMap) {
  const tabs = [];
  const seen = new Set();
  for (const pair of layoutMap.items) {
    const tabName = getLayoutPairTab(pair);
    if (tabName && !seen.has(tabName)) {
      seen.add(tabName);
      tabs.push(tabName);
    }
  }
  return tabs;
}

function addLayoutTab(settingsDocument, tabName, groupName) {
  const layoutMap = getOrCreateLayoutMap(settingsDocument);
  if (getLayoutTabs(layoutMap).includes(tabName)) {
    throw new YamlTransformError(`Tab "${tabName}" already exists`);
  }
  const layoutEntry = findLayoutPair(layoutMap, groupName);
  if (!layoutEntry) {
    layoutMap.set(groupName, settingsDocument.createNode({ tab: tabName }));
    return;
  }
  if (layoutEntry.pair.value === null || YAML.isScalar(layoutEntry.pair.value) && layoutEntry.pair.value.value === null) {
    layoutEntry.pair.value = settingsDocument.createNode({});
  }
  if (!YAML.isMap(layoutEntry.pair.value)) {
    throw new YamlTransformError(`Layout group "${groupName}" has an unsupported structure`);
  }
  layoutEntry.pair.value.set('tab', tabName);
}

function removeLayoutTab(settingsDocument, tabName) {
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap) {
    throw new YamlTransformError(`Tab "${tabName}" could not be found`);
  }
  let changed = false;
  for (const pair of layoutMap.items) {
    if (getLayoutPairTab(pair) === tabName) {
      pair.value.delete('tab');
      changed = true;
    }
  }
  if (!changed) {
    throw new YamlTransformError(`Tab "${tabName}" could not be found`);
  }
}

function moveLayoutTab(settingsDocument, tabName, direction) {
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap) {
    throw new YamlTransformError(`Tab "${tabName}" could not be found`);
  }
  const tabs = getLayoutTabs(layoutMap);
  const tabIndex = tabs.indexOf(tabName);
  const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  const destination = tabIndex + offset;
  if (tabIndex === -1 || !offset || destination < 0 || destination >= tabs.length) {
    throw new YamlTransformError('The tab cannot be moved farther in that direction');
  }
  const adjacentTab = tabs[destination];
  const currentPairIndex = layoutMap.items.findIndex((pair) => getLayoutPairTab(pair) === tabName);
  const adjacentPairIndex = layoutMap.items.findIndex((pair) => getLayoutPairTab(pair) === adjacentTab);
  const temporary = layoutMap.items[currentPairIndex];
  layoutMap.items[currentPairIndex] = layoutMap.items[adjacentPairIndex];
  layoutMap.items[adjacentPairIndex] = temporary;
}

function serializeDocument(document, originalText) {
  let output = document.toString({ indent: 2, lineWidth: 0 });
  if (!String(originalText).endsWith('\n')) {
    output = output.replace(/\n$/, '');
  }
  if (String(originalText).includes('\r\n')) {
    output = output.replace(/\n/g, '\r\n');
  }
  return output;
}

function transformPreviewYaml({ files, operation }) {
  if (!files || typeof files !== 'object' || !operation || typeof operation !== 'object') {
    throw new YamlTransformError('Files and a preview edit operation are required');
  }

  const servicesText = files.services;
  const settingsText = typeof files.settings === 'string' ? files.settings : '';
  const servicesDocument = parseDocument(servicesText, 'services.yaml');
  const operationUsesLayout = ['group.edit', 'group.rename', 'group.remove', 'group.move', 'tab.add', 'tab.remove', 'tab.move'].includes(operation.type);
  const settingsDocument = operationUsesLayout ? parseDocument(settingsText, 'settings.yaml') : null;
  const servicesSequence = getServicesSequence(servicesDocument);
  const target = operation.target || {};
  const values = operation.values || {};
  let servicesChanged = false;
  let settingsChanged = false;

  switch (operation.type) {
    case 'service.add': {
      const group = getGroup(servicesDocument, target);
      if (!YAML.isSeq(group.pair.value)) {
        group.pair.value = servicesDocument.createNode([]);
      }
      const name = requireName(values.name, 'Service');
      if (Array.isArray(values.fields)) {
        const fields = normalizeEditableFields(values.fields).filter((field) => field.value !== '');
        const serviceValue = servicesDocument.createNode({});
        setMapFields(servicesDocument, serviceValue, fields);
        const serviceItem = servicesDocument.createNode({});
        serviceItem.set(name, serviceValue);
        group.pair.value.items.push(serviceItem);
      } else {
        const fields = {};
        for (const fieldName of ['href', 'description', 'icon']) {
          const value = String(values[fieldName] || '').trim();
          if (value) fields[fieldName] = value;
        }
        group.pair.value.items.push(servicesDocument.createNode({ [name]: fields }));
      }
      servicesChanged = true;
      break;
    }
    case 'service.edit': {
      const { service } = getService(servicesDocument, target);
      const name = requireName(values.name, 'Service');
      if (YAML.isScalar(service.pair.key)) service.pair.key.value = name;
      if (Array.isArray(values.fields)) {
        if (!YAML.isMap(service.pair.value)) service.pair.value = servicesDocument.createNode({});
        setMapFields(servicesDocument, service.pair.value, normalizeEditableFields(values.fields));
      } else {
        setServiceFields(servicesDocument, service.pair, values);
      }
      servicesChanged = true;
      break;
    }
    case 'service.remove': {
      const { service, services } = getService(servicesDocument, target);
      services.items.splice(service.index, 1);
      servicesChanged = true;
      break;
    }
    case 'service.move': {
      const { service, services } = getService(servicesDocument, target);
      const offset = operation.direction === 'up' ? -1 : operation.direction === 'down' ? 1 : 0;
      const destination = service.index + offset;
      if (!offset || destination < 0 || destination >= services.items.length) {
        throw new YamlTransformError('The service cannot be moved farther in that direction');
      }
      const [item] = services.items.splice(service.index, 1);
      services.items.splice(destination, 0, item);
      servicesChanged = true;
      break;
    }
    case 'group.add': {
      const name = requireName(values.name, 'Group');
      servicesSequence.items.push(servicesDocument.createNode({ [name]: [] }));
      servicesChanged = true;
      break;
    }
    case 'group.edit':
    case 'group.rename': {
      const group = getGroup(servicesDocument, target);
      const name = requireName(values.name, 'Group');
      const oldName = scalarValue(group.pair.key);
      if (YAML.isScalar(group.pair.key)) group.pair.key.value = name;
      servicesChanged = true;
      settingsChanged = syncLayoutRename(settingsDocument, oldName, name);
      if (operation.type === 'group.edit' && Array.isArray(values.fields)) {
        const fields = normalizeEditableFields(values.fields);
        let layoutMap = getLayoutMap(settingsDocument);
        let layoutEntry = findLayoutPair(layoutMap, name);
        if (fields.length === 0) {
          if (layoutEntry) {
            layoutMap.items.splice(layoutEntry.index, 1);
            settingsChanged = true;
          }
        } else {
          if (!layoutMap) layoutMap = getOrCreateLayoutMap(settingsDocument);
          layoutEntry = findLayoutPair(layoutMap, name);
          if (!layoutEntry) {
            layoutMap.set(name, settingsDocument.createNode({}));
            layoutEntry = findLayoutPair(layoutMap, name);
          }
          if (!YAML.isMap(layoutEntry.pair.value)) {
            layoutEntry.pair.value = settingsDocument.createNode({});
          }
          setMapFields(settingsDocument, layoutEntry.pair.value, fields);
          settingsChanged = true;
        }
      }
      break;
    }
    case 'group.remove': {
      const group = getGroup(servicesDocument, target);
      const oldName = scalarValue(group.pair.key);
      servicesSequence.items.splice(group.index, 1);
      servicesChanged = true;
      settingsChanged = syncLayoutRemove(settingsDocument, oldName);
      break;
    }
    case 'group.move': {
      const group = getGroup(servicesDocument, target);
      const offset = operation.direction === 'up' ? -1 : operation.direction === 'down' ? 1 : 0;
      const destination = group.index + offset;
      if (!offset || destination < 0 || destination >= servicesSequence.items.length) {
        throw new YamlTransformError('The group cannot be moved farther in that direction');
      }
      const adjacentPair = getSinglePair(servicesSequence.items[destination], 'Service group');
      settingsChanged = syncLayoutMove(
        settingsDocument,
        scalarValue(group.pair.key),
        scalarValue(adjacentPair.key)
      );
      const [item] = servicesSequence.items.splice(group.index, 1);
      servicesSequence.items.splice(destination, 0, item);
      servicesChanged = true;
      break;
    }
    case 'tab.add': {
      const tabName = requireName(values.name, 'Tab');
      const groupName = requireName(values.groupName, 'Initial group');
      const hasServiceGroup = servicesSequence.items.some((item) => (
        scalarValue(getSinglePair(item, 'Service group').key) === groupName
      ));
      const hasLayoutGroup = Boolean(findLayoutPair(getLayoutMap(settingsDocument), groupName));
      if (values.createGroup === true) {
        if (hasServiceGroup || hasLayoutGroup) {
          throw new YamlTransformError(`Group "${groupName}" already exists`);
        }
        servicesSequence.items.push(servicesDocument.createNode({ [groupName]: [] }));
        servicesChanged = true;
      } else if (!hasServiceGroup && !hasLayoutGroup) {
        throw new YamlTransformError(`Group "${groupName}" could not be found`);
      }
      addLayoutTab(settingsDocument, tabName, groupName);
      settingsChanged = true;
      break;
    }
    case 'tab.remove': {
      const tabName = requireName(target.name, 'Tab');
      removeLayoutTab(settingsDocument, tabName);
      settingsChanged = true;
      break;
    }
    case 'tab.move': {
      const tabName = requireName(target.name, 'Tab');
      moveLayoutTab(settingsDocument, tabName, operation.direction);
      settingsChanged = true;
      break;
    }
    default:
      throw new YamlTransformError('Unsupported preview edit operation');
  }

  const transformedFiles = {
    services: servicesChanged ? serializeDocument(servicesDocument, servicesText) : servicesText,
    settings: settingsChanged ? serializeDocument(settingsDocument, settingsText) : settingsText
  };
  parseDocument(transformedFiles.services, 'services.yaml');
  if (settingsChanged) parseDocument(transformedFiles.settings, 'settings.yaml');
  return { files: transformedFiles };
}

module.exports = {
  YamlTransformError,
  transformPreviewYaml
};
