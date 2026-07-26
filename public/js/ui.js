// UI helper functions — DOM manipulation, status updates, scrolling, navigation
import { configTabNames, configTabLabels, createNewTabGroupValue, defaultPageTitle, optionValueTypeChoices, optionAppliesToChoices, settingsTabNames } from './constants.js';
import { yamlCodeEditor, previewAddTabModal } from './shared.js';
import { addErrorGuidance, saveOptionTypes as persistOptionTypes, persistAppSettings as persistAppSettingsRequest } from './api.js';
import { parseTabConfig, getHomepageTabInfo, getDragItemAttributes, getPreviewEditActionButton, updatePreview, applyPreviewEdit, renderPreviewEditOptions, setPreviewOptionDefinitions } from './preview.js';
import { currentTab, loadedFiles, loadedFileNames, previewUndoState, previewEditDialogState, optionDefinitions, optionTypesDraft, optionTypesRemovedDefinitions, optionTypesPreviousFocus, savedAppSettings, sampleModeEnabled, previewHomepageTab, previewShowCommentsState, pendingInlineRenameTab, pendingInlineRenameBackup, previewTabAddAnchor, previewTabAddAfterTab, previewTabAddInFlight, directoryModalPreviousFocus, confirmationDialogResolver, confirmationDialogPreviousFocus, settingsActiveTab, settingsModalPreviousFocus, pendingAppSettingsSave, settingsTabOrderDraft, setSampleModeEnabled, setPreviewHomepageTab, setPreviewShowCommentsState, setOptionTypesDraft, setOptionTypesRemovedDefinitions, setOptionTypesPreviousFocus, setSavedAppSettings, setPendingInlineRenameTab, setPendingInlineRenameBackup, setPreviewTabAddAnchor, setPreviewTabAddAfterTab, setPreviewTabAddInFlight, setDirectoryModalPreviousFocus, setConfirmationDialogResolver, setConfirmationDialogPreviousFocus, setSettingsModalPreviousFocus, setSettingsActiveTab, setPendingAppSettingsSave, setSettingsTabOrderDraft, mutateOptionTypesDraft, getUnsavedTabNames } from './state.js';

const autoIndentToggle = document.getElementById('auto-indent-toggle');
const autoIndentLabel = document.getElementById('auto-indent-label');
const editorVisibilityToggle = document.getElementById('editor-visibility-toggle');
const editorVisibilityLabel = document.getElementById('editor-visibility-label');
const themeToggle = document.getElementById('themeToggle');
const previewAutoRefreshToggle = document.getElementById('preview-auto-refresh-toggle');
const previewAutoRefreshLabel = document.getElementById('preview-auto-refresh-label');
const previewEditToggle = document.getElementById('preview-edit-toggle');
const previewEditLabel = document.getElementById('preview-edit-label');
const manualRefreshButton = document.getElementById('manual-refresh-button');

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function updateUnsavedIndicators() {
    const unsavedTabNames = getUnsavedTabNames();
    const unsavedTabs = new Set(unsavedTabNames);

    document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
        const tabName = tab.dataset.tab;
        const isUnsaved = unsavedTabs.has(tabName);
        const filename = loadedFileNames[tabName] || `${tabName}.yaml`;
        tab.classList.toggle('unsaved', isUnsaved);
        tab.title = isUnsaved ? `${filename} has unsaved changes` : '';
    });

    const statusElement = document.getElementById('unsaved-status');
    if (unsavedTabNames.length === 0) {
        statusElement.hidden = true;
        statusElement.textContent = '';
        return;
    }

    const filenames = unsavedTabNames.map((tabName) => loadedFileNames[tabName] || `${tabName}.yaml`);
    statusElement.textContent = `\u25CF Unsaved (${filenames.length}): ${filenames.join(', ')}`;
    statusElement.hidden = false;
}

export function setSaveStatus(message, state = 'info', source = null) {
    const statusElement = document.getElementById('save-status');
    statusElement.textContent = message;
    statusElement.dataset.state = state;
    statusElement.hidden = false;
    statusElement.setAttribute('role', state === 'error' ? 'alert' : 'status');
    statusElement.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
    statusElement.classList.toggle('save-status-jump', Boolean(source));
    if (source) {
        statusElement.dataset.source = JSON.stringify(source);
        statusElement.tabIndex = 0;
        statusElement.title = 'Jump to the YAML error';
    } else {
        delete statusElement.dataset.source;
        statusElement.removeAttribute('tabindex');
        statusElement.removeAttribute('title');
    }
}

export function clearSaveStatus() {
    const statusElement = document.getElementById('save-status');
    statusElement.hidden = true;
    statusElement.textContent = '';
    delete statusElement.dataset.state;
    delete statusElement.dataset.source;
    statusElement.classList.remove('save-status-jump');
    statusElement.removeAttribute('tabindex');
    statusElement.removeAttribute('title');
}

export function setPreviewStatus(messages = []) {
    const statusElement = document.getElementById('preview-status');
    const uniqueMessages = Array.from(new Set(messages.filter(Boolean)));
    statusElement.textContent = uniqueMessages.join(' ');
    statusElement.hidden = uniqueMessages.length === 0;
    statusElement.dataset.state = 'info';
}

export function setDirectoryStatus(directory, fileCount, { autoloaded = false, missingCount = 0 } = {}) {
    const statusElement = document.getElementById('directory-info');
    const loadedMessage = autoloaded
        ? `Autoloaded ${fileCount}/${configTabNames.length}`
        : `Loaded ${fileCount}/${configTabNames.length} from ${directory}`;
    statusElement.textContent = missingCount > 0
        ? `${missingCount} YAML file${missingCount === 1 ? '' : 's'} missing; example content is shown and will be created if saved. ${loadedMessage}`
        : loadedMessage;
    statusElement.title = statusElement.textContent;
    statusElement.dataset.state = missingCount > 0 ? 'warning' : 'loaded';
}

export function setDirectoryModalStatus(message = '') {
    const statusElement = document.getElementById('directory-modal-status');
    statusElement.textContent = message;
    statusElement.hidden = !message;
}

