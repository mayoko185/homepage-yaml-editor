import { yamlCodeEditor, previewAddTabModal, saveStatusElement } from "./shared.js";
// Preview helper functions — YAML parsing, icon resolution, tab info, source navigation
import { configTabNames, sampleConfigs, blankSelectControlValue } from './constants.js';
import { currentTab, loadedFiles, loadedFileNames, parsedConfigCache, previewHomepageTab, previewUpdateTimer, sampleModeEnabled, previewShowCommentsState, pendingInlineRenameTab, previewUndoState, previewEditDialogState, previewEditPreviousFocus, previewEditPreviousFocusVisible, optionDefinitions, optionTypesDraft, activePreviewDrag, setParsedConfigCache, setPreviewHomepageTab, setPendingInlineRenameTab, setPreviewUpdateTimer, setPreviewUndoState, setLoadedFileContent, setApplyingPreviewFiles, setPreviewEditDialogState, setPreviewEditPreviousFocus, setPreviewEditPreviousFocusVisible, setOptionDefinitions, setActivePreviewDrag, mutatePreviewEditDialogState, mutateOptionTypesDraft } from './state.js';
import { getEditorValue, toggleLineRangeComments } from './editor.js';
import { addErrorGuidance, formatYamlError, formatYamlErrorLocation, transformPreviewYaml } from './api.js';
import { escapeHtml, setSaveStatus, setPreviewStatus, setPreviewEditModalStatus, syncPreviewEditModePresentation, findPreviewTabButton, enterTabRenameMode, getTabEditControls, showConfirmationDialog, updateUnsavedIndicators, readOptionTypesDraft, renderOptionTypesDraft, renderOptionDefaultsDraft, getOrderedOptionDefaultIndexes, setOptionDefaultOrder } from './ui.js';

export function getTabYamlText(tabName) {
    if (tabName === currentTab) {
        return getEditorValue();
    }
    const value = loadedFiles && Object.prototype.hasOwnProperty.call(loadedFiles, tabName)
        ? loadedFiles[tabName]
        : sampleConfigs[tabName];
    if (typeof value === 'string') {
        return value;
    }
    try {
        return jsyaml.dump(value || {});
    } catch (error) {
        return String(value || '');
    }
}

export function parseTabConfig(tabName) {
    const yamlText = getTabYamlText(tabName);
    const cached = parsedConfigCache.get(tabName);
    if (cached && cached.yamlText === yamlText) {
        return cached.result;
    }
    if (!yamlText || !yamlText.trim()) {
        const result = { data: null, error: null };
        setParsedConfigCache(tabName, { yamlText, result });
        return result;
    }
    try {
        const result = { data: jsyaml.load(yamlText), error: null };
        setParsedConfigCache(tabName, { yamlText, result });
        return result;
    } catch (error) {
        const yamlError = formatYamlError(error);
        const result = {
            data: null,
            error: yamlError
        };
        setParsedConfigCache(tabName, { yamlText, result });
        return result;
    }
}

export function getHomepageTabInfo(settingsData) {
    const tabs = [];
    const groupsByTab = {};
    const groupLayout = {};
    if (!settingsData || typeof settingsData !== 'object') {
        return { tabs, groupsByTab, groupLayout };
    }
    const layout = settingsData.layout;
    if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
        Object.entries(layout).forEach(([groupName, config]) => {
            if (config && typeof config === 'object') {
                groupLayout[groupName] = config;
            }
            if (config && typeof config === 'object' && typeof config.tab === 'string' && config.tab.trim()) {
                const tabName = config.tab.trim();
                if (!tabs.includes(tabName)) {
                    tabs.push(tabName);
                }
                if (!groupsByTab[tabName]) {
                    groupsByTab[tabName] = [];
                }
                groupsByTab[tabName].push(groupName);
            }
        });
    }
    if (tabs.length > 0) {
        return { tabs, groupsByTab, groupLayout };
    }
    const candidates = [settingsData.tabs, settingsData.tabbed, settingsData.views];
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        if (Array.isArray(candidate)) {
            candidate.forEach((item) => {
                const tabName = typeof item === 'string'
                    ? item
                    : item && typeof item === 'object'
                        ? item.name || item.label || item.title || Object.keys(item)[0]
                        : null;
                if (tabName && !tabs.includes(tabName)) {
                    tabs.push(tabName);
                }
            });
            break;
        }
        if (typeof candidate === 'object') {
            Object.keys(candidate).forEach((key) => {
                if (!tabs.includes(key)) {
                    tabs.push(key);
                }
            });
            break;
        }
    }
    return { tabs, groupsByTab, groupLayout };
}

export function isInitiallyCollapsed(layoutConfig) {
    if (!layoutConfig || typeof layoutConfig !== 'object') {
        return false;
    }
    return layoutConfig.initiallyCollapsed === true
        || String(layoutConfig.initiallyCollapsed).toLowerCase() === 'true';
}

export function isNestedServiceGroup(item) {
    const name = Object.keys(item || {})[0];
    return Boolean(name && Array.isArray(item[name]));
}

export function getNestedGroupColumns(layoutConfig) {
    return Math.max(1, Math.min(8, Number.parseInt(layoutConfig && layoutConfig.columns, 10) || 2));
}

export function resolveIconUrl(icon) {
    const iconName = String(icon || '').trim();
    if (!iconName) {
        return '';
    }
    if (/^https?:\/\//i.test(iconName)) {
        return iconName;
    }
    if (iconName.startsWith('/')) {
        return iconName;
    }

    const iconWithExtension = /\.[a-z0-9]+$/i.test(iconName)
        ? iconName
        : `${iconName}.png`;
    const extensionMatch = iconWithExtension.match(/\.([a-z0-9]+)$/i);
    const format = extensionMatch ? extensionMatch[1].toLowerCase() : 'png';
    const supportedFormat = ['png', 'svg', 'webp'].includes(format) ? format : 'png';
    const filename = iconWithExtension.split('/').map(encodeURIComponent).join('/');

    return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${supportedFormat}/${filename}`;
}

export function renderIcon(icon, label) {
    const iconUrl = resolveIconUrl(icon);
    if (!iconUrl) {
        return '';
    }
    return `<img class="dashboard-icon" src="${escapeHtml(iconUrl)}" alt="" title="${escapeHtml(label || '')}" loading="lazy" referrerpolicy="no-referrer">`;
}

export function getSafeLinkUrl(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '#';
    try {
        const url = new URL(rawValue, window.location.origin);
        return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
    } catch {
        return '#';
    }
}

export function getYamlLines(tabName) {
    return String(getTabYamlText(tabName) || '').replace(/\r\n/g, '\n').split('\n');
}

export function getYamlKeyFromLine(line) {
    const trimmed = String(line || '').trim();
    const withoutListMarker = trimmed.startsWith('- ') ? trimmed.slice(2).trimStart() : trimmed;
    const match = withoutListMarker.match(/^(['"]?)(.*?)\1\s*:/);
    return match ? match[2] : null;
}

export function getYamlIndent(line) {
    const match = String(line || '').match(/^\s*/);
    return match ? match[0].length : 0;
}

export function findYamlKeyLine(tabName, key, options = {}) {
    if (!key) {
        return 1;
    }

    const lines = getYamlLines(tabName);
    const startIndex = Math.max(0, (options.startLine || 1) - 1);
    const endIndex = Math.min(lines.length, options.endLine || lines.length);
    for (let index = startIndex; index < endIndex; index++) {
        if (getYamlKeyFromLine(lines[index]) === key) {
            return index + 1;
        }
    }
    return options.fallbackLine || 1;
}

export function findNthYamlListKeyLine(tabName, key, occurrenceIndex, options = {}) {
    const lines = getYamlLines(tabName);
    const startIndex = Math.max(0, (options.startLine || 1) - 1);
    const endIndex = Math.min(lines.length, options.endLine || lines.length);
    let seen = 0;

    for (let index = startIndex; index < endIndex; index++) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed.startsWith('- ')) {
            continue;
        }
        if (typeof options.indent === 'number' && getYamlIndent(line) !== options.indent) {
            continue;
        }
        if (typeof options.minIndent === 'number' && getYamlIndent(line) < options.minIndent) {
            continue;
        }
        if (getYamlKeyFromLine(line) === key) {
            if (seen === occurrenceIndex) {
                return index + 1;
            }
            seen++;
        }
    }

    return options.fallbackLine || findYamlKeyLine(tabName, key, options);
}

export function findGroupRangeFromLine(lines, startLine) {
    const groupIndex = Math.max(0, startLine - 1);
    const groupIndent = getYamlIndent(lines[groupIndex]);
    let endLine = lines.length;

    for (let index = groupIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        if (!line.trim() || line.trim().startsWith('#')) {
            continue;
        }
        if (getYamlIndent(line) <= groupIndent && line.trim().startsWith('- ') && getYamlKeyFromLine(line)) {
            endLine = index;
            break;
        }
    }

    return { startLine, endLine, groupIndent };
}

export function findYamlGroupRange(tabName, groupName, occurrenceIndex = 0) {
    const lines = getYamlLines(tabName);
    const groupLine = findNthYamlListKeyLine(tabName, groupName, occurrenceIndex, { indent: 0 });
    const range = findGroupRangeFromLine(lines, groupLine);
    return { startLine: range.startLine, endLine: range.endLine };
}

export function findNestedGroupPathRange(tabName, source) {
    const lines = getYamlLines(tabName);
    let groupLine = findNthYamlListKeyLine(tabName, source.groupName, source.groupIndex || 0, { indent: 0 });
    let range = findGroupRangeFromLine(lines, groupLine);
    if (Array.isArray(source.nestedGroupPath)) {
        for (const step of source.nestedGroupPath) {
            groupLine = findNthYamlListKeyLine(tabName, String(step && step.name || ''), Number(step && step.index) || 0, {
                startLine: groupLine + 1,
                endLine: range.endLine,
                minIndent: range.groupIndent + 1,
                fallbackLine: groupLine
            });
            range = findGroupRangeFromLine(lines, groupLine);
        }
    }
    return range;
}

export function findServicesGroupAtLine(lineIndex) {
    const lines = getYamlLines('services');
    const occurrenceCounts = new Map();
    let currentGroup = null;

    for (let index = 0; index <= Math.min(lineIndex, lines.length - 1); index++) {
        const line = lines[index];
        if (getYamlIndent(line) !== 0 || !line.trim().startsWith('- ')) {
            continue;
        }
        const groupName = getYamlKeyFromLine(line);
        if (!groupName) {
            continue;
        }
        const groupIndex = occurrenceCounts.get(groupName) || 0;
        occurrenceCounts.set(groupName, groupIndex + 1);
        currentGroup = { groupName, groupIndex };
    }

    return currentGroup;
}

export function findSettingsLayoutGroupAtLine(lineIndex) {
    const lines = getYamlLines('settings');
    const layoutLine = findYamlKeyLine('settings', 'layout');
    const layoutIndex = layoutLine - 1;
    if (getYamlKeyFromLine(lines[layoutIndex]) !== 'layout' || lineIndex <= layoutIndex) {
        return null;
    }

    const layoutIndent = getYamlIndent(lines[layoutIndex]);
    let layoutEndIndex = lines.length;
    for (let index = layoutIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        if (!line.trim() || line.trim().startsWith('#')) {
            continue;
        }
        if (getYamlIndent(line) <= layoutIndent && getYamlKeyFromLine(line)) {
            layoutEndIndex = index;
            break;
        }
    }
    if (lineIndex >= layoutEndIndex) {
        return null;
    }

    const groupLines = [];
    let groupIndent = null;
    for (let index = layoutIndex + 1; index < layoutEndIndex; index++) {
        const line = lines[index];
        const key = getYamlKeyFromLine(line);
        const indent = getYamlIndent(line);
        if (!key || indent <= layoutIndent || line.trim().startsWith('- ')) {
            continue;
        }
        if (groupIndent === null || indent < groupIndent) {
            groupIndent = indent;
        }
        groupLines.push({ index, indent, groupName: key });
    }

    let currentGroup = null;
    groupLines.forEach((group) => {
        if (group.indent === groupIndent && group.index <= lineIndex) {
            currentGroup = group.groupName;
        }
    });
    return currentGroup;
}

export function findNestedYamlKeyLine(tabName, parentKey, childKey, parentIndex = 0, childIndex = 0) {
    const range = findYamlGroupRange(tabName, parentKey, parentIndex);
    return findNthYamlListKeyLine(tabName, childKey, childIndex, {
        startLine: range.startLine + 1,
        endLine: range.endLine,
        minIndent: getYamlIndent(getYamlLines(tabName)[range.startLine - 1]) + 1,
        fallbackLine: range.startLine
    });
}

export function findLineContainingValue(tabName, value, options = {}) {
    if (!value) {
        return options.fallbackLine || 1;
    }
    const lines = getYamlLines(tabName);
    const startIndex = Math.max(0, (options.startLine || 1) - 1);
    const endIndex = Math.min(lines.length, options.endLine || lines.length);
    const target = String(value).trim().replace(/^['"]|['"]$/g, '');

    for (let index = startIndex; index < endIndex; index++) {
        const line = lines[index];
        const valuePart = line.includes(':') ? line.slice(line.indexOf(':') + 1).trim() : line.trim();
        if (valuePart.replace(/^['"]|['"]$/g, '') === target) {
            return index + 1;
        }
    }

    return options.fallbackLine || 1;
}

export function findSourceLine(source) {
    if (!source || !source.tab) {
        return 1;
    }

    if (source.commented === true && Number.isInteger(source.startLine)) {
        return source.startLine + 1;
    }

    if (source.kind === 'services-group') {
        if (Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0) {
            return findNestedGroupPathRange('services', source).startLine;
        }
        return findNthYamlListKeyLine('services', source.groupName, source.groupIndex || 0, { indent: 0 });
    }
    if (source.kind === 'service') {
        if (Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0) {
            const range = findNestedGroupPathRange('services', source);
            return findNthYamlListKeyLine('services', source.serviceName, source.serviceIndex || 0, {
                startLine: range.startLine + 1,
                endLine: range.endLine,
                minIndent: range.groupIndent + 1,
                fallbackLine: range.startLine
            });
        }
        return findNestedYamlKeyLine('services', source.groupName, source.serviceName, source.groupIndex || 0, source.serviceIndex || 0);
    }
    if (source.kind === 'bookmark-group') {
        return findNthYamlListKeyLine('bookmarks', source.groupName, source.groupIndex || 0, { indent: 0 });
    }
    if (source.kind === 'bookmark') {
        return findNestedYamlKeyLine('bookmarks', source.groupName, source.bookmarkName, source.groupIndex || 0, source.bookmarkIndex || 0);
    }
    if (source.kind === 'widget') {
        return source.isList
            ? findNthYamlListKeyLine('widgets', source.name, source.index || 0, { indent: 0 })
            : findYamlKeyLine('widgets', source.name);
    }
    if (source.kind === 'settings-key') {
        return findYamlKeyLine('settings', source.key);
    }
    if (source.kind === 'settings-layout-group') {
        const layoutLine = findYamlKeyLine('settings', 'layout');
        return findYamlKeyLine('settings', source.groupName, {
            startLine: layoutLine,
            fallbackLine: layoutLine
        });
    }
    if (source.kind === 'settings-tab') {
        const layoutLine = findYamlKeyLine('settings', 'layout');
        return findLineContainingValue('settings', source.name, {
            startLine: layoutLine,
            fallbackLine: layoutLine
        });
    }
    return source.line || 1;
}

export function findBlockLineRange(source) {
    if (!source || !source.tab) return null;
    if (source.commented === true && Number.isInteger(source.startLine) && Number.isInteger(source.endLine)) {
        return { startLine: source.startLine, endLine: source.endLine };
    }
    const yamlText = getTabYamlText(source.tab);
    if (!yamlText) return null;
    const startLine1Based = findSourceLine(source);
    if (!startLine1Based || startLine1Based < 1) return null;
    const lines = yamlText.split('\n');
    const startIdx = startLine1Based - 1;
    if (startIdx < 0 || startIdx >= lines.length) return null;
    const startIndent = lines[startIdx].search(/\S/);
    if (startIndent < 0) return { startLine: startIdx, endLine: startIdx };

    for (let i = startIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const indent = line.search(/\S/);
        if (source.kind === 'widget' && !source.isList) {
            if (indent <= startIndent) return { startLine: startIdx, endLine: i - 1 };
        } else if (indent <= startIndent && (line.trim().startsWith('- ') || line.trim().startsWith('#'))) {
            return { startLine: startIdx, endLine: i - 1 };
        }
    }
    return { startLine: startIdx, endLine: lines.length - 1 };
}

export function getSourceAttributes(source) {
    return `data-source="${escapeHtml(JSON.stringify(source))}"`;
}

export function getDragItemAttributes(kind, source, index, scope = '') {
    return `draggable="true" data-preview-drag-item data-preview-drag-kind="${escapeHtml(kind)}" data-preview-drag-index="${index}" data-preview-drag-scope="${escapeHtml(scope)}" data-preview-drag-source="${escapeHtml(JSON.stringify(source || {}))}"`;
}

export function takeOccurrence(counter, name) {
    if (!counter.has(name)) {
        counter.set(name, 0);
    }
    const current = counter.get(name);
    counter.set(name, current + 1);
    return current;
}

export function formatPreviewTooltipLabel(key) {
    if (String(key).toLowerCase() === 'href') {
        return 'URL';
    }
    return String(key)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());
}

export function formatPreviewTooltipValue(value) {
    if (value === null || value === undefined || value === '') {
        return '';
    }
    if (Array.isArray(value)) {
        return value.map((item) => item && typeof item === 'object'
            ? Object.keys(item).join(', ')
            : String(item)).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') {
        return value.type ? String(value.type) : Object.keys(value).join(', ');
    }
    return String(value);
}

export function getPreviewDetailLines(data, keys, limit = 6) {
    if (!data || typeof data !== 'object') {
        return [];
    }
    return keys
        .filter((key) => !/(?:password|secret|token|api.?key|username)/i.test(key))
        .map((key) => [key, formatPreviewTooltipValue(data[key])])
        .filter(([, value]) => value)
        .slice(0, limit)
        .map(([key, value]) => `${formatPreviewTooltipLabel(key)}: ${value}`);
}

export function getPreviewTooltipAttributes(lines, { focusable = true } = {}) {
    const cleanLines = lines.map((line) => String(line || '').trim()).filter(Boolean);
    const tooltip = escapeHtml(cleanLines.join('\n')).replace(/\n/g, '&#10;');
    const ariaLabel = escapeHtml(cleanLines.join('. '));
    return `data-preview-tooltip="${tooltip}" aria-label="${ariaLabel}"${focusable ? ' tabindex="0"' : ''}`;
}

export function getBookmarkTooltipLines(name, data) {
    const lines = [`Group: ${name}`];
    const entries = Array.isArray(data) ? data : [];
    entries.slice(0, 5).forEach((entry) => {
        const entryName = Object.keys(entry || {})[0];
        if (!entryName) {
            return;
        }
        lines.push(entryName);
    });
    return lines;
}

export function getCurrentTabSource(source) {
    if (!source || typeof source !== 'object') {
        return source;
    }
    if (currentTab === 'settings' && source.settingsSource) {
        return source.settingsSource;
    }
    if (source.servicesSource) {
        return source.servicesSource;
    }
    return source;
}

export function getPreviewEditActionButton(action, source, label, icon, { disabled = false, danger = false } = {}) {
    const dangerClass = danger ? ' preview-edit-delete' : '';
    const actionClass = action.endsWith('.edit')
        ? ' preview-edit-modify'
        : action.endsWith('.comment')
            ? ' preview-edit-comment'
            : action.endsWith('.move-up')
                ? ' preview-edit-move-up'
                : action.endsWith('.move-down')
                    ? ' preview-edit-move-down'
                    : action.endsWith('.duplicate')
                        ? ' preview-edit-duplicate'
                        : '';
    return `<button type="button" class="preview-edit-action${dangerClass}${actionClass}" data-preview-action="${escapeHtml(action)}" ${getSourceAttributes(source)} aria-label="${escapeHtml(label)}"${disabled ? ' disabled' : ''}>${icon}<span class="preview-control-label preview-edit-action-label" aria-hidden="true">${escapeHtml(label)}</span></button>`;
}

export function getGroupEditControls(source, position, groupCount) {
    const isCommented = source.commented === true;
    return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('group.edit', source, 'Edit group', '&#9998;')}
                ${isCommented ? '' : getPreviewEditActionButton('group.move-up', source, 'Move group up', '&uarr;', { disabled: position === 0 })}
                ${isCommented ? '' : getPreviewEditActionButton('group.move-down', source, 'Move group down', '&darr;', { disabled: position === groupCount - 1 })}
                <span class="preview-edit-actions-secondary">
                    ${getPreviewEditActionButton('group.comment', source, 'Comment/uncomment group', '#')}
                    ${getPreviewEditActionButton('group.remove', source, 'Delete group', '&times;', { danger: true })}
                </span>
            </span>`;
}

export function getServiceEditControls(source, position, serviceCount) {
    const isCommented = source.commented === true;
    return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('service.edit', source, 'Edit service', '&#9998;')}
                <span class="preview-edit-actions-secondary">
                    ${getPreviewEditActionButton('service.comment', source, 'Comment/uncomment service', '#')}
                    ${getPreviewEditActionButton('service.duplicate', source, 'Duplicate service', '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9"/><rect x="2" y="2" width="9" height="9"/></svg>')}
                    ${isCommented ? '' : getPreviewEditActionButton('service.move-up', source, 'Move service up', '&uarr;', { disabled: position === 0 })}
                    ${isCommented ? '' : getPreviewEditActionButton('service.move-down', source, 'Move service down', '&darr;', { disabled: position === serviceCount - 1 })}
                    ${getPreviewEditActionButton('service.remove', source, 'Delete service', '&times;', { danger: true })}
                </span>
            </span>`;
}

export function getBookmarkGroupEditControls(source, position, groupCount) {
    return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('bookmark-group.edit', source, 'Edit bookmark group', '&#9998;')}
                <span class="preview-edit-actions-secondary">
                    ${getPreviewEditActionButton('bookmark-group.comment', source, 'Comment/uncomment bookmark group', '#')}
                    ${getPreviewEditActionButton('bookmark-group.move-up', source, 'Move bookmark group up', '&uarr;', { disabled: position === 0 })}
                    ${getPreviewEditActionButton('bookmark-group.move-down', source, 'Move bookmark group down', '&darr;', { disabled: position === groupCount - 1 })}
                    ${getPreviewEditActionButton('bookmark-group.remove', source, 'Delete bookmark group', '&times;', { danger: true })}
                </span>
            </span>`;
}

