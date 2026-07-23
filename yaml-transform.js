const YAML = require('yaml');

class YamlTransformError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'YamlTransformError';
    this.statusCode = statusCode;
  }
}

function formatYamlParseError(error) {
  const rawReason = String(error && (error.reason || error.message) || 'Invalid YAML')
    .split('\n')[0]
    .trim();
  const friendlyReasons = [
    [/DUPLICATE_KEY|map keys must be unique|duplicated mapping key/i, 'Duplicate mapping key. Each key in a YAML mapping must be unique. Rename or remove the duplicate key.'],
    [/BAD_INDENT|bad indentation/i, 'Invalid indentation. Align this key or list item with the surrounding YAML structure.'],
    [/TAB_AS_INDENT|tab.*indent/i, 'Tabs cannot be used for YAML indentation. Replace tabs with spaces.'],
    [/MISSING_CHAR|missing.*character/i, 'A YAML punctuation mark is missing. Check nearby colons, brackets, commas, and quotes.'],
    [/UNEXPECTED_TOKEN|unexpected token/i, 'Unexpected YAML content. Check the syntax near this location.']
  ];
  const matchedReason = friendlyReasons.find(([pattern]) => pattern.test(String(error && error.code || '')))
    || friendlyReasons.find(([pattern]) => pattern.test(rawReason));
  const summary = matchedReason
    ? matchedReason[1]
    : `${rawReason.charAt(0).toUpperCase()}${rawReason.slice(1)}${/[.!?]$/.test(rawReason) ? '' : '.'}`;
  const position = Array.isArray(error && error.linePos) ? error.linePos[0] : null;
  const location = position && Number.isInteger(position.line) && Number.isInteger(position.col)
    ? `at line ${position.line}, column ${position.col}`
    : '';
  return location ? `${summary} (${location})` : summary;
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
    throw new YamlTransformError(`${filename} is invalid: ${formatYamlParseError(document.errors[0])}`);
  }
  return document;
}

function scalarValue(node) {
  if (node === null || node === undefined) return '';
  if (YAML.isScalar(node)) return String(node.value ?? '');
  return ['string', 'number', 'boolean'].includes(typeof node) ? String(node) : '';
}

function preserveCommentBefore(sequence, index) {
  const item = sequence.items[index];
  if (!item) return null;
  const comment = item.commentBefore;
  if (comment) {
    item.commentBefore = undefined;
  }
  return comment || null;
}

function restoreCommentBefore(sequence, index, comment) {
  if (!comment) return;
  if (index < sequence.items.length) {
    const target = sequence.items[index];
    if (target.commentBefore) {
      target.commentBefore = comment + '\n' + target.commentBefore;
    } else {
      target.commentBefore = comment;
    }
  } else {
    if (sequence.comment) {
      sequence.comment = sequence.comment + '\n' + comment;
    } else {
      sequence.comment = comment;
    }
  }
}

function getMoveDestination(currentIndex, itemCount, operation, label) {
  if (Number.isInteger(operation.destinationIndex)) {
    if (operation.destinationIndex < 0 || operation.destinationIndex >= itemCount) {
      throw new YamlTransformError(`${label} move destination is outside the available list`);
    }
    return operation.destinationIndex;
  }
  if (!['up', 'down'].includes(operation.direction)) {
    throw new YamlTransformError(`${label} move direction must be "up" or "down"`);
  }
  return currentIndex + (operation.direction === 'up' ? -1 : 1);
}