export function setPreviewEditModalStatus(message = '') {
    const statusElement = document.getElementById('preview-edit-modal-status');
    statusElement.textContent = message;
    statusElement.hidden = !message;
}

export function setOptionTypesStatus(message = '') {
    const status = document.getElementById('option-types-status');
    status.textContent = message;
    status.hidden = !message;
}

export function readOptionTypesDraft() {
    setOptionTypesDraft(Array.from(document.querySelectorAll('#option-types-list > [data-option-type-row]')).map((row, index) => {
        const appliesTo = Array.from(row.querySelectorAll('[data-option-applies-to]:checked')).map((input) => input.value);
        const previousDefinition = optionTypesDraft[index] || {};
        const defaultForAdd = (previousDefinition.defaultForAdd || []).filter((target) => appliesTo.includes(target));
        const defaultOrder = Object.fromEntries(Object.entries(previousDefinition.defaultOrder || {})
            .filter(([target]) => defaultForAdd.includes(target)));
        const selectValues = row.querySelector('[data-option-select-values]');
        return {
            name: row.querySelector('[data-option-type-name]').value,
            type: row.querySelector('[data-option-value-type]').value,
            appliesTo,
            _originalName: previousDefinition._originalName || '',
            _originalAppliesTo: [...(previousDefinition._originalAppliesTo || [])],
            ...(defaultForAdd.length > 0 ? { defaultForAdd } : {}),
            ...(Object.keys(defaultOrder).length > 0 ? { defaultOrder } : {}),
            values: selectValues ? selectValues.value.split(',').map((value) => value.trim()) : [],
            rows: Number(row.querySelector('[data-option-textarea-rows]')?.value) || 2
        };
    }));
    normalizeOptionDefaultOrders();
}

export function renderOptionTypesDraft() {
    const list = document.getElementById('option-types-list');
    list.innerHTML = optionTypesDraft.map((definition, index) => {
        const typeOptions = optionValueTypeChoices.map((type) => `<option value="${type}"${type === definition.type ? ' selected' : ''}>${type}</option>`).join('');
        const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
        const appliesToOptions = optionAppliesToChoices.map((choice) => `<label class="option-applies-to-choice" title="${escapeHtml(choice.tooltip)}"><input type="checkbox" data-option-applies-to value="${choice.value}" aria-label="Applies to ${escapeHtml(choice.tooltip)}"${appliesTo.includes(choice.value) ? ' checked' : ''}><span>${choice.label}</span></label>`).join('');
        const needsSelectValues = definition.type === 'select';
        const needsRows = definition.type === 'textarea';
        const extraControl = needsSelectValues
            ? `<input type="text" class="modal-input" data-option-select-values aria-label="Select choices" value="${escapeHtml((definition.values || []).join(', '))}" placeholder="Select choices">`
            : needsRows
                ? `<input type="number" class="modal-input" data-option-textarea-rows aria-label="Textarea rows" min="2" max="12" value="${definition.rows || 2}" placeholder="Rows">`
                : '<span class="option-types-extra-placeholder" aria-hidden="true"></span>';
        return `<div class="option-types-row${needsSelectValues ? ' has-select-values' : ''}${needsRows ? ' has-textarea-rows' : ''}" data-option-type-row ${getDragItemAttributes('option-type', null, index)} data-preview-drop-kind="option-type" data-preview-drop-index="${index}">
            <input type="text" class="modal-input" data-option-type-name aria-label="Option name" value="${escapeHtml(definition.name)}" placeholder="Option name">
            <select class="modal-input" data-option-value-type aria-label="Value type">${typeOptions}</select>
            <fieldset class="option-applies-to" aria-label="Applies to">${appliesToOptions}</fieldset>
            ${extraControl}
            <span class="preview-edit-actions option-types-actions">
                <button type="button" class="preview-edit-action preview-edit-move-up" data-option-type-move="up" data-option-type-index="${index}" aria-label="Move ${escapeHtml(definition.name || 'option')} up"${index === 0 ? ' disabled' : ''}>&uarr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move option type up</span></button>
                <button type="button" class="preview-edit-action preview-edit-move-down" data-option-type-move="down" data-option-type-index="${index}" aria-label="Move ${escapeHtml(definition.name || 'option')} down"${index === optionTypesDraft.length - 1 ? ' disabled' : ''}>&darr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move option type down</span></button>
                <button type="button" class="preview-edit-action preview-edit-delete" data-option-type-remove="${index}" aria-label="Remove ${escapeHtml(definition.name || 'option')}">&times;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Remove option type</span></button>
            </span>
        </div>`;
    }).join('') || '<div class="option-types-list-empty">No option types are configured.</div>';
    renderOptionDefaultsDraft();
}

export function getOrderedOptionDefaultIndexes(target) {
    return optionTypesDraft.map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => definition.appliesTo?.includes(target) && definition.defaultForAdd?.includes(target))
        .sort((first, second) => {
            const firstOrder = Number(first.definition.defaultOrder?.[target]);
            const secondOrder = Number(second.definition.defaultOrder?.[target]);
            return (Number.isFinite(firstOrder) ? firstOrder : Number.MAX_SAFE_INTEGER)
                - (Number.isFinite(secondOrder) ? secondOrder : Number.MAX_SAFE_INTEGER)
                || first.index - second.index;
        })
        .map(({ index }) => index);
}

export function setOptionDefaultOrder(target, orderedIndexes) {
    mutateOptionTypesDraft((draft) => {
        draft.forEach((definition) => {
            if (!definition.defaultOrder) return;
            delete definition.defaultOrder[target];
            if (Object.keys(definition.defaultOrder).length === 0) delete definition.defaultOrder;
        });
        orderedIndexes.forEach((definitionIndex, order) => {
            draft[definitionIndex].defaultOrder = {
                ...(draft[definitionIndex].defaultOrder || {}),
                [target]: order
            };
        });
    });
}

