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
  return YAML.isScalar(node) ? String(node.value ?? '') : '';
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
  const operationUsesLayout = ['group.rename', 'group.remove', 'group.move'].includes(operation.type);
  const settingsDocument = operationUsesLayout ? parseDocument(settingsText, 'settings.yaml') : null;
  const servicesSequence = getServicesSequence(servicesDocument);
  const target = operation.target || {};
  const values = operation.values || {};
  let settingsChanged = false;

  switch (operation.type) {
    case 'service.add': {
      const group = getGroup(servicesDocument, target);
      if (!YAML.isSeq(group.pair.value)) {
        group.pair.value = servicesDocument.createNode([]);
      }
      const name = requireName(values.name, 'Service');
      const fields = {};
      for (const fieldName of ['href', 'description', 'icon']) {
        const value = String(values[fieldName] || '').trim();
        if (value) fields[fieldName] = value;
      }
      group.pair.value.items.push(servicesDocument.createNode({ [name]: fields }));
      break;
    }
    case 'service.edit': {
      const { service } = getService(servicesDocument, target);
      const name = requireName(values.name, 'Service');
      if (YAML.isScalar(service.pair.key)) service.pair.key.value = name;
      setServiceFields(servicesDocument, service.pair, values);
      break;
    }
    case 'service.remove': {
      const { service, services } = getService(servicesDocument, target);
      services.items.splice(service.index, 1);
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
      break;
    }
    case 'group.add': {
      const name = requireName(values.name, 'Group');
      servicesSequence.items.push(servicesDocument.createNode({ [name]: [] }));
      break;
    }
    case 'group.rename': {
      const group = getGroup(servicesDocument, target);
      const name = requireName(values.name, 'Group');
      const oldName = scalarValue(group.pair.key);
      if (YAML.isScalar(group.pair.key)) group.pair.key.value = name;
      settingsChanged = syncLayoutRename(settingsDocument, oldName, name);
      break;
    }
    case 'group.remove': {
      const group = getGroup(servicesDocument, target);
      const oldName = scalarValue(group.pair.key);
      servicesSequence.items.splice(group.index, 1);
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
      break;
    }
    default:
      throw new YamlTransformError('Unsupported preview edit operation');
  }

  const transformedFiles = {
    services: serializeDocument(servicesDocument, servicesText),
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