export function getBookmarkEditControls(source, position, bookmarkCount) {
    return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('bookmark.edit', source, 'Edit bookmark', '&#9998;')}
                <span class="preview-edit-actions-secondary">
                    ${getPreviewEditActionButton('bookmark.comment', source, 'Comment/uncomment bookmark', '#')}
                    ${getPreviewEditActionButton('bookmark.move-up', source, 'Move bookmark up', '&uarr;', { disabled: position === 0 })}
                    ${getPreviewEditActionButton('bookmark.move-down', source, 'Move bookmark down', '&darr;', { disabled: position === bookmarkCount - 1 })}
                    ${getPreviewEditActionButton('bookmark.remove', source, 'Delete bookmark', '&times;', { danger: true })}
                </span>
            </span>`;
}

export function extractCommentedLines(yamlText) {
    if (!yamlText || typeof yamlText !== 'string') return [];
    const lines = yamlText.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        let match = line.match(/^(\s*)#\s*(-\s+\S[\S\s]*?:)\s*$/);
        if (!match) {
            const mapMatch = line.match(/^(\s*)#\s*(\S[\S\s]*?:)\s*$/);
            if (mapMatch) {
                const contentAfterHash = line.slice(line.indexOf('#') + 1).trimStart();
                if (!contentAfterHash.startsWith('- ')) match = mapMatch;
            }
        }

        if (match) {
            const indent = match[1].length;
            const blockStart = i;
            const isListItem = /^\s*#\s*-\s+\S/.test(line);
            const uncommentedLines = [match[1] + match[2]];
            i++;
            while (i < lines.length) {
                const next = lines[i];
                const hashPos = next.indexOf('#');
                if (hashPos < 0 || hashPos < indent) break;
                if (i > blockStart && hashPos === indent) {
                    const afterHash = next.slice(hashPos + 1);
                    const stripped = afterHash.startsWith(' ') ? afterHash.slice(1) : afterHash;
                    if (stripped.startsWith('- ')) break;
                }
                const beforeHash = next.slice(0, hashPos);
                let afterHash = next.slice(hashPos + 1);
                if (afterHash.startsWith(' ')) afterHash = afterHash.slice(1);
                uncommentedLines.push(beforeHash + afterHash);
                i++;
            }

            try {
                const parsed = jsyaml.load(uncommentedLines.join('\n'));
                if (parsed !== null && parsed !== undefined && parsed !== '') {
                    blocks.push({ parsed, startLine: blockStart, endLine: i - 1, indent, isListItem });
                }
            } catch {
                // Ignore comments that are not complete YAML entries.
            }
        } else {
            i++;
        }
    }

    return blocks;
}

export function buildCommentedServicesData(yamlText, activeServices) {
    const blocks = extractCommentedLines(yamlText);
    if (blocks.length === 0) return { groups: [], servicesMap: new Map(), nestedServicesMap: new Map() };

    const groupOccurrenceCounter = new Map();
    const activeGroupInfo = activeServices.map((group) => {
        const name = Object.keys(group || {})[0] || '';
        const idx = groupOccurrenceCounter.get(name) || 0;
        groupOccurrenceCounter.set(name, idx + 1);
        return { name, idx };
    });
    const commentedGroups = [];
    const commentedServicesMap = new Map();
    const nestedServicesMap = new Map();

    blocks.forEach((block) => {
        if (block.isListItem !== true) return;
        const entry = Array.isArray(block.parsed) ? block.parsed[0] : block.parsed;
        if (!entry || typeof entry !== 'object') return;
        const entryName = Object.keys(entry)[0];
        if (!entryName) return;

        if (block.indent === 0) {
            const groupEntry = {};
            const innerData = entry[entryName];
            groupEntry[entryName] = Array.isArray(innerData) ? markDeepCommented(innerData) : innerData;
            groupEntry.__commented = true;
            groupEntry.__commentedStartLine = block.startLine;
            groupEntry.__commentedEndLine = block.endLine;
            commentedGroups.push(groupEntry);
            return;
        }

        const lines = yamlText.split('\n');
        const ancestors = [];
        let currentIndent = block.indent;
        for (let j = block.startLine - 1; j >= 0; j--) {
            const match = lines[j].match(/^(\s*)-\s+(\S.*?):\s*$/);
            if (match && match[1].length < currentIndent && match[2].trim()) {
                ancestors.unshift({ name: match[2].trim(), indent: match[1].length, line: j });
                currentIndent = match[1].length;
                if (match[1].length === 0) break;
            }
        }
        if (ancestors.length === 0) return;

        const topParent = ancestors[0];
        const parentName = ancestors[ancestors.length - 1].name;
        let parentOccurrence = 0;
        for (let j = block.startLine - 1; j >= 0; j--) {
            const match = lines[j].match(/^(\s*)-\s+(\S.*?):\s*$/);
            if (match && match[1].length === 0 && match[2].trim() === topParent.name) parentOccurrence++;
        }

        const lineInfo = { __commentedStartLine: block.startLine, __commentedEndLine: block.endLine };
        const innerValue = entry[entryName];
        const isNestedGroup = Array.isArray(innerValue);
        const commentedEntry = isNestedGroup
            ? { [entryName]: markDeepCommented(innerValue), __commented: true, ...lineInfo }
            : { [entryName]: entry[entryName], __commented: true, ...lineInfo };

        if (ancestors.length === 1) {
            const matchedIdx = activeGroupInfo.findIndex((info) => info.name === parentName && info.idx === parentOccurrence - 1);
            if (matchedIdx >= 0) {
                if (!commentedServicesMap.has(matchedIdx)) commentedServicesMap.set(matchedIdx, []);
                commentedServicesMap.get(matchedIdx).push(commentedEntry);
            } else {
                const parentGroup = commentedGroups.find((group) => Object.keys(group)[0] === parentName);
                if (parentGroup) {
                    if (!Array.isArray(parentGroup[parentName])) parentGroup[parentName] = [];
                    parentGroup[parentName].push(commentedEntry);
                }
            }
            return;
        }

        const matchedIdx = activeGroupInfo.findIndex((info) => info.name === topParent.name && info.idx === parentOccurrence - 1);
        if (matchedIdx >= 0) {
            const nestedPath = [];
            for (let p = 1; p < ancestors.length; p++) {
                const stepName = ancestors[p].name;
                const parentLine = ancestors[p - 1].line;
                let stepOccurrence = 0;
                for (let q = parentLine; q <= block.startLine; q++) {
                    const match = lines[q].match(/^(\s*)-\s+(\S.*?):\s*$/);
                    if (match && match[1].length === ancestors[p].indent && match[2].trim() === stepName) stepOccurrence++;
                }
                nestedPath.push({ name: stepName, index: stepOccurrence - 1 });
            }
            const key = `${matchedIdx}:${nestedPath.map((step) => `${step.name}[${step.index}]`).join('/')}`;
            if (!nestedServicesMap.has(key)) nestedServicesMap.set(key, []);
            nestedServicesMap.get(key).push(commentedEntry);
        } else {
            const parentGroup = commentedGroups.find((group) => Object.keys(group)[0] === topParent.name);
            if (parentGroup) {
                if (!Array.isArray(parentGroup[topParent.name])) parentGroup[topParent.name] = [];
                parentGroup[topParent.name].push(commentedEntry);
            }
        }
    });

    return { groups: commentedGroups, servicesMap: commentedServicesMap, nestedServicesMap };
}

export function normalizeCommentedChunkLines(rawLines) {
    return rawLines.map((line) => {
        if (!line || line.trim() === '') return line;
        const hashPos = line.indexOf('#');
        if (hashPos < 0) return line;
        let content = line.slice(hashPos + 1);
        if (content.startsWith(' ')) content = content.slice(1);
        const contentIndent = content.match(/^\s*/)?.[0].length || 0;
        return ' '.repeat(hashPos + contentIndent) + content.trimStart();
    });
}

export function parseCommentedChunkEntry(entry, startLine, endLine) {
    const parsedLines = normalizeCommentedChunkLines(entry.rawLines);
    let parsed = null;
    try {
        parsed = jsyaml.load(parsedLines.join('\n'));
    } catch {
        return null;
    }
    const document = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!document || typeof document !== 'object') return null;
    const name = entry.name || Object.keys(document)[0];
    if (!name) return null;
    const value = document[name];
    return {
        [name]: Array.isArray(value) ? markDeepCommented(value) : value,
        __commented: true,
        __commentedStartLine: startLine,
        __commentedEndLine: endLine
    };
}

export function buildServicesPreviewDataFromChunks(yamlText, activeServices) {
    if (typeof ChunkTree === 'undefined') return activeServices;
    const chunks = ChunkTree.parseServicesDocument(yamlText);
    if (!Array.isArray(chunks)) return activeServices;

    const result = [];
    let activeGroupIndex = 0;
    let lineCursor = 0;
    const lines = yamlText.split('\n');

    chunks.forEach((chunk) => {
        while (lineCursor < lines.length && lines[lineCursor].trim() === '') lineCursor++;
        const chunkStartLine = lineCursor;
        lineCursor += Array.isArray(chunk.rawLines) ? chunk.rawLines.length : 0;

        if (chunk.kind === 'commented-group') {
            const entries = [];
            let entryLine = chunkStartLine + 1;
            (chunk.entries || []).forEach((entry) => {
                const entryStartLine = entryLine;
                entryLine += Array.isArray(entry.rawLines) ? entry.rawLines.length : 0;
                if (!entry.kind.startsWith('commented-')) return;
                const rawLines = entry.rawLines || [];
                let actualStartLine = entryStartLine;
                for (let k = 0; k < rawLines.length; k++) {
                    if (rawLines[k].trim() !== '') {
                        actualStartLine = entryStartLine + k;
                        break;
                    }
                }
                const parsedEntry = parseCommentedChunkEntry(entry, actualStartLine, entryLine - 1);
                if (parsedEntry) entries.push(parsedEntry);
            });
            result.push({
                [chunk.name]: entries,
                __commented: true,
                __commentedStartLine: chunkStartLine,
                __commentedEndLine: lineCursor - 1
            });
            return;
        }

        if (chunk.kind !== 'group') return;
        const activeGroup = activeServices[activeGroupIndex++];
        if (!activeGroup) return;
        const groupName = Object.keys(activeGroup)[0];
        if (!groupName) {
            result.push(activeGroup);
            return;
        }

        const activeEntries = Array.isArray(activeGroup[groupName]) ? activeGroup[groupName] : [];
        const mergedEntries = [];
        let activeEntryIndex = 0;
        let entryLine = chunkStartLine + 1;
        (chunk.entries || []).forEach((entry) => {
            const entryStartLine = entryLine;
            entryLine += Array.isArray(entry.rawLines) ? entry.rawLines.length : 0;
            if (entry.kind.startsWith('commented-')) {
                const rawLines = entry.rawLines || [];
                let actualStartLine = entryStartLine;
                for (let k = 0; k < rawLines.length; k++) {
                    if (rawLines[k].trim() !== '') {
                        actualStartLine = entryStartLine + k;
                        break;
                    }
                }
                const parsedEntry = parseCommentedChunkEntry(entry, actualStartLine, entryStartLine + rawLines.length - 1);
                if (parsedEntry) mergedEntries.push(parsedEntry);
            } else if (entry.kind !== 'comment') {
                const activeEntry = activeEntries[activeEntryIndex++];
                if (activeEntry) mergedEntries.push(activeEntry);
            }
        });
        while (activeEntryIndex < activeEntries.length) mergedEntries.push(activeEntries[activeEntryIndex++]);
        result.push({ [groupName]: mergedEntries });
    });

    return result;
}

export function buildCommentedWidgetsData(yamlText) {
    const blocks = extractCommentedLines(yamlText);
    if (blocks.length === 0) return [];
    const result = [];
    blocks.forEach((block) => {
        if (block.indent !== 0) return;
        const entry = Array.isArray(block.parsed) ? block.parsed[0] : block.parsed;
        if (!entry || typeof entry !== 'object') return;
        const name = Object.keys(entry)[0];
        if (!name) return;
        result.push({ [name]: entry[name], __commented: true, __commentedStartLine: block.startLine, __commentedEndLine: block.endLine });
    });
    return result;
}

        function toggleCommentBlock(source) {
            const resolvedSource = getCurrentTabSource(source);
            const tabName = resolvedSource && resolvedSource.tab ? resolvedSource.tab : currentTab;
            const range = findBlockLineRange(resolvedSource);
            if (!range || range.startLine < 0 || range.endLine < range.startLine) {
                setSaveStatus('Could not locate the YAML block to comment/uncomment.', 'error');
                return;
            }
            if (tabName !== currentTab) {
                document.querySelector(`.tab[data-tab="${tabName}"]`)?.click();
            }
            const isCommented = resolvedSource && resolvedSource.commented === true;
            toggleLineRangeComments(yamlCodeEditor, range.startLine, range.endLine, isCommented);
            updateUnsavedIndicators();
            updatePreview({ force: true });
            setSaveStatus(isCommented ? 'Item uncommented.' : 'Item commented out.', 'success');
        }

        // --- Commented-item text transforms for Preview edit operations ---

        function getTabYamlLines(tabName) {
            return getTabYamlText(tabName).split('\n');
        }

        function replaceTabYamlText(tabName, newText) {
            setLoadedFileContent(tabName, newText);
            if (tabName === currentTab) {
                yamlCodeEditor.operation(() => {
                    const lastLine = Math.max(0, yamlCodeEditor.lineCount() - 1);
                    const lastCharacter = (yamlCodeEditor.getLine(lastLine) || '').length;
                    yamlCodeEditor.replaceRange(newText, { line: 0, ch: 0 }, { line: lastLine, ch: lastCharacter }, '+commentedPreviewEdit');
                });
            }
            updateUnsavedIndicators();
            updatePreview({ force: true });
        }

        function parseCommentedBlockData(source) {
            const range = findBlockLineRange(source);
            if (!range) return null;
            const lines = getTabYamlLines(source.tab);
            const uncommentedLines = lines.slice(range.startLine, range.endLine + 1).map((line) => {
                const match = line.match(/^(\s*)# ?(.*)$/);
                if (!match) return line;
                return match[1] + match[2];
            });
            try {
                const parsed = jsyaml.load(uncommentedLines.join('\n'));
                if (parsed === null || parsed === undefined || parsed === '') return null;
                const entry = Array.isArray(parsed) ? parsed[0] : parsed;
                if (!entry || typeof entry !== 'object') return null;
                const name = Object.keys(entry)[0];
                return name ? { name, data: entry[name] } : null;
            } catch (e) {
                return null;
            }
        }

        function serializeCommentedBlock(name, data, baseIndent) {
            const indent = ' '.repeat(baseIndent);
            const childIndent = ' '.repeat(baseIndent + 2);
            const lines = [`${indent}- ${name}:`];
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                Object.entries(data).forEach(([key, value]) => {
                    if (value === undefined || value === null) return;
                    if (typeof value === 'object') {
                        lines.push(`${childIndent}${key}:`);
                        const grandChildIndent = ' '.repeat(baseIndent + 4);
                        Object.entries(value).forEach(([subKey, subValue]) => {
                            if (subValue === undefined || subValue === null) return;
                            lines.push(`${grandChildIndent}${subKey}: ${subValue}`);
                        });
                    } else {
                        lines.push(`${childIndent}${key}: ${value}`);
                    }
                });
            }
            return lines;
        }

        function commentBlockLines(lines, baseIndent) {
            return lines.map((line) => {
                if (line.trim() === '') return line;
                return line.slice(0, baseIndent) + '# ' + line.slice(baseIndent);
            });
        }

        function serializeCommentedObjectBlock(name, data, baseIndent) {
            const indent = ' '.repeat(baseIndent);
            const childIndent = ' '.repeat(baseIndent + 2);
            const lines = [`${indent}${name}:`];
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                Object.entries(data).forEach(([key, value]) => {
                    if (value === undefined || value === null) return;
                    if (typeof value === 'object') {
                        lines.push(`${childIndent}${key}:`);
                        const grandChildIndent = ' '.repeat(baseIndent + 4);
                        Object.entries(value).forEach(([subKey, subValue]) => {
                            if (subValue === undefined || subValue === null) return;
                            lines.push(`${grandChildIndent}${subKey}: ${subValue}`);
                        });
                    } else {
                        lines.push(`${childIndent}${key}: ${value}`);
                    }
                });
            }
            return lines;
        }

        function applyCommentedServiceOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate commented service');

            if (operation.type === 'service.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'service.duplicate') {
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                const parsed = parseCommentedBlockData(target);
                const originalName = parsed ? parsed.name : '';
                const renamedFirstLine = blockLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${originalName ? originalName + ' (cloned)' : 'Cloned'}:`);
                const newBlock = [renamedFirstLine, ...blockLines.slice(1)];
                lines.splice(range.endLine + 1, 0, '', ...newBlock);
                return lines.join('\n');
            }

            if (operation.type === 'service.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                let blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (operation.destinationTarget) {
                    const destGroupRange = findBlockLineRange({
                        tab: tabName,
                        kind: 'services-group',
                        groupName: operation.destinationTarget.groupName,
                        groupIndex: operation.destinationTarget.groupIndex || 0,
                        ...(operation.destinationTarget.nestedGroupPath ? { nestedGroupPath: operation.destinationTarget.nestedGroupPath } : {})
                    });
                    if (!destGroupRange) throw new Error('Could not locate destination group');
                    const destEntryIndent = detectEntryIndent(lines, destGroupRange.startLine, destGroupRange.endLine);
                    blockLines = reindentCommentedBlockLines(blockLines, destEntryIndent);
                    if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                        insertAt = findServiceInsertLine(lines, destGroupRange, operation.destinationIndex);
                    } else {
                        insertAt = destGroupRange.endLine + 1;
                    }
                } else {
                    const groupRange = findBlockLineRange({ tab: tabName, kind: 'services-group', groupName: target.groupName, groupIndex: target.groupIndex || 0 });
                    if (!groupRange) throw new Error('Could not locate service group');
                    const sibling = findSiblingServiceLineRange(yamlText, groupRange.startLine, groupRange.endLine, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Service is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} of the group`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            if (operation.type === 'service.edit') {
                const values = operation.values || {};
                const newName = String(values.name || '').trim();
                if (!newName) throw new Error('Service name is required');
                const baseIndent = lines[range.startLine].search(/\S/);
                const data = values.fields ? Object.fromEntries(values.fields.filter((f) => f.blankValue || String(f.value || '').trim() !== '').map((f) => [f.key, f.value])) : {};
                const commentedBlock = commentBlockLines(serializeCommentedBlock(newName, data, baseIndent), baseIndent);
                lines.splice(range.startLine, range.endLine - range.startLine + 1, ...commentedBlock);
                return lines.join('\n');
            }

            throw new Error(`Unsupported commented service operation "${operation.type}"`);
        }

        function applyCommentedGroupOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate commented group');

            if (operation.type === 'group.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'group.duplicate') {
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                const parsed = parseCommentedBlockData(target);
                const originalName = parsed ? parsed.name : '';
                const renamedFirstLine = blockLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${originalName ? originalName + ' (cloned)' : 'Cloned'}:`);
                const newBlock = [renamedFirstLine, ...blockLines.slice(1)];
                lines.splice(range.endLine + 1, 0, '', ...newBlock);
                return lines.join('\n');
            }

            if (operation.type === 'group.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                    insertAt = findGroupInsertLine(lines, operation.destinationIndex);
                } else {
                    const sibling = findSiblingGroupLineRange(yamlText, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Group is already at the ${operation.direction === 'up' ? 'top' : 'bottom'}`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            if (operation.type === 'group.edit' || operation.type === 'group.rename') {
                const values = operation.values || {};
                const newName = String(values.name || '').trim();
                if (!newName) throw new Error('Group name is required');
                lines[range.startLine] = lines[range.startLine].replace(/(-\s+)(.+?):\s*$/, `$1${newName}:`);
                return lines.join('\n');
            }

            throw new Error(`Unsupported commented group operation "${operation.type}"`);
        }

        function applyCommentedBookmarkOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate commented bookmark');

            if (operation.type === 'bookmark.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark.duplicate') {
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                const parsed = parseCommentedBlockData(target);
                const originalName = parsed ? parsed.name : '';
                const renamedFirstLine = blockLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${originalName ? originalName + ' (cloned)' : 'Cloned'}:`);
                const newBlock = [renamedFirstLine, ...blockLines.slice(1)];
                lines.splice(range.endLine + 1, 0, '', ...newBlock);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                let blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (operation.destinationTarget) {
                    const destGroupRange = findBlockLineRange({
                        tab: tabName,
                        kind: 'bookmark-group',
                        groupName: operation.destinationTarget.groupName,
                        groupIndex: operation.destinationTarget.groupIndex || 0,
                        ...(operation.destinationTarget.nestedGroupPath ? { nestedGroupPath: operation.destinationTarget.nestedGroupPath } : {})
                    });
                    if (!destGroupRange) throw new Error('Could not locate destination bookmark group');
                    const destEntryIndent = detectEntryIndent(lines, destGroupRange.startLine, destGroupRange.endLine);
                    blockLines = reindentCommentedBlockLines(blockLines, destEntryIndent);
                    if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                        insertAt = findServiceInsertLine(lines, destGroupRange, operation.destinationIndex);
                    } else {
                        insertAt = destGroupRange.endLine + 1;
                    }
                } else {
                    const groupRange = findBlockLineRange({ tab: tabName, kind: 'bookmark-group', groupName: target.groupName, groupIndex: target.groupIndex || 0 });
                    if (!groupRange) throw new Error('Could not locate bookmark group');
                    const sibling = findSiblingServiceLineRange(yamlText, groupRange.startLine, groupRange.endLine, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Bookmark is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} of the group`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark.edit') {
                const values = operation.values || {};
                const newName = String(values.name || '').trim();
                if (!newName) throw new Error('Bookmark name is required');
                const baseIndent = lines[range.startLine].search(/\S/);
                const data = values.fields ? Object.fromEntries(values.fields.filter((f) => f.blankValue || String(f.value || '').trim() !== '').map((f) => [f.key, f.value])) : {};
                const commentedBlock = commentBlockLines(serializeCommentedBlock(newName, data, baseIndent), baseIndent);
                lines.splice(range.startLine, range.endLine - range.startLine + 1, ...commentedBlock);
                return lines.join('\n');
            }

            throw new Error(`Unsupported commented bookmark operation "${operation.type}"`);
        }

        function applyCommentedBookmarkGroupOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate commented bookmark group');

            if (operation.type === 'bookmark-group.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark-group.duplicate') {
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                const parsed = parseCommentedBlockData(target);
                const originalName = parsed ? parsed.name : '';
                const renamedFirstLine = blockLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${originalName ? originalName + ' (cloned)' : 'Cloned'}:`);
                const newBlock = [renamedFirstLine, ...blockLines.slice(1)];
                lines.splice(range.endLine + 1, 0, '', ...newBlock);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark-group.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                    insertAt = findGroupInsertLine(lines, operation.destinationIndex);
                } else {
                    const sibling = findSiblingGroupLineRange(yamlText, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Bookmark group is already at the ${operation.direction === 'up' ? 'top' : 'bottom'}`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark-group.edit') {
                const values = operation.values || {};
                const newName = String(values.name || '').trim();
                if (!newName) throw new Error('Bookmark group name is required');
                lines[range.startLine] = lines[range.startLine].replace(/(-\s+)(.+?):\s*$/, `$1${newName}:`);
                return lines.join('\n');
            }

            throw new Error(`Unsupported commented bookmark group operation "${operation.type}"`);
        }

        function applyCommentedWidgetOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate commented widget');

            if (operation.type === 'widget.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'widget.edit') {
                const values = operation.values || {};
                const newName = String(values.name || '').trim();
                if (!newName) throw new Error('Widget name is required');
                const baseIndent = lines[range.startLine].search(/\S/);
                const data = values.fields ? Object.fromEntries(values.fields.filter((f) => f.blankValue || String(f.value || '').trim() !== '').map((f) => [f.key, f.value])) : {};
                const blockLines = target.isList
                    ? serializeCommentedBlock(newName, data, baseIndent)
                    : serializeCommentedObjectBlock(newName, data, baseIndent);
                const commentedBlock = commentBlockLines(blockLines, baseIndent);
                lines.splice(range.startLine, range.endLine - range.startLine + 1, ...commentedBlock);
                return lines.join('\n');
            }

            throw new Error(`Unsupported commented widget operation "${operation.type}"`);
        }

        function applyChunkTreeOperation(tabName, operation) {
            if (typeof ChunkTree === 'undefined') return null;
            const target = operation.target || {};
            const yamlText = getTabYamlText(tabName);
            let chunks = null;
            if (tabName === 'services') {
                chunks = ChunkTree.parseServicesDocument(yamlText);
            } else if (tabName === 'bookmarks') {
                chunks = ChunkTree.parseBookmarksDocument(yamlText);
            } else if (tabName === 'widgets') {
                chunks = ChunkTree.parseWidgetsDocument(yamlText);
            }
            if (!chunks || chunks.length === 0) return null;

            const kind = target.kind || '';
            const isWidget = kind === 'widget';
            const isGroup = kind === 'services-group' || kind === 'bookmark-group';
            const isEntry = kind === 'service' || kind === 'bookmark';
            const hasNestedPath = Array.isArray(target.nestedGroupPath) && target.nestedGroupPath.length > 0;
            const nestedGroupInfo = hasNestedPath ? target.nestedGroupPath[target.nestedGroupPath.length - 1] : null;

            const path = {
                groupName: isWidget ? target.name : (target.groupName || target.name),
                groupIndex: isWidget ? (target.index || 0) : (target.groupIndex || 0),
                entryName: isEntry ? (target.serviceName || target.bookmarkName) : (nestedGroupInfo ? nestedGroupInfo.name : undefined),
                entryIndex: isEntry ? (target.serviceIndex || target.bookmarkIndex || 0) : (nestedGroupInfo ? nestedGroupInfo.index : undefined)
            };

            const opType = operation.type || '';

            if (opType.endsWith('.remove')) {
                if (isEntry || nestedGroupInfo) {
                    return ChunkTree.removeChunk(chunks, path);
                }
                return ChunkTree.removeChunk(chunks, { groupName: path.groupName, groupIndex: path.groupIndex });
            }

            if (opType.endsWith('.duplicate')) {
                if (isEntry || nestedGroupInfo) {
                    return ChunkTree.duplicateChunk(chunks, path);
                }
                return ChunkTree.duplicateChunk(chunks, { groupName: path.groupName, groupIndex: path.groupIndex });
            }

            if (opType.endsWith('.move')) {
                // Commented service move targeting a nested group: return null so
                // applyCommentedServiceOperation handles it (it already resolves
                // nested destinations, indentation, and insertion index correctly).
                if (target.commented === true && isEntry && operation.destinationTarget && Array.isArray(operation.destinationTarget.nestedGroupPath) && operation.destinationTarget.nestedGroupPath.length > 0) {
                    return null;
                }
                let toPath;
                if (isEntry || nestedGroupInfo) {
                    toPath = { groupName: path.groupName, groupIndex: path.groupIndex };
                    if (operation.destinationTarget) {
                        toPath.groupName = operation.destinationTarget.groupName;
                        toPath.groupIndex = operation.destinationTarget.groupIndex || 0;
                        if (Number.isInteger(operation.destinationIndex)) {
                            toPath.destinationIndex = operation.destinationIndex;
                        }
                    } else if (operation.direction) {
                        toPath.direction = operation.direction;
                    }
                    return ChunkTree.moveChunk(chunks, path, toPath);
                }
                // Group or top-level move
                toPath = { groupName: path.groupName, groupIndex: path.groupIndex };
                if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                    toPath.destinationIndex = operation.destinationIndex;
                } else if (operation.direction) {
                    toPath.direction = operation.direction;
                }
                return ChunkTree.moveChunk(chunks, { groupName: path.groupName, groupIndex: path.groupIndex }, toPath);
            }

            if (opType.endsWith('.edit') || opType.endsWith('.rename')) {
                const values = operation.values || {};
                const newName = String(values.name || '').trim();
                if (!newName) return null;
                const fields = values.fields || [];
                const getFieldValue = (field, parentKey) => {
                    if (parentKey === 'widget' && field.key === 'fields' && typeof field.value === 'string') {
                        try {
                            const parsed = JSON.parse(field.value);
                            if (Array.isArray(parsed)) return parsed;
                        } catch {
                        }
                    }
                    return field.value;
                };
                const buildDataFromFields = (fieldList, parentKey = '') => {
                    const data = {};
                    for (const f of fieldList) {
                        if (Array.isArray(f.fields)) {
                            const nested = buildDataFromFields(f.fields, f.key);
                            if (Object.keys(nested).length > 0) {
                                data[f.key] = nested;
                            }
                        } else if (f.blankValue || String(f.value || '').trim() !== '') {
                            data[f.key] = getFieldValue(f, parentKey);
                        }
                    }
                    return data;
                };
                const data = buildDataFromFields(fields);
                const commentedKeys = fields.filter((f) => f.commented).map((f) => f.key);
                if (isEntry || isWidget) {
                    return ChunkTree.editChunk(chunks, path, newName, data, { commentedKeys });
                }
                if (nestedGroupInfo) {
                    // Nested groups: rename only, data is layout (stored in settings.yaml, not services.yaml)
                    return ChunkTree.editChunk(chunks, path, newName, {});
                }
                return ChunkTree.editChunk(chunks, { groupName: path.groupName, groupIndex: path.groupIndex }, newName);
            }

            if (opType.endsWith('.comment')) {
                return ChunkTree.toggleChunkComment(chunks, path);
            }

            return null;
        }

        async function applyCommentedPreviewEdit(operation, successMessage) {
            if (sampleModeEnabled) return false;
            const beforeFiles = {
                services: getTabYamlText('services'),
                settings: getTabYamlText('settings'),
                bookmarks: getTabYamlText('bookmarks')
            };
            try {
                const target = operation.target || {};
                const tabName = target.tab || 'services';
                let newText = applyChunkTreeOperation(tabName, operation);
                if (newText === null) {
                    if (target.kind === 'service') {
                        newText = applyCommentedServiceOperation(tabName, operation);
                    } else if (target.kind === 'services-group') {
                        newText = applyCommentedGroupOperation(tabName, operation);
                    } else if (target.kind === 'bookmark') {
                        newText = applyCommentedBookmarkOperation(tabName, operation);
                    } else if (target.kind === 'bookmark-group') {
                        newText = applyCommentedBookmarkGroupOperation(tabName, operation);
                    } else if (target.kind === 'widget') {
                        newText = applyCommentedWidgetOperation(tabName, operation);
                    } else {
                        throw new Error(`Unsupported commented item kind "${target.kind}"`);
                    }
                }
                try {
                    jsyaml.load(newText);
                } catch (yamlErr) {
                    throw new Error(`Transformed ${tabName}.yaml is invalid: ${yamlErr.message || yamlErr}`);
                }
                setPreviewUndoState({ files: beforeFiles, message: successMessage });
                replaceTabYamlText(tabName, newText);
                updatePreviewUndoButton();
                setSaveStatus(`${successMessage} Save to write the pending YAML changes.`, 'info');
                return true;
            } catch (error) {
                setSaveStatus(`Could not edit the dashboard: ${addErrorGuidance(error, 'Check the item name and YAML structure, then try again')}`, 'error');
                return false;
            }
        }

        function reindentBlockLines(blockLines, newFirstLineIndent) {
            if (blockLines.length === 0) return blockLines;
            const oldFirstLineIndent = blockLines[0].search(/\S/);
            if (oldFirstLineIndent < 0) return blockLines;
            const delta = newFirstLineIndent - oldFirstLineIndent;
            if (delta === 0) return blockLines;
            return blockLines.map((line) => {
                if (line.trim() === '') return line;
                const currentIndent = line.search(/\S/);
                if (currentIndent < 0) return line;
                const newIndent = Math.max(0, currentIndent + delta);
                return ' '.repeat(newIndent) + line.trimStart();
            });
        }

        function applyNormalServiceOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate service');

            if (operation.type === 'service.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'service.duplicate') {
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                const firstLine = blockLines[0];
                const nameMatch = firstLine.match(/(-\s+)(.+?):\s*$/);
                const originalName = nameMatch ? nameMatch[2].trim() : '';
                const renamedFirstLine = firstLine.replace(/(-\s+)(.+?):\s*$/, `$1${originalName ? originalName + ' (cloned)' : 'Cloned'}:`);
                const newBlock = [renamedFirstLine, ...blockLines.slice(1)];
                lines.splice(range.endLine + 1, 0, '', ...newBlock);
                return lines.join('\n');
            }

            if (operation.type === 'service.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                let blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (operation.destinationTarget) {
                    const destGroupRange = findBlockLineRange({ tab: tabName, kind: 'services-group', groupName: operation.destinationTarget.groupName, groupIndex: operation.destinationTarget.groupIndex || 0 });
                    if (!destGroupRange) throw new Error('Could not locate destination group');
                    const destEntryIndent = detectEntryIndent(lines, destGroupRange.startLine, destGroupRange.endLine);
                    blockLines = reindentBlockLines(blockLines, destEntryIndent);
                    if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                        insertAt = findServiceInsertLine(lines, destGroupRange, operation.destinationIndex);
                    } else {
                        insertAt = destGroupRange.endLine + 1;
                    }
                } else {
                    const groupRange = findBlockLineRange({ tab: tabName, kind: 'services-group', groupName: target.groupName, groupIndex: target.groupIndex || 0 });
                    if (!groupRange) throw new Error('Could not locate service group');
                    const sibling = findSiblingServiceLineRange(yamlText, groupRange.startLine, groupRange.endLine, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Service is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} of the group`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            throw new Error(`Unsupported normal service operation "${operation.type}"`);
        }

        function applyNormalBookmarkOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate bookmark');

            if (operation.type === 'bookmark.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark.duplicate') {
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                const firstLine = blockLines[0];
                const nameMatch = firstLine.match(/(-\s+)(.+?):\s*$/);
                const originalName = nameMatch ? nameMatch[2].trim() : '';
                const renamedFirstLine = firstLine.replace(/(-\s+)(.+?):\s*$/, `$1${originalName ? originalName + ' (cloned)' : 'Cloned'}:`);
                const newBlock = [renamedFirstLine, ...blockLines.slice(1)];
                lines.splice(range.endLine + 1, 0, '', ...newBlock);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                let blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (operation.destinationTarget) {
                    const destGroupRange = findBlockLineRange({ tab: tabName, kind: 'bookmark-group', groupName: operation.destinationTarget.groupName, groupIndex: operation.destinationTarget.groupIndex || 0 });
                    if (!destGroupRange) throw new Error('Could not locate destination bookmark group');
                    const destEntryIndent = detectEntryIndent(lines, destGroupRange.startLine, destGroupRange.endLine);
                    blockLines = reindentBlockLines(blockLines, destEntryIndent);
                    if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                        insertAt = findServiceInsertLine(lines, destGroupRange, operation.destinationIndex);
                    } else {
                        insertAt = destGroupRange.endLine + 1;
                    }
                } else {
                    const groupRange = findBlockLineRange({ tab: tabName, kind: 'bookmark-group', groupName: target.groupName, groupIndex: target.groupIndex || 0 });
                    if (!groupRange) throw new Error('Could not locate bookmark group');
                    const sibling = findSiblingServiceLineRange(yamlText, groupRange.startLine, groupRange.endLine, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Bookmark is already at the ${operation.direction === 'up' ? 'top' : 'bottom'} of the group`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            throw new Error(`Unsupported normal bookmark operation "${operation.type}"`);
        }

        function applyNormalGroupOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate service group');

            if (operation.type === 'group.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'group.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                    insertAt = findGroupInsertLine(lines, operation.destinationIndex);
                } else {
                    const sibling = findSiblingGroupLineRange(yamlText, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Group is already at the ${operation.direction === 'up' ? 'top' : 'bottom'}`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            throw new Error(`Unsupported normal group operation "${operation.type}"`);
        }

        function applyNormalBookmarkGroupOperation(tabName, operation) {
            const target = operation.target;
            const lines = getTabYamlLines(tabName);
            const yamlText = lines.join('\n');
            const range = findBlockLineRange(target);
            if (!range) throw new Error('Could not locate bookmark group');

            if (operation.type === 'bookmark-group.remove') {
                lines.splice(range.startLine, range.endLine - range.startLine + 1);
                return lines.join('\n');
            }

            if (operation.type === 'bookmark-group.move') {
                const blockLength = range.endLine - range.startLine + 1;
                let insertAt;
                if (Number.isInteger(operation.destinationIndex) && operation.destinationIndex >= 0) {
                    insertAt = findGroupInsertLine(lines, operation.destinationIndex);
                } else {
                    const sibling = findSiblingGroupLineRange(yamlText, range.startLine, operation.direction);
                    if (!sibling) throw new Error(`Bookmark group is already at the ${operation.direction === 'up' ? 'top' : 'bottom'}`);
                    insertAt = operation.direction === 'up' ? sibling.startLine : sibling.endLine + 1;
                }
                const blockLines = lines.slice(range.startLine, range.endLine + 1);
                if (insertAt > range.endLine) insertAt -= blockLength;
                lines.splice(range.startLine, blockLength);
                lines.splice(insertAt, 0, ...blockLines);
                return lines.join('\n');
            }

            throw new Error(`Unsupported normal bookmark group operation "${operation.type}"`);
        }

        async function applyClientSidePreviewEdit(operation, successMessage) {
            if (sampleModeEnabled) return false;
            const beforeFiles = {
                services: getTabYamlText('services'),
                settings: getTabYamlText('settings'),
                bookmarks: getTabYamlText('bookmarks')
            };
            try {
                const target = operation.target || {};
                const tabName = target.tab || 'services';
                let newText = applyChunkTreeOperation(tabName, operation);
                if (newText === null) {
                    if (target.kind === 'service') {
                        newText = applyNormalServiceOperation(tabName, operation);
                    } else if (target.kind === 'services-group') {
                        newText = applyNormalGroupOperation(tabName, operation);
                    } else if (target.kind === 'bookmark') {
                        newText = applyNormalBookmarkOperation(tabName, operation);
                    } else if (target.kind === 'bookmark-group') {
                        newText = applyNormalBookmarkGroupOperation(tabName, operation);
                    } else {
                        throw new Error(`Unsupported client-side item kind "${target.kind}"`);
                    }
                }
                try {
                    jsyaml.load(newText);
                } catch (yamlErr) {
                    throw new Error(`Transformed ${tabName}.yaml is invalid: ${yamlErr.message || yamlErr}`);
                }
                setPreviewUndoState({ files: beforeFiles, message: successMessage });
                replaceTabYamlText(tabName, newText);
                updatePreviewUndoButton();
                setSaveStatus(`${successMessage} Save to write the pending YAML changes.`, 'info');
                return true;
            } catch (error) {
                console.error('[applyClientSidePreviewEdit] failed:', error);
                setSaveStatus(`Could not edit the dashboard: ${addErrorGuidance(error, 'Check the item name and YAML structure, then try again')}`, 'error');
                return false;
            }
        }

        function findBlockEndLine(lines, startLine) {
            const startIndent = getYamlIndent(lines[startLine]);
            for (let i = startLine + 1; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim() === '') continue;
                const indent = getYamlIndent(line);
                if (indent <= startIndent && line.trim().startsWith('- ')) {
                    return i - 1;
                }
            }
            return lines.length - 1;
        }

        function getGroupPositions(yamlText) {
            const lines = yamlText.split('\n');
            const positions = [];
            const nameCounters = new Map();
            lines.forEach((line, index) => {
                if (getYamlIndent(line) === 0 && line.trim().startsWith('- ')) {
                    const name = getYamlKeyFromLine(line);
                    const occurrenceIndex = nameCounters.get(name) || 0;
                    nameCounters.set(name, occurrenceIndex + 1);
                    positions.push({ name, occurrenceIndex, startLine: index });
                }
            });
            return positions;
        }

        function findGroupStartLine(yamlText, groupName, occurrenceIndex) {
            const lines = yamlText.split('\n');
            let occurrence = -1;
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^-\s+(\S.*?):\s*$/);
                if (m && m[1].trim() === groupName) {
                    occurrence++;
                    if (occurrence === (occurrenceIndex || 0)) return i;
                }
            }
            return -1;
        }

        function reindentCommentedBlockLines(blockLines, newServiceIndent) {
            if (blockLines.length === 0) return blockLines;
            const firstLine = blockLines[0];
            const firstHashPos = firstLine.indexOf('#');
            if (firstHashPos < 0) return blockLines;
            const firstLineAfterHash = firstLine.slice(firstHashPos + 1);
            const firstLineAfterHashStripped = firstLineAfterHash.startsWith(' ') ? firstLineAfterHash.slice(1) : firstLineAfterHash;
            const oldServiceContentLeadingSpaces = firstLineAfterHashStripped.search(/\S/);
            if (oldServiceContentLeadingSpaces < 0) return blockLines;

            return blockLines.map((line) => {
                if (line.trim() === '') return line;
                const hashPos = line.indexOf('#');
                if (hashPos < 0) return line;
                const afterHash = line.slice(hashPos + 1);
                const afterHashStripped = afterHash.startsWith(' ') ? afterHash.slice(1) : afterHash;
                const oldContentLeadingSpaces = afterHashStripped.search(/\S/);
                const content = afterHashStripped.trimStart();
                const newContentLeadingSpaces = Math.max(0, oldContentLeadingSpaces - oldServiceContentLeadingSpaces);
                return ' '.repeat(newServiceIndent) + '# ' + ' '.repeat(newContentLeadingSpaces) + content;
            });
        }

        function detectEntryIndent(lines, groupStartLine, groupEndLine) {
            const groupIndent = getYamlIndent(lines[groupStartLine]);
            for (let i = groupStartLine + 1; i <= groupEndLine; i++) {
                const line = lines[i];
                if (line.trim() === '') continue;
                const indent = getYamlIndent(line);
                const trimmed = line.trim();
                if (indent <= groupIndent) break;
                if (/^#\s*-\s+\S/.test(trimmed) || /^-\s+\S/.test(trimmed)) {
                    return indent;
                }
            }
            return groupIndent + 2;
        }

        function markDeepCommented(value) {
            if (Array.isArray(value)) {
                return value.map((item) => {
                    if (item && typeof item === 'object') {
                        const itemName = Object.keys(item)[0];
                        if (itemName) {
                            const itemVal = item[itemName];
                            return { [itemName]: markDeepCommented(itemVal), __commented: true };
                        }
                        return { ...item, __commented: true };
                    }
                    return item;
                });
            }
            return value;
        }

        function mergeGroupEntries(activeEntries, commentedEntries, groupStartLine, yamlText) {
            if (!Array.isArray(activeEntries) || commentedEntries.length === 0) return activeEntries;
            const lines = yamlText.split('\n');
            const groupEndLine = findBlockEndLine(lines, groupStartLine);
            const groupIndent = getYamlIndent(lines[groupStartLine]);
            const entryIndent = detectEntryIndent(lines, groupStartLine, groupEndLine);
            const merged = [];
            let activeIndex = 0;
            const remainingCommented = new Map(commentedEntries.map((entry) => [entry.__commentedStartLine, entry]));

            for (let i = groupStartLine + 1; i <= groupEndLine; i++) {
                const line = lines[i];
                if (line.trim() === '') continue;
                const indent = getYamlIndent(line);
                if (indent <= groupIndent && line.trim().startsWith('- ')) break;
                if (indent !== entryIndent) continue;
                const trimmed = line.trim();
                if (!(/^#\s*-\s+\S/.test(trimmed) || /^-\s+\S/.test(trimmed))) continue;
                if (remainingCommented.has(i)) {
                    merged.push(remainingCommented.get(i));
                    remainingCommented.delete(i);
                } else if (activeIndex < activeEntries.length) {
                    merged.push(activeEntries[activeIndex++]);
                }
            }
            while (activeIndex < activeEntries.length) {
                merged.push(activeEntries[activeIndex++]);
            }
            remainingCommented.forEach((entry) => merged.push(entry));
            return merged;
        }

        function findNestedGroupLine(lines, parentLine, groupName, occurrenceIndex) {
            const parentEnd = findBlockEndLine(lines, parentLine);
            const parentIndent = getYamlIndent(lines[parentLine]);
            const childIndent = detectEntryIndent(lines, parentLine, parentEnd);
            if (childIndent <= parentIndent) return -1;
            let occurrence = -1;
            for (let i = parentLine + 1; i <= parentEnd; i++) {
                const line = lines[i];
                const indent = getYamlIndent(line);
                if (indent <= parentIndent) break;
                if (indent !== childIndent) continue;
                const m = line.match(/^(\s*)-\s+(\S.*?):\s*$/);
                if (m && m[2].trim() === groupName) {
                    occurrence++;
                    if (occurrence === occurrenceIndex) return i;
                }
            }
            return -1;
        }

        function mergeNestedGroupEntries(group, nestedPath, commentEntries, yamlText) {
            // Recursively traverse into the group's nested structure following nestedPath
            // and insert commentEntries into the matching nested array in YAML order.
            const lines = yamlText.split('\n');
            let current = group;
            const groupName = Object.keys(current)[0];
            if (!groupName) return;
            let entries = current[groupName];
            let parentLine = findGroupStartLine(yamlText, groupName);
            for (let depth = 0; depth < nestedPath.length; depth++) {
                const step = nestedPath[depth];
                const stepName = typeof step === 'string' ? step : step.name;
                const stepIndex = typeof step === 'object' ? step.index : 0;
                if (!Array.isArray(entries)) return;
                let found = null;
                let foundIdx = -1;
                let occurrence = -1;
                for (let ei = 0; ei < entries.length; ei++) {
                    const item = entries[ei];
                    if (item && typeof item === 'object' && Object.keys(item)[0] === stepName) {
                        occurrence++;
                        if (occurrence === stepIndex) {
                            found = item;
                            foundIdx = ei;
                            break;
                        }
                    }
                }
                if (!found) return;
                const foundName = Object.keys(found)[0];
                if (depth === nestedPath.length - 1) {
                    // Last step — merge into this nested group's array in YAML order
                    if (!Array.isArray(found[foundName])) {
                        found[foundName] = [];
                    }
                    // Find the nested group's own start line within the parent's block
                    const nestedGroupLine = parentLine >= 0
                        ? findNestedGroupLine(lines, parentLine, foundName, stepIndex)
                        : -1;
                    if (nestedGroupLine >= 0) {
                        found[foundName] = mergeGroupEntries(found[foundName], commentEntries, nestedGroupLine, yamlText);
                    } else {
                        found[foundName] = found[foundName].concat(commentEntries);
                    }
                } else {
                    // Track the current group's line for the next depth
                    parentLine = parentLine >= 0
                        ? findNestedGroupLine(lines, parentLine, foundName, stepIndex)
                        : -1;
                    entries = found[foundName];
                }
            }
        }

        function mergeGroupsByLine(activeGroups, commentedGroups, yamlText) {
            if (commentedGroups.length === 0) return activeGroups;
            const positions = getGroupPositions(yamlText);
            const merged = [];
            let activeIndex = 0;
            let commentedIndex = 0;

            while (activeIndex < activeGroups.length || commentedIndex < commentedGroups.length) {
                if (activeIndex >= activeGroups.length) {
                    merged.push(commentedGroups[commentedIndex++]);
                } else if (commentedIndex >= commentedGroups.length) {
                    merged.push(activeGroups[activeIndex++]);
                } else {
                    const activeStartLine = positions[activeIndex]?.startLine ?? Infinity;
                    const commentedStartLine = commentedGroups[commentedIndex].__commentedStartLine;
                    if (commentedStartLine < activeStartLine) {
                        merged.push(commentedGroups[commentedIndex++]);
                    } else {
                        merged.push(activeGroups[activeIndex++]);
                    }
                }
            }
            return merged;
        }

        function findSiblingServiceLineRange(yamlText, groupStartLine, groupEndLine, startLine, direction) {
            const lines = yamlText.split('\n');
            const entryIndent = detectEntryIndent(lines, groupStartLine, groupEndLine);
            if (direction === 'up') {
                for (let i = startLine - 1; i > groupStartLine; i--) {
                    const line = lines[i];
                    if (line.trim() === '') continue;
                    const indent = getYamlIndent(line);
                    const trimmed = line.trim();
                    if (indent === entryIndent && (/^#\s*-\s+\S/.test(trimmed) || /^-\s+\S/.test(trimmed))) {
                        return { startLine: i, endLine: findBlockEndLine(lines, i) };
                    }
                }
            } else {
                const currentEnd = findBlockEndLine(lines, startLine);
                for (let i = currentEnd + 1; i <= groupEndLine; i++) {
                    const line = lines[i];
                    if (line.trim() === '') continue;
                    const indent = getYamlIndent(line);
                    const trimmed = line.trim();
                    if (indent === entryIndent && (/^#\s*-\s+\S/.test(trimmed) || /^-\s+\S/.test(trimmed))) {
                        return { startLine: i, endLine: findBlockEndLine(lines, i) };
                    }
                }
            }
            return null;
        }

        function findSiblingGroupLineRange(yamlText, startLine, direction) {
            const lines = yamlText.split('\n');
            if (direction === 'up') {
                for (let i = startLine - 1; i >= 0; i--) {
                    const line = lines[i];
                    if (line.trim() === '') continue;
                    const indent = getYamlIndent(line);
                    if (indent === 0 && line.trim().startsWith('- ')) {
                        return { startLine: i, endLine: findBlockEndLine(lines, i) };
                    }
                }
            } else {
                const currentEnd = findBlockEndLine(lines, startLine);
                for (let i = currentEnd + 1; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.trim() === '') continue;
                    const indent = getYamlIndent(line);
                    if (indent === 0 && line.trim().startsWith('- ')) {
                        return { startLine: i, endLine: findBlockEndLine(lines, i) };
                    }
                }
            }
            return null;
        }

        function findServiceInsertLine(lines, groupRange, destinationIndex) {
            const serviceIndent = detectEntryIndent(lines, groupRange.startLine, groupRange.endLine);
            let serviceCount = 0;
            let lastServiceEndLine = groupRange.startLine;
            for (let i = groupRange.startLine + 1; i <= groupRange.endLine; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                if ((/^#\s*-\s+\S/.test(trimmed) || /^-\s+\S/.test(trimmed)) && getYamlIndent(line) === serviceIndent) {
                    if (serviceCount === destinationIndex) return i;
                    serviceCount++;
                    lastServiceEndLine = findBlockEndLine(lines, i);
                }
            }
            return lastServiceEndLine + 1;
        }

        function findGroupInsertLine(lines, destinationIndex) {
            let groupCount = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim().startsWith('- ') && getYamlIndent(line) === 0) {
                    if (groupCount === destinationIndex) return i;
                    groupCount++;
                }
            }
            return lines.length;
        }

        function scheduleVisualPreview() {
            window.clearTimeout(previewUpdateTimer);
            if (!document.getElementById('preview-auto-refresh-toggle').checked) {
                return;
            }
            setPreviewUpdateTimer(window.setTimeout(updatePreview, 180));
        }

        function findPreviewGroup(source) {
            const services = parseTabConfig('services');
            if (services.error || !Array.isArray(services.data)) {
                throw new Error('Fix the services.yaml error shown on the dashboard before editing it.');
            }
            let seen = 0;
            for (const group of services.data) {
                const groupName = Object.keys(group || {})[0] || '';
                if (groupName !== source.groupName) continue;
                if (seen === (Number(source.groupIndex) || 0)) {
                    return { group, groupName, services: Array.isArray(group[groupName]) ? group[groupName] : [] };
                }
                seen++;
            }
            throw new Error(`Service group "${source.groupName}" is no longer available. Refresh the dashboard and try again.`);
        }

        function parseCommentedSubOptions(lines, startLine, endLine) {
            if (!Array.isArray(lines) || startLine < 0 || endLine < startLine || endLine >= lines.length) return [];
            const baseIndent = getYamlIndent(lines[startLine] || '');
            const candidates = extractCommentedLines(lines.join('\n'))
                .filter((block) => block.startLine > startLine
                    && block.endLine <= endLine
                    && block.indent > baseIndent)
                .map((block) => {
                    const parsed = Array.isArray(block.parsed) ? block.parsed[0] : block.parsed;
                    return {
                        line: block.startLine,
                        fields: getPreviewOptionFields(parsed, { commented: true }),
                        startLine: block.startLine,
                        endLine: block.endLine
                    };
                });
            const coveredLines = new Set(candidates.flatMap((candidate) => {
                const covered = [];
                for (let line = candidate.startLine; line <= candidate.endLine; line++) covered.push(line);
                return covered;
            }));
            for (let line = startLine + 1; line <= endLine; line++) {
                if (coveredLines.has(line)) continue;
                const match = String(lines[line] || '').match(/^(\s*)# ?(.*)$/);
                if (!match) continue;
                const normalized = `${match[1]}${match[2]}`;
                if (getYamlIndent(normalized) <= baseIndent) continue;
                const keyValue = normalized.match(/^\s*(?:-\s+)?(.+?):(?:\s*(.*))?$/);
                if (!keyValue) continue;
                candidates.push({
                    line,
                    fields: [{
                        key: keyValue[1].trim(),
                        value: (keyValue[2] || '').trim(),
                        commented: true,
                        locked: true
                    }]
                });
            }
            return candidates
                .sort((first, second) => first.line - second.line)
                .flatMap((candidate) => candidate.fields);
        }

        function appendCommentedSubOptions(source, fields) {
            const range = findBlockLineRange(source);
            if (!range) return fields;
            const lines = getTabYamlLines(source.tab);
            const commentedFields = parseCommentedSubOptions(lines, range.startLine, range.endLine);
            if (commentedFields.length === 0) return fields;
            // Only append fields whose keys are not already present in the active fields
            const existingKeys = new Set(fields.map((f) => f.key));
            const toAppend = commentedFields.filter((f) => !existingKeys.has(f.key));
            return fields.concat(toAppend);
        }

        function findPreviewService(source) {
            const { services: entries, groupName } = findPreviewGroup(source);
            const sequence = resolvePreviewEntries(entries, source);
            let seen = 0;
            for (const service of sequence) {
                const serviceName = Object.keys(service || {})[0] || '';
                if (serviceName !== source.serviceName) continue;
                if (seen === (Number(source.serviceIndex) || 0)) {
                    return { group: { groupName }, services: sequence, service, serviceName, data: service[serviceName] || {} };
                }
                seen++;
            }
            throw new Error(`Service "${source.serviceName}" is no longer available. Refresh the dashboard and try again.`);
        }

        function resolvePreviewEntries(entries, source) {
            if (!Array.isArray(entries)) return [];
            if (!Array.isArray(source.nestedGroupPath) || source.nestedGroupPath.length === 0) {
                return entries;
            }
            let current = entries;
            for (const step of source.nestedGroupPath) {
                const stepName = String(step && step.name || '');
                const stepIndex = Number(step && step.index) || 0;
                let seen = 0;
                let nextEntries = null;
                for (const item of current) {
                    const itemName = Object.keys(item || {})[0] || '';
                    if (itemName !== stepName) continue;
                    if (seen === stepIndex) {
                        nextEntries = Array.isArray(item[itemName]) ? item[itemName] : [];
                        break;
                    }
                    seen++;
                }
                if (!nextEntries) {
                    throw new Error(`Nested group "${stepName}" is no longer available. Refresh the dashboard and try again.`);
                }
                current = nextEntries;
            }
            return current;
        }

        function findPreviewNestedGroup(source) {
            if (!Array.isArray(source.nestedGroupPath) || source.nestedGroupPath.length === 0) {
                throw new Error('A nested service group path is required.');
            }
            const { services: entries } = findPreviewGroup(source);
            const parentEntries = resolvePreviewEntries(entries, { ...source, nestedGroupPath: source.nestedGroupPath.slice(0, -1) });
            const lastStep = source.nestedGroupPath[source.nestedGroupPath.length - 1];
            const stepName = String(lastStep && lastStep.name || '');
            const stepIndex = Number(lastStep && lastStep.index) || 0;
            let seen = 0;
            for (const item of parentEntries) {
                const itemName = Object.keys(item || {})[0] || '';
                if (itemName !== stepName) continue;
                if (seen === stepIndex) {
                    return { groupName: stepName, entries: Array.isArray(item[itemName]) ? item[itemName] : [] };
                }
                seen++;
            }
            throw new Error(`Nested group "${stepName}" is no longer available. Refresh the dashboard and try again.`);
        }

        function findPreviewBookmarkGroup(source) {
            const bookmarks = parseTabConfig('bookmarks');
            if (bookmarks.error || !Array.isArray(bookmarks.data)) {
                throw new Error('Fix the bookmarks.yaml error shown on the dashboard before editing it.');
            }
            let seen = 0;
            for (const group of bookmarks.data) {
                const groupName = Object.keys(group || {})[0] || '';
                if (groupName !== source.groupName) continue;
                if (seen === (Number(source.groupIndex) || 0)) {
                    return {
                        group,
                        groupName,
                        groupIndex: seen,
                        entries: Array.isArray(group[groupName]) ? group[groupName] : []
                    };
                }
                seen++;
            }
            throw new Error(`Bookmark group "${source.groupName}" is no longer available. Refresh the dashboard and try again.`);
        }

        function findPreviewBookmark(source) {
            const group = findPreviewBookmarkGroup(source);
            let seen = 0;
            for (const bookmark of group.entries) {
                const bookmarkName = Object.keys(bookmark || {})[0] || '';
                if (bookmarkName !== source.bookmarkName) continue;
                if (seen === (Number(source.bookmarkIndex) || 0)) {
                    const rawData = bookmark[bookmarkName];
                    const data = Array.isArray(rawData) ? rawData[0] : rawData;
                    return {
                        ...group,
                        bookmark,
                        bookmarkName,
                        bookmarkIndex: seen,
                        data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}
                    };
                }
                seen++;
            }
            throw new Error(`Bookmark "${source.bookmarkName}" is no longer available. Refresh the dashboard and try again.`);
        }



        function setPreviewOptionDefinitions(definitions) {
            setOptionDefinitions(new Map((definitions || []).map((definition) => [definition.name, definition])));
            const datalist = document.getElementById('preview-known-options');
            datalist.innerHTML = Array.from(optionDefinitions.keys())
                .map((name) => `<option value="${escapeHtml(name)}"></option>`)
                .join('');
        }

        function getOptionDefinition(name) {
            return optionDefinitions.get(String(name || '').trim()) || null;
        }

        function getPreviewOptionTarget(action) {
            if (String(action || '').startsWith('service.')) return 'service';
            if (String(action || '').startsWith('group.')) return 'group';
            if (String(action || '').startsWith('bookmark.')) return 'bookmark';
            return null;
        }

        function optionDefinitionMatchesTarget(definition, target) {
            const appliesTo = Array.isArray(definition?.appliesTo) ? definition.appliesTo : [];
            return !target || appliesTo.includes(target);
        }

        function getOptionDefinitionsForTarget(target) {
            return Array.from(optionDefinitions.values()).filter((definition) => optionDefinitionMatchesTarget(definition, target));
        }

        function getDefaultPreviewOptionFields(target, { availableTabs = [] } = {}) {
            return getOptionDefinitionsForTarget(target)
                .filter((definition) => Array.isArray(definition.defaultForAdd) && definition.defaultForAdd.includes(target))
                .sort((first, second) => {
                    const firstOrder = Number(first.defaultOrder?.[target]);
                    const secondOrder = Number(second.defaultOrder?.[target]);
                    return (Number.isFinite(firstOrder) ? firstOrder : Number.MAX_SAFE_INTEGER)
                        - (Number.isFinite(secondOrder) ? secondOrder : Number.MAX_SAFE_INTEGER);
                })
                .filter((definition) => definition.type !== 'tab' || availableTabs.length > 0)
                .map((definition) => ({ key: definition.name, value: '' }));
        }

        function getPreviewOptionFields(value, { commented = false } = {}) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            return Object.entries(value).map(([key, optionValue]) => {
                if (optionValue && typeof optionValue === 'object' && !Array.isArray(optionValue)) {
                    return { key, fields: getPreviewOptionFields(optionValue, { commented }), locked: true, commented };
                }
                if (getOptionDefinition(key)?.type === 'select' && (optionValue === null || optionValue === '')) {
                    return { key, value: '', blankValue: true, locked: true, commented };
                }
                return {
                    key,
                    value: Array.isArray(optionValue) ? JSON.stringify(optionValue) : optionValue === null ? 'null' : String(optionValue ?? ''),
                    locked: true,
                    commented
                };
            });
        }

        function markFieldsCommented(fields, commented) {
            return fields.map((field) => {
                const result = { ...field, commented };
                if (Array.isArray(field.fields)) {
                    result.fields = markFieldsCommented(field.fields, commented);
                }
                return result;
            });
        }

        function normalizePreviewOptionStyles(fields) {
            fields.forEach((field) => {
                const definition = getOptionDefinition(field.key);
                if (Array.isArray(field.fields)) {
                    if (!field.locked && definition?.type !== 'mapping' && field.fields.length === 0) {
                        delete field.fields;
                        field.value = '';
                    } else {
                        normalizePreviewOptionStyles(field.fields);
                    }
                } else if (definition?.type === 'mapping' && !field.value) {
                    delete field.value;
                    field.fields = [];
                }
            });
        }

        function readPreviewOptionRows(container) {
            return Array.from(container.children)
                .filter((child) => child.matches('[data-preview-option-row]'))
                .map((row) => {
                    const keyControl = row.querySelector(':scope > [data-preview-option-key]');
                    const key = keyControl instanceof HTMLInputElement || keyControl instanceof HTMLSelectElement
                        ? keyControl.value : keyControl.textContent;
                    const locked = row.dataset.previewOptionLocked === 'true';
                    const commented = row.dataset.previewOptionCommented === 'true';
                    const nested = row.querySelector(':scope > [data-preview-nested-options]');
                    const booleanValue = row.querySelector(':scope > [data-preview-option-value] input:checked');
                    const valueControl = row.querySelector(':scope > [data-preview-option-value]');
                    const selectedChoice = valueControl instanceof HTMLSelectElement ? valueControl.selectedOptions[0] : null;
                    return nested
                        ? { key, fields: readPreviewOptionRows(nested), locked, commented }
                        : selectedChoice?.dataset.previewBlankChoice === 'true'
                            ? { key, value: '', blankValue: true, locked, commented }
                            : getOptionDefinition(key)?.type === 'select' && valueControl instanceof HTMLSelectElement
                                ? { key, value: valueControl.value || '', ...(valueControl.value ? { textValue: true } : {}), locked, commented }
                                : { key, value: booleanValue ? booleanValue.value : valueControl.value || '', locked, commented };
                });
        }

        function syncPreviewEditOptionState() {
            mutatePreviewEditDialogState((state) => {
                state.fields = readPreviewOptionRows(document.getElementById('preview-edit-options'));
                normalizePreviewOptionStyles(state.fields);
            });
        }

        function getPreviewEditFieldAtPath(path) {
            if (!previewEditDialogState || path === null || path === undefined || path === '') return null;
            let fields = previewEditDialogState.fields;
            let field = null;
            for (const pathIndex of String(path).split('.')) {
                field = Array.isArray(fields) ? fields[Number(pathIndex)] : null;
                if (!field) return null;
                fields = field.fields;
            }
            return field;
        }

        function updatePreviewEditTabWarning() {
            const warning = document.getElementById('preview-edit-tab-warning');
            const isGroupEdit = previewEditDialogState && previewEditDialogState.action === 'group.edit';
            const tabField = isGroupEdit && previewEditDialogState.fields.find((field) => field.key.trim() === 'tab');
            const selectedTab = tabField && typeof tabField.value === 'string' ? tabField.value.trim() : '';
            warning.hidden = !(selectedTab && selectedTab !== previewEditDialogState.originalTab);
        }

        function renderPreviewEditOptions() {
            const options = document.getElementById('preview-edit-options');
            const addButton = document.getElementById('preview-edit-add-option');
            const addOptionNote = document.getElementById('preview-edit-add-option-note');
            const state = previewEditDialogState;
            const supportsOptions = state && ['service.add', 'service.edit', 'group.add', 'group.edit', 'bookmark.add', 'bookmark.edit'].includes(state.action);
            options.hidden = !supportsOptions;
            addButton.hidden = !supportsOptions;
            addOptionNote.hidden = !supportsOptions || !state.hasAddedOption;
            if (!supportsOptions) {
                options.innerHTML = '';
                document.getElementById('preview-edit-tab-warning').hidden = true;
                return;
            }
            const optionTarget = getPreviewOptionTarget(state.action);
            function getFieldCollection(path = '') {
                if (!path) return state.fields;
                return path.split('.').reduce((fields, index) => fields[Number(index)].fields, state.fields);
            }
            function renderRows(fields, parentPath = '', currentTarget = optionTarget) {
                const availableOptionNames = getOptionDefinitionsForTarget(currentTarget).map((definition) => definition.name);
                return fields.map((field, index) => {
                const path = parentPath ? `${parentPath}.${index}` : String(index);
                const definition = getOptionDefinition(field.key);
                const optionType = definition?.type;
                const isTabOption = optionType === 'tab';
                const isSelectOption = optionType === 'select';
                const isBooleanOption = !field.fields && (optionType === 'boolean' || field.value.trim() === 'true' || field.value.trim() === 'false');
                const isTextareaOption = optionType === 'textarea';
                const isSingleLineOption = optionType === 'text';
                const tabNames = state.availableTabs || [];
                const tabOptions = [...new Set(field.value && !tabNames.includes(field.value)
                    ? [field.value, ...tabNames] : tabNames)]
                    .map((tabName) => `<option value="${escapeHtml(tabName)}"${tabName === field.value ? ' selected' : ''}>${escapeHtml(tabName)}</option>`)
                    .join('');
                const selectValues = definition?.values || [];
                const selectChoices = selectValues.map((value) => ({
                    value: value === '' ? blankSelectControlValue : value,
                    label: value === '' ? '(blank)' : value,
                    blank: value === ''
                }));
                if (field.value && !selectChoices.some((choice) => !choice.blank && choice.value === field.value)) {
                    selectChoices.unshift({ value: field.value, label: field.value, blank: false });
                }
                const selectOptions = selectChoices
                    .filter((choice, choiceIndex) => selectChoices.findIndex((candidate) => candidate.value === choice.value && candidate.blank === choice.blank) === choiceIndex)
                    .map((choice) => `<option value="${escapeHtml(choice.value)}"${choice.blank ? ' data-preview-blank-choice="true"' : ''}${choice.blank ? field.blankValue ? ' selected' : '' : choice.value === field.value && !field.blankValue ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`)
                    .join('');
                const knownOptionChoices = [...new Set([
                    ...availableOptionNames,
                    ...(field.key ? [field.key] : [])
                ])]
                    .map((optionName) => `<option value="${escapeHtml(optionName)}"${optionName === field.key ? ' selected' : ''}>${escapeHtml(optionName)}</option>`)
                    .join('');
                const valueControl = field.fields
                    ? `<div class="preview-edit-nested-options${field.key === 'widget' ? ' preview-edit-widget-options' : ''}" data-preview-nested-options>${renderRows(field.fields, path, field.key === 'widget' ? 'widget' : currentTarget)}<button type="button" class="preview-add-option" data-preview-option-add-child data-preview-option-path="${path}">+ Add ${escapeHtml(field.key || 'nested')} option</button></div>`
                    : isTabOption
                    ? `<select class="modal-input preview-edit-option-value" data-preview-option-value aria-label="Dashboard tab"><option value="" disabled${field.value ? '' : ' selected'}>Select a tab</option>${tabOptions}</select>`
                    : isSelectOption
                    ? `<select class="modal-input preview-edit-option-value" data-preview-option-value aria-label="Value for ${escapeHtml(field.key || 'option')}"><option value="" disabled${field.value || field.blankValue ? '' : ' selected'}>Select a value</option>${selectOptions}</select>`
                    : isBooleanOption
                        ? `<fieldset class="preview-edit-boolean-options" data-preview-option-value aria-label="Boolean value for ${escapeHtml(field.key || 'option')}"><legend>${escapeHtml(field.key || 'Option')}</legend><label title="true"><input type="radio" name="preview-option-${path}" value="true"${field.value === 'true' ? ' checked' : ''}><span class="preview-boolean-icon" aria-hidden="true">&#10003;</span><span class="sr-only">true</span></label><label title="false"><input type="radio" name="preview-option-${path}" value="false"${field.value === 'false' ? ' checked' : ''}><span class="preview-boolean-icon" aria-hidden="true">&times;</span><span class="sr-only">false</span></label></fieldset>`
                    : isSingleLineOption
                        ? `<input type="text" class="modal-input preview-edit-option-value" data-preview-option-value aria-label="Value for ${escapeHtml(field.key || 'option')}" value="${escapeHtml(field.value)}" placeholder="Value">`
                    : `<textarea class="modal-input preview-edit-option-value${isTextareaOption && (definition.rows || 2) > 2 ? ' preview-edit-option-description' : ''}" data-preview-option-value aria-label="Value for ${escapeHtml(field.key || 'option')}" rows="${isTextareaOption ? (definition.rows || 2) : 2}" placeholder="Value">${escapeHtml(field.value)}</textarea>`;
                const keyControl = field.locked
                    ? `<span class="preview-edit-option-key" data-preview-option-key>${escapeHtml(field.key)}</span>`
                    : `<select class="modal-input" data-preview-option-key aria-label="Option name"><option value="" disabled${field.key ? '' : ' selected'}>Choose an option</option>${knownOptionChoices}</select>`;
                const isCommentedOption = field.commented === true;
                return `<div class="preview-edit-option-row${field.fields ? ' has-nested-options' : ''}${isCommentedOption ? ' preview-edit-option-row--commented' : ''}" data-preview-option-row data-preview-option-path="${path}" data-preview-option-locked="${field.locked ? 'true' : 'false'}" data-preview-option-commented="${isCommentedOption ? 'true' : 'false'}" ${isCommentedOption ? '' : getDragItemAttributes('edit-option', null, index, parentPath)} data-preview-drop-kind="edit-option" data-preview-drop-index="${index}">
                ${keyControl}
                ${valueControl}
                <span class="preview-edit-actions preview-edit-option-actions">
                    <button type="button" class="preview-edit-action preview-edit-comment" data-preview-option-action="comment" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="${isCommentedOption ? 'Uncomment' : 'Comment'} ${escapeHtml(field.key || 'option')}">#<span class="preview-control-label preview-edit-action-label" aria-hidden="true">${isCommentedOption ? 'Uncomment' : 'Comment'} option</span></button>
                    ${isCommentedOption ? '' : `<button type="button" class="preview-edit-action preview-edit-move-up" data-preview-option-action="up" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Move ${escapeHtml(field.key || 'option')} up"${index === 0 ? ' disabled' : ''}>&uarr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move option up</span></button>`}
                    ${isCommentedOption ? '' : `<button type="button" class="preview-edit-action preview-edit-move-down" data-preview-option-action="down" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Move ${escapeHtml(field.key || 'option')} down"${index === fields.length - 1 ? ' disabled' : ''}>&darr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move option down</span></button>`}
                    <button type="button" class="preview-edit-action preview-edit-delete" data-preview-option-action="remove" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Remove ${escapeHtml(field.key || 'option')}">&times;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Remove option</span></button>
                </span>
            </div>`;
                }).join('');
            }
            options.innerHTML = renderRows(state.fields) || '<p class="preview-edit-note">No options are currently configured.</p>';
            updatePreviewEditTabWarning();
        }

        function getServiceGroupMoveChoices(source) {
            const settings = parseTabConfig('settings');
            const services = parseTabConfig('services');
            if (settings.error || services.error || !Array.isArray(services.data)) {
                return { tabs: [], choices: [] };
            }
            const tabInfo = getHomepageTabInfo(settings.data);
            if (tabInfo.tabs.length === 0) return { tabs: [], choices: [] };
            const occurrences = new Map();
            const choices = services.data.map((group) => {
                const groupName = Object.keys(group || {})[0] || '';
                const groupIndex = occurrences.get(groupName) || 0;
                occurrences.set(groupName, groupIndex + 1);
                const layout = tabInfo.groupLayout[groupName];
                const tabName = layout && typeof layout === 'object' ? String(layout.tab || '').trim() : '';
                return {
                    groupName,
                    groupIndex,
                    tabName,
                    current: groupName === source.groupName && groupIndex === (Number(source.groupIndex) || 0)
                };
            }).filter((choice) => choice.groupName);
            return { tabs: tabInfo.tabs, choices };
        }

        function renderPreviewEditServiceLocation() {
            const section = document.getElementById('preview-edit-service-location');
            const select = document.getElementById('preview-edit-service-group');
            const state = previewEditDialogState;
            const choices = state?.serviceGroupChoices || [];
            const isCommented = state?.source?.commented === true;
            const visible = state?.action === 'service.edit' && !isCommented && (state.availableTabs || []).length > 0 && choices.length > 0;
            section.hidden = !visible;
            if (!visible) {
                select.innerHTML = '';
                return;
            }
            select.innerHTML = choices.map((choice, index) => {
                const location = choice.tabName ? `${choice.tabName} tab` : 'All tabs';
                return `<option value="${index}"${choice.current ? ' selected' : ''}>${escapeHtml(choice.groupName)} — ${escapeHtml(location)}</option>`;
            }).join('');
        }

        function renderPreviewEditGroupLocation() {
            const section = document.getElementById('preview-edit-group-location');
            const select = document.getElementById('preview-edit-group-tab');
            const state = previewEditDialogState;
            const tabs = state?.availableTabs || [];
            const isNestedGroup = state?.action === 'group.edit' && Array.isArray(state?.source?.nestedGroupPath) && state.source.nestedGroupPath.length > 0;
            const visible = state?.action === 'group.edit' && tabs.length > 0 && !isNestedGroup;
            section.hidden = !visible;
            if (!visible) {
                select.innerHTML = '';
                return;
            }
            select.innerHTML = [
                `<option value=""${state.originalTab ? '' : ' selected'}>All tabs</option>`,
                ...tabs.map((tabName) => `<option value="${escapeHtml(tabName)}"${tabName === state.originalTab ? ' selected' : ''}>${escapeHtml(tabName)}</option>`)
            ].join('');
        }

        function renderPreviewEditGroupNested() {
            const section = document.getElementById('preview-edit-group-nested');
            const state = previewEditDialogState;
            const visible = state?.action === 'group.edit';
            section.hidden = !visible;
            if (!visible) {
                section.innerHTML = '';
                return;
            }
            const source = state.source;
            const isNestedGroup = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0;
            // Nested groups themselves should not show convert or sub-group controls
            if (isNestedGroup) {
                section.innerHTML = '';
                section.hidden = true;
                return;
            }
            let entries;
            try {
                entries = findPreviewGroup(source).services;
            } catch (error) {
                section.innerHTML = `<p class="preview-edit-note">${escapeHtml(error.message)}</p>`;
                return;
            }
            const nestedSubGroups = Array.isArray(entries) ? entries.filter(isNestedServiceGroup) : [];
            const hasNestedSubGroups = nestedSubGroups.length > 0;
            if (!hasNestedSubGroups) {
                section.innerHTML = `
                    <button type="button" id="preview-edit-group-convert" class="preview-add-option preview-edit-group-convert-button">Convert into a nested group</button>
                    <p class="preview-edit-note">Wraps this group's services into a single nested sub-group named "1".</p>
                `;
            } else {
                section.innerHTML = `
                    <button type="button" id="preview-edit-group-convert-back" class="preview-add-option preview-edit-group-convert-button">Convert back to normal service group</button>
                    <p class="preview-edit-note">Flattens all nested sub-groups into direct services. All services will collapse into this group.</p>
                `;
            }
        }

        function openPreviewEditDialog(action, source) {
            if (sampleModeEnabled) {
                setSaveStatus('Load a configuration directory before editing the dashboard.', 'error');
                return;
            }
            const modal = document.getElementById('preview-edit-modal');
            const title = document.getElementById('preview-edit-modal-title');
            const submit = document.getElementById('preview-edit-submit');
            const nameInput = document.getElementById('preview-edit-name');

            setPreviewEditDialogState({ action, source, fields: [], availableTabs: [] });
            setPreviewEditPreviousFocus(document.activeElement);
            setPreviewEditPreviousFocusVisible(Boolean(previewEditPreviousFocus?.matches?.(':focus-visible')));
            modal.querySelector('.modal-content').classList.toggle('preview-edit-modal-wide', ['group.add', 'group.edit'].includes(action) || action.startsWith('service.') || action.startsWith('bookmark.'));
            nameInput.value = '';
            setPreviewEditModalStatus();

            const settingsForTabs = parseTabConfig('settings');
            if (!settingsForTabs.error) {
                const availableTabs = getHomepageTabInfo(settingsForTabs.data).tabs;
                mutatePreviewEditDialogState((state) => {
                    state.availableTabs = availableTabs;
                });
            }

            if (action === 'group.add') {
                const isSubGroup = Array.isArray(source?.nestedGroupPath);
                title.textContent = isSubGroup ? `Add sub-group to ${source.groupName}` : 'Add service group';
                submit.textContent = 'Add group';
                const groupFields = getDefaultPreviewOptionFields('group', { availableTabs: previewEditDialogState.availableTabs });
                mutatePreviewEditDialogState((state) => {
                    state.fields = isSubGroup
                        ? groupFields.filter((f) => f.key !== 'tab')
                        : groupFields;
                });
            } else if (action === 'group.edit') {
                const isNestedGroup = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0;
                title.textContent = isNestedGroup ? 'Edit nested service group' : 'Edit service group';
                submit.textContent = 'Save';
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    nameInput.value = parsed ? parsed.name : source.groupName;
                    mutatePreviewEditDialogState((state) => {
                        state.fields = [];
                        state.originalTab = '';
                        state.isCommented = true;
                    });
                } else {
                    const group = isNestedGroup ? findPreviewNestedGroup(source) : findPreviewGroup(source);
                    const settings = parseTabConfig('settings');
                    if (settings.error) throw new Error('Fix the settings.yaml error shown on the dashboard before editing this group.');
                    const layout = settings.data && settings.data.layout && typeof settings.data.layout === 'object'
                        ? settings.data.layout : {};
                    nameInput.value = group.groupName;
                    const availableTabs = getHomepageTabInfo(settings.data).tabs;
                    let groupLayout;
                    if (isNestedGroup) {
                        // For nested groups, look up layout from parent group's layout config
                        const parentLayout = layout[source.groupName];
                        groupLayout = parentLayout && typeof parentLayout === 'object' && !Array.isArray(parentLayout)
                            ? parentLayout[group.groupName]
                            : null;
                    } else {
                        groupLayout = layout[group.groupName];
                    }
                    const originalTab = String(groupLayout?.tab || '').trim();
                    const groupFields = getPreviewOptionFields(groupLayout);
                    mutatePreviewEditDialogState((state) => {
                        state.availableTabs = availableTabs;
                        state.originalTab = originalTab;
                        state.groupTabFieldIndex = groupFields.findIndex((field) => field.key === 'tab');
                        state.fields = availableTabs.length > 0
                            ? groupFields.filter((field) => field.key !== 'tab')
                            : groupFields;
                    });
                }
            } else if (action === 'service.add') {
                const targetGroupName = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0
                    ? source.nestedGroupPath[source.nestedGroupPath.length - 1].name
                    : source.groupName;
                title.textContent = `Add service to ${targetGroupName}`;
                submit.textContent = 'Add service';
                mutatePreviewEditDialogState((state) => {
                    state.fields = getDefaultPreviewOptionFields('service');
                });
            } else if (action === 'service.edit') {
                let serviceName;
                let serviceData;
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    serviceName = parsed ? parsed.name : source.serviceName;
                    serviceData = parsed ? parsed.data : {};
                } else {
                    const service = findPreviewService(source);
                    serviceName = service.serviceName;
                    serviceData = service.data;
                }
                const groupMoveData = getServiceGroupMoveChoices(source);
                title.textContent = 'Edit service';
                submit.textContent = 'Save';
                nameInput.value = serviceName;
                const serviceFields = getPreviewOptionFields(serviceData, { commented: source.commented === true });
                const serviceFieldsWithComments = source.commented !== true
                    ? appendCommentedSubOptions(source, serviceFields)
                    : serviceFields;
                mutatePreviewEditDialogState((state) => {
                    if (source.commented === true) state.isCommented = true;
                    state.fields = serviceFieldsWithComments;
                    state.availableTabs = groupMoveData.tabs;
                    state.serviceGroupChoices = groupMoveData.choices;
                });
            } else if (action === 'bookmark-group.add') {
                title.textContent = 'Add bookmark group';
                submit.textContent = 'Add group';
            } else if (action === 'bookmark-group.edit') {
                title.textContent = 'Edit bookmark group';
                submit.textContent = 'Save';
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    nameInput.value = parsed ? parsed.name : source.groupName;
                    mutatePreviewEditDialogState((state) => {
                        state.isCommented = true;
                    });
                } else {
                    const group = findPreviewBookmarkGroup(source);
                    nameInput.value = group.groupName;
                }
            } else if (action === 'bookmark.add') {
                title.textContent = `Add bookmark to ${source.groupName}`;
                submit.textContent = 'Add bookmark';
                mutatePreviewEditDialogState((state) => {
                    state.fields = getDefaultPreviewOptionFields('bookmark');
                });
            } else if (action === 'bookmark.edit') {
                let bookmarkName;
                let bookmarkData;
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    bookmarkName = parsed ? parsed.name : source.bookmarkName;
                    bookmarkData = parsed ? parsed.data : {};
                } else {
                    const bookmark = findPreviewBookmark(source);
                    bookmarkName = bookmark.bookmarkName;
                    bookmarkData = bookmark.data;
                }
                title.textContent = 'Edit bookmark';
                submit.textContent = 'Save';
                nameInput.value = bookmarkName;
                const bookmarkFields = getPreviewOptionFields(bookmarkData, { commented: source.commented === true });
                const bookmarkFieldsWithComments = source.commented !== true
                    ? appendCommentedSubOptions(source, bookmarkFields)
                    : bookmarkFields;
                mutatePreviewEditDialogState((state) => {
                    if (source.commented === true) state.isCommented = true;
                    state.fields = bookmarkFieldsWithComments;
                });
            } else if (action === 'widget.edit') {
                title.textContent = 'Edit widget';
                submit.textContent = 'Save';
                const parsed = parseCommentedBlockData(source);
                nameInput.value = parsed ? parsed.name : source.name;
                const widgetFields = getPreviewOptionFields(parsed ? parsed.data : {}, { commented: source.commented === true });
                const widgetFieldsWithComments = source.commented !== true
                    ? appendCommentedSubOptions(source, widgetFields)
                    : widgetFields;
                mutatePreviewEditDialogState((state) => {
                    if (source.commented === true) state.isCommented = true;
                    state.fields = widgetFieldsWithComments;
                });
            }

            renderPreviewEditOptions();
            renderPreviewEditServiceLocation();
            renderPreviewEditGroupLocation();
            renderPreviewEditGroupNested();
            modal.hidden = false;
            window.requestAnimationFrame(() => {
                nameInput.focus();
                if (action.endsWith('.edit')) nameInput.select();
            });
        }

        function closePreviewEditDialog() {
            const modal = document.getElementById('preview-edit-modal');
            if (modal.hidden) return;
            modal.hidden = true;
            setPreviewEditDialogState(null);
            setPreviewEditModalStatus();
            if (previewEditPreviousFocusVisible && previewEditPreviousFocus && typeof previewEditPreviousFocus.focus === 'function') {
                previewEditPreviousFocus.focus();
            } else if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
            setPreviewEditPreviousFocus(null);
            setPreviewEditPreviousFocusVisible(false);
        }

        function replacePreviewEditedFiles(files) {
            setApplyingPreviewFiles(true);
            try {
                for (const tabName of configTabNames) {
                    if (typeof files?.[tabName] === 'string') setLoadedFileContent(tabName, files[tabName]);
                }
                if (typeof files?.[currentTab] === 'string' && getEditorValue() !== files[currentTab]) {
                    const lastLine = Math.max(0, yamlCodeEditor.lineCount() - 1);
                    const lastCharacter = (yamlCodeEditor.getLine(lastLine) || '').length;
                    yamlCodeEditor.operation(() => {
                        yamlCodeEditor.replaceRange(
                            files[currentTab],
                            { line: 0, ch: 0 },
                            { line: lastLine, ch: lastCharacter },
                            '+previewEdit'
                        );
                    });
                    setLoadedFileContent(currentTab, getEditorValue());
                }
            } finally {
                setApplyingPreviewFiles(false);
            }
            updateUnsavedIndicators();
            updatePreview({ force: true });
        }

        function updatePreviewUndoButton() {
            document.getElementById('preview-undo-button').hidden = !previewUndoState;
        }

        async function applyPreviewEdit(operation, successMessage) {
            if (sampleModeEnabled) return false;
            const beforeFiles = {
                services: getTabYamlText('services'),
                settings: getTabYamlText('settings'),
                bookmarks: getTabYamlText('bookmarks')
            };
            try {
                const data = await transformPreviewYaml(beforeFiles, operation);
                setPreviewUndoState({ files: beforeFiles, message: successMessage });
                replacePreviewEditedFiles(data.files);
                updatePreviewUndoButton();
                setSaveStatus(`${successMessage} Save to write the pending YAML changes.`, 'info');
                return true;
            } catch (error) {
                setSaveStatus(`Could not edit the dashboard: ${addErrorGuidance(error, 'Check the item name and YAML structure, then try again')}`, 'error');
                return false;
            }
        }

        async function submitPreviewEditForm(event) {
            event.preventDefault();
            if (!previewEditDialogState) return;
            const name = document.getElementById('preview-edit-name').value.trim();
            if (!name) {
                setPreviewEditModalStatus('Enter a name to continue.');
                document.getElementById('preview-edit-name').focus();
                return;
            }
            const { action, source } = previewEditDialogState;
            const isCommented = source && source.commented === true;
            syncPreviewEditOptionState();
            let selectedGroupTab = '';
            let groupTabChanged = false;
            if (action === 'group.edit' && previewEditDialogState.availableTabs?.length) {
                selectedGroupTab = document.getElementById('preview-edit-group-tab').value.trim();
                groupTabChanged = selectedGroupTab !== previewEditDialogState.originalTab;
                mutatePreviewEditDialogState((state) => {
                    state.fields = state.fields.filter((field) => field.key.trim() !== 'tab');
                    if (selectedGroupTab) {
                        const insertionIndex = state.groupTabFieldIndex >= 0
                            ? Math.min(state.groupTabFieldIndex, state.fields.length)
                            : state.fields.length;
                        state.fields.splice(insertionIndex, 0, {
                            key: 'tab',
                            value: selectedGroupTab,
                            locked: true
                        });
                    }
                });
            }
            const normalizeFields = (currentFields) => currentFields.map((field) => ({
                key: field.key.trim(),
                ...(Array.isArray(field.fields)
                    ? { fields: normalizeFields(field.fields) }
                    : {
                        value: field.value,
                        ...(field.textValue ? { textValue: true } : {}),
                        ...(field.blankValue ? { blankValue: true } : {})
                    }),
                ...(field.commented ? { commented: true } : {})
            }));
            const fields = normalizeFields(previewEditDialogState.fields);
            const findInvalidField = (currentFields) => currentFields.find((field, index) => (
                !field.key || currentFields.findIndex((candidate) => candidate.key === field.key) !== index ||
                (Array.isArray(field.fields) && findInvalidField(field.fields))
            ));
            const duplicateKey = findInvalidField(fields);
            if (duplicateKey) {
                setPreviewEditModalStatus(!duplicateKey.key
                    ? 'Every option needs a name.'
                    : `The option "${duplicateKey.key}" is listed more than once.`);
                return;
            }
            if (['group.add', 'group.edit'].includes(action) && fields.some((field) => field.key === 'tab' && !field.value.trim())) {
                setPreviewEditModalStatus('Choose a dashboard tab or remove the tab option.');
                return;
            }
            if (['bookmark.add', 'bookmark.edit'].includes(action)
                && !fields.some((field) => field.key === 'href' && String(field.value || '').trim())) {
                setPreviewEditModalStatus('Add a bookmark URL in the href option.');
                return;
            }
            const values = { name, fields };
            const operation = { type: action, target: source, values };
            if (action === 'group.add' || action === 'group.edit') {
                operation.groupOptionNames = getOptionDefinitionsForTarget('group').map((definition) => definition.name);
            }
            let destinationGroupName = '';
            if (action === 'service.edit' && previewEditDialogState.serviceGroupChoices?.length) {
                const selectedIndex = Number(document.getElementById('preview-edit-service-group').value);
                const destination = previewEditDialogState.serviceGroupChoices[selectedIndex];
                if (destination && !destination.current) {
                    operation.destinationTarget = {
                        groupName: destination.groupName,
                        groupIndex: destination.groupIndex
                    };
                    destinationGroupName = destination.groupName;
                }
            }
            const submitButton = document.getElementById('preview-edit-submit');
            submitButton.disabled = true;
            setPreviewEditModalStatus();
            const isSubGroup = action === 'group.add' && Array.isArray(source?.nestedGroupPath);
            const message = action === 'group.add'
                ? isSubGroup ? `Added sub-group ${name} to ${source.groupName}.` : `Added group ${name}.`
                : action === 'group.edit'
                    ? groupTabChanged
                        ? selectedGroupTab
                            ? `Updated group ${name} and moved it to the ${selectedGroupTab} tab.`
                            : `Updated group ${name} and made it visible on all tabs.`
                        : `Updated group ${name}.`
                    : action === 'service.add'
                        ? `Added service ${name}.`
                        : action === 'service.edit'
                            ? destinationGroupName
                                ? `Updated service ${name} and moved it to ${destinationGroupName}.`
                                : `Updated service ${name}.`
                            : action === 'bookmark-group.add'
                                ? `Added bookmark group ${name}.`
                                : action === 'bookmark-group.edit'
                                    ? `Updated bookmark group ${name}.`
                                    : action === 'bookmark.add'
                                        ? `Added bookmark ${name}.`
                                        : action === 'bookmark.edit'
                                            ? `Updated bookmark ${name}.`
                                            : `Updated widget ${name}.`;
            const applied = isCommented
                ? await applyCommentedPreviewEdit(operation, message)
                : await applyPreviewEdit(operation, message);
            submitButton.disabled = false;
            if (applied) closePreviewEditDialog();
            else setPreviewEditModalStatus('Could not apply the edit. See the application notification for the reason.');
        }

        function undoPreviewEdit() {
            if (!previewUndoState) return;
            const undoState = previewUndoState;
            setPreviewUndoState(null);
            replacePreviewEditedFiles(undoState.files);
            updatePreviewUndoButton();
            setSaveStatus(`Undid: ${undoState.message}`, 'info');
        }

        async function handlePreviewEditAction(action, source) {
            try {
            if (action === 'service.comment' || action === 'group.comment' || action === 'bookmark.comment' || action === 'bookmark-group.comment' || action === 'widget.comment') {
                    toggleCommentBlock(source);
                    return;
                }
                if (source && source.commented === true) {
                    if (['service.edit', 'group.edit', 'bookmark.edit', 'bookmark-group.edit', 'widget.edit'].includes(action)) {
                        openPreviewEditDialog(action, source);
                        return;
                    }
                    if (action === 'widget.remove') {
                        const confirmed = await showConfirmationDialog({
                            title: 'Delete widget?',
                            message: `Delete commented widget ${source.name}? Its complete YAML block will be removed.`,
                            confirmText: 'Delete widget'
                        });
                        if (confirmed) {
                            await applyCommentedPreviewEdit(
                                { type: 'widget.remove', target: source },
                                `Deleted commented widget ${source.name}.`
                            );
                        }
                        return;
                    }
                    const operationMap = {
                        'service.remove': { type: 'service.remove', label: 'service' },
                        'service.duplicate': { type: 'service.duplicate', label: 'service' },
                        'service.move-up': { type: 'service.move', label: 'service', direction: 'up' },
                        'service.move-down': { type: 'service.move', label: 'service', direction: 'down' },
                        'group.remove': { type: 'group.remove', label: 'group' },
                        'group.duplicate': { type: 'group.duplicate', label: 'group' },
                        'group.move-up': { type: 'group.move', label: 'group', direction: 'up' },
                        'group.move-down': { type: 'group.move', label: 'group', direction: 'down' },
                        'bookmark.remove': { type: 'bookmark.remove', label: 'bookmark' },
                        'bookmark.duplicate': { type: 'bookmark.duplicate', label: 'bookmark' },
                        'bookmark.move-up': { type: 'bookmark.move', label: 'bookmark', direction: 'up' },
                        'bookmark.move-down': { type: 'bookmark.move', label: 'bookmark', direction: 'down' },
                        'bookmark-group.remove': { type: 'bookmark-group.remove', label: 'bookmark group' },
                        'bookmark-group.duplicate': { type: 'bookmark-group.duplicate', label: 'bookmark group' },
                        'bookmark-group.move-up': { type: 'bookmark-group.move', label: 'bookmark group', direction: 'up' },
                        'bookmark-group.move-down': { type: 'bookmark-group.move', label: 'bookmark group', direction: 'down' }
                    };
                    const mapped = operationMap[action];
                    if (!mapped) {
                        setSaveStatus('This action is not supported for commented items yet.', 'error');
                        return;
                    }
                    const itemName = source.serviceName || source.groupName || 'item';
                    const isRemove = mapped.type.endsWith('.remove');
                    if (isRemove) {
                        const confirmed = await showConfirmationDialog({
                            title: `Delete commented ${mapped.label}?`,
                            message: `Delete commented ${mapped.label} ${itemName}? Its complete YAML block will be removed.`,
                            confirmText: `Delete ${mapped.label}`
                        });
                        if (!confirmed) return;
                    }
                    const operation = { type: mapped.type, target: source };
                    if (mapped.direction) operation.direction = mapped.direction;
                    const [itemType, opType] = mapped.type.split('.');
                    const actionLabel = opType === 'remove' ? 'Deleted' : opType === 'duplicate' ? 'Duplicated' : 'Moved';
                    const directionPart = mapped.direction ? ` ${mapped.direction}` : '';
                    const message = `${actionLabel} commented ${itemType.replace('-', ' ')} ${itemName}${directionPart}.`;
                    await applyCommentedPreviewEdit(operation, message);
                    return;
                }
            if (action === 'tab.edit') {
                    enterTabRenameMode(source && source.name);
                    return;
                }
                if (['group.add', 'group.edit', 'service.add', 'service.edit', 'bookmark-group.add', 'bookmark-group.edit', 'bookmark.add', 'bookmark.edit'].includes(action)) {
                    openPreviewEditDialog(action, source);
                    return;
                }
                if (action === 'service.duplicate') {
                    const operation = { type: 'service.duplicate', target: source };
                    const message = `Duplicated service ${source.serviceName}.`;
                    if (previewShowCommentsState) {
                        await applyClientSidePreviewEdit(operation, message);
                    } else {
                        await applyPreviewEdit(operation, message);
                    }
                    return;
                }
                if (action === 'service.move-up' || action === 'service.move-down') {
                    const direction = action.endsWith('up') ? 'up' : 'down';
                    const operation = { type: 'service.move', target: source, direction };
                    const message = `Moved service ${source.serviceName} ${direction}.`;
                    if (previewShowCommentsState) {
                        await applyClientSidePreviewEdit(operation, message);
                    } else {
                        await applyPreviewEdit(operation, message);
                    }
                    return;
                }
                if (action === 'group.move-up' || action === 'group.move-down') {
                    const direction = action.endsWith('up') ? 'up' : 'down';
                    const displayName = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0
                        ? source.nestedGroupPath[source.nestedGroupPath.length - 1].name
                        : source.groupName;
                    const operation = { type: 'group.move', target: source, direction };
                    const message = `Moved group ${displayName} ${direction}.`;
                    if (previewShowCommentsState) {
                        await applyClientSidePreviewEdit(operation, message);
                    } else {
                        await applyPreviewEdit(operation, message);
                    }
                    return;
                }
                if (action === 'bookmark-group.move-up' || action === 'bookmark-group.move-down') {
                    const direction = action.endsWith('up') ? 'up' : 'down';
                    const operation = { type: 'bookmark-group.move', target: source, direction };
                    const message = `Moved bookmark group ${source.groupName} ${direction}.`;
                    if (previewShowCommentsState) {
                        await applyClientSidePreviewEdit(operation, message);
                    } else {
                        await applyPreviewEdit(operation, message);
                    }
                    return;
                }
                if (action === 'bookmark.move-up' || action === 'bookmark.move-down') {
                    const direction = action.endsWith('up') ? 'up' : 'down';
                    const operation = { type: 'bookmark.move', target: source, direction };
                    const message = `Moved bookmark ${source.bookmarkName} ${direction}.`;
                    if (previewShowCommentsState) {
                        await applyClientSidePreviewEdit(operation, message);
                    } else {
                        await applyPreviewEdit(operation, message);
                    }
                    return;
                }
                if (action === 'service.remove') {
                    const fromGroupName = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0
                        ? source.nestedGroupPath[source.nestedGroupPath.length - 1].name
                        : source.groupName;
                    const confirmed = await showConfirmationDialog({
                        title: 'Delete service?',
                        message: `Delete ${source.serviceName} from ${fromGroupName}? Its complete YAML block will be removed.`,
                        confirmText: 'Delete service'
                    });
                    if (confirmed) {
                        const operation = { type: 'service.remove', target: source };
                        const message = `Deleted service ${source.serviceName}.`;
                        if (previewShowCommentsState) {
                            await applyClientSidePreviewEdit(operation, message);
                        } else {
                            await applyPreviewEdit(operation, message);
                        }
                    }
                    return;
                }
                if (action === 'group.remove') {
                    const isNestedGroup = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0;
                    const group = isNestedGroup ? findPreviewNestedGroup(source) : findPreviewGroup(source);
                    const count = (isNestedGroup ? group.entries : group.services).length;
                    const displayName = group.groupName;
                    const confirmed = await showConfirmationDialog({
                        title: isNestedGroup ? 'Delete nested service group?' : 'Delete service group?',
                        message: `Delete ${displayName} and ${count} service${count === 1 ? '' : 's'}? A matching settings.yaml layout entry will also be removed.`,
                        confirmText: 'Delete group'
                    });
                    if (confirmed) {
                        const operation = { type: 'group.remove', target: source };
                        const message = `Deleted group ${displayName}.`;
                        if (previewShowCommentsState) {
                            await applyClientSidePreviewEdit(operation, message);
                        } else {
                            await applyPreviewEdit(operation, message);
                        }
                    }
                    return;
                }
                if (action === 'bookmark.remove') {
                    const confirmed = await showConfirmationDialog({
                        title: 'Delete bookmark?',
                        message: `Delete ${source.bookmarkName} from ${source.groupName}? Its complete YAML block will be removed.`,
                        confirmText: 'Delete bookmark'
                    });
                    if (confirmed) {
                        const operation = { type: 'bookmark.remove', target: source };
                        const message = `Deleted bookmark ${source.bookmarkName}.`;
                        if (previewShowCommentsState) {
                            await applyClientSidePreviewEdit(operation, message);
                        } else {
                            await applyPreviewEdit(operation, message);
                        }
                    }
                    return;
                }
                if (action === 'bookmark-group.remove') {
                    const group = findPreviewBookmarkGroup(source);
                    const count = group.entries.length;
                    const confirmed = await showConfirmationDialog({
                        title: 'Delete bookmark group?',
                        message: `Delete ${source.groupName} and ${count} bookmark${count === 1 ? '' : 's'}?`,
                        confirmText: 'Delete group'
                    });
                    if (confirmed) {
                        const operation = { type: 'bookmark-group.remove', target: source };
                        const message = `Deleted bookmark group ${source.groupName}.`;
                        if (previewShowCommentsState) {
                            await applyClientSidePreviewEdit(operation, message);
                        } else {
                            await applyPreviewEdit(operation, message);
                        }
                    }
                    return;
                }
                if (action === 'tab.remove') {
                    const settingsData = parseTabConfig('settings').data;
                    const tabInfo = getHomepageTabInfo(settingsData);
                    const tabName = source && source.name;
                    const groupCount = tabInfo && tabInfo.groupsByTab ? (tabInfo.groupsByTab[tabName] || []).length : 0;
                    const confirmed = await showConfirmationDialog({
                        title: 'Remove tab?',
                        message: `Remove ${tabName}? ${groupCount} assigned group${groupCount === 1 ? '' : 's'} will become visible on every tab. No groups or services will be deleted.`,
                        confirmText: 'Remove tab'
                    });
                    if (confirmed) {
                        await applyPreviewEdit(
                            { type: 'tab.remove', target: { name: tabName } },
                            `Removed tab ${tabName}.`
                        );
                    }
                }
            } catch (error) {
                setSaveStatus(`Could not edit the dashboard: ${addErrorGuidance(error, 'Check the item name and YAML structure, then try again')}`, 'error');
            }
        }

export function updateVisualPreview() {
    const previewDiv = document.getElementById('visual-preview');
    const parsed = Object.fromEntries(
        configTabNames.map((tabName) => [tabName, parseTabConfig(tabName)])
    );
    const previewEditToggleElement = document.getElementById('preview-edit-toggle');
    previewEditToggleElement.disabled = sampleModeEnabled || Boolean(parsed.services.error);
    const previewEditMode = previewEditToggleElement.checked && !previewEditToggleElement.disabled;
    syncPreviewEditModePresentation(previewEditMode);
    const previewNotices = [];
    const addPreviewNotice = (message) => previewNotices.push(message);
    if (previewEditMode) {
        addPreviewNotice('Dashboard editing is on. Changes update the YAML editor and remain pending until Save is clicked.');
    }

    let services = Array.isArray(parsed.services.data) ? parsed.services.data : [];
    let bookmarks = Array.isArray(parsed.bookmarks.data) ? parsed.bookmarks.data : [];
    const widgetsData = parsed.widgets.data;
    const widgetDataOccurrences = new Map();
    if (Array.isArray(widgetsData)) {
        widgetsData.forEach((item) => {
            const name = Object.keys(item || {})[0];
            if (!name) return;
            if (!widgetDataOccurrences.has(name)) widgetDataOccurrences.set(name, []);
            widgetDataOccurrences.get(name).push(item[name]);
        });
    }
    const widgets = Array.isArray(widgetsData)
        ? widgetsData.map((item) => Object.keys(item || {})[0]).filter(Boolean)
        : widgetsData && typeof widgetsData === 'object'
            ? Object.keys(widgetsData)
            : [];
    const previewWidgets = widgets.filter((name) => !['search', 'resources'].includes(String(name).trim().toLowerCase()));

    // Merge commented-out items when showComments is enabled (Interactive Editor only)
    if (previewShowCommentsState && previewEditMode && !parsed.services.error) {
        try {
            // Deep-clone services to avoid mutating the parsed-config cache
            function deepCloneEntry(item) {
                if (!item || typeof item !== 'object') return item;
                if (Array.isArray(item)) return item.map(deepCloneEntry);
                const name = Object.keys(item)[0];
                if (name) {
                    const val = item[name];
                    if (Array.isArray(val)) {
                        return { [name]: val.map(deepCloneEntry), ...(item.__commented !== undefined ? { __commented: item.__commented } : {}) };
                    }
                }
                return { ...item };
            }
            services = services.map((group) => {
                const name = Object.keys(group || {})[0];
                if (!name) return group;
                const value = group[name];
                if (Array.isArray(value)) {
                    return { [name]: value.map(deepCloneEntry) };
                }
                return { [name]: value };
            });
            const servicesYamlText = getTabYamlText('services');
            // Keep the existing nested-group overlay, but let ChunkTree own
            // top-level group and direct-service ownership/order.
            const legacyCommentedServicesData = buildCommentedServicesData(servicesYamlText, services);
            legacyCommentedServicesData.nestedServicesMap.forEach((commentEntries, key) => {
                const colonIdx = key.indexOf(':');
                const groupIdx = Number(key.slice(0, colonIdx));
                const pathStr = key.slice(colonIdx + 1);
                const nestedPath = pathStr.split('/').map((s) => {
                    const bracketIdx = s.indexOf('[');
                    if (bracketIdx >= 0) {
                        return { name: s.slice(0, bracketIdx), index: Number(s.slice(bracketIdx + 1, -1)) };
                    }
                    return { name: s, index: 0 };
                });
                const group = services[groupIdx];
                if (group && nestedPath.length > 0) {
                    mergeNestedGroupEntries(group, nestedPath, commentEntries, servicesYamlText);
                }
            });
            services = buildServicesPreviewDataFromChunks(servicesYamlText, services);
        } catch (e) { console.error('[showComments] services integration failed:', e); }
    }
    if (previewShowCommentsState && previewEditMode && !parsed.bookmarks.error) {
        try {
            // Clone bookmarks to avoid mutating the parsed-config cache
            bookmarks = bookmarks.map((group) => {
                const name = Object.keys(group || {})[0];
                if (!name) return group;
                const value = group[name];
                return Array.isArray(value) ? { [name]: [...value] } : { [name]: value };
            });
            const bookmarksYamlText = getTabYamlText('bookmarks');
            const commentedBookmarksData = buildCommentedServicesData(bookmarksYamlText, bookmarks);
            const bookmarkGroupPositions = getGroupPositions(bookmarksYamlText);
            // Merge commented bookmarks into their active groups in YAML order
            commentedBookmarksData.servicesMap.forEach((commentEntries, groupIdx) => {
                try {
                    const group = bookmarks[groupIdx];
                    if (!group) return;
                    const groupName = Object.keys(group)[0];
                    if (!groupName || !Array.isArray(group[groupName])) return;
                    const groupPos = bookmarkGroupPositions[groupIdx];
                    if (!groupPos) return;
                    group[groupName] = mergeGroupEntries(group[groupName], commentEntries, groupPos.startLine, bookmarksYamlText);
                } catch (groupErr) {
                    console.error('[showComments] mergeGroupEntries failed for bookmarks group', groupIdx, groupErr);
                    const group = bookmarks[groupIdx];
                    if (group) {
                        const groupName = Object.keys(group)[0];
                        if (groupName && Array.isArray(group[groupName])) {
                            group[groupName] = group[groupName].concat(commentEntries);
                        }
                    }
                }
            });
            // Merge commented bookmark groups into the list in YAML order
            try {
                bookmarks = mergeGroupsByLine(bookmarks, commentedBookmarksData.groups, bookmarksYamlText);
            } catch (mergeErr) {
                console.error('[showComments] mergeGroupsByLine failed for bookmarks:', mergeErr);
                bookmarks = bookmarks.concat(commentedBookmarksData.groups);
            }
        } catch (e) { console.error('[showComments] bookmarks integration failed:', e); }
    }
    const commentedWidgetInfo = new Map();
    if (previewShowCommentsState && previewEditMode && !parsed.widgets.error) {
        const commentedWidgets = buildCommentedWidgetsData(getTabYamlText('widgets'));
        if (commentedWidgets.length > 0) {
            commentedWidgets.forEach((w) => {
                const name = Object.keys(w)[0];
                if (name) {
                    if (!widgetDataOccurrences.has(name)) widgetDataOccurrences.set(name, []);
                    const occIdx = widgetDataOccurrences.get(name).length;
                    widgetDataOccurrences.get(name).push(w[name]);
                    commentedWidgetInfo.set(`${name}:${occIdx}`, { startLine: w.__commentedStartLine, endLine: w.__commentedEndLine });
                }
            });
            previewWidgets.push(...commentedWidgets.map((w) => Object.keys(w)[0]).filter(Boolean));
        }
    }

    const homepageTabInfo = getHomepageTabInfo(parsed.settings.data);
    const homepageTabs = homepageTabInfo.tabs;
    const groupsByTab = homepageTabInfo.groupsByTab;
    const groupLayout = homepageTabInfo.groupLayout;
    if (homepageTabs.length > 0 && (!previewHomepageTab || !homepageTabs.includes(previewHomepageTab))) {
        setPreviewHomepageTab(homepageTabs[0]);
    }
    if (homepageTabs.length === 0) {
        setPreviewHomepageTab(null);
    }

    const errorItems = Object.entries(parsed)
        .filter(([, value]) => value.error)
        .map(([key, value]) => {
            const filename = loadedFileNames[key] || `${key}.yaml`;
            const source = { tab: key, line: value.error.line || 1 };
            return `<button type="button" class="yaml-error-card preview-jump-target" ${getSourceAttributes(source)} title="Jump to the YAML error">
                        <span class="yaml-error-file">${escapeHtml(filename)}</span>
                        <span class="yaml-error-location">${escapeHtml(formatYamlErrorLocation(value.error))}</span>
                        <span class="yaml-error-summary">${escapeHtml(value.error.summary)}</span>
                        <span class="yaml-error-action">Jump to line &rarr;</span>
                    </button>`;
        })
        .join('');

    let filteredServices = services;
    if (previewHomepageTab) {
        const allowedGroups = groupsByTab[previewHomepageTab] || [];
        if (allowedGroups.length > 0) {
            filteredServices = services.filter((group) => {
                const groupName = Object.keys(group || {})[0] || '';
                const layoutConfig = groupLayout[groupName];
                const assignedTab = layoutConfig && typeof layoutConfig === 'object'
                    ? String(layoutConfig.tab || '').trim()
                    : '';
                return allowedGroups.includes(groupName) || !assignedTab;
            });
        } else {
            filteredServices = services.filter((group) => {
                const groupName = Object.keys(group || {})[0] || '';
                const lower = groupName.toLowerCase();
                const tabLower = previewHomepageTab.toLowerCase();
                return lower.includes(`[${tabLower}]`) || lower.includes(`${tabLower}:`) || lower.startsWith(`${tabLower} `) || lower === tabLower;
            });
        }
        if (filteredServices.length === 0) {
            filteredServices = services;
        }
    }

    let groupsHtml = '';
    const groupOccurrenceCounter = new Map();
    const groupOccurrenceByItem = new Map();
    const groupPositionByItem = new Map();
    services.forEach((group, groupPosition) => {
        const name = Object.keys(group || {})[0] || '';
        const isCommented = group.__commented === true;
        groupOccurrenceByItem.set(group, isCommented ? 0 : takeOccurrence(groupOccurrenceCounter, name));
        groupPositionByItem.set(group, groupPosition);
    });

    function getPreviewLayoutAttributes(layoutConfig) {
        const style = String(layoutConfig && layoutConfig.style || '').trim().toLowerCase();
        const columns = Math.max(1, Math.min(12, Number.parseInt(layoutConfig && layoutConfig.columns, 10) || 1));
        return style === 'row'
            ? ` data-preview-layout-style="row" data-preview-card-columns="${columns}"`
            : '';
    }

    function renderPreviewServiceCards(entries, { groupName, groupIndex, layoutConfig, nested = false, nestedGroupPath = [] } = {}) {
        const servicesOnly = Array.isArray(entries) ? entries.map((entry, entryIndex) => ({ entry, entryIndex })).filter(({ entry }) => !isNestedServiceGroup(entry)) : [];
        let yamlDropIndex = 0;
        const serviceOccurrenceCounter = new Map();
        return servicesOnly.map(({ entry: service, entryIndex }, servicePosition) => {
            const name = Object.keys(service || {})[0] || 'Service';
            const isCommented = service.__commented === true;
            const serviceOccurrenceIndex = isCommented ? 0 : takeOccurrence(serviceOccurrenceCounter, name);
            const currentYamlDropIndex = isCommented ? yamlDropIndex : yamlDropIndex++;
            const data = service[name] || {};
            const directSource = {
                servicesSource: {
                    tab: 'services',
                    kind: 'service',
                    groupName,
                    groupIndex,
                    ...(nestedGroupPath.length > 0 ? { nestedGroupPath } : {}),
                    serviceName: name,
                    serviceIndex: serviceOccurrenceIndex,
                    ...(isCommented ? { commented: true, startLine: service.__commentedStartLine, endLine: service.__commentedEndLine } : {})
                },
                settingsSource: {
                    tab: 'settings',
                    kind: 'settings-layout-group',
                    groupName: nestedGroupPath.length > 0 ? nestedGroupPath[nestedGroupPath.length - 1].name : groupName
                }
            };
            const serviceIcon = renderIcon(data.icon, name);
            const serviceSourceFile = currentTab === 'settings' ? 'settings.yaml' : 'services.yaml';
            const serviceJumpLabel = nested
                ? `Nested service in ${nestedGroupPath.map((step) => step.name).join(' › ')}`
                : `Jump to this item in ${serviceSourceFile}`;
            const serviceTooltip = getPreviewTooltipAttributes([
                serviceJumpLabel,
                `Service: ${name}`,
                ...getPreviewDetailLines(data, ['description', 'href', 'icon', 'siteMonitor', 'ping', 'container', 'server']),
                ...getPreviewDetailLines(data.widget, ['type', 'url'])
            ]);
            const serviceEditControls = previewEditMode
                ? getServiceEditControls(directSource.servicesSource, servicePosition, servicesOnly.length)
                : '';
            const dropSource = { groupName, groupIndex, ...(nestedGroupPath.length > 0 ? { nestedGroupPath } : {}) };
            const serviceDragAttributes = previewEditMode
                ? `${isCommented ? '' : getDragItemAttributes('service', directSource.servicesSource, entryIndex)} data-preview-drop-kind="service" data-preview-drop-index="${currentYamlDropIndex}" data-preview-drop-commented="${isCommented ? 'true' : 'false'}" data-preview-service-drop-source="${escapeHtml(JSON.stringify(dropSource))}"`
                : '';
            return `<div class="dashboard-card preview-jump-target${isCommented ? ' dashboard-card--commented' : ''}" ${serviceDragAttributes} ${getSourceAttributes(directSource)} ${serviceTooltip}>${serviceEditControls}<div class="dashboard-card-heading">${serviceIcon}<div class="dashboard-card-title">${escapeHtml(name)}</div></div><div class="dashboard-card-desc">${escapeHtml(data.description || '')}</div></div>`;
        }).join('');
    }

    function buildNestedGroupSource(groupName, groupIndex, nestedName, nestedGroupPath, isCommented) {
        const servicesSource = {
            tab: 'services',
            kind: 'services-group',
            groupName,
            groupIndex,
            nestedGroupPath,
            ...(isCommented ? { commented: true } : {})
        };
        return {
            servicesSource,
            settingsSource: { tab: 'settings', kind: 'settings-layout-group', groupName: nestedName }
        };
    }

    function renderNestedPreviewGroups(entries, layoutConfig, groupName, groupIndex, parentPath = []) {
        if (!Array.isArray(entries)) return '';
        const nestedGroupOccurrenceCounter = new Map();
        const totalEntries = entries.length;
        return entries.map((entry, entryIndex) => {
            if (!isNestedServiceGroup(entry)) return '';
            const nestedName = Object.keys(entry)[0];
            const nestedOccurrenceIndex = takeOccurrence(nestedGroupOccurrenceCounter, nestedName);
            const nestedEntries = entry[nestedName];
            const nestedIsCommented = entry.__commented === true;
            const nestedLayout = layoutConfig && typeof layoutConfig === 'object' && !Array.isArray(layoutConfig)
                ? layoutConfig[nestedName]
                : null;
            const nestedIcon = renderIcon(nestedLayout && nestedLayout.icon, nestedName);
            const nestedGroupPath = [...parentPath, { name: nestedName, index: nestedOccurrenceIndex }];
            const nestedGroupSource = buildNestedGroupSource(groupName, groupIndex, nestedName, nestedGroupPath, nestedIsCommented);
            const nestedCards = renderPreviewServiceCards(nestedEntries, {
                groupName,
                groupIndex,
                layoutConfig: nestedLayout,
                nested: true,
                nestedGroupPath
            });
            const nestedChildren = renderNestedPreviewGroups(nestedEntries, nestedLayout, groupName, groupIndex, nestedGroupPath);
            if (!nestedCards && !nestedChildren) {
                addPreviewNotice(`No services configured in ${nestedName}.`);
            }
            const nestedGroupEditControls = previewEditMode
                ? getGroupEditControls(nestedGroupSource.servicesSource, entryIndex, totalEntries)
                : '';
            const nestedGroupTooltip = getPreviewTooltipAttributes([
                `Nested group in ${groupName}`,
                `Group: ${nestedName}`,
                `Services: ${Array.isArray(nestedEntries) ? nestedEntries.length : 0}`,
                ...getPreviewDetailLines(nestedLayout, ['icon', 'style', 'columns', 'header', 'tab'])
            ], { focusable: false });
            const addServiceButton = previewEditMode
                ? `<button type="button" class="preview-add-button preview-add-service" data-preview-action="service.add" ${getSourceAttributes(nestedGroupSource.servicesSource)}><span aria-hidden="true">+</span> Add service</button>`
                : '';
            const dropSource = { groupName, groupIndex, nestedGroupPath };
            const serviceCardsGrid = nestedCards || addServiceButton
                ? `<div class="dashboard-cards"${previewEditMode && !nestedIsCommented ? ` data-preview-service-drop-zone data-preview-service-drop-index="${Array.isArray(nestedEntries) ? nestedEntries.filter((e) => !e.__commented && !isNestedServiceGroup(e)).length : 0}" data-preview-service-drop-source="${escapeHtml(JSON.stringify(dropSource))}"` : ''}>${nestedCards}${addServiceButton}</div>`
                : '';
            const isCollapsed = isInitiallyCollapsed(nestedLayout);
            const nestedGroupClass = 'dashboard-nested-group' + (nestedIsCommented ? ' dashboard-nested-group--commented' : '');
            const nestedScope = parentPath.reduce((acc, step) => `${acc}/nested-${step.name}-${step.index}`, `group-${groupName}-${groupIndex}`);
            const nestedGroupDragAttrs = previewEditMode && !nestedIsCommented
                ? `${getDragItemAttributes('nested-group', nestedGroupSource.servicesSource, entryIndex, nestedScope)} data-preview-drop-kind="nested-group" data-preview-drop-index="${entryIndex}"`
                : '';
            return `<details class="${nestedGroupClass}" ${nestedGroupDragAttrs} ${getPreviewLayoutAttributes(nestedLayout)} ${isCollapsed ? '' : 'open'}><summary class="dashboard-nested-group-title">${nestedIcon}<span class="preview-jump-target" ${getSourceAttributes(nestedGroupSource)} ${nestedGroupTooltip}>${escapeHtml(nestedName)}</span>${nestedGroupEditControls}</summary>${serviceCardsGrid}${nestedChildren}</details>`;
        }).join('');
    }

    filteredServices.forEach((group) => {
        const groupName = Object.keys(group || {})[0];
        const groupIndex = groupOccurrenceByItem.get(group) || 0;
        const groupIsCommented = group.__commented === true;
        const entries = groupName ? group[groupName] : [];
        const layoutConfig = groupLayout[groupName];
        const isCollapsed = isInitiallyCollapsed(layoutConfig);
        const groupIcon = renderIcon(layoutConfig && layoutConfig.icon, groupName || 'Services');
        const groupSource = {
            servicesSource: { tab: 'services', kind: 'services-group', groupName, groupIndex, ...(groupIsCommented ? { commented: true, startLine: group.__commentedStartLine, endLine: group.__commentedEndLine } : {}) },
            settingsSource: { tab: 'settings', kind: 'settings-layout-group', groupName }
        };
        const serviceGroupSource = groupSource.servicesSource;
        const groupEditControls = previewEditMode
            ? getGroupEditControls(serviceGroupSource, groupPositionByItem.get(group) || 0, services.length)
            : '';
        const cards = renderPreviewServiceCards(entries, { groupName, groupIndex, layoutConfig });
        const hasNestedGroups = Array.isArray(entries) && entries.some(isNestedServiceGroup);
        const nestedGroups = renderNestedPreviewGroups(entries, layoutConfig, groupName, groupIndex);
        const groupSourceFile = currentTab === 'settings' ? 'settings.yaml' : 'services.yaml';
        const groupTooltip = getPreviewTooltipAttributes([
            `Jump to this group in ${groupSourceFile}`,
            `Group: ${groupName || 'Services'}`,
            `Services: ${Array.isArray(entries) ? entries.length : 0}`,
            ...getPreviewDetailLines(layoutConfig, ['icon', 'style', 'columns', 'header'])
        ], { focusable: false });
        const showTopLevelAddService = previewEditMode && (cards || !hasNestedGroups);
        const addServiceButton = showTopLevelAddService
            ? `<button type="button" class="preview-add-button preview-add-service" data-preview-action="service.add" ${getSourceAttributes(serviceGroupSource)}><span aria-hidden="true">+</span> Add service</button>`
            : '';
        const serviceCardsGrid = cards || addServiceButton
            ? `<div class="dashboard-cards"${previewEditMode && !groupIsCommented ? ` data-preview-service-drop-zone data-preview-service-drop-index="${Array.isArray(entries) ? entries.filter((e) => !e.__commented && !isNestedServiceGroup(e)).length : 0}" data-preview-service-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"` : ''}>${cards}${addServiceButton}</div>`
            : '';
        const groupPosition = groupPositionByItem.get(group) || 0;
        const groupDragAttributes = previewEditMode && !groupIsCommented
            ? `${getDragItemAttributes('group', serviceGroupSource, groupPosition)} data-preview-drop-kind="group" data-preview-drop-index="${groupPosition}" data-preview-service-drop data-preview-service-drop-index="${Array.isArray(entries) ? entries.filter((e) => !e.__commented && !isNestedServiceGroup(e)).length : 0}" data-preview-service-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"`
            : '';
        const groupClass = 'dashboard-group' + (groupIsCommented ? ' dashboard-group--commented' : '');
        const addSubGroupButton = previewEditMode && !groupIsCommented
            ? `<button type="button" class="preview-add-button preview-add-group" data-preview-action="group.add" ${getSourceAttributes({ tab: 'services', kind: 'services-group', groupName, groupIndex, nestedGroupPath: [] })}><span aria-hidden="true">+</span> Add service group</button>`
            : '';
        if (hasNestedGroups) {
            groupsHtml += `<details class="${groupClass} dashboard-group-nested-root" ${groupDragAttributes}${getPreviewLayoutAttributes(layoutConfig)} ${isCollapsed ? '' : 'open'}><summary class="dashboard-group-title">${groupIcon}<span class="preview-jump-target" ${getSourceAttributes(groupSource)} ${groupTooltip}>${escapeHtml(groupName || 'Services')}</span>${groupEditControls}</summary>${serviceCardsGrid}<div class="dashboard-nested-groups" data-preview-nested-columns="${getNestedGroupColumns(layoutConfig)}">${nestedGroups}</div>${addSubGroupButton}</details>`;
        } else {
            if (!cards) {
                addPreviewNotice(`No services configured in ${groupName || 'this group'}.`);
            }
            groupsHtml += `<details class="${groupClass}" ${groupDragAttributes}${getPreviewLayoutAttributes(layoutConfig)} ${isCollapsed ? '' : 'open'}><summary class="dashboard-group-title">${groupIcon}<span class="preview-jump-target" ${getSourceAttributes(groupSource)} ${groupTooltip}>${escapeHtml(groupName || 'Services')}</span>${groupEditControls}</summary>${serviceCardsGrid}</details>`;
        }
    });

    if (!parsed.widgets.error && widgets.length === 0) addPreviewNotice('No widgets configured.');
    if (!parsed.bookmarks.error && bookmarks.length === 0) addPreviewNotice('No bookmarks configured.');
    if (!parsed.services.error && services.length === 0) addPreviewNotice('No service groups configured.');

    const bookmarkGroupOccurrenceCounter = new Map();
    let bookmarkLinkCount = 0;
    const bookmarkGroupsHtml = bookmarks.map((item, groupPosition) => {
        const groupName = Object.keys(item || {})[0] || 'Bookmarks';
        const groupIndex = takeOccurrence(bookmarkGroupOccurrenceCounter, groupName);
        const groupIsCommented = item.__commented === true;
        const groupData = item[groupName];
        const entries = Array.isArray(groupData)
            ? groupData
            : groupData && typeof groupData === 'object'
                ? [{ [groupName]: groupData }]
                : [];
        const groupSource = { tab: 'bookmarks', kind: 'bookmark-group', groupName, groupIndex, ...(groupIsCommented ? { commented: true, startLine: item.__commentedStartLine, endLine: item.__commentedEndLine } : {}) };
        const groupEditControls = previewEditMode
            ? getBookmarkGroupEditControls(groupSource, groupPosition, bookmarks.length)
            : '';
        const groupTooltip = getPreviewTooltipAttributes([
            'Jump to this bookmark group in bookmarks.yaml',
            ...getBookmarkTooltipLines(groupName, groupData)
        ]);
        const bookmarkOccurrenceCounter = new Map();
        const linksHtml = entries.map((entry, bookmarkPosition) => {
            const bookmarkIsCommented = entry.__commented === true;
            const bookmarkName = Object.keys(entry || {})[0] || 'Bookmark';
            const bookmarkIndex = bookmarkIsCommented ? 0 : takeOccurrence(bookmarkOccurrenceCounter, bookmarkName);
            const rawData = entry && entry[bookmarkName];
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            const bookmarkData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
            const bookmarkSource = {
                tab: 'bookmarks',
                kind: 'bookmark',
                groupName,
                groupIndex,
                bookmarkName,
                bookmarkIndex,
                ...(bookmarkIsCommented ? { commented: true, startLine: entry.__commentedStartLine, endLine: entry.__commentedEndLine } : {})
            };
            const bookmarkEditControls = previewEditMode
                ? getBookmarkEditControls(bookmarkSource, bookmarkPosition, entries.length)
                : '';
            const href = getSafeLinkUrl(bookmarkData.href);
            const abbr = String(bookmarkData.abbr || '').trim();
            const description = bookmarkData.description == null ? '' : String(bookmarkData.description).trim();
            const bookmarkTooltip = getPreviewTooltipAttributes([
                'Jump to this item in bookmarks.yaml',
                `Bookmark: ${bookmarkName}`,
                ...getPreviewDetailLines(bookmarkData, ['description', 'href', 'icon', 'abbr']),
            ], { focusable: false });
            bookmarkLinkCount += 1;
            const bookmarkDragAttributes = previewEditMode
                ? `${getDragItemAttributes('bookmark', bookmarkSource, bookmarkPosition)} data-preview-drop-kind="bookmark" data-preview-drop-index="${bookmarkPosition}" data-preview-bookmark-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"`
                : '';
            return `<div class="bookmark-card${bookmarkIsCommented ? ' bookmark-card--commented' : ''}" ${bookmarkDragAttributes}>
                        <a class="bookmark-card-link preview-jump-target" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" ${getSourceAttributes(bookmarkSource)} ${bookmarkTooltip}>
                            <span class="bookmark-card-mark" aria-hidden="true">${abbr ? escapeHtml(abbr.slice(0, 4)) : '&#8599;'}</span>
                            <span class="bookmark-card-copy"><span class="bookmark-card-name">${escapeHtml(bookmarkName)}</span>${description ? `<span class="dashboard-card-desc">${escapeHtml(description)}</span>` : ''}</span>
                            <span class="bookmark-card-arrow" aria-hidden="true">&#8594;</span>
                        </a>
                        ${bookmarkEditControls}
                    </div>`;
        }).join('');
        const addBookmarkButton = previewEditMode
            ? `<button type="button" class="preview-add-button preview-add-bookmark" data-preview-action="bookmark.add" ${getSourceAttributes(groupSource)}><span aria-hidden="true">+</span> Add bookmark</button>`
            : '';
        const bookmarkGroupDragAttributes = previewEditMode
            ? `${getDragItemAttributes('bookmark-group', groupSource, groupPosition)} data-preview-drop-kind="bookmark-group" data-preview-drop-index="${groupPosition}" data-preview-bookmark-drop data-preview-bookmark-drop-index="${entries.length}" data-preview-bookmark-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"`
            : '';
        return `<section class="bookmark-group${groupIsCommented ? ' bookmark-group--commented' : ''}" ${bookmarkGroupDragAttributes}><div class="bookmark-group-heading"><span class="bookmark-group-title preview-jump-target" ${getSourceAttributes(groupSource)} ${groupTooltip}>${escapeHtml(groupName)}</span><span class="bookmark-group-count">${entries.length} ${entries.length === 1 ? 'link' : 'links'}</span>${groupEditControls}</div>${linksHtml ? `<div class="bookmark-links"${previewEditMode ? ` data-preview-bookmark-drop-zone data-preview-bookmark-drop-index="${entries.length}" data-preview-bookmark-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"` : ''}>${linksHtml}</div>` : '<p class="bookmark-empty">No links configured.</p>'}${addBookmarkButton}</section>`;
    }).join('');
    const addBookmarkGroupButton = previewEditMode
        ? '<button type="button" class="preview-add-button preview-add-bookmark-group" data-preview-action="bookmark-group.add"><span aria-hidden="true">+</span> Add bookmark group</button>'
        : '';
    const bookmarksHtml = (bookmarkGroupsHtml || previewEditMode)
        ? `<section class="dashboard-bookmarks">
                    <div class="bookmark-panel-heading">
                        <div class="bookmark-panel-title"><svg class="bookmark-panel-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3-6 3V4.5Z"></path></svg><span>Bookmarks</span></div>
                        <span class="bookmark-panel-count">${bookmarks.length} ${bookmarks.length === 1 ? 'group' : 'groups'} &middot; ${bookmarkLinkCount} ${bookmarkLinkCount === 1 ? 'link' : 'links'}</span>
                    </div>
                    <div class="bookmark-groups">${bookmarkGroupsHtml || '<p class="bookmark-empty">No bookmark groups configured.</p>'}</div>
                    ${addBookmarkGroupButton}
                </section>`
        : '';

    const widgetOccurrenceCounter = new Map();
    const widgetsHtml = previewWidgets.map((name) => {
        const occurrenceIndex = takeOccurrence(widgetOccurrenceCounter, name);
        const widgetIdentifier = `${name}:${occurrenceIndex}`;
        const isCommented = commentedWidgetInfo.has(widgetIdentifier);
        const widgetData = Array.isArray(widgetsData)
            ? widgetDataOccurrences.get(name)?.[occurrenceIndex]
            : widgetsData?.[name];
        const widgetTooltip = getPreviewTooltipAttributes([
            'Jump to this widget in widgets.yaml',
            `Widget: ${name}`,
            ...getPreviewDetailLines(widgetData, Object.keys(widgetData || {}))
        ]);
        const widgetLineInfo = isCommented ? commentedWidgetInfo.get(widgetIdentifier) : null;
        const widgetSource = { tab: 'widgets', kind: 'widget', name, index: occurrenceIndex, isList: Array.isArray(widgetsData), ...(isCommented ? { commented: true, startLine: widgetLineInfo.startLine, endLine: widgetLineInfo.endLine } : {}) };
        const widgetEditButton = previewEditMode && isCommented
            ? getPreviewEditActionButton('widget.edit', widgetSource, 'Edit widget', '&#9998;')
            : '';
        const widgetCommentButton = previewEditMode
            ? getPreviewEditActionButton('widget.comment', widgetSource, 'Comment/uncomment widget', '#')
            : '';
        const widgetRemoveButton = previewEditMode && isCommented
            ? getPreviewEditActionButton('widget.remove', widgetSource, 'Delete widget', '&times;', { danger: true })
            : '';
        return `<span class="widget-block preview-jump-target${isCommented ? ' widget-block--commented' : ''}" ${getSourceAttributes(widgetSource)} ${widgetTooltip}>${escapeHtml(name)}<span class="preview-edit-actions">${widgetEditButton}${widgetCommentButton}${widgetRemoveButton}</span></span>`;
    }).join('');

    const previewTabHost = document.getElementById('preview-tab-host');
    if (previewTabHost) {
        if (homepageTabs.length > 0 || previewEditMode) {
            previewTabHost.innerHTML = `<div class="preview-tab-navigation">
                        <span class="preview-tab-label">Tabs</span>
                        <div class="preview-tab-strip">
                            <div class="preview-tab-items" role="tablist" aria-label="Homepage dashboard pages">${homepageTabs.map((name, index) => {
                            const isActive = name === previewHomepageTab;
                            const tabSource = { tab: 'settings', kind: 'settings-tab', name };
                            const dragAttributes = previewEditMode ? getDragItemAttributes('tab', tabSource, index) : '';
                            const dropAttributes = previewEditMode ? ` data-preview-drop-kind="tab" data-preview-drop-index="${index}"` : '';
                            const editControls = previewEditMode ? getTabEditControls(tabSource) : '';
                            return `<span class="preview-tab" ${dragAttributes}${dropAttributes}>
                                <button type="button" role="tab" aria-selected="${isActive}" tabindex="${isActive ? '0' : '-1'}" class="preview-tab-btn ${isActive ? 'active' : ''}" data-preview-tab="${escapeHtml(name)}" ${getSourceAttributes(tabSource)}>${escapeHtml(name)}</button>
                                ${editControls}
                            </span>`;
                         }).join('')}</div>${previewEditMode ? '<button type="button" class="preview-add-button preview-add-tab" data-preview-action="tab.add"><span aria-hidden="true">+</span> Add tab</button>' : ''}</div>
                     </div>`;
        } else {
            previewTabHost.innerHTML = '';
        }
    }

    const addGroupButton = previewEditMode
        ? '<button type="button" class="preview-add-button preview-add-group" data-preview-action="group.add"><span aria-hidden="true">+</span> Add service group</button>'
        : '';
    previewDiv.innerHTML = `
                <div class="dashboard-shell ${previewEditMode ? 'preview-edit-enabled' : ''}">
                    ${errorItems ? `<div class="dashboard-errors">${errorItems}</div>` : ''}
                    ${widgetsHtml ? `<div class="dashboard-widgets">${widgetsHtml}</div>` : ''}
                    ${groupsHtml || addGroupButton ? `<div class="dashboard-grid">${groupsHtml}${addGroupButton}</div>` : ''}
                    ${bookmarksHtml}
                </div>`;
    setPreviewStatus(previewNotices);

    if (pendingInlineRenameTab) {
        const pendingName = pendingInlineRenameTab;
        window.requestAnimationFrame(() => {
            if (pendingInlineRenameTab === pendingName && findPreviewTabButton(pendingName)) {
                enterTabRenameMode(pendingName);
                setPendingInlineRenameTab(null);
            }
        });
    }
}

export function updatePreview({ force = false } = {}) {
    window.clearTimeout(previewUpdateTimer);
    if (!force && !document.getElementById('preview-auto-refresh-toggle').checked) {
        return;
    }
    updateVisualPreview();
}

export function refreshPreview() {
    const refreshBtn = document.getElementById('manual-refresh-button');
    refreshBtn.disabled = true;
    refreshBtn.classList.add('is-refreshing');
    refreshBtn.setAttribute('aria-label', 'Refreshing dashboard');
    refreshBtn.querySelector('.preview-control-label').textContent = 'Refreshing dashboard';

    updatePreview({ force: true });

    setTimeout(() => {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('is-refreshing');
        refreshBtn.setAttribute('aria-label', 'Refresh dashboard manually');
        refreshBtn.querySelector('.preview-control-label').textContent = 'Refresh dashboard manually';
    }, 500);
}

export function clearPreviewDropIndicators() {
    document.querySelectorAll('.preview-drag-over, .preview-drop-before, .preview-drop-after, .preview-drop-inside, .preview-drop-left, .preview-drop-right').forEach((element) => {
        element.classList.remove('preview-drag-over', 'preview-drop-before', 'preview-drop-after', 'preview-drop-inside', 'preview-drop-left', 'preview-drop-right');
    });
    document.querySelectorAll('.preview-main-drop-indicator').forEach((element) => element.remove());
}

export function ensurePreviewMainDropIndicator(vertical) {
    const existing = document.body.querySelector(':scope > .preview-main-drop-indicator');
    const existingIsVertical = existing && existing.classList.contains('preview-main-drop-indicator-vertical');
    let line = existing && existingIsVertical === Boolean(vertical) ? existing : null;
    if (existing && existingIsVertical !== Boolean(vertical)) existing.remove();
    if (!line) {
        line = document.createElement('span');
        line.className = vertical
            ? 'preview-main-drop-indicator preview-main-drop-indicator-vertical'
            : 'preview-main-drop-indicator';
        line.setAttribute('aria-hidden', 'true');
        document.body.append(line);
    }
    return line;
}

export function clearPreviewDragState() {
    document.querySelectorAll('.preview-dragging').forEach((element) => {
        element.classList.remove('preview-dragging');
    });
    clearPreviewDropIndicators();
    setActivePreviewDrag(null);
}

export function isSamePreviewDropCollection(drag, destinationTarget) {
    if (drag.kind === 'service' || drag.kind === 'bookmark') {
        const sameGroup = drag.source.groupName === destinationTarget?.groupName
            && Number(drag.source.groupIndex) === Number(destinationTarget?.groupIndex);
        if (!sameGroup) return false;
        if (drag.kind === 'service') {
            const dragPath = drag.source.nestedGroupPath || [];
            const destPath = destinationTarget?.nestedGroupPath || [];
            if (dragPath.length !== destPath.length) return false;
            return dragPath.every((step, index) => (
                String(step && step.name || '') === String(destPath[index] && destPath[index].name || '')
                && Number(step && step.index || 0) === Number(destPath[index] && destPath[index].index || 0)
            ));
        }
        return true;
    }
    return true;
}

export async function applyPreviewDrop(drag, destinationIndex, destinationTarget = null) {
    const sameCollection = isSamePreviewDropCollection(drag, destinationTarget);
    const adjustedDestinationIndex = sameCollection && drag.index < destinationIndex
        ? destinationIndex - 1
        : destinationIndex;
    if (drag.kind === 'option-type') {
        if (drag.index === adjustedDestinationIndex) return;
        readOptionTypesDraft();
        mutateOptionTypesDraft((draft) => {
            const [item] = draft.splice(drag.index, 1);
            draft.splice(adjustedDestinationIndex, 0, item);
        });
        renderOptionTypesDraft();
        return;
    }
    if (drag.kind === 'option-default') {
        if (drag.index === adjustedDestinationIndex) return;
        readOptionTypesDraft();
        const orderedIndexes = getOrderedOptionDefaultIndexes(drag.scope);
        const [item] = orderedIndexes.splice(drag.index, 1);
        orderedIndexes.splice(adjustedDestinationIndex, 0, item);
        setOptionDefaultOrder(drag.scope, orderedIndexes);
        renderOptionDefaultsDraft();
        return;
    }
    if (drag.kind === 'edit-option') {
        if (drag.index === adjustedDestinationIndex) return;
        syncPreviewEditOptionState();
        mutatePreviewEditDialogState((state) => {
            const fields = drag.scope
                ? drag.scope.split('.').reduce((collection, pathIndex) => collection[Number(pathIndex)].fields, state.fields)
                : state.fields;
            // Reject drag if the option itself is commented
            if (fields[drag.index] && fields[drag.index].commented === true) return;
            const [item] = fields.splice(drag.index, 1);
            fields.splice(adjustedDestinationIndex, 0, item);
        });
        renderPreviewEditOptions();
        return;
    }
    if (drag.kind === 'tab') {
        if (drag.index === adjustedDestinationIndex) return;
        await applyPreviewEdit(
            { type: 'tab.move', target: drag.source, destinationIndex: adjustedDestinationIndex },
            `Moved tab ${drag.source.name}.`
        );
        return;
    }
    if (drag.kind === 'service') {
        if (sameCollection && drag.index === adjustedDestinationIndex) return;
        const destinationName = Array.isArray(destinationTarget?.nestedGroupPath) && destinationTarget.nestedGroupPath.length > 0
            ? destinationTarget.nestedGroupPath[destinationTarget.nestedGroupPath.length - 1].name
            : destinationTarget?.groupName || drag.source.groupName;
        const operation = { type: 'service.move', target: drag.source, destinationIndex: adjustedDestinationIndex, destinationTarget };
        const message = `Moved service ${drag.source.serviceName} to ${destinationName}.`;
        if (drag.source.commented === true) {
            await applyCommentedPreviewEdit(operation, `Moved commented service ${drag.source.serviceName} to ${destinationName}.`);
        } else if (previewShowCommentsState) {
            await applyClientSidePreviewEdit(operation, message);
        } else {
            await applyPreviewEdit(operation, message);
        }
        return;
    }
    if (drag.kind === 'bookmark') {
        if (sameCollection && drag.index === adjustedDestinationIndex) return;
        const operation = { type: 'bookmark.move', target: drag.source, destinationIndex: adjustedDestinationIndex, destinationTarget };
        const message = `Moved bookmark ${drag.source.bookmarkName} to ${destinationTarget?.groupName || drag.source.groupName}.`;
        if (drag.source.commented === true) {
            await applyCommentedPreviewEdit(operation, `Moved commented bookmark ${drag.source.bookmarkName} to ${destinationTarget?.groupName || drag.source.groupName}.`);
        } else if (previewShowCommentsState) {
            await applyClientSidePreviewEdit(operation, message);
        } else {
            await applyPreviewEdit(operation, message);
        }
        return;
    }
    if (drag.index === adjustedDestinationIndex) return;
    const typeByKind = {
        group: 'group.move',
        'nested-group': 'group.move',
        'bookmark-group': 'bookmark-group.move'
    };
    const operationType = typeByKind[drag.kind];
    if (operationType) {
        const operation = { type: operationType, target: drag.source, destinationIndex: adjustedDestinationIndex };
        const itemName = drag.source.serviceName || drag.source.bookmarkName || drag.source.groupName || '';
        if (drag.source.commented === true) {
            await applyCommentedPreviewEdit(operation, `Reordered commented ${drag.kind.replace('-', ' ')} ${itemName}.`);
        } else if (previewShowCommentsState) {
            await applyClientSidePreviewEdit(operation, `Reordered ${drag.kind.replace('-', ' ')} ${itemName}.`);
        } else {
            await applyPreviewEdit(operation, `Reordered ${drag.kind.replace('-', ' ')} ${itemName}.`);
        }
    }
}

function getClosestPreviewDropItem(zone, kind, event) {
    const items = Array.from(zone.querySelectorAll(`:scope > [data-preview-drop-kind="${kind}"]`));
    if (items.length === 0) return null;
    const measuredItems = items.map((item) => ({ item, rect: item.getBoundingClientRect() }));
    if (kind === 'service') {
        const rows = measuredItems.reduce((result, measured) => {
            const row = result[result.length - 1];
            if (!row || Math.abs(row.top - measured.rect.top) > 4) {
                result.push({
                    top: measured.rect.top,
                    bottom: measured.rect.bottom,
                    items: [measured]
                });
            } else {
                row.bottom = Math.max(row.bottom, measured.rect.bottom);
                row.items.push(measured);
            }
            return result;
        }, []);
        if (event.clientY < rows[0].top) {
            return { element: rows[0].items[0].item, position: 'before' };
        }
        for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
            const row = rows[rowIndex];
            const nextRow = rows[rowIndex + 1];
            if (event.clientY > row.bottom && event.clientY < nextRow.top) {
                return event.clientY < row.bottom + ((nextRow.top - row.bottom) / 2)
                    ? { element: row.items[row.items.length - 1].item, position: 'after' }
                    : { element: nextRow.items[0].item, position: 'before' };
            }
        }
        const lastRow = rows[rows.length - 1];
        if (event.clientY > lastRow.bottom) {
            return { element: lastRow.items[lastRow.items.length - 1].item, position: 'after' };
        }
    }
    return measuredItems.reduce((closest, measured) => {
        const { item, rect } = measured;
        const distanceX = event.clientX < rect.left
            ? rect.left - event.clientX
            : event.clientX > rect.right
                ? event.clientX - rect.right
                : 0;
        const distanceY = event.clientY < rect.top
            ? rect.top - event.clientY
            : event.clientY > rect.bottom
                ? event.clientY - rect.bottom
                : 0;
        const distance = (distanceX * distanceX) + (distanceY * distanceY);
        return !closest || distance < closest.distance ? { element: item, distance, position: null } : closest;
    }, null) || null;
}

export function getPreviewDropTarget(eventTarget, drag, event) {
    if (drag.kind === 'service') {
        const item = eventTarget.closest('[data-preview-drop-kind="service"]');
        if (item) return { element: item, position: null };
        const zone = eventTarget.closest('[data-preview-service-drop-zone]');
        const closest = zone && getClosestPreviewDropItem(zone, drag.kind, event);
        const fallback = zone || eventTarget.closest('[data-preview-service-drop]');
        return closest || (fallback ? { element: fallback, position: null } : null);
    }
    if (drag.kind === 'bookmark') {
        const item = eventTarget.closest('[data-preview-drop-kind="bookmark"]');
        if (item) return { element: item, position: null };
        const zone = eventTarget.closest('[data-preview-bookmark-drop-zone]');
        const closest = zone && getClosestPreviewDropItem(zone, drag.kind, event);
        const fallback = zone || eventTarget.closest('[data-preview-bookmark-drop]');
        return closest || (fallback ? { element: fallback, position: null } : null);
    }
    if (drag.kind === 'tab') {
        const item = eventTarget.closest('[data-preview-drop-kind="tab"]');
        return item ? { element: item, position: null } : null;
    }
    const element = eventTarget.closest('[data-preview-drop-kind]');
    return element ? { element, position: null } : null;
}

export function getPreviewDropDetails(target, drag, event, forcedPosition = null) {
    const isItemTarget = target.dataset.previewDropKind === drag.kind;
    const destinationTarget = drag.kind === 'service'
        ? JSON.parse(target.getAttribute('data-preview-service-drop-source') || '{}')
        : drag.kind === 'bookmark'
            ? JSON.parse(target.getAttribute('data-preview-bookmark-drop-source') || '{}')
            : null;
    if (!isItemTarget) {
        return {
            destinationIndex: Number(drag.kind === 'service'
                ? target.dataset.previewServiceDropIndex
                : target.dataset.previewBookmarkDropIndex),
            destinationTarget,
            position: 'inside'
        };
    }

    const rect = target.getBoundingClientRect();
    const verticalLine = (drag.kind === 'service' && target.classList.contains('dashboard-card')) || drag.kind === 'nested-group';
    if (drag.kind === 'tab') {
        const afterTab = forcedPosition
            ? forcedPosition === 'after'
            : event.clientX >= rect.left + (rect.width / 2);
        return {
            destinationIndex: Number(target.dataset.previewDropIndex) + (afterTab ? 1 : 0),
            destinationTarget,
            position: afterTab ? 'right' : 'left',
            verticalLine: false
        };
    }
    const after = forcedPosition
        ? forcedPosition === 'after'
        : verticalLine
            ? event.clientX >= rect.left + (rect.width / 2)
            : event.clientY >= rect.top + (rect.height / 2);
    const isCommentedTarget = target.dataset.previewDropCommented === 'true';
    return {
        destinationIndex: Number(target.dataset.previewDropIndex) + (isCommentedTarget ? 0 : (after ? 1 : 0)),
        destinationTarget,
        position: after ? 'after' : 'before',
        verticalLine
    };
}

function showPreviewDropIndicator(target, details, drag) {
    clearPreviewDropIndicators();
    target.classList.add('preview-drag-over');
    if (['service', 'bookmark', 'group', 'bookmark-group', 'nested-group'].includes(drag.kind)) {
        const rect = target.getBoundingClientRect();
        const line = ensurePreviewMainDropIndicator(Boolean(details.verticalLine));
        if (details.verticalLine) {
            line.style.left = `${details.position === 'before' ? rect.left - 2 : rect.right - 2}px`;
            line.style.top = `${rect.top + 4}px`;
            line.style.height = `${Math.max(0, rect.height - 8)}px`;
            line.style.width = '';
            return;
        }
        const inset = details.position === 'inside' ? 12 : 4;
        const top = details.position === 'before'
            ? rect.top - 2
            : details.position === 'after'
                ? rect.bottom - 2
                : rect.bottom - 10;
        line.style.left = `${rect.left + inset}px`;
        line.style.top = `${top}px`;
        line.style.width = `${Math.max(0, rect.width - (inset * 2))}px`;
        line.style.height = '';
        return;
    }
    target.classList.add(`preview-drop-${details.position}`);
}

export function handlePreviewDragStart(event) {
    const item = event.target.closest('[data-preview-drag-item]');
    if (!item) return;
    if (item && event.target.closest('.preview-edit-actions, input, select, textarea, [data-preview-tab-rename-input]')) {
        event.preventDefault();
        return;
    }
    // Reject drag for commented items
    const sourceAttr = item.getAttribute('data-preview-drag-source');
    if (sourceAttr) {
        try {
            const dragSource = JSON.parse(sourceAttr);
            if (dragSource.commented === true) {
                event.preventDefault();
                return;
            }
        } catch (e) { /* ignore parse errors */ }
    }
    setActivePreviewDrag({
        kind: item.dataset.previewDragKind,
        index: Number(item.dataset.previewDragIndex),
        scope: item.dataset.previewDragScope || '',
        source: JSON.parse(item.getAttribute('data-preview-drag-source') || '{}')
    });
    item.classList.add('preview-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', activePreviewDrag.kind);
}

export function handlePreviewDragOver(event) {
    if (!activePreviewDrag) return;
    const dropTarget = getPreviewDropTarget(event.target, activePreviewDrag, event);
    const target = dropTarget?.element;
    const canCrossGroups = ['service', 'bookmark'].includes(activePreviewDrag.kind);
    const matchesKind = canCrossGroups
        ? Boolean(target)
        : target?.dataset.previewDropKind === activePreviewDrag.kind;
    if (!matchesKind || (!canCrossGroups && (target.dataset.previewDragScope || '') !== activePreviewDrag.scope)) {
        clearPreviewDropIndicators();
        return;
    }
    event.preventDefault();
    showPreviewDropIndicator(target, getPreviewDropDetails(target, activePreviewDrag, event, dropTarget.position), activePreviewDrag);
    event.dataTransfer.dropEffect = 'move';
}

export function handlePreviewDrop(event) {
    if (!activePreviewDrag) return;
    const dropTarget = getPreviewDropTarget(event.target, activePreviewDrag, event);
    const target = dropTarget?.element;
    const canCrossGroups = ['service', 'bookmark'].includes(activePreviewDrag.kind);
    const matchesKind = canCrossGroups
        ? Boolean(target)
        : target?.dataset.previewDropKind === activePreviewDrag.kind;
    if (!matchesKind || (!canCrossGroups && (target.dataset.previewDragScope || '') !== activePreviewDrag.scope)) return;
    // Reject drops into commented-group destinations
    if (activePreviewDrag.kind === 'service' || activePreviewDrag.kind === 'bookmark') {
        const destSource = target.getAttribute('data-preview-service-drop-source') || target.getAttribute('data-preview-bookmark-drop-source') || '{}';
        try {
            const dest = JSON.parse(destSource);
            if (dest.commented === true) {
                clearPreviewDragState();
                return;
            }
        } catch (e) { /* ignore parse errors */ }
    }
    event.preventDefault();
    const drag = activePreviewDrag;
    const { destinationIndex, destinationTarget } = getPreviewDropDetails(target, drag, event, dropTarget.position);
    clearPreviewDragState();
    applyPreviewDrop(drag, destinationIndex, destinationTarget).catch((error) => {
        setSaveStatus(`Could not reorder the item: ${addErrorGuidance(error, 'Try the move again')}`, 'error');
    });
}

export {
    toggleCommentBlock,
    getTabYamlLines,
    replaceTabYamlText,
    parseCommentedBlockData,
    serializeCommentedBlock,
    commentBlockLines,
    serializeCommentedObjectBlock,
    applyCommentedServiceOperation,
    applyCommentedGroupOperation,
    applyCommentedBookmarkOperation,
    applyCommentedBookmarkGroupOperation,
    applyCommentedWidgetOperation,
    applyChunkTreeOperation,
    applyCommentedPreviewEdit,
    reindentBlockLines,
    applyNormalServiceOperation,
    applyNormalBookmarkOperation,
    applyNormalGroupOperation,
    applyNormalBookmarkGroupOperation,
    applyClientSidePreviewEdit,
    findBlockEndLine,
    getGroupPositions,
    findGroupStartLine,
    reindentCommentedBlockLines,
    detectEntryIndent,
    markDeepCommented,
    mergeGroupEntries,
    findNestedGroupLine,
    mergeNestedGroupEntries,
    mergeGroupsByLine,
    findSiblingServiceLineRange,
    findSiblingGroupLineRange,
    findServiceInsertLine,
    findGroupInsertLine,
    scheduleVisualPreview,
    findPreviewGroup,
    appendCommentedSubOptions,
    findPreviewService,
    resolvePreviewEntries,
    findPreviewNestedGroup,
    findPreviewBookmarkGroup,
    findPreviewBookmark,
    setPreviewOptionDefinitions,
    getOptionDefinition,
    getPreviewOptionTarget,
    getOptionDefinitionsForTarget,
    getDefaultPreviewOptionFields,
    getPreviewOptionFields,
    markFieldsCommented,
    normalizePreviewOptionStyles,
    readPreviewOptionRows,
    syncPreviewEditOptionState,
    getPreviewEditFieldAtPath,
    updatePreviewEditTabWarning,
    renderPreviewEditOptions,
    getServiceGroupMoveChoices,
    renderPreviewEditServiceLocation,
    renderPreviewEditGroupLocation,
    renderPreviewEditGroupNested,
    openPreviewEditDialog,
    closePreviewEditDialog,
    replacePreviewEditedFiles,
    applyPreviewEdit,
    submitPreviewEditForm,
    undoPreviewEdit,
    handlePreviewEditAction
};