function normalizeOptionDefaultOrders() {
    mutateOptionTypesDraft((draft) => {
        draft.forEach((definition) => {
            const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
            const defaultForAdd = (definition.defaultForAdd || []).filter((target) => appliesTo.includes(target));
            if (defaultForAdd.length > 0) definition.defaultForAdd = [...new Set(defaultForAdd)];
            else delete definition.defaultForAdd;
        });
    });
    optionAppliesToChoices.forEach((choice) => setOptionDefaultOrder(choice.value, getOrderedOptionDefaultIndexes(choice.value)));
}

export function renderOptionDefaultsDraft() {
    const defaultsList = document.getElementById('option-defaults-list');
    if (!defaultsList) return;
    normalizeOptionDefaultOrders();
    defaultsList.innerHTML = optionAppliesToChoices.map((choice) => {
        const orderedIndexes = getOrderedOptionDefaultIndexes(choice.value);
        const availableIndexes = optionTypesDraft.map((definition, index) => ({ definition, index }))
            .filter(({ definition, index }) => definition.appliesTo?.includes(choice.value) && !orderedIndexes.includes(index) && definition.name.trim());
        const rows = orderedIndexes.map((definitionIndex, order) => {
            const definition = optionTypesDraft[definitionIndex];
            const name = definition.name.trim() || 'Unnamed option';
            return `<div class="option-default-row" data-option-default-row ${getDragItemAttributes('option-default', null, order, choice.value)} data-preview-drop-kind="option-default" data-preview-drop-index="${order}">
                <span class="option-default-name">${escapeHtml(name)}</span>
                <span class="preview-edit-actions option-default-actions">
                    <button type="button" class="preview-edit-action preview-edit-move-up" data-option-default-action="up" data-option-default-target="${choice.value}" data-option-default-index="${definitionIndex}" aria-label="Move ${escapeHtml(name)} up in ${escapeHtml(choice.tooltip)} defaults"${order === 0 ? ' disabled' : ''}>&uarr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move default up</span></button>
                    <button type="button" class="preview-edit-action preview-edit-move-down" data-option-default-action="down" data-option-default-target="${choice.value}" data-option-default-index="${definitionIndex}" aria-label="Move ${escapeHtml(name)} down in ${escapeHtml(choice.tooltip)} defaults"${order === orderedIndexes.length - 1 ? ' disabled' : ''}>&darr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move default down</span></button>
                    <button type="button" class="preview-edit-action preview-edit-delete" data-option-default-action="remove" data-option-default-target="${choice.value}" data-option-default-index="${definitionIndex}" aria-label="Remove ${escapeHtml(name)} from ${escapeHtml(choice.tooltip)} defaults">&times;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Remove default</span></button>
                </span>
            </div>`;
        }).join('') || '<div class="option-default-empty">No defaults selected.</div>';
        const availableOptions = availableIndexes.map(({ definition, index }) => `<option value="${index}">${escapeHtml(definition.name.trim())}</option>`).join('');
        return `<section class="option-default-group" data-option-default-group="${choice.value}">
            <h5>${escapeHtml(choice.tooltip)}</h5>
            <div class="option-default-rows">${rows}</div>
            <div class="option-default-add">
                <select class="modal-input" data-option-default-select aria-label="Add a ${escapeHtml(choice.tooltip.toLowerCase())} default"${availableOptions ? '' : ' disabled'}>
                    <option value="">${availableOptions ? 'Choose an option' : 'All applicable options added'}</option>${availableOptions}
                </select>
                <button type="button" class="modal-button option-default-add-button" data-option-default-action="add" data-option-default-target="${choice.value}" aria-label="Add ${escapeHtml(choice.tooltip.toLowerCase())} default"${availableOptions ? '' : ' disabled'}>Add</button>
            </div>
        </section>`;
    }).join('');
}

export function openOptionTypesModal() {
    setOptionTypesPreviousFocus(document.activeElement);
    setOptionTypesDraft(Array.from(optionDefinitions.values()).map((definition) => ({
        ...definition,
        _originalName: definition.name,
        _originalAppliesTo: [...(definition.appliesTo || [])],
        values: [...(definition.values || [])],
        ...(definition.defaultForAdd ? { defaultForAdd: [...definition.defaultForAdd] } : {}),
        ...(definition.defaultOrder ? { defaultOrder: { ...definition.defaultOrder } } : {})
    })));
    setOptionTypesRemovedDefinitions(new Map());
    renderOptionTypesDraft();
    setOptionTypesStatus();
    const modal = document.getElementById('option-types-modal');
    modal.hidden = false;
    window.requestAnimationFrame(() => document.querySelector('#option-types-list [data-option-type-name]')?.focus());
}

export function closeOptionTypesModal() {
    const modal = document.getElementById('option-types-modal');
    if (modal.hidden) return;
    modal.hidden = true;
    setOptionTypesStatus();
    if (optionTypesPreviousFocus && typeof optionTypesPreviousFocus.focus === 'function') optionTypesPreviousFocus.focus();
    setOptionTypesPreviousFocus(null);
}

export async function saveOptionTypes(event) {
    event.preventDefault();
    readOptionTypesDraft();
    const optionTypesToSave = optionTypesDraft.map(({ _originalName, _originalAppliesTo, ...definition }) => definition);
    const remainingNames = new Set(optionTypesToSave.map((definition) => definition.name.trim()));
    const removedDefinitions = Array.from(optionTypesRemovedDefinitions.values())
        .filter((definition) => !remainingNames.has(definition.name));
    const allOptionNames = [...new Set([
        ...optionTypesToSave.map((definition) => definition.name.trim()),
        ...removedDefinitions.map((definition) => definition.name)
    ])];
    const saveButton = document.getElementById('option-types-save');
    saveButton.disabled = true;
    setOptionTypesStatus();
    try {
        if (removedDefinitions.length > 0) {
            const removedFromYaml = await applyPreviewEdit(
                { type: 'option-types.remove', options: removedDefinitions, allOptionNames },
                `Removed deleted option type${removedDefinitions.length === 1 ? '' : 's'} from the loaded YAML.`
            );
            if (!removedFromYaml) throw new Error('Could not remove deleted option types from the loaded YAML');
        }
        const data = await persistOptionTypes(optionTypesToSave);
        setPreviewOptionDefinitions(data.options);
        setOptionTypesRemovedDefinitions(new Map());
        if (previewEditDialogState) renderPreviewEditOptions();
        setSaveStatus(removedDefinitions.length > 0
            ? 'Option types saved. Removed matching YAML options; Save to write the pending YAML changes.'
            : 'Option types saved.', removedDefinitions.length > 0 ? 'info' : 'success');
        closeOptionTypesModal();
    } catch (error) {
        setOptionTypesStatus(addErrorGuidance(error, 'Review the option type values and try again'));
    } finally {
        saveButton.disabled = false;
    }
}