function getSinglePair(mapNode, label) {
  if (!YAML.isMap(mapNode) || mapNode.items.length === 0) {
    throw new YamlTransformError(`${label} must be a YAML mapping with one name and its value`);
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
  throw new YamlTransformError(`${label} "${name}" was not found. It may have been renamed or removed; reload the directory and try again`);
}

function getServicesSequence(document) {
  if (document.contents === null) {
    document.contents = document.createNode([]);
  }
  if (!YAML.isSeq(document.contents)) {
    throw new YamlTransformError('services.yaml must be a YAML list of service groups');
  }
  return document.contents;
}

function getBookmarksSequence(document) {
  if (document.contents === null) {
    document.contents = document.createNode([]);
  }
  if (!YAML.isSeq(document.contents)) {
    throw new YamlTransformError('bookmarks.yaml must be a YAML list of bookmark groups');
  }
  return document.contents;
}

function getBookmarkGroup(document, target) {
  return findNamedSequenceItem(
    getBookmarksSequence(document),
    String(target.groupName || ''),
    Number(target.groupIndex) || 0,
    'Bookmark group'
  );
}

function getBookmarkEntries(group) {
  if (!YAML.isSeq(group.pair.value)) {
    throw new YamlTransformError(`Bookmark group "${scalarValue(group.pair.key)}" must be a YAML list of bookmarks`);
  }
  return group.pair.value;
}

function getBookmark(document, target) {
  const group = getBookmarkGroup(document, target);
  const bookmarks = getBookmarkEntries(group);
  const bookmark = findNamedSequenceItem(
    bookmarks,
    String(target.bookmarkName || ''),
    Number(target.bookmarkIndex) || 0,
    'Bookmark'
  );
  return { group, bookmark, bookmarks };
}

function assertUniqueBookmarkGroupName(bookmarksSequence, name, excludedIndex = -1) {
  const alreadyExists = bookmarksSequence.items.some((item, index) => (
    index !== excludedIndex && scalarValue(getSinglePair(item, 'Bookmark group').key) === name
  ));
  if (alreadyExists) {
    throw new YamlTransformError(`Bookmark group "${name}" already exists. Choose a different group name`);
  }
}

function setBookmarkFields(document, bookmarkPair, fields) {
  const normalizedFields = normalizeEditableFields(fields);
  let fieldMap = null;
  if (YAML.isMap(bookmarkPair.value)) {
    fieldMap = bookmarkPair.value;
  } else if (YAML.isSeq(bookmarkPair.value) && bookmarkPair.value.items.length > 0 && YAML.isMap(bookmarkPair.value.items[0])) {
    fieldMap = bookmarkPair.value.items[0];
  }

  if (!fieldMap) {
    fieldMap = document.createNode({});
    bookmarkPair.value = document.createNode([fieldMap]);
  }
  setMapFields(document, fieldMap, normalizedFields);
}

function createBookmarkValue(document, fields) {
  const fieldMap = document.createNode({});
  setMapFields(document, fieldMap, normalizeEditableFields(fields || []));
  return document.createNode([fieldMap]);
}

function getGroup(document, target) {
  return findNamedSequenceItem(
    getServicesSequence(document),
    String(target.groupName || ''),
    Number(target.groupIndex) || 0,
    'Service group'
  );
}

function assertUniqueGroupName(servicesSequence, name, excludedIndex = -1) {
  const alreadyExists = servicesSequence.items.some((item, index) => (
    index !== excludedIndex && scalarValue(getSinglePair(item, 'Service group').key) === name
  ));
  if (alreadyExists) {
    throw new YamlTransformError(`Group "${name}" already exists. Choose a different group name`);
  }
}

function resolveServiceSequence(document, target, { createIfMissing = false } = {}) {
  const group = getGroup(document, target);
  let sequence = group.pair.value;
  if (!YAML.isSeq(sequence)) {
    if (!createIfMissing) {
      throw new YamlTransformError(`Service group "${scalarValue(group.pair.key)}" must be a YAML list of services`);
    }
    sequence = document.createNode([]);
    group.pair.value = sequence;
  }
  if (!Array.isArray(target.nestedGroupPath) || target.nestedGroupPath.length === 0) {
    return sequence;
  }
  for (const step of target.nestedGroupPath) {
    const stepName = String(step && step.name || '');
    const stepIndex = Number(step && step.index) || 0;
    const nested = findNamedSequenceItem(sequence, stepName, stepIndex, 'Nested service group');
    let nestedSequence = nested.pair.value;
    if (!YAML.isSeq(nestedSequence)) {
      if (!createIfMissing) {
        throw new YamlTransformError(`Nested service group "${stepName}" must be a YAML list of services`);
      }
      nestedSequence = document.createNode([]);
      nested.pair.value = nestedSequence;
    }
    sequence = nestedSequence;
  }
  return sequence;
}

function findServiceGroupPair(servicesDocument, target) {
  if (Array.isArray(target.nestedGroupPath) && target.nestedGroupPath.length > 0) {
    const parentTarget = { ...target, nestedGroupPath: target.nestedGroupPath.slice(0, -1) };
    const parentSequence = resolveServiceSequence(servicesDocument, parentTarget);
    const lastStep = target.nestedGroupPath[target.nestedGroupPath.length - 1];
    const found = findNamedSequenceItem(
      parentSequence,
      String(lastStep && lastStep.name || ''),
      Number(lastStep && lastStep.index) || 0,
      'Nested service group'
    );
    return { pair: found.pair, index: found.index, parentSequence, isNested: true };
  }
  const group = getGroup(servicesDocument, target);
  return { pair: group.pair, index: group.index, parentSequence: getServicesSequence(servicesDocument), isNested: false };
}

function getServiceInPath(document, target) {
  const sequence = resolveServiceSequence(document, target);
  const service = findNamedSequenceItem(
    sequence,
    String(target.serviceName || ''),
    Number(target.serviceIndex) || 0,
    'Service'
  );
  return { service, services: sequence };
}

function requireName(value, label) {
  const name = String(value || '').trim();
  if (!name) {
    throw new YamlTransformError(`${label} name is required. Enter a name and try again`);
  }
  if (/\r|\n/.test(name)) {
    throw new YamlTransformError(`${label} name must be a single line. Remove the line break and try again`);
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
    throw new YamlTransformError('Preview options must be a YAML list');
  }
  const seen = new Set();
  return fields.map((field) => {
    const key = requireName(field && field.key, 'Option');
    if (seen.has(key)) {
      throw new YamlTransformError(`Option "${key}" is listed more than once. Keep only one row for each option`);
    }
    seen.add(key);
    if (Array.isArray(field && field.fields)) {
      return { key, fields: normalizeEditableFields(field.fields), ...(field.commented ? { commented: true } : {}) };
    }
    return {
      key,
      value: String((field && field.value) ?? ''),
      ...(field && field.textValue ? { textValue: true } : {}),
      ...(field && field.blankValue ? { blankValue: true } : {}),
      ...(field && field.commented ? { commented: true } : {})
    };
  });
}

function parseEditableValue(value, key) {
  if (value === '') return '';
  const document = YAML.parseDocument(value, { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new YamlTransformError(`Option "${key}" contains invalid YAML: ${formatYamlParseError(document.errors[0])}`);
  }
  return document.toJS();
}

function setMapFields(document, map, fields) {
  if (!YAML.isMap(map)) {
    throw new YamlTransformError('Preview options must use a YAML mapping of names and values');
  }

  // Save old items so we can preserve value-level and standalone key comments.
  const oldItemsByKey = new Map();
  for (const item of map.items) {
    oldItemsByKey.set(scalarValue(item.key), item);
  }

  // Build a fresh map containing only the active (uncommented) fields so the yaml
  // library handles value quoting, block-style nested maps, and nulls correctly.
  const activeFields = fields.filter((field) => !field.commented);
  const activeKeys = new Set(activeFields.map((field) => field.key));
  const activeMap = document.createNode({});
  for (const field of activeFields) {
    const { key, value, fields: nestedFields, textValue, blankValue } = field;
    if (nestedFields) {
      const oldItem = oldItemsByKey.get(key);
      const nestedMap = oldItem && YAML.isMap(oldItem.value) ? oldItem.value : document.createNode({});
      setMapFields(document, nestedMap, nestedFields);
      activeMap.set(key, nestedMap);
    } else if (blankValue) {
      const valueNode = document.createNode(null);
      valueNode.source = '';
      valueNode.type = YAML.Scalar.PLAIN;
      activeMap.set(key, valueNode);
    } else {
      activeMap.set(key, document.createNode(textValue ? value : parseEditableValue(value, key)));
    }
  }

  // Serialize the active map to a string at indent 0 and parse it back so we
  // get proper AST nodes with correct quoting and nested-map handling.
  const activeDoc = new YAML.Document(activeMap);
  let activeYaml = activeDoc.toString({ indent: 2 });
  if (!activeYaml.endsWith('\n')) activeYaml += '\n';
  const parsedActive = YAML.parseDocument(activeYaml, { keepSourceTokens: true, prettyErrors: true });
  if (parsedActive.errors.length > 0) {
    throw new YamlTransformError(`Preview options contain invalid YAML: ${formatYamlParseError(parsedActive.errors[0])}`);
  }

  // Build a map of commented fields by key so we can attach them at the correct
  // position based on the original field order.
  const commentedFields = fields.filter((field) => field.commented);
  const commentedFieldByKey = new Map();
  for (const field of commentedFields) {
    const { key, value, fields: nestedFields, textValue, blankValue } = field;
    let valueText;
    if (nestedFields) {
      // Serialize the nested structure with all fields treated as active so the
      // commented block preserves the full key-value map.
      const nestedMap = document.createNode({});
      for (const nf of nestedFields) {
        if (nf.fields) {
          const deepMap = document.createNode({});
          setMapFields(document, deepMap, nf.fields);
          nestedMap.set(nf.key, deepMap);
        } else if (nf.blankValue) {
          const valueNode = document.createNode(null);
          valueNode.source = '';
          valueNode.type = YAML.Scalar.PLAIN;
          nestedMap.set(nf.key, valueNode);
        } else {
          nestedMap.set(nf.key, document.createNode(nf.textValue ? nf.value : parseEditableValue(nf.value, nf.key)));
        }
      }
      const wrapperMap = document.createNode({});
      wrapperMap.set(key, nestedMap);
      const wrapperDoc = new YAML.Document(wrapperMap);
      valueText = wrapperDoc.toString({ indent: 2 }).replace(/\n$/, '');
      commentedFieldByKey.set(key, valueText);
    } else if (blankValue) {
      commentedFieldByKey.set(key, `${key}:`);
    } else {
      valueText = String(textValue ? value : parseEditableValue(String(value ?? ''), ''));
      commentedFieldByKey.set(key, `${key}:${valueText ? ` ${valueText}` : ''}`);
    }
  }

  // Preserve any existing map-level comments that do not belong to active fields.
  const existingComments = (map.comment || '').split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false;
    const uncommented = line.replace(/^\s*#\s?/, '').trim();
    const key = uncommented.split(':')[0];
    return !activeKeys.has(key);
  });

  // Determine which active keys will receive new commentBefore from commented
  // fields, so we know which keys are safe to preserve original commentBefore on.
  const keysReceivingNewCommentBefore = new Set();
  let hasPendingComments = false;
  for (const field of fields) {
    if (field.commented) {
      hasPendingComments = true;
      continue;
    }
    if (hasPendingComments) {
      keysReceivingNewCommentBefore.add(field.key);
      hasPendingComments = false;
    }
  }

  // Replace the map items with the active AST nodes.
  map.items = parsedActive.contents.items;
  map.comment = null;

  // Walk through fields in order and attach consecutive commented fields as
  // commentBefore on the next active item, or as a trailing map comment when
  // they appear after all active items.
  let pendingComments = [];
  const flushComments = (targetItem) => {
    if (pendingComments.length === 0) return;
    const commentText = pendingComments.map((c) => c.split('\n').map((line) => ` ${line}`).join('\n')).join('\n');
    if (targetItem && targetItem.key) {
      targetItem.key.commentBefore = targetItem.key.commentBefore
        ? targetItem.key.commentBefore + '\n' + commentText
        : commentText;
    } else {
      map.comment = map.comment ? map.comment + '\n' + commentText : commentText;
    }
    pendingComments = [];
  };

  for (const field of fields) {
    if (field.commented) {
      const text = commentedFieldByKey.get(field.key);
      if (text !== undefined) pendingComments.push(text);
      continue;
    }
    const item = map.items.find((i) => scalarValue(i.key) === field.key);
    flushComments(item);
  }
  flushComments(null);

  // Preserve original value-level and key-level comments for items that did not
  // receive a new commentBefore from commented fields.
  for (const item of map.items) {
    const key = scalarValue(item.key);
    const oldItem = oldItemsByKey.get(key);
    if (!oldItem) continue;
    if (!keysReceivingNewCommentBefore.has(key) && oldItem.key && oldItem.key.commentBefore) {
      item.key.commentBefore = oldItem.key.commentBefore;
    }
    if (oldItem.value && item.value) {
      if (oldItem.value.comment && !item.value.comment) {
        item.value.comment = oldItem.value.comment;
      }
      if (oldItem.value.commentBefore && !item.value.commentBefore) {
        item.value.commentBefore = oldItem.value.commentBefore;
      }
    }
  }

  // Append existing non-field comments to the map comment.
  for (const comment of existingComments) {
    const text = comment.trimStart().startsWith('#') ? comment.trimStart().slice(1).trimStart() : comment.trimStart();
    map.comment = map.comment ? map.comment + '\n ' + text : ' ' + text;
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

function getOrCreateLayoutMap(settingsDocument) {
  if (settingsDocument.contents === null) {
    settingsDocument.contents = settingsDocument.createNode({});
  }
  if (!YAML.isMap(settingsDocument.contents)) {
    throw new YamlTransformError('settings.yaml must be a YAML mapping of Homepage settings');
  }
  let layoutPair = findTopLevelMapPair(settingsDocument, 'layout');
  if (!layoutPair) {
    settingsDocument.contents.set('layout', settingsDocument.createNode({}));
    layoutPair = findTopLevelMapPair(settingsDocument, 'layout');
  }
  if (!YAML.isMap(layoutPair.value)) {
    throw new YamlTransformError('settings.yaml layout must be a YAML mapping of group names to layout options');
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

function getOrCreateGroupLayoutMap(settingsDocument, target) {
  const topLayoutMap = getOrCreateLayoutMap(settingsDocument);
  if (Array.isArray(target.nestedGroupPath) && target.nestedGroupPath.length > 0) {
    let parentEntry = findLayoutPair(topLayoutMap, target.groupName);
    if (!parentEntry) {
      topLayoutMap.set(target.groupName, settingsDocument.createNode({}));
      parentEntry = findLayoutPair(topLayoutMap, target.groupName);
    }
    if (!YAML.isMap(parentEntry.pair.value)) {
      parentEntry.pair.value = settingsDocument.createNode({});
    }
    return parentEntry.pair.value;
  }
  return topLayoutMap;
}

function syncLayoutRename(settingsDocument, oldName, newName, target) {
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap) return false;
  if (Array.isArray(target?.nestedGroupPath) && target.nestedGroupPath.length > 0) {
    const parentEntry = findLayoutPair(layoutMap, target.groupName);
    if (!parentEntry || !YAML.isMap(parentEntry.pair.value)) return false;
    // Check if the old name exists under the parent already
    let layoutEntry = findLayoutPair(parentEntry.pair.value, oldName);
    if (!layoutEntry) {
      // Not under parent yet — check top level (migration from old layout storage)
      const topLevelEntry = findLayoutPair(layoutMap, oldName);
      if (topLevelEntry) {
        // Move the entry from top level into the parent's map
        const [moved] = layoutMap.items.splice(topLevelEntry.index, 1);
        parentEntry.pair.value.items.push(moved);
        layoutEntry = findLayoutPair(parentEntry.pair.value, oldName);
      }
    }
    if (layoutEntry && YAML.isScalar(layoutEntry.pair.key)) {
      layoutEntry.pair.key.value = newName;
      return true;
    }
    return false;
  }
  const layoutEntry = findLayoutPair(layoutMap, oldName);
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

function findLastLayoutPairIndex(layoutMap, tabName) {
  for (let i = layoutMap.items.length - 1; i >= 0; i--) {
    if (getLayoutPairTab(layoutMap.items[i]) === tabName) return i;
  }
  return -1;
}

function addLayoutTab(settingsDocument, tabName, groupName, afterTab) {
  const layoutMap = getOrCreateLayoutMap(settingsDocument);
  if (getLayoutTabs(layoutMap).includes(tabName)) {
    throw new YamlTransformError(`Preview tab "${tabName}" already exists. Choose a different tab name`);
  }
  const layoutEntry = findLayoutPair(layoutMap, groupName);
  if (!layoutEntry) {
    const newPair = settingsDocument.createPair(groupName, settingsDocument.createNode({ tab: tabName }));
    const insertAt = afterTab
      ? (() => { const idx = findLastLayoutPairIndex(layoutMap, afterTab); return idx >= 0 ? idx + 1 : layoutMap.items.length; })()
      : layoutMap.items.length;
    layoutMap.items.splice(insertAt, 0, newPair);
    return;
  }
  if (layoutEntry.pair.value === null || YAML.isScalar(layoutEntry.pair.value) && layoutEntry.pair.value.value === null) {
    layoutEntry.pair.value = settingsDocument.createNode({});
  }
  if (!YAML.isMap(layoutEntry.pair.value)) {
    throw new YamlTransformError(`Layout group "${groupName}" must be a YAML mapping of layout options`);
  }
  layoutEntry.pair.value.set('tab', tabName);
}

function removeLayoutTab(settingsDocument, tabName) {
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap) {
    throw new YamlTransformError(`Preview tab "${tabName}" was not found. Check its name and try again`);
  }
  let changed = false;
  for (const pair of layoutMap.items) {
    if (getLayoutPairTab(pair) === tabName) {
      pair.value.delete('tab');
      changed = true;
    }
  }
  if (!changed) {
    throw new YamlTransformError(`Preview tab "${tabName}" was not found. Check its name and try again`);
  }
}

function renameLayoutTab(settingsDocument, oldTabName, newTabName) {
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap) {
    throw new YamlTransformError(`Preview tab "${oldTabName}" was not found. Check its name and try again`);
  }
  const tabs = getLayoutTabs(layoutMap);
  if (!tabs.includes(oldTabName)) {
    throw new YamlTransformError(`Preview tab "${oldTabName}" was not found. Check its name and try again`);
  }
  if (tabs.includes(newTabName) && newTabName !== oldTabName) {
    throw new YamlTransformError(`Preview tab "${newTabName}" already exists. Choose a different tab name`);
  }

  let changed = false;
  for (const pair of layoutMap.items) {
    if (!YAML.isMap(pair.value) || getLayoutPairTab(pair) !== oldTabName) {
      continue;
    }
    const tabPair = pair.value.items.find((item) => scalarValue(item.key) === 'tab');
    setScalarPairValue(settingsDocument, tabPair, newTabName);
    changed = true;
  }
  if (!changed) {
    throw new YamlTransformError(`Preview tab "${oldTabName}" was not found. Check its name and try again`);
  }
}

function moveLayoutTab(settingsDocument, tabName, operation) {
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap) {
    throw new YamlTransformError(`Preview tab "${tabName}" was not found. Check its name and try again`);
  }
  const tabs = getLayoutTabs(layoutMap);
  const tabIndex = tabs.indexOf(tabName);
  if (tabIndex === -1) {
    throw new YamlTransformError(`Preview tab "${tabName}" was not found. Check its name and try again`);
  }
  const destination = getMoveDestination(tabIndex, tabs.length, operation, 'Tab');
  if (destination < 0 || destination >= tabs.length) {
    throw new YamlTransformError(`Preview tab "${tabName}" cannot be moved farther`);
  }
  const movingPairs = layoutMap.items.filter((pair) => getLayoutPairTab(pair) === tabName);
  layoutMap.items = layoutMap.items.filter((pair) => getLayoutPairTab(pair) !== tabName);
  const destinationTab = tabs.filter((name) => name !== tabName)[destination];
  const insertionIndex = destinationTab
    ? layoutMap.items.findIndex((pair) => getLayoutPairTab(pair) === destinationTab)
    : layoutMap.items.length;
  layoutMap.items.splice(insertionIndex < 0 ? layoutMap.items.length : insertionIndex, 0, ...movingPairs);
}

function forceBlockStyle(node) {
  if (!node) return;
  if (YAML.isSeq(node)) {
    if (node.items.length > 0) node.flow = false;
    for (const item of node.items) forceBlockStyle(item);
  } else if (YAML.isMap(node)) {
    if (node.items.length > 0) node.flow = false;
    for (const item of node.items) {
      forceBlockStyle(item.key);
      forceBlockStyle(item.value);
    }
  } else if (YAML.isPair(node)) {
    forceBlockStyle(node.key);
    forceBlockStyle(node.value);
  }
}

function serializeDocument(document, originalText) {
  forceBlockStyle(document.contents);
  let output = document.toString({ indent: 2 });
  // Remove empty-map braces that precede a comment so all-commented options
  // serialize as clean commented lines instead of "{}" followed by comments.
  // Handles both block maps and list-item maps.
  output = output.replace(/(\n\s*)\{\}\s*(?:\n\s*)?(#[^\n]*)/g, '$1$2');
  output = output.replace(/(\n\s*-\s)\{\}\s*(?:\n\s*)?(#[^\n]*)/g, '$1$2');
  if (!String(originalText).endsWith('\n')) {
    output = output.replace(/\n$/, '');
  }
  if (String(originalText).includes('\r\n')) {
    output = output.replace(/\n/g, '\r\n');
  }
  return output;
}

function removeMapOptions(map, optionNames) {
  if (!YAML.isMap(map) || optionNames.size === 0) return false;
  const originalLength = map.items.length;
  map.items = map.items.filter((pair) => !optionNames.has(scalarValue(pair.key)));
  return map.items.length !== originalLength;
}

function removeServiceOptionDefinitions(servicesSequence, definitions) {
  const serviceOptions = new Set(definitions.filter((definition) => definition.appliesTo.includes('service')).map((definition) => definition.name));
  const widgetOptions = new Set(definitions.filter((definition) => definition.appliesTo.includes('widget')).map((definition) => definition.name));
  let changed = false;
  function visitEntries(entries) {
    if (!YAML.isSeq(entries)) return;
    entries.items.forEach((item) => {
      if (!YAML.isMap(item)) return;
      item.items.forEach((pair) => {
        if (YAML.isSeq(pair.value)) {
          visitEntries(pair.value);
          return;
        }
        if (!YAML.isMap(pair.value)) return;
        const serviceMap = pair.value;
        if (removeMapOptions(serviceMap, serviceOptions)) changed = true;
        const widgetPair = serviceMap.items.find((fieldPair) => scalarValue(fieldPair.key) === 'widget');
        if (widgetPair && removeMapOptions(widgetPair.value, widgetOptions)) changed = true;
      });
    });
  }
  visitEntries(servicesSequence);
  return changed;
}

function removeGroupOptionDefinitions(settingsDocument, definitions, servicesSequence, optionNames) {
  const groupOptions = new Set(definitions.filter((definition) => definition.appliesTo.includes('group')).map((definition) => definition.name));
  const allOptionNames = new Set([
    ...definitions.map((definition) => definition.name),
    ...(Array.isArray(optionNames) ? optionNames : [])
  ]);
  const layoutMap = getLayoutMap(settingsDocument);
  if (!layoutMap || groupOptions.size === 0) return false;
  let changed = false;
  const isFallbackNestedGroup = (map) => (
    YAML.isMap(map) &&
    map.items.length > 0 &&
    map.items.some((item) => groupOptions.has(scalarValue(item.key))) &&
    map.items.every((item) => {
      const name = scalarValue(item.key);
      return groupOptions.has(name) || allOptionNames.has(name);
    })
  );
  layoutMap.items.forEach((pair) => {
    if (removeMapOptions(pair.value, groupOptions)) changed = true;
    // Only descend into nested group layout entries (layout[parent][nested])
    if (YAML.isMap(pair.value) && YAML.isSeq(servicesSequence)) {
      const groupName = scalarValue(pair.key);
      const groupItem = servicesSequence.items.find((item) => {
        if (!YAML.isMap(item)) return false;
        const k = item.items[0]?.key;
        return k && scalarValue(k) === groupName;
      });
      const nestedNames = new Set();
      if (groupItem) {
        const groupValue = groupItem.items[0]?.value;
        if (YAML.isSeq(groupValue)) {
          groupValue.items.forEach((entry) => {
            if (!YAML.isMap(entry)) return;
            const v = entry.items[0]?.value;
            if (YAML.isSeq(v)) nestedNames.add(scalarValue(entry.items[0].key));
          });
        }
      }
      pair.value.items.forEach((nestedPair) => {
        // A nested group layout entry is always a map. Group options are
        // scalars (text, boolean, tab), so skip scalar entries.
        if (!YAML.isMap(nestedPair.value)) return;
        const key = scalarValue(nestedPair.key);
        // Skip known group option names — they are scalars, not nested groups.
        if (groupOptions.has(key)) return;
        // Only descend into entries that are actual nested groups (present
        // in the services sequence) or entries
        // whose value contains only known option keys and at least one group
        // option (commented-out nested groups). This avoids treating
        // map-valued options like customMapping.columns as nested groups.
        const isNestedGroup = nestedNames.has(key) || (!allOptionNames.has(key) && isFallbackNestedGroup(nestedPair.value));
        if (isNestedGroup && removeMapOptions(nestedPair.value, groupOptions)) changed = true;
      });
    }
  });
  return changed;
}

function removeBookmarkOptionDefinitions(bookmarksSequence, definitions) {
  const bookmarkOptions = new Set(definitions.filter((definition) => definition.appliesTo.includes('bookmark')).map((definition) => definition.name));
  if (bookmarkOptions.size === 0) return false;
  let changed = false;
  bookmarksSequence.items.forEach((groupItem) => {
    if (!YAML.isMap(groupItem)) return;
    groupItem.items.forEach((groupPair) => {
      if (!YAML.isSeq(groupPair.value)) return;
      groupPair.value.items.forEach((bookmarkItem) => {
        if (!YAML.isMap(bookmarkItem)) return;
        bookmarkItem.items.forEach((bookmarkPair) => {
          const bookmarkMap = YAML.isMap(bookmarkPair.value)
            ? bookmarkPair.value
            : YAML.isSeq(bookmarkPair.value) && YAML.isMap(bookmarkPair.value.items[0])
              ? bookmarkPair.value.items[0] : null;
          if (removeMapOptions(bookmarkMap, bookmarkOptions)) changed = true;
        });
      });
    });
  });
  return changed;
}

function transformPreviewYaml({ files, operation }) {
  if (!files || typeof files !== 'object' || !operation || typeof operation !== 'object') {
    throw new YamlTransformError('Preview edit request must include the current YAML files and an edit operation');
  }

  const servicesText = files.services;
  const settingsText = typeof files.settings === 'string' ? files.settings : '';
  const bookmarksText = typeof files.bookmarks === 'string' ? files.bookmarks : '';
  const servicesDocument = parseDocument(servicesText, 'services.yaml');
  const operationUsesLayout = ['group.add', 'group.edit', 'group.rename', 'group.remove', 'group.move', 'tab.add', 'tab.remove', 'tab.rename', 'tab.move', 'option-types.remove'].includes(operation.type);
  const settingsDocument = operationUsesLayout ? parseDocument(settingsText, 'settings.yaml') : null;
  const operationUsesBookmarks = [
    'bookmark-group.add',
    'bookmark-group.edit',
    'bookmark-group.remove',
    'bookmark-group.move',
    'bookmark.add',
    'bookmark.edit',
    'bookmark.remove',
    'bookmark.move',
    'option-types.remove'
  ].includes(operation.type);
  const bookmarksDocument = operationUsesBookmarks ? parseDocument(bookmarksText, 'bookmarks.yaml') : null;
  const servicesSequence = getServicesSequence(servicesDocument);
  const bookmarksSequence = operationUsesBookmarks ? getBookmarksSequence(bookmarksDocument) : null;
  const target = operation.target || {};
  const values = operation.values || {};
  let servicesChanged = false;
  let settingsChanged = false;
  let bookmarksChanged = false;

  switch (operation.type) {
    case 'option-types.remove': {
      if (!Array.isArray(operation.options)) {
        throw new YamlTransformError('Removed option types must be provided as a list');
      }
      const definitions = operation.options.map((definition) => ({
        name: requireName(definition && definition.name, 'Removed option'),
        appliesTo: Array.isArray(definition && definition.appliesTo)
          ? definition.appliesTo.map((targetName) => String(targetName)) : []
      }));
      servicesChanged = removeServiceOptionDefinitions(servicesSequence, definitions);
      settingsChanged = removeGroupOptionDefinitions(settingsDocument, definitions, servicesSequence, operation.allOptionNames);
      bookmarksChanged = removeBookmarkOptionDefinitions(bookmarksSequence, definitions);
      break;
    }
    case 'service.add': {
      const groupSequence = resolveServiceSequence(servicesDocument, target, { createIfMissing: true });
      const name = requireName(values.name, 'Service');
      if (Array.isArray(values.fields)) {
        const fields = normalizeEditableFields(values.fields).filter((field) => field.blankValue || field.value !== '');
        const serviceValue = servicesDocument.createNode({});
        setMapFields(servicesDocument, serviceValue, fields);
        const serviceItem = servicesDocument.createNode({});
        serviceItem.set(name, serviceValue);
        groupSequence.items.push(serviceItem);
      } else {
        const fields = {};
        for (const fieldName of ['href', 'description', 'icon']) {
          const value = String(values[fieldName] || '').trim();
          if (value) fields[fieldName] = value;
        }
        groupSequence.items.push(servicesDocument.createNode({ [name]: fields }));
      }
      servicesChanged = true;
      break;
    }
    case 'service.edit': {
      const { service, services: sourceServices } = getServiceInPath(servicesDocument, target);
      const name = requireName(values.name, 'Service');
      if (YAML.isScalar(service.pair.key)) service.pair.key.value = name;
      if (Array.isArray(values.fields)) {
        if (!YAML.isMap(service.pair.value)) service.pair.value = servicesDocument.createNode({});
        setMapFields(servicesDocument, service.pair.value, normalizeEditableFields(values.fields));
      } else {
        setServiceFields(servicesDocument, service.pair, values);
      }
      if (operation.destinationTarget) {
        const savedComment = preserveCommentBefore(sourceServices, service.index);
        const destinationSequence = resolveServiceSequence(servicesDocument, operation.destinationTarget, { createIfMissing: true });
        const [item] = sourceServices.items.splice(service.index, 1);
        destinationSequence.items.push(item);
        restoreCommentBefore(sourceServices, service.index, savedComment);
      }
      servicesChanged = true;
      break;
    }
    case 'service.remove': {
      const { service, services: sourceServices } = getServiceInPath(servicesDocument, target);
      const savedComment = preserveCommentBefore(sourceServices, service.index);
      sourceServices.items.splice(service.index, 1);
      restoreCommentBefore(sourceServices, service.index, savedComment);
      servicesChanged = true;
      break;
    }
    case 'service.duplicate': {
      const { service, services: sourceServices } = getServiceInPath(servicesDocument, target);
      const clonedItem = service.item.clone();
      const clonedPair = getSinglePair(clonedItem, 'Cloned service');
      const originalName = scalarValue(clonedPair.key);
      if (YAML.isScalar(clonedPair.key)) {
        clonedPair.key.value = originalName + ' (cloned)';
      }
      sourceServices.items.splice(service.index + 1, 0, clonedItem);
      servicesChanged = true;
      break;
    }
    case 'service.move': {
      const { service, services: sourceServices } = getServiceInPath(servicesDocument, target);
      const savedComment = preserveCommentBefore(sourceServices, service.index);
      const destinationTarget = operation.destinationTarget;
      if (destinationTarget) {
        const destinationSequence = resolveServiceSequence(servicesDocument, destinationTarget, { createIfMissing: true });
        const destination = Number(operation.destinationIndex);
        if (!Number.isInteger(destination) || destination < 0 || destination > destinationSequence.items.length) {
          throw new YamlTransformError('Service move destination is outside the target group');
        }
        const [item] = sourceServices.items.splice(service.index, 1);
        destinationSequence.items.splice(destination, 0, item);
      } else {
        const destination = getMoveDestination(service.index, sourceServices.items.length, operation, 'Service');
        if (destination < 0 || destination >= sourceServices.items.length) {
          throw new YamlTransformError(`Service "${target.serviceName}" is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} of the group and cannot be moved farther`);
        }
        const [item] = sourceServices.items.splice(service.index, 1);
        sourceServices.items.splice(destination, 0, item);
      }
      restoreCommentBefore(sourceServices, service.index, savedComment);
      servicesChanged = true;
      break;
    }
    case 'group.add': {
      const name = requireName(values.name, 'Group');
      assertUniqueGroupName(servicesSequence, name);
      servicesSequence.items.push(servicesDocument.createNode({ [name]: [] }));
      servicesChanged = true;
      if (Array.isArray(values.fields)) {
        const fields = normalizeEditableFields(values.fields).filter((field) => (
          Array.isArray(field.fields) ? field.fields.length > 0 : field.blankValue || field.value !== ''
        ));
        if (fields.length > 0) {
          const layoutMap = getOrCreateLayoutMap(settingsDocument);
          layoutMap.set(name, settingsDocument.createNode({}));
          const layoutEntry = findLayoutPair(layoutMap, name);
          setMapFields(settingsDocument, layoutEntry.pair.value, fields);
          settingsChanged = true;
        }
      }
      break;
    }
    case 'group.edit':
    case 'group.rename': {
      const found = findServiceGroupPair(servicesDocument, target);
      const name = requireName(values.name, 'Group');
      const oldName = scalarValue(found.pair.key);
      if (name !== oldName) {
        const siblingExists = found.parentSequence.items.some((item, index) => (
          index !== found.index && scalarValue(getSinglePair(item, 'Service group').key) === name
        ));
        if (siblingExists) {
          throw new YamlTransformError(`Group "${name}" already exists. Choose a different group name`);
        }
        if (findLayoutPair(getLayoutMap(settingsDocument), name)) {
          throw new YamlTransformError(`Group "${name}" already exists. Choose a different group name`);
        }
      }
      if (YAML.isScalar(found.pair.key)) found.pair.key.value = name;
      servicesChanged = true;
      settingsChanged = syncLayoutRename(settingsDocument, oldName, name, target);
      if (operation.type === 'group.edit' && Array.isArray(values.fields)) {
        const fields = normalizeEditableFields(values.fields);
        const layoutMap = getOrCreateGroupLayoutMap(settingsDocument, target);
        let layoutEntry = findLayoutPair(layoutMap, name);
        if (fields.length === 0) {
          if (layoutEntry) {
            layoutMap.items.splice(layoutEntry.index, 1);
            settingsChanged = true;
          }
        } else {
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
      const found = findServiceGroupPair(servicesDocument, target);
      const oldName = scalarValue(found.pair.key);
      const savedComment = preserveCommentBefore(found.parentSequence, found.index);
      found.parentSequence.items.splice(found.index, 1);
      restoreCommentBefore(found.parentSequence, found.index, savedComment);
      servicesChanged = true;
      if (found.isNested) {
        const topLayoutMap = getLayoutMap(settingsDocument);
        const parentEntry = topLayoutMap && findLayoutPair(topLayoutMap, target.groupName);
        if (parentEntry && YAML.isMap(parentEntry.pair.value)) {
          const layoutEntry = findLayoutPair(parentEntry.pair.value, oldName);
          if (layoutEntry) {
            parentEntry.pair.value.items.splice(layoutEntry.index, 1);
            settingsChanged = true;
          }
        }
        // Clean up any legacy top-level layout entry from buggy files,
        // but only if no top-level group has this name (avoid deleting an unrelated group's layout)
        const topLevelGroupExists = getServicesSequence(servicesDocument).items.some((item) => {
          if (!YAML.isMap(item)) return false;
          const k = item.items[0]?.key;
          return k && scalarValue(k) === oldName;
        });
        if (!topLevelGroupExists && syncLayoutRemove(settingsDocument, oldName)) settingsChanged = true;
      } else {
        settingsChanged = syncLayoutRemove(settingsDocument, oldName);
      }
      break;
    }
    case 'group.move': {
      const found = findServiceGroupPair(servicesDocument, target);
      const groupName = scalarValue(found.pair.key);
      const savedComment = preserveCommentBefore(found.parentSequence, found.index);
      const destination = getMoveDestination(found.index, found.parentSequence.items.length, operation, 'Group');
      if (destination < 0 || destination >= found.parentSequence.items.length) {
        throw new YamlTransformError(`Group "${groupName}" is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} and cannot be moved farther`);
      }
      if (!found.isNested) {
        const step = destination > found.index ? 1 : -1;
        for (let index = found.index + step; index !== destination + step; index += step) {
          const adjacentPair = getSinglePair(found.parentSequence.items[index], 'Service group');
          settingsChanged = syncLayoutMove(settingsDocument, groupName, scalarValue(adjacentPair.key)) || settingsChanged;
        }
      }
      const [item] = found.parentSequence.items.splice(found.index, 1);
      found.parentSequence.items.splice(destination, 0, item);
      restoreCommentBefore(found.parentSequence, found.index, savedComment);
      servicesChanged = true;
      break;
    }
    case 'group.convert-to-nested': {
      const sequence = resolveServiceSequence(servicesDocument, target, { createIfMissing: true });
      const directServiceItems = [];
      const existingNestedItems = [];
      sequence.items.forEach((item) => {
        const pair = getSinglePair(item, 'Service group');
        if (YAML.isSeq(pair.value)) {
          existingNestedItems.push(item);
        } else {
          directServiceItems.push(item);
        }
      });
      const newNestedValue = servicesDocument.createNode(directServiceItems);
      const newNestedItem = servicesDocument.createNode({});
      newNestedItem.set('1', newNestedValue);
      sequence.items = [...existingNestedItems, newNestedItem];
      servicesChanged = true;
      break;
    }
    case 'group.set-nested-count': {
      const count = Math.max(1, Math.min(12, Number(values.count) || 1));
      const sequence = resolveServiceSequence(servicesDocument, target, { createIfMissing: true });
      const directServiceItems = [];
      const nestedItems = [];
      sequence.items.forEach((item) => {
        const pair = getSinglePair(item, 'Service group');
        if (YAML.isSeq(pair.value)) {
          nestedItems.push(item);
        } else {
          directServiceItems.push(item);
        }
      });
      const keepCount = Math.min(count, nestedItems.length);
      for (let index = 0; index < keepCount; index++) {
        const pair = getSinglePair(nestedItems[index], 'Service group');
        if (YAML.isScalar(pair.key)) pair.key.value = String(index + 1);
      }
      if (nestedItems.length > count) {
        const lastKept = nestedItems[count - 1];
        const lastKeptPair = getSinglePair(lastKept, 'Service group');
        const lastKeptSeq = lastKeptPair && YAML.isSeq(lastKeptPair.value) ? lastKeptPair.value : null;
        if (lastKeptSeq) {
          for (let index = count; index < nestedItems.length; index++) {
            const removed = nestedItems[index];
            const removedPair = getSinglePair(removed, 'Service group');
            if (removedPair && YAML.isSeq(removedPair.value)) {
              removedPair.value.items.forEach((item) => lastKeptSeq.items.push(item));
            }
          }
        }
      }
      const newNestedItems = nestedItems.slice(0, count);
      for (let index = nestedItems.length; index < count; index++) {
        const newNested = servicesDocument.createNode({});
        newNested.set(String(index + 1), servicesDocument.createNode([]));
        newNestedItems.push(newNested);
      }
      sequence.items = [...directServiceItems, ...newNestedItems];
      servicesChanged = true;
      break;
    }
    case 'group.convert-from-nested': {
      const sequence = resolveServiceSequence(servicesDocument, target, { createIfMissing: true });
      const flatItems = [];
      sequence.items.forEach((item) => {
        const pair = getSinglePair(item, 'Service group');
        if (YAML.isSeq(pair.value)) {
          pair.value.items.forEach((nestedItem) => flatItems.push(nestedItem));
        } else {
          flatItems.push(item);
        }
      });
      sequence.items = flatItems;
      servicesChanged = true;
      break;
    }
    case 'bookmark-group.add': {
      const name = requireName(values.name, 'Bookmark group');
      assertUniqueBookmarkGroupName(bookmarksSequence, name);
      bookmarksSequence.items.push(bookmarksDocument.createNode({ [name]: [] }));
      bookmarksChanged = true;
      break;
    }
    case 'bookmark-group.edit': {
      const group = getBookmarkGroup(bookmarksDocument, target);
      const name = requireName(values.name, 'Bookmark group');
      const oldName = scalarValue(group.pair.key);
      if (name !== oldName) {
        assertUniqueBookmarkGroupName(bookmarksSequence, name, group.index);
        if (YAML.isScalar(group.pair.key)) group.pair.key.value = name;
      }
      bookmarksChanged = true;
      break;
    }
    case 'bookmark-group.remove': {
      const group = getBookmarkGroup(bookmarksDocument, target);
      const savedComment = preserveCommentBefore(bookmarksSequence, group.index);
      bookmarksSequence.items.splice(group.index, 1);
      restoreCommentBefore(bookmarksSequence, group.index, savedComment);
      bookmarksChanged = true;
      break;
    }
    case 'bookmark-group.move': {
      const group = getBookmarkGroup(bookmarksDocument, target);
      const savedComment = preserveCommentBefore(bookmarksSequence, group.index);
      const destination = getMoveDestination(group.index, bookmarksSequence.items.length, operation, 'Bookmark group');
      if (destination < 0 || destination >= bookmarksSequence.items.length) {
        throw new YamlTransformError(`Bookmark group "${target.groupName}" is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} and cannot be moved farther`);
      }
      const [item] = bookmarksSequence.items.splice(group.index, 1);
      bookmarksSequence.items.splice(destination, 0, item);
      restoreCommentBefore(bookmarksSequence, group.index, savedComment);
      bookmarksChanged = true;
      break;
    }
    case 'bookmark.add': {
      const group = getBookmarkGroup(bookmarksDocument, target);
      const bookmarks = getBookmarkEntries(group);
      const name = requireName(values.name, 'Bookmark');
      if (!Array.isArray(values.fields)) {
        throw new YamlTransformError('Bookmark options must be a YAML list');
      }
      const bookmarkItem = bookmarksDocument.createNode({});
      bookmarkItem.set(name, createBookmarkValue(bookmarksDocument, values.fields));
      bookmarks.items.push(bookmarkItem);
      bookmarksChanged = true;
      break;
    }
    case 'bookmark.edit': {
      const { bookmark } = getBookmark(bookmarksDocument, target);
      const name = requireName(values.name, 'Bookmark');
      if (!Array.isArray(values.fields)) {
        throw new YamlTransformError('Bookmark options must be a YAML list');
      }
      if (YAML.isScalar(bookmark.pair.key)) bookmark.pair.key.value = name;
      setBookmarkFields(bookmarksDocument, bookmark.pair, values.fields);
      bookmarksChanged = true;
      break;
    }
    case 'bookmark.remove': {
      const { bookmark, bookmarks } = getBookmark(bookmarksDocument, target);
      const savedComment = preserveCommentBefore(bookmarks, bookmark.index);
      bookmarks.items.splice(bookmark.index, 1);
      restoreCommentBefore(bookmarks, bookmark.index, savedComment);
      bookmarksChanged = true;
      break;
    }
    case 'bookmark.move': {
      const { bookmark, bookmarks: sourceBookmarks } = getBookmark(bookmarksDocument, target);
      const savedComment = preserveCommentBefore(sourceBookmarks, bookmark.index);
      const destinationTarget = operation.destinationTarget;
      if (destinationTarget) {
        const destinationGroup = getBookmarkGroup(bookmarksDocument, destinationTarget);
        const destinationBookmarks = getBookmarkEntries(destinationGroup);
        const destination = Number(operation.destinationIndex);
        if (!Number.isInteger(destination) || destination < 0 || destination > destinationBookmarks.items.length) {
          throw new YamlTransformError('Bookmark move destination is outside the target group');
        }
        const [item] = sourceBookmarks.items.splice(bookmark.index, 1);
        destinationBookmarks.items.splice(destination, 0, item);
      } else {
        const destination = getMoveDestination(bookmark.index, sourceBookmarks.items.length, operation, 'Bookmark');
        if (destination < 0 || destination >= sourceBookmarks.items.length) {
          throw new YamlTransformError(`Bookmark "${target.bookmarkName}" is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} of its group and cannot be moved farther`);
        }
        const [item] = sourceBookmarks.items.splice(bookmark.index, 1);
        sourceBookmarks.items.splice(destination, 0, item);
      }
      restoreCommentBefore(sourceBookmarks, bookmark.index, savedComment);
      bookmarksChanged = true;
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
          throw new YamlTransformError(`Group "${groupName}" already exists. Choose a different group name`);
        }
        servicesSequence.items.push(servicesDocument.createNode({ [groupName]: [] }));
        servicesChanged = true;
      } else if (!hasServiceGroup && !hasLayoutGroup) {
        throw new YamlTransformError(`Initial group "${groupName}" was not found. Choose an existing group or create a new one`);
      }
      addLayoutTab(settingsDocument, tabName, groupName, values.afterTab);
      settingsChanged = true;
      break;
    }
    case 'tab.remove': {
      const tabName = requireName(target.name, 'Tab');
      removeLayoutTab(settingsDocument, tabName);
      settingsChanged = true;
      break;
    }
    case 'tab.rename': {
      const oldTabName = requireName(target.name, 'Tab');
      const newTabName = requireName(values.name, 'Tab');
      renameLayoutTab(settingsDocument, oldTabName, newTabName);
      settingsChanged = true;
      break;
    }
    case 'tab.move': {
      const tabName = requireName(target.name, 'Tab');
      moveLayoutTab(settingsDocument, tabName, operation);
      settingsChanged = true;
      break;
    }
    default:
      throw new YamlTransformError(`Preview edit type "${operation.type || 'unknown'}" is not supported`);
  }

  const transformedFiles = {
    services: servicesChanged ? serializeDocument(servicesDocument, servicesText) : servicesText,
    settings: settingsChanged ? serializeDocument(settingsDocument, settingsText) : settingsText
  };
  if (operationUsesBookmarks || Object.prototype.hasOwnProperty.call(files, 'bookmarks')) {
    transformedFiles.bookmarks = bookmarksChanged ? serializeDocument(bookmarksDocument, bookmarksText) : bookmarksText;
  }
  parseDocument(transformedFiles.services, 'services.yaml');
  if (settingsChanged) parseDocument(transformedFiles.settings, 'settings.yaml');
  if (bookmarksChanged) parseDocument(transformedFiles.bookmarks, 'bookmarks.yaml');
  return { files: transformedFiles };
}

module.exports = {
  formatYamlParseError,
  YamlTransformError,
  transformPreviewYaml
};
