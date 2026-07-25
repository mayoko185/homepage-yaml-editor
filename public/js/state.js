// Application state management — single authoritative owner of all mutable state
import { configTabNames } from './constants.js';

// --- State variables ---
export let currentTab = 'services';
export let loadedFiles = {};
export let originalLoadedFiles = {};
export let loadedFileRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));
export let loadedFileNames = Object.fromEntries(
    configTabNames.map((tabName) => [tabName, `${tabName}.yaml`])
);
export let currentDirectoryPath = null;
export let currentDirectoryWasAutoloaded = false;
export let previewHomepageTab = null;
export const parsedConfigCache = new Map();
export let previewUpdateTimer = null;
export let sourceHighlightLine = null;
export let sourceHighlightTimer = null;
export let sampleModeEnabled = true;
export let previewUndoState = null;
export let applyingPreviewFiles = false;
export let previewShowCommentsState = false;
export let previewEditDialogState = null;
export let previewEditPreviousFocus = null;
export let previewEditPreviousFocusVisible = false;
export let pendingInlineRenameTab = null;
export let pendingInlineRenameBackup = null;
export let previewTabAddAnchor = null;
export let previewTabAddAfterTab = null;
export let previewTabAddInFlight = false;
export let activePreviewDrag = null;
export let optionDefinitions = new Map();
export let optionTypesDraft = [];
export let optionTypesRemovedDefinitions = new Map();
export let optionTypesPreviousFocus = null;
export let directoryModalPreviousFocus = null;
export let confirmationDialogResolver = null;
export let confirmationDialogPreviousFocus = null;
export let previewEditModalPreviousFocus = null;
export let settingsActiveTab = 'appearance';
export let settingsModalPreviousFocus = null;
export let pendingAppSettingsSave = Promise.resolve();
export let settingsTabOrderDraft = [...configTabNames];
export let savedAppSettings = {
    theme: 'dark',
    customPageTitle: '',
    liveHomepageUrl: '',
    autoIndent: true,
    previewAutoRefresh: true,
    editorVisible: false,
    interactiveEditor: true,
    showComments: false,
    editBarOptions: { comment: true, duplicate: true, moveUpDown: true },
    visibleTabs: [...configTabNames],
    tabOrder: [...configTabNames],
    autoBackup: true,
    backupCount: 10
};

// --- Full-reassignment setters ---
export function setCurrentTab(tab) { currentTab = tab; }
export function setLoadedFiles(files) { loadedFiles = files; }
export function setOriginalLoadedFiles(files) { originalLoadedFiles = files; }
export function setLoadedFileRevisions(revisions) { loadedFileRevisions = revisions; }
export function setLoadedFileNames(names) { loadedFileNames = names; }
export function setCurrentDirectoryPath(path) { currentDirectoryPath = path; }
export function setCurrentDirectoryWasAutoloaded(val) { currentDirectoryWasAutoloaded = val; }
export function setPreviewHomepageTab(tab) { previewHomepageTab = tab; }
export function setSampleModeEnabled(val) { sampleModeEnabled = val; }
export function setPreviewUndoState(state) { previewUndoState = state; }
export function setApplyingPreviewFiles(val) { applyingPreviewFiles = val; }
export function setPreviewShowCommentsState(val) { previewShowCommentsState = val; }
export function setPreviewEditDialogState(state) { previewEditDialogState = state; }
export function setPreviewUpdateTimer(timer) { previewUpdateTimer = timer; }
export function setSourceHighlightLine(line) { sourceHighlightLine = line; }
export function setSourceHighlightTimer(timer) { sourceHighlightTimer = timer; }
export function setPreviewEditPreviousFocus(el) { previewEditPreviousFocus = el; }
export function setPreviewEditPreviousFocusVisible(val) { previewEditPreviousFocusVisible = val; }
export function setPendingInlineRenameTab(tab) { pendingInlineRenameTab = tab; }
export function setPendingInlineRenameBackup(backup) { pendingInlineRenameBackup = backup; }
export function setPreviewTabAddAnchor(anchor) { previewTabAddAnchor = anchor; }
export function setPreviewTabAddAfterTab(tab) { previewTabAddAfterTab = tab; }
export function setPreviewTabAddInFlight(val) { previewTabAddInFlight = val; }
export function setActivePreviewDrag(drag) { activePreviewDrag = drag; }
export function setOptionDefinitions(defs) { optionDefinitions = defs; }
export function setOptionTypesDraft(draft) { optionTypesDraft = draft; }
export function setOptionTypesRemovedDefinitions(defs) { optionTypesRemovedDefinitions = defs; }
export function setOptionTypesPreviousFocus(el) { optionTypesPreviousFocus = el; }
export function setDirectoryModalPreviousFocus(el) { directoryModalPreviousFocus = el; }
export function setConfirmationDialogResolver(fn) { confirmationDialogResolver = fn; }
export function setConfirmationDialogPreviousFocus(el) { confirmationDialogPreviousFocus = el; }
export function setPreviewEditModalPreviousFocus(el) { previewEditModalPreviousFocus = el; }
export function setSettingsActiveTab(tab) { settingsActiveTab = tab; }
export function setSettingsModalPreviousFocus(el) { settingsModalPreviousFocus = el; }
export function setPendingAppSettingsSave(promise) { pendingAppSettingsSave = promise; }
export function setSettingsTabOrderDraft(draft) { settingsTabOrderDraft = draft; }
export function setSavedAppSettings(settings) { savedAppSettings = settings; }

export function mutatePreviewEditDialogState(mutator) {
    if (!previewEditDialogState) return undefined;
    return mutator(previewEditDialogState);
}

export function mutateOptionTypesDraft(mutator) {
    return mutator(optionTypesDraft);
}

// --- Object/Map mutation helpers (for property assignments, not full reassignment) ---
export function setLoadedFileContent(tabName, content) {
    loadedFiles[tabName] = content;
}

export function setOriginalLoadedFileContent(tabName, content) {
    originalLoadedFiles[tabName] = content;
}

export function setLoadedFileName(tabName, fileName) {
    loadedFileNames[tabName] = fileName;
}

export function setLoadedFileRevision(tabName, revision) {
    loadedFileRevisions[tabName] = revision;
}

export function clearParsedConfigCache() {
    parsedConfigCache.clear();
}

export function setParsedConfigCache(key, value) {
    parsedConfigCache.set(key, value);
}

export function deleteParsedConfigCache(key) {
    parsedConfigCache.delete(key);
}

export function setOptionDefinition(name, definition) {
    optionDefinitions.set(name, definition);
}

export function deleteOptionDefinition(name) {
    optionDefinitions.delete(name);
}

export function clearOptionDefinitions() {
    optionDefinitions.clear();
}

// --- Pure state helpers (no DOM) ---
export function getUnsavedTabNames() {
    const unsaved = [];
    for (const tabName of configTabNames) {
        if (loadedFiles[tabName] !== originalLoadedFiles[tabName]) {
            unsaved.push(tabName);
        }
    }
    return unsaved;
}

export function hasUnsavedChanges() {
    return getUnsavedTabNames().length > 0;
}