export function setInlineAddTabStatus(message) {
    const statusElement = document.getElementById('preview-add-tab-status');
    if (!statusElement) return;
    statusElement.textContent = message || '';
    statusElement.hidden = !message;
}

export function handleLoadDirectory() {
    openDirectoryModal();
}

export function openDirectoryModal() {
    const modal = document.getElementById('directoryModal');
    setDirectoryModalPreviousFocus(document.activeElement);
    setDirectoryModalStatus();
    modal.hidden = false;
    window.requestAnimationFrame(() => document.getElementById('serverPathInput').focus());
}

export function closeDirectoryModal() {
    document.getElementById('directoryModal').hidden = true;
    setDirectoryModalStatus();
    if (directoryModalPreviousFocus && typeof directoryModalPreviousFocus.focus === 'function') {
        directoryModalPreviousFocus.focus();
    }
    setDirectoryModalPreviousFocus(null);
}

export function showConfirmationDialog({ title, message, confirmText = 'Continue' }) {
    const modal = document.getElementById('confirmation-modal');
    const confirmButton = document.getElementById('confirmation-modal-confirm');
    document.getElementById('confirmation-modal-title').textContent = title;
    document.getElementById('confirmation-modal-message').textContent = message;
    confirmButton.textContent = confirmText;
    setConfirmationDialogPreviousFocus(document.activeElement);
    modal.hidden = false;

    return new Promise((resolve) => {
        setConfirmationDialogResolver(resolve);
        window.requestAnimationFrame(() => confirmButton.focus());
    });
}

export function closeConfirmationDialog(confirmed) {
    const modal = document.getElementById('confirmation-modal');
    if (modal.hidden) {
        return;
    }
    modal.hidden = true;
    const resolve = confirmationDialogResolver;
    setConfirmationDialogResolver(null);
    if (confirmationDialogPreviousFocus && typeof confirmationDialogPreviousFocus.focus === 'function') {
        confirmationDialogPreviousFocus.focus();
    }
    setConfirmationDialogPreviousFocus(null);
    if (resolve) {
        resolve(Boolean(confirmed));
    }
}

export function findPreviewTabButton(tabName) {
    if (!tabName) return null;
    return Array.from(document.querySelectorAll('.preview-tab-strip .preview-tab-btn[data-preview-tab]'))
        .find((button) => button.getAttribute('data-preview-tab') === tabName) || null;
}

export function enterTabRenameMode(tabName) {
    if (!tabName) return;
    const button = findPreviewTabButton(tabName);
    if (!button) return;
    const wrapper = button.closest('.preview-tab');
    if (!wrapper) return;
    if (wrapper.querySelector('[data-preview-tab-rename-input]')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input preview-tab-rename-input';
    input.setAttribute('data-preview-tab-rename-input', '');
    input.setAttribute('data-preview-tab', tabName);
    input.value = tabName;
    input.setAttribute('aria-label', `Rename ${tabName} tab`);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('required', '');

    setPendingInlineRenameBackup(button.cloneNode(true));
    button.replaceWith(input);

    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            exitTabRenameMode(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!input.disabled) {
                exitTabRenameMode(false);
            }
        }
    });

    window.requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

export async function exitTabRenameMode(save) {
    const input = document.querySelector('[data-preview-tab-rename-input]');
    if (!input) return;
    const originalName = input.getAttribute('data-preview-tab');
    const backup = pendingInlineRenameBackup;
    setPendingInlineRenameBackup(null);

    if (!save) {
        if (backup) {
            input.replaceWith(backup);
            backup.focus();
        }
        return;
    }

    const newName = input.value.trim();
    if (!newName) {
        setPendingInlineRenameBackup(backup);
        input.focus();
        input.select();
        setSaveStatus('Enter a tab name to continue.', 'error');
        return;
    }
    if (newName === originalName) {
        if (backup) input.replaceWith(backup);
        return;
    }

    input.disabled = true;
    const wasActive = previewHomepageTab === originalName;
    if (wasActive) {
        setPreviewHomepageTab(newName);
    }
    const applied = await applyPreviewEdit(
        { type: 'tab.rename', target: { name: originalName }, values: { name: newName } },
        `Renamed tab ${originalName} to ${newName}.`
    );
    if (applied) {
        return;
    }

    if (wasActive) {
        setPreviewHomepageTab(originalName);
    }
    if (backup) input.replaceWith(backup);
    enterTabRenameMode(originalName);
}

