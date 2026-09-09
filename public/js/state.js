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
// Per-tab record of whether the file actually exists on disk in the loaded directory.
// Absent tabs keep sample text as their working/baseline content but must remain
// distinguishable from real files so Save never creates them without an edit.
export let loadedFilePresent = Object.fromEntries(configTabNames.map((tabName) => [tabName, false]));
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
// --- D1 async ownership foundation ---
// Directory session generation: identity of the currently owned loaded-directory session.
// Bumped exactly once per successful directory install (startup load, manual load, reload), so
// A -> B -> A and same-path reloads all produce distinct generations. Save batches freeze this
// value at submission; a response may reconcile state only while it still matches, which means
// returning to the same path later never revives an old response's ownership.
let directorySessionGeneration = 0;

// Directory operation sequence: every started load/reload receives the next token when its
// request begins. Only the most recently started operation may install its result, so reversed
// or overlapping responses are rejected by operation identity rather than path comparison.
let directoryOperationSequence = 0;

// Operation token that installed the currently owned directory session. A pending newer load or
// reload advances directoryOperationSequence but leaves this boundary unchanged until it installs,
// so Save can detect supersession during that pending window.
let directorySessionOperationToken = null;

// Content mutation version: bumped on every meaningful working-document change (per-tab text
// replacement and full document reassignment). Ordinary tab switching never bumps it. Baseline
// updates alone do not bump it because they do not change the working document. Preview transform
// responses freeze this value before awaiting and must still match it before committing.
let contentVersion = 0;

// Preview operation sequence: every server-backed preview transform claims the next token, so a
// newer preview action supersedes older pending responses. Directory lifecycle changes and Undo
// explicitly invalidate the sequence without changing the document themselves.
let previewOperationSequence = 0;

// In-flight frontend save batch ownership: non-null while a Save action is pending, so
// overlapping Save actions cannot share or clear each other's state (independent of the
// disabled-button affordance).
let activeSaveToken = null;
let saveBatchSequence = 0;

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
export function setLoadedFiles(files) { loadedFiles = files; bumpContentVersion(); }
export function setOriginalLoadedFiles(files) { originalLoadedFiles = files; }
export function setLoadedFileRevisions(revisions) { loadedFileRevisions = revisions; }
export function setLoadedFileNames(names) { loadedFileNames = names; }
export function setLoadedFilePresent(present) { loadedFilePresent = present; }
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

// --- D1 ownership API ---
export function getDirectorySessionGeneration() { return directorySessionGeneration; }

export function getDirectorySessionOperationToken() { return directorySessionOperationToken; }

// Records that a new directory session has been installed and returns its generation.
export function installDirectorySession(operationToken = directoryOperationSequence) {
    directorySessionGeneration += 1;
    directorySessionOperationToken = operationToken;
    invalidatePreviewOperations();
    return directorySessionGeneration;
}

// True while the given frozen session generation is still the owned one.
export function isDirectorySessionCurrent(generation) { return generation === directorySessionGeneration; }

// Starts a new directory load/reload operation and returns its unique token. The most recently
// started operation wins: an older pending response may not install once a newer one begins.
export function beginDirectoryOperation() {
    directoryOperationSequence += 1;
    invalidatePreviewOperations();
    return directoryOperationSequence;
}

export function isLatestDirectoryOperation(token) { return token === directoryOperationSequence; }

// Finalizes the newest operation without allowing an older, already superseded operation to
// reclaim ownership. When the newest operation fails before installing, the session that remains
// visible can own later UI reconciliation from this new operation boundary.
export function finalizeDirectoryOperation(token) {
    if (!isLatestDirectoryOperation(token)) return false;
    directorySessionOperationToken = token;
    return true;
}

export function getContentVersion() { return contentVersion; }

export function beginPreviewOperation() {
    previewOperationSequence += 1;
    return previewOperationSequence;
}

export function invalidatePreviewOperations() {
    previewOperationSequence += 1;
    return previewOperationSequence;
}

export function isLatestPreviewOperation(token) { return token === previewOperationSequence; }

// Bumps the working-document mutation version. Called by the loaded-file setters below so every
// meaningful content change is observed without touching editor or preview code.
export function bumpContentVersion() {
    contentVersion += 1;
    return contentVersion;
}

// Claims ownership of a frontend save batch; returns null when another batch is still pending.
export function beginSaveBatch() {
    if (activeSaveToken !== null) return null;
    saveBatchSequence += 1;
    activeSaveToken = saveBatchSequence;
    return activeSaveToken;
}

export function endSaveBatch(token) {
    if (activeSaveToken === token) activeSaveToken = null;
}

// --- Object/Map mutation helpers (for property assignments, not full reassignment) ---
export function setLoadedFileContent(tabName, content) {
    // Bump only on a real change so tab switching and no-op remembers never invalidate owners.
    if (loadedFiles[tabName] !== content) {
        loadedFiles[tabName] = content;
        bumpContentVersion();
    }
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

export function setLoadedFilePresence(tabName, present) {
    loadedFilePresent[tabName] = present;
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