export function getTabEditControls(source) {
    return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('tab.edit', source, 'Rename tab', '&#9998;')}
                <span class="preview-edit-actions-secondary">
                    ${getPreviewEditActionButton('tab.add', source, 'Add tab to the right', '+')}
                    ${getPreviewEditActionButton('tab.remove', source, 'Remove tab', '&times;', { danger: true })}
                </span>
            </span>`;
}

export function buildInlineAddTabGroupOptions() {
    const settings = parseTabConfig('settings');
    const services = parseTabConfig('services');
    if (settings.error) {
        throw new Error('Fix the settings.yaml error shown on the dashboard before adding a tab.');
    }
    if (services.error || !Array.isArray(services.data)) {
        throw new Error('Fix the services.yaml error shown on the dashboard before adding a tab.');
    }
    const tabInfo = getHomepageTabInfo(settings.data);
    const layoutGroups = tabInfo.groupLayout || {};
    const seen = new Set();
    const groupNames = [];
    services.data.forEach((group) => {
        const groupName = Object.keys(group || {})[0];
        if (groupName && !seen.has(groupName)) {
            seen.add(groupName);
            groupNames.push(groupName);
        }
    });
    Object.keys(layoutGroups).forEach((groupName) => {
        if (!seen.has(groupName)) {
            seen.add(groupName);
            groupNames.push(groupName);
        }
    });
    const existingOptions = groupNames.map((groupName) => {
        const layoutConfig = layoutGroups[groupName];
        const assignedTab = layoutConfig && typeof layoutConfig === 'object' ? layoutConfig.tab : '';
        const suffix = assignedTab ? ` — currently ${assignedTab}` : ' — visible on all tabs';
        return `<option value="${escapeHtml(groupName)}">${escapeHtml(groupName + suffix)}</option>`;
    }).join('');
    return `<option value="" selected disabled>Select an initial group</option><option value="${createNewTabGroupValue}">+ Create a new service group</option>${existingOptions}`;
}

export function initInlineAddTabModal() {
    const groupSelect = document.getElementById('preview-add-tab-group');
    const newGroupField = document.getElementById('preview-add-tab-new-group-field');
    const newGroupInput = document.getElementById('preview-add-tab-new-group');
    const updateGroupMode = function() {
        const isCreatingGroup = groupSelect.value === createNewTabGroupValue;
        newGroupField.hidden = !isCreatingGroup;
        newGroupInput.setAttribute('aria-required', String(isCreatingGroup));
    };
    groupSelect.addEventListener('change', updateGroupMode);
    document.getElementById('preview-add-tab-form').addEventListener('submit', function(event) {
        event.preventDefault();
        if (previewTabAddInFlight) return;
        submitInlineAddTab();
    });
    document.getElementById('preview-add-tab-close').addEventListener('click', function() {
        closeInlineAddTabPanel({ restoreFocus: true });
    });
    document.getElementById('preview-add-tab-cancel').addEventListener('click', function() {
        closeInlineAddTabPanel({ restoreFocus: true });
    });
    previewAddTabModal.addEventListener('click', function(event) {
        if (event.target === previewAddTabModal) {
            closeInlineAddTabPanel({ restoreFocus: true });
        }
    });
}

export function openInlineAddTabPanel(openedByButton, afterTab) {
    if (!previewAddTabModal.hidden) {
        closeInlineAddTabPanel({ restoreFocus: true });
        return;
    }
    if (sampleModeEnabled) {
        setSaveStatus('Load a configuration directory before managing tabs.', 'error');
        return;
    }
    let groupOptionsHtml;
    try {
        groupOptionsHtml = buildInlineAddTabGroupOptions();
    } catch (error) {
        setSaveStatus(addErrorGuidance(error, 'Fix the YAML error and try again.'), 'error');
        return;
    }
    const nameInput = document.getElementById('preview-add-tab-name');
    const groupSelect = document.getElementById('preview-add-tab-group');
    const newGroupField = document.getElementById('preview-add-tab-new-group-field');
    const newGroupInput = document.getElementById('preview-add-tab-new-group');
    nameInput.value = '';
    groupSelect.innerHTML = groupOptionsHtml;
    newGroupField.hidden = true;
    newGroupInput.value = '';
    setInlineAddTabStatus('');
    setPreviewTabAddAnchor(openedByButton || null);
    setPreviewTabAddAfterTab(afterTab || null);
    setPreviewTabAddInFlight(false);
    previewAddTabModal.hidden = false;
    nameInput.focus();
}

export function closeInlineAddTabPanel({ restoreFocus } = {}) {
    const anchor = previewTabAddAnchor;
    previewAddTabModal.hidden = true;
    setPreviewTabAddAnchor(null);
    setPreviewTabAddAfterTab(null);
    setPreviewTabAddInFlight(false);
    setPendingInlineRenameTab(null);
    if (restoreFocus !== false && anchor && document.body.contains(anchor) && anchor.offsetParent !== null && typeof anchor.focus === 'function') {
        anchor.focus();
    } else if (restoreFocus !== false) {
        const tabHost = document.getElementById('preview-tab-host');
        if (tabHost) {
            tabHost.tabIndex = -1;
            tabHost.focus();
            tabHost.removeAttribute('tabindex');
        }
    }
}

export async function submitInlineAddTab() {
    if (previewAddTabModal.hidden || previewTabAddInFlight) return;
    if (sampleModeEnabled) return;
    const nameInput = document.getElementById('preview-add-tab-name');
    const groupSelect = document.getElementById('preview-add-tab-group');
    const newGroupInput = document.getElementById('preview-add-tab-new-group');
    const submitButton = document.getElementById('preview-add-tab-submit');
    const name = nameInput.value.trim();
    const createGroup = groupSelect.value === createNewTabGroupValue;
    const groupName = createGroup ? newGroupInput.value.trim() : groupSelect.value;
    if (!name || !groupName) {
        setInlineAddTabStatus(createGroup
            ? 'Enter a tab name and a new service group name.'
            : 'Enter a tab name and choose its initial group.');
        return;
    }
    setPreviewTabAddInFlight(true);
    submitButton.disabled = true;
    setPendingInlineRenameTab(name);
    const applied = await applyPreviewEdit({
        type: 'tab.add',
        values: { name, groupName, createGroup, afterTab: previewTabAddAfterTab }
    }, createGroup ? `Added tab ${name} with group ${groupName}.` : `Added tab ${name}.`);
    if (applied) {
        closeInlineAddTabPanel({ restoreFocus: false });
    } else {
        setPreviewTabAddInFlight(false);
        submitButton.disabled = false;
        setPendingInlineRenameTab(null);
        setInlineAddTabStatus('Could not add the tab. See the application notification for the reason.');
    }
}

export function updateAutoIndentLabel() {
    autoIndentLabel.textContent = `Auto Indent ${autoIndentToggle.checked ? 'on' : 'off'}`;
}

export function updateEditorVisibility() {
    const isVisible = editorVisibilityToggle.checked;
    document.getElementById('yaml-editor-section').classList.toggle('editor-collapsed', !isVisible);
    editorVisibilityLabel.textContent = isVisible ? 'Hide editor' : 'Show editor';
    editorVisibilityToggle.setAttribute('aria-label', isVisible ? 'Hide editor' : 'Show editor');
    if (isVisible) {
        window.requestAnimationFrame(() => yamlCodeEditor.refresh());
    }
}

export function syncPreviewEditModePresentation(isEnabled) {
    if (!isEnabled) closeInlineAddTabPanel({ restoreFocus: false });
    previewEditLabel.textContent = `Interactive editor ${isEnabled ? 'on' : 'off'}`;
    document.getElementById('preview-title-label').textContent = isEnabled ? 'Interactive Editor' : 'Dashboard';
    document.getElementById('preview-title-icon').innerHTML = isEnabled
        ? '<path d="M4 20l4.2-1L18.8 8.4a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20zM14.6 7l2.8 2.8"></path>'
        : '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M9 9v11M15 9v11"></path>';
    previewEditToggle.setAttribute('aria-label', `${isEnabled ? 'Disable' : 'Enable'} Interactive editor`);
    document.getElementById('preview-option-types-button').hidden = !isEnabled;
    document.getElementById('preview-comments-toggle-container').hidden = !isEnabled;
}

export function updatePreviewEditMode() {
    const isEnabled = previewEditToggle.checked && !previewEditToggle.disabled;
    syncPreviewEditModePresentation(isEnabled);
    updatePreview({ force: true });
}

export function updatePreviewUndoButton() {
    document.getElementById('preview-undo-button').hidden = !previewUndoState;
}

export function setResetSampleVisible(isVisible) {
    const resetButton = document.getElementById('reset-sample-button');
    if (resetButton) {
        resetButton.hidden = !isVisible;
    }
}

export function setReloadDirectoryVisible(isVisible) {
    const reloadButton = document.getElementById('reload-directory-button');
    if (reloadButton) {
        reloadButton.hidden = !isVisible;
    }
}

export function setSampleMode(isSampleMode) {
    setSampleModeEnabled(isSampleMode);
    const saveButton = document.getElementById('save-config-button');
    const saveLabel = saveButton.querySelector('.toolbar-button-label');
    saveButton.disabled = isSampleMode;
    saveButton.classList.toggle('sample-mode-disabled', isSampleMode);
    saveButton.setAttribute('aria-label', isSampleMode ? 'Save unavailable in sample mode' : 'Save');
    saveLabel.textContent = isSampleMode
        ? 'Examples are read-only; load a directory to save'
        : 'Save all edited YAML files';
    const editToggle = document.getElementById('preview-edit-toggle');
    editToggle.disabled = isSampleMode;
    syncPreviewEditModePresentation(editToggle.checked && !editToggle.disabled);
}

export function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function scrollToEditor() {
    const editorSection = document.getElementById('yaml-editor-section');
    if (editorSection) {
        editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

export function scrollToPreview() {
    const previewSection = document.getElementById('homepage-preview-section');
    if (previewSection) {
        previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

export function updateFloatingNavVisibility() {
    const topButton = document.getElementById('scroll-top-button');
    if (!topButton) {
        return;
    }
    topButton.hidden = window.scrollY <= 100;
}

export function updateSectionJumpButton() {
    const button = document.getElementById('jump-section-button');
    const label = document.getElementById('jump-section-label');
    const targetTab = currentTab === 'services'
        ? 'Settings'
        : currentTab === 'settings'
            ? 'Services'
            : null;

    button.hidden = !targetTab;
    if (targetTab) {
        const buttonLabel = `Jump to ${targetTab}`;
        label.textContent = buttonLabel;
        button.setAttribute('aria-label', buttonLabel);
    }
}

export function applyTheme(isDarkMode) {
    document.documentElement.classList.toggle('light-mode', !isDarkMode);
    document.body.classList.toggle('light-mode', !isDarkMode);
    const nextTheme = isDarkMode ? 'Light' : 'Dark';
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} Mode`);
    document.getElementById('theme-toggle-icon').textContent = isDarkMode ? '\u2600' : '\u263E';
    document.getElementById('theme-toggle-label').textContent = `${nextTheme} mode`;
}

export async function toggleTheme() {
    const isDarkMode = document.body.classList.contains('light-mode');
    applyTheme(isDarkMode);
    setSavedAppSettings({
        ...savedAppSettings,
        theme: isDarkMode ? 'dark' : 'light'
    });
    yamlCodeEditor.refresh();
    const saveResult = await persistAppSettings();
    if (saveResult !== true) {
        setSaveStatus(`Could not save editor settings. ${addErrorGuidance(saveResult.error, 'Check the application data directory and try again')}`, 'error');
    }
}

export function normalizeConfigTabOrder(tabOrder) {
    const requestedOrder = Array.isArray(tabOrder) ? tabOrder : [];
    const knownTabs = requestedOrder.filter((tabName, index) => (
        configTabNames.includes(tabName) && requestedOrder.indexOf(tabName) === index
    ));
    return [...knownTabs, ...configTabNames.filter((tabName) => !knownTabs.includes(tabName))];
}

export function normalizeVisibleConfigTabs(visibleTabs, tabOrder) {
    const requestedTabs = Array.isArray(visibleTabs) ? visibleTabs : [];
    const normalizedTabs = tabOrder.filter((tabName) => requestedTabs.includes(tabName));
    return normalizedTabs.length > 0 ? normalizedTabs : [...tabOrder];
}

export function normalizeEditBarOptions(options) {
    const defaults = { comment: true, duplicate: true, moveUpDown: true };
    if (!options || typeof options !== 'object') return { ...defaults };
    return {
        comment: options.comment !== false,
        duplicate: options.duplicate !== false,
        moveUpDown: options.moveUpDown !== false
    };
}

export function applyEditBarOptions() {
    const opts = savedAppSettings.editBarOptions;
    document.body.setAttribute('data-editbar-comment', String(opts.comment));
    document.body.setAttribute('data-editbar-duplicate', String(opts.duplicate));
    document.body.setAttribute('data-editbar-move', String(opts.moveUpDown));
}

export function normalizeLiveHomepageUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
        const parsed = new URL(raw, window.location.origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.href;
    } catch {
        return '';
    }
}

export function applyLiveHomepageLink(url) {
    const link = document.getElementById('live-homepage-link');
    if (!link) return;
    const normalized = normalizeLiveHomepageUrl(url);
    if (!normalized) {
        link.hidden = true;
        link.removeAttribute('href');
        return;
    }
    link.hidden = false;
    link.href = normalized;
}

export function applyConfigTabNavigation({ onSwitchTab } = {}) {
    const tabContainer = document.querySelector('.config-tabs');
    const visibleTabs = new Set(savedAppSettings.visibleTabs);
    savedAppSettings.tabOrder.forEach((tabName) => {
        const tab = tabContainer.querySelector(`.tab[data-tab="${tabName}"]`);
        if (!tab) return;
        tab.hidden = !visibleTabs.has(tabName);
        tabContainer.append(tab);
    });
    if (!visibleTabs.has(currentTab) && Object.keys(loadedFiles).length > 0 && onSwitchTab) {
        onSwitchTab(getFirstVisibleConfigTab(), null);
    }
}

export function applyPersistentAppSettings(settings = {}, { onSwitchTab } = {}) {
    const tabOrder = normalizeConfigTabOrder(settings.tabOrder);
    setSavedAppSettings({
        theme: settings.theme === 'light' ? 'light' : 'dark',
        customPageTitle: typeof settings.customPageTitle === 'string' ? settings.customPageTitle.trim() : '',
        liveHomepageUrl: normalizeLiveHomepageUrl(settings.liveHomepageUrl),
        autoIndent: settings.autoIndent !== false,
        previewAutoRefresh: settings.previewAutoRefresh !== false,
        editorVisible: settings.editorVisible !== false,
        interactiveEditor: settings.interactiveEditor === true,
        showComments: settings.showComments === true,
        editBarOptions: normalizeEditBarOptions(settings.editBarOptions),
        tabOrder,
        visibleTabs: normalizeVisibleConfigTabs(settings.visibleTabs, tabOrder),
        autoBackup: settings.autoBackup !== false,
        backupCount: Number.isFinite(settings.backupCount) ? Math.max(1, Math.min(100, Math.round(settings.backupCount))) : 10
    });
    applyConfigTabNavigation({ onSwitchTab });
    const pageTitle = savedAppSettings.customPageTitle || defaultPageTitle;
    document.title = pageTitle;
    document.getElementById('app-title').textContent = pageTitle;
    applyTheme(savedAppSettings.theme !== 'light');
    applyLiveHomepageLink(savedAppSettings.liveHomepageUrl);
    autoIndentToggle.checked = savedAppSettings.autoIndent;
    previewAutoRefreshToggle.checked = savedAppSettings.previewAutoRefresh;
    editorVisibilityToggle.checked = savedAppSettings.editorVisible;
    previewEditToggle.checked = savedAppSettings.interactiveEditor;
    setPreviewShowCommentsState(savedAppSettings.showComments);
    const commentsToggle = document.getElementById('preview-comments-toggle');
    if (commentsToggle) commentsToggle.checked = savedAppSettings.showComments;
    const commentsLabel = document.getElementById('preview-comments-label');
    if (commentsLabel) commentsLabel.textContent = savedAppSettings.showComments ? 'Hide comments' : 'Show comments';
    updateAutoIndentLabel();
    updateEditorVisibility();
    previewAutoRefreshLabel.textContent = `Auto Refresh ${previewAutoRefreshToggle.checked ? 'on' : 'off'}`;
    manualRefreshButton.hidden = previewAutoRefreshToggle.checked;
    updatePreviewEditMode();
    applyEditBarOptions();
    yamlCodeEditor.refresh();
}

export function getFirstVisibleConfigTab() {
    return savedAppSettings.tabOrder.find((tabName) => savedAppSettings.visibleTabs.includes(tabName)) || 'services';
}

export function getSettingsTabDraftFromControls() {
    const rows = document.querySelectorAll('#settings-yaml-tabs [data-settings-tab]');
    const tabOrder = Array.from(rows, (row) => row.getAttribute('data-settings-tab'));
    const visibleTabs = Array.from(rows)
        .filter((row) => row.querySelector('[data-settings-tab-visible]').checked)
        .map((row) => row.getAttribute('data-settings-tab'));
    const normalizedOrder = normalizeConfigTabOrder(tabOrder);
    return {
        tabOrder: normalizedOrder,
        visibleTabs: normalizeVisibleConfigTabs(visibleTabs, normalizedOrder)
    };
}

export function updateSettingsTabVisibilityDraft() {
    setSettingsTabOrderDraft(getSettingsTabDraftFromControls());
    renderSettingsTabControls();
}

export function renderSettingsTabControls() {
    const container = document.getElementById('settings-yaml-tabs');
    const visibleTabs = new Set(settingsTabOrderDraft.visibleTabs);
    container.innerHTML = settingsTabOrderDraft.tabOrder.map((tabName, index) => `
        <div class="settings-yaml-tab-row" data-settings-tab="${tabName}">
            <label class="settings-yaml-tab-visibility">
                <input type="checkbox" data-settings-tab-visible${visibleTabs.has(tabName) ? ' checked' : ''}${visibleTabs.size === 1 && visibleTabs.has(tabName) ? ' disabled' : ''}>
                <span class="settings-yaml-tab-check" aria-hidden="true">&#10003;</span>
                <span>${escapeHtml(configTabLabels[tabName])}</span>
            </label>
            <div class="settings-yaml-tab-actions" aria-label="Reorder ${escapeHtml(configTabLabels[tabName])} tab">
                <button type="button" class="settings-yaml-tab-move" data-settings-tab-move="up" aria-label="Move ${escapeHtml(configTabLabels[tabName])} tab up" title="Move up"${index === 0 ? ' disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 18V6M7 11l5-5 5 5"></path></svg></button>
                <button type="button" class="settings-yaml-tab-move" data-settings-tab-move="down" aria-label="Move ${escapeHtml(configTabLabels[tabName])} tab down" title="Move down"${index === settingsTabOrderDraft.tabOrder.length - 1 ? ' disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 6v12m-5-5 5 5 5-5"></path></svg></button>
            </div>
        </div>`).join('');
}

export function moveSettingsTab(tabName, direction) {
    const draft = getSettingsTabDraftFromControls();
    const currentIndex = draft.tabOrder.indexOf(tabName);
    const destination = currentIndex + (direction === 'up' ? -1 : 1);
    if (currentIndex === -1 || destination < 0 || destination >= draft.tabOrder.length) return;
    [draft.tabOrder[currentIndex], draft.tabOrder[destination]] = [draft.tabOrder[destination], draft.tabOrder[currentIndex]];
    setSettingsTabOrderDraft(draft);
    renderSettingsTabControls();
}

export function getPersistentAppSettings() {
    return { ...savedAppSettings };
}

export function persistAppSettings() {
    const settings = getPersistentAppSettings();
    setPendingAppSettingsSave(pendingAppSettingsSave
        .catch(() => undefined)
        .then(() => persistAppSettingsRequest(settings))
        .then(() => true)
        .catch((error) => {
            console.warn('Could not save persistent app settings', error);
            return { ok: false, error };
        }));
    return pendingAppSettingsSave;
}

export function activateSettingsTab(tabName, { focus = false } = {}) {
    const activeTabName = settingsTabNames.includes(tabName) ? tabName : settingsTabNames[0];
    setSettingsActiveTab(activeTabName);
    const tabList = document.getElementById('settings-tab-list');
    const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
    tabs.forEach((tab) => {
        const isActive = tab.getAttribute('data-settings-tab') === activeTabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-settings-panel') !== activeTabName;
    });
    const settingsScrollContainer = document.querySelector('#settings-modal .settings-tabs');
    if (settingsScrollContainer) {
        settingsScrollContainer.scrollTop = 0;
    }
    if (focus) {
        tabList.querySelector(`[role="tab"][data-settings-tab="${activeTabName}"]`)?.focus();
    }
}

export function handleSettingsTabKeydown(event) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(document.querySelectorAll('#settings-tab-list [role="tab"]'));
    const currentIndex = tabs.indexOf(event.target);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'Home') {
        nextIndex = 0;
    } else if (event.key === 'End') {
        nextIndex = tabs.length - 1;
    }
    event.preventDefault();
    activateSettingsTab(tabs[nextIndex].getAttribute('data-settings-tab'), { focus: true });
}

export function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    setSettingsModalPreviousFocus(document.activeElement);
    const settings = getPersistentAppSettings();
    document.querySelector(`input[name="settings-theme"][value="${settings.theme}"]`).checked = true;
    document.getElementById('settings-custom-page-title').value = settings.customPageTitle;
    document.getElementById('settings-live-homepage-url').value = settings.liveHomepageUrl || '';
    document.getElementById('settings-auto-indent').checked = settings.autoIndent;
    document.getElementById('settings-auto-backup').checked = settings.autoBackup;
    document.getElementById('settings-backup-count').value = settings.backupCount;
    document.getElementById('settings-preview-auto-refresh').checked = settings.previewAutoRefresh;
    document.getElementById('settings-editor-visible').checked = settings.editorVisible;
    document.getElementById('settings-interactive-editor').checked = settings.interactiveEditor;
    document.getElementById('settings-show-comments').checked = settings.showComments === true;
    const editBarOpts = settings.editBarOptions || { comment: true, duplicate: true, moveUpDown: true };
    document.getElementById('settings-editbar-comment').checked = editBarOpts.comment !== false;
    document.getElementById('settings-editbar-duplicate').checked = editBarOpts.duplicate !== false;
    document.getElementById('settings-editbar-move').checked = editBarOpts.moveUpDown !== false;
    setSettingsTabOrderDraft({ tabOrder: [...settings.tabOrder], visibleTabs: [...settings.visibleTabs] });
    renderSettingsTabControls();
    activateSettingsTab(settingsActiveTab);
    modal.hidden = false;
    modal.querySelector('.modal-content').scrollTop = 0;
    window.requestAnimationFrame(() => document.querySelector('#settings-tab-list [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }));
}

export function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal.hidden) return;
    modal.hidden = true;
    if (settingsModalPreviousFocus && typeof settingsModalPreviousFocus.focus === 'function') {
        settingsModalPreviousFocus.focus();
    }
    setSettingsModalPreviousFocus(null);
}

export async function submitSettingsModal(event) {
    event.preventDefault();
    const theme = document.querySelector('input[name="settings-theme"]:checked').value;
    const tabSettings = getSettingsTabDraftFromControls();
    applyPersistentAppSettings({
        theme,
        customPageTitle: document.getElementById('settings-custom-page-title').value,
        liveHomepageUrl: document.getElementById('settings-live-homepage-url').value,
        autoIndent: document.getElementById('settings-auto-indent').checked,
        autoBackup: document.getElementById('settings-auto-backup').checked,
        backupCount: Number(document.getElementById('settings-backup-count').value) || 10,
        previewAutoRefresh: document.getElementById('settings-preview-auto-refresh').checked,
        editorVisible: document.getElementById('settings-editor-visible').checked,
        interactiveEditor: document.getElementById('settings-interactive-editor').checked,
        showComments: document.getElementById('settings-show-comments').checked,
        editBarOptions: {
            comment: document.getElementById('settings-editbar-comment').checked,
            duplicate: document.getElementById('settings-editbar-duplicate').checked,
            moveUpDown: document.getElementById('settings-editbar-move').checked
        },
        tabOrder: tabSettings.tabOrder,
        visibleTabs: tabSettings.visibleTabs
    });
    const saveResult = await persistAppSettings();
    if (saveResult === true) {
        setSaveStatus('Editor settings saved.', 'success');
        closeSettingsModal();
    } else {
        setSaveStatus(`Could not save editor settings. ${addErrorGuidance(saveResult.error, 'Check the application data directory and try again')}`, 'error');
    }
}
