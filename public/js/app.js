import { configTabNames, configTabLabels, sampleConfigs, createNewTabGroupValue, defaultPageTitle, fileToTabMapping, optionValueTypeChoices, optionAppliesToChoices } from './constants.js';
import { getApiErrorMessage, formatYamlError, formatYamlErrorLocation, getSaveErrorSummary, addErrorGuidance, loadSampleConfigs, loadPersistentAppSettings, loadOptionDefinitions, requestDirectoryLoad, createZipBlob } from './api.js';
import { ChunkTree } from './vendor/chunk-tree.js';
import { getEditorValue, setEditorValue, getSelectedLineNumbers, toggleSelectedComments, init as initEditor } from './editor.js';
import { escapeHtml, updateUnsavedIndicators, setSaveStatus, clearSaveStatus, clearSaveStatusNotOwnedByDirectoryOperation, setPreviewStatus, setDirectoryStatus, setSampleDirectoryStatus, setDirectoryModalStatus, handleLoadDirectory, openDirectoryModal, closeDirectoryModal, showConfirmationDialog, closeConfirmationDialog, openInlineAddTabPanel, initInlineAddTabModal, closeInlineAddTabPanel, exitTabRenameMode, applyPersistentAppSettings, setPreviewEditModalStatus, setOptionTypesStatus, readOptionTypesDraft, renderOptionTypesDraft, renderOptionDefaultsDraft, getOrderedOptionDefaultIndexes, setOptionDefaultOrder, openOptionTypesModal, closeOptionTypesModal, saveOptionTypes, setInlineAddTabStatus, updateAutoIndentLabel, updateEditorVisibility, syncPreviewEditModePresentation, updatePreviewEditMode, updatePreviewUndoButton, toggleTheme, setResetSampleVisible, setReloadDirectoryVisible, setSampleMode, scrollToTop, scrollToEditor, scrollToPreview, updateFloatingNavVisibility, updateSectionJumpButton, getFirstVisibleConfigTab, openSettingsModal, closeSettingsModal, submitSettingsModal, activateSettingsTab, handleSettingsTabKeydown, renderSettingsTabControls, moveSettingsTab, updateSettingsTabVisibilityDraft } from './ui.js';
 import { getTabYamlText, parseTabConfig, getHomepageTabInfo, isInitiallyCollapsed, isNestedServiceGroup, getNestedGroupColumns, resolveIconUrl, renderIcon, getSafeLinkUrl, getYamlLines, getYamlKeyFromLine, getYamlIndent, findYamlKeyLine, findNthYamlListKeyLine, findGroupRangeFromLine, findYamlGroupRange, findNestedGroupPathRange, findServicesGroupAtLine, findSettingsLayoutGroupAtLine, findNestedYamlKeyLine, findLineContainingValue, findSourceLine, findBlockLineRange, getSourceAttributes, getDragItemAttributes, takeOccurrence, formatPreviewTooltipLabel, formatPreviewTooltipValue, getPreviewDetailLines, getPreviewTooltipAttributes, getBookmarkTooltipLines, getCurrentTabSource, getPreviewEditActionButton, getGroupEditControls, getServiceEditControls, getBookmarkGroupEditControls, getBookmarkEditControls, extractCommentedLines, buildCommentedServicesData, normalizeCommentedChunkLines, parseCommentedChunkEntry, buildServicesPreviewDataFromChunks, buildCommentedWidgetsData, setPreviewOptionDefinitions, getDefaultPreviewOptionFields, markFieldsCommented, renderPreviewEditOptions, syncPreviewEditOptionState, updatePreviewEditTabWarning, getPreviewEditFieldAtPath, renderPreviewEditGroupNested, closePreviewEditDialog, submitPreviewEditForm, applyPreviewEdit, handlePreviewEditAction, scheduleVisualPreview, updatePreview, refreshPreview, undoPreviewEdit, handlePreviewDragStart, handlePreviewDragOver, handlePreviewDrop, clearPreviewDragState } from './preview.js';
import { yamlCodeEditor, previewAddTabModal, saveStatusElement, setYamlCodeEditor, setPreviewAddTabModal, setSaveStatusElement } from './shared.js';
import { currentTab, loadedFiles, originalLoadedFiles, loadedFileRevisions, loadedFileNames, currentDirectoryPath, currentDirectoryWasAutoloaded, sampleModeEnabled, parsedConfigCache, previewHomepageTab, previewShowCommentsState, previewEditDialogState, previewUndoState, previewUpdateTimer, applyingPreviewFiles, sourceHighlightLine, sourceHighlightTimer, optionDefinitions, optionTypesDraft, optionTypesRemovedDefinitions, optionTypesPreviousFocus, directoryModalPreviousFocus, confirmationDialogResolver, confirmationDialogPreviousFocus, previewEditModalPreviousFocus, pendingInlineRenameTab, pendingInlineRenameBackup, previewTabAddAnchor, previewTabAddAfterTab, previewTabAddInFlight, activePreviewDrag, setCurrentTab, setLoadedFiles, setOriginalLoadedFiles, setLoadedFileRevisions, setLoadedFileNames, setCurrentDirectoryPath, setCurrentDirectoryWasAutoloaded, setSampleModeEnabled, setPreviewHomepageTab, setPreviewShowCommentsState, setPreviewUndoState, setApplyingPreviewFiles, setSourceHighlightLine, setSourceHighlightTimer, setOptionDefinitions, setOptionTypesRemovedDefinitions, setOptionTypesPreviousFocus, setDirectoryModalPreviousFocus, setConfirmationDialogResolver, setConfirmationDialogPreviousFocus, setPreviewEditModalPreviousFocus, setPendingInlineRenameTab, setPendingInlineRenameBackup, setPreviewTabAddAnchor, setPreviewTabAddAfterTab, setPreviewTabAddInFlight, setActivePreviewDrag, mutatePreviewEditDialogState, mutateOptionTypesDraft, setLoadedFileContent, setOriginalLoadedFileContent, setLoadedFileName, setLoadedFileRevision, loadedFilePresent, setLoadedFilePresent, setLoadedFilePresence, getDirectorySessionGeneration, getDirectorySessionOperationToken, installDirectorySession, isDirectorySessionCurrent, beginDirectoryOperation, isLatestDirectoryOperation, finalizeDirectoryOperation, getContentVersion, beginSaveBatch, endSaveBatch, clearParsedConfigCache, setParsedConfigCache, deleteParsedConfigCache, setOptionDefinition, deleteOptionDefinition, clearOptionDefinitions, getUnsavedTabNames, hasUnsavedChanges } from './state.js';

document.addEventListener('DOMContentLoaded', async function() {
    // Claim the startup lifecycle before any awaited bootstrap work. A manual directory
    // load that begins during initialization must supersede startup rather than be reset by
    // late sample initialization or autoload completion.
    const bootstrapSessionGeneration = getDirectorySessionGeneration();
    const startupToken = beginDirectoryOperation();
    let bootstrapComplete = false;
    let latestLoadOperationToken = null;
    let latestReloadOperationToken = null;
    let saveStatusOwner = null;
    // Start examples initialization once, before any other awaited bootstrap work. Directory
    // results share this boundary so absent tabs never capture the initial empty sample values.
    const sampleInitializationPromise = loadSampleConfigs()
        .then(() => ({ available: true, error: null }))
        .catch((error) => ({ available: false, error }));
    // --- Functions moved from preview.js (reference app.js-scoped variables) ---

            function jumpFromSaveStatus() {
                if (!saveStatusElement.dataset.source) {
                    return;
                }
                try {
                    jumpToYamlSource(JSON.parse(saveStatusElement.dataset.source));
                } catch (error) {
                    console.warn('Could not parse save error source target', error);
                }
            }

            function jumpToYamlSource(source) {
                const resolvedSource = getCurrentTabSource(source);
                const tabName = resolvedSource && resolvedSource.tab ? resolvedSource.tab : currentTab;
                const targetLine = Math.max(1, Number(findSourceLine(resolvedSource)) || 1);

                if (!editorVisibilityToggle.checked) {
                    editorVisibilityToggle.checked = true;
                    updateEditorVisibility();
                }

                if (tabName !== currentTab) {
                    switchTab(tabName, null);
                }

                requestAnimationFrame(() => {
                    const lineIndex = Math.min(targetLine - 1, Math.max(0, yamlCodeEditor.lineCount() - 1));
                    const lineText = yamlCodeEditor.getLine(lineIndex) || '';
                    const firstContentColumn = Math.max(0, lineText.search(/\S|$/));

                    if (sourceHighlightLine) {
                        yamlCodeEditor.removeLineClass(sourceHighlightLine, 'background', 'source-line-highlight');
                    }
                    window.clearTimeout(sourceHighlightTimer);

                    yamlCodeEditor.focus();
                    yamlCodeEditor.setCursor({ line: lineIndex, ch: firstContentColumn });
                    yamlCodeEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 120);
                    setSourceHighlightLine(yamlCodeEditor.addLineClass(lineIndex, 'background', 'source-line-highlight'));

                    const editorElement = yamlCodeEditor.getWrapperElement();
                    editorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setSourceHighlightTimer(window.setTimeout(() => {
                        if (sourceHighlightLine) {
                            yamlCodeEditor.removeLineClass(sourceHighlightLine, 'background', 'source-line-highlight');
                            setSourceHighlightLine(null);
                        }
                    }, 1400));
             });
         }

         function jumpToMatchingConfigSection() {
             const cursorLine = yamlCodeEditor.getCursor().line;
             if (currentTab === 'services') {
                 const group = findServicesGroupAtLine(cursorLine);
                 jumpToYamlSource(group
                     ? { tab: 'settings', kind: 'settings-layout-group', groupName: group.groupName }
                     : { tab: 'settings', line: 1 });
                 return;
             }
             if (currentTab === 'settings') {
                 const groupName = findSettingsLayoutGroupAtLine(cursorLine);
                 jumpToYamlSource(groupName
                     ? { tab: 'services', kind: 'services-group', groupName, groupIndex: 0 }
                     : { tab: 'services', line: 1 });
             }
         }

            const previewSection = document.getElementById('homepage-preview-section');
            previewSection.addEventListener('click', function(event) {
                const actionTarget = event.target.closest('[data-preview-action]');
                if (actionTarget && this.contains(actionTarget)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (actionTarget.getAttribute('data-preview-action') === 'tab.add') {
                        const source = JSON.parse(actionTarget.getAttribute('data-source') || '{}');
                        openInlineAddTabPanel(actionTarget.closest('button') || actionTarget, source.name || null);
                        return;
                    }
                    const source = JSON.parse(actionTarget.getAttribute('data-source') || '{}');
                    handlePreviewEditAction(actionTarget.getAttribute('data-preview-action'), source);
                    return;
                }
                const target = event.target.closest('[data-source]');
                if (!target || !this.contains(target)) {
                    return;
                }
                if (target.classList.contains('preview-tab-btn')) {
                    setPreviewHomepageTab(target.getAttribute('data-preview-tab'));
                    updatePreview();
                    return;
                }
                if (previewEditToggle.checked
                    && !previewEditToggle.disabled
                    && !target.classList.contains('yaml-error-card')) {
                    if (target.classList.contains('bookmark-card-link')) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                try {
                    jumpToYamlSource(JSON.parse(target.getAttribute('data-source') || '{}'));
                } catch (error) {
                    console.warn('Could not parse preview source target', error);
                }
            });
            previewSection.addEventListener('keydown', function(event) {
                const jumpTarget = event.target.closest('[data-source]');
                if (jumpTarget && !jumpTarget.classList.contains('preview-tab-btn') && ['Enter', ' '].includes(event.key)) {
                    event.preventDefault();
                    jumpTarget.click();
                    return;
                }
                const target = event.target.closest('.preview-tab-btn');
                if (!target || !this.contains(target) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    return;
                }
                const tabs = Array.from(this.querySelectorAll('.preview-tab-btn'));
                const currentIndex = tabs.indexOf(target);
                let nextIndex = currentIndex;
                if (event.key === 'ArrowLeft') {
                    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                } else if (event.key === 'ArrowRight') {
                    nextIndex = (currentIndex + 1) % tabs.length;
                } else if (event.key === 'Home') {
                    nextIndex = 0;
                } else if (event.key === 'End') {
                    nextIndex = tabs.length - 1;
                }
                event.preventDefault();
                setPreviewHomepageTab(tabs[nextIndex].getAttribute('data-preview-tab'));
                updatePreview();
                requestAnimationFrame(() => this.querySelector('.preview-tab-btn.active')?.focus());
            });
            document.getElementById('visual-preview').addEventListener('error', function(event) {
                if (event.target.matches('img.dashboard-icon')) event.target.hidden = true;
            }, true);
            document.querySelector('.config-tabs').addEventListener('click', function(event) {
                const tab = event.target.closest('.tab[data-tab]');
                if (tab && this.contains(tab)) switchTab(tab.dataset.tab, event);
            });
            document.getElementById('scroll-top-button').addEventListener('click', scrollToTop);
            document.getElementById('scroll-editor-button').addEventListener('click', scrollToEditor);
            document.getElementById('scroll-preview-button').addEventListener('click', scrollToPreview);
            document.getElementById('save-config-button').addEventListener('click', saveConfig);
            document.getElementById('load-directory-button').addEventListener('click', handleLoadDirectory);
            document.getElementById('reset-sample-button').addEventListener('click', resetToSample);
            document.getElementById('reload-directory-button').addEventListener('click', reloadCurrentDirectory);
            document.getElementById('download-config-button').addEventListener('click', downloadAllConfigs);
            document.getElementById('manual-refresh-button').addEventListener('click', refreshPreview);
            document.getElementById('directory-modal-close').addEventListener('click', closeDirectoryModal);
            document.getElementById('directory-modal-cancel').addEventListener('click', closeDirectoryModal);
            document.getElementById('load-directory-submit').addEventListener('click', loadFromServerPath);
            document.getElementById('confirmation-modal-close').addEventListener('click', () => closeConfirmationDialog(false));
            document.getElementById('confirmation-modal-cancel').addEventListener('click', () => closeConfirmationDialog(false));
             document.getElementById('confirmation-modal-confirm').addEventListener('click', () => closeConfirmationDialog(true));
             setSaveStatusElement(document.getElementById('save-status'));






























         setPreviewAddTabModal(document.getElementById('preview-add-tab-modal'));
         setYamlCodeEditor(CodeMirror.fromTextArea(document.getElementById('yaml-editor'), {
            mode: 'yaml',
            lineNumbers: true,
            lineWrapping: false,
            indentUnit: 2,
            tabSize: 2,
            smartIndent: true,
            viewportMargin: 10,
            extraKeys: {
                'Ctrl-/': toggleSelectedComments,
                'Cmd-/': toggleSelectedComments,
                Enter(editor) {
                    if (document.getElementById('auto-indent-toggle').checked) {
                        editor.execCommand('newlineAndIndent');
                    } else {
                        editor.replaceSelection('\n', 'end');
                    }
                },
                Tab(editor) {
                    if (editor.somethingSelected()) {
                        editor.execCommand('indentMore');
                    } else {
                        editor.replaceSelection(' '.repeat(editor.getOption('indentUnit')), 'end');
                    }
                }
             }
         }));
         initEditor(yamlCodeEditor);
         initInlineAddTabModal();
         yamlCodeEditor.on('change', function(editor, change) {
             if (!applyingPreviewFiles && previewUndoState && change.origin !== 'setValue') {
                 setPreviewUndoState(null);
                 updatePreviewUndoButton();
             }
             clearSaveStatus();
             rememberCurrentEditorValue();
             updateUnsavedIndicators();
             scheduleVisualPreview();
         });

          const autoIndentToggle = document.getElementById('auto-indent-toggle');
          const editorVisibilityToggle = document.getElementById('editor-visibility-toggle');
          const previewEditToggle = document.getElementById('preview-edit-toggle');
          const previewAutoRefreshToggle = document.getElementById('preview-auto-refresh-toggle');
          const previewAutoRefreshLabel = document.getElementById('preview-auto-refresh-label');
          const manualRefreshButton = document.getElementById('manual-refresh-button');
          autoIndentToggle.addEventListener('change', updateAutoIndentLabel);
          updateAutoIndentLabel();
           editorVisibilityToggle.addEventListener('change', updateEditorVisibility);
           updateEditorVisibility();
          document.getElementById('preview-comments-toggle').addEventListener('change', function() {
              setPreviewShowCommentsState(this.checked);
              document.getElementById('preview-comments-label').textContent = this.checked ? 'Hide comments' : 'Show comments';
              if (this.checked) {
                  setSaveStatus('Commented-out items cannot be moved or reordered. Uncomment them first to enable move controls.', 'warning');
              } else {
                  clearSaveStatus();
              }
               updatePreview({ force: true });
           });
          previewEditToggle.addEventListener('change', updatePreviewEditMode);
          document.getElementById('preview-undo-button').addEventListener('click', undoPreviewEdit);
          previewAutoRefreshToggle.addEventListener('change', function() {
              const isEnabled = previewAutoRefreshToggle.checked;
              previewAutoRefreshLabel.textContent = `Auto Refresh ${isEnabled ? 'on' : 'off'}`;
              manualRefreshButton.hidden = isEnabled;
              window.clearTimeout(previewUpdateTimer);
              if (isEnabled) {
                  updatePreview({ force: true });
              }
          });
          document.getElementById('themeToggle').addEventListener('click', toggleTheme);
          document.addEventListener('dragstart', handlePreviewDragStart);
          document.addEventListener('dragover', handlePreviewDragOver);
          document.addEventListener('drop', handlePreviewDrop);
          document.addEventListener('dragend', clearPreviewDragState);
          document.getElementById('toggle-comment-button').addEventListener('mousedown', function(event) {
             event.preventDefault();
         });
         document.getElementById('toggle-comment-button').addEventListener('click', function() {
             toggleSelectedComments(yamlCodeEditor);
         });
         document.getElementById('jump-section-button').addEventListener('mousedown', function(event) {
             event.preventDefault();
         });
         document.getElementById('jump-section-button').addEventListener('click', jumpToMatchingConfigSection);
         saveStatusElement.addEventListener('click', jumpFromSaveStatus);
         saveStatusElement.addEventListener('keydown', function(event) {
             if (event.key === 'Enter' || event.key === ' ') {
                 event.preventDefault();
                 jumpFromSaveStatus();
             }
         });
         window.addEventListener('scroll', updateFloatingNavVisibility);
          window.addEventListener('beforeunload', function(event) {
              rememberCurrentEditorValue();
              if (!hasUnsavedChanges()) {
                  return;
             }
             event.preventDefault();
             event.returnValue = true;
         });

         try {
             applyPersistentAppSettings(await loadPersistentAppSettings(), { onSwitchTab: switchTab });
          } catch (error) {
              console.warn('Could not load persistent app settings', error);
              applyPersistentAppSettings({}, { onSwitchTab: switchTab });
              setSaveStatus(`Could not load editor settings; using defaults. ${addErrorGuidance(error, 'You can try again from the Settings dialog')}`, 'error');
          }

         try {
             setPreviewOptionDefinitions(await loadOptionDefinitions());
         } catch (error) {
             console.warn('Could not load option type definitions', error);
             setSaveStatus(`Could not load option types. Some editing controls may be unavailable. ${addErrorGuidance(error, 'You can try again by reloading the page')}`, 'error');
         }

        function applyGenerationZeroSampleFallback(sampleInitializationState) {
            const fallbackFiles = sampleInitializationState.available
                ? { ...sampleConfigs }
                : Object.fromEntries(configTabNames.map((tabName) => [tabName, '']));
            setLoadedFiles(fallbackFiles);
            setOriginalLoadedFiles({ ...fallbackFiles });
            setLoadedFileRevisions(Object.fromEntries(configTabNames.map((tabName) => [tabName, null])));
            setLoadedFileNames(Object.fromEntries(configTabNames.map((tabName) => [tabName, `${tabName}.yaml`])));
            setLoadedFilePresent(Object.fromEntries(configTabNames.map((tabName) => [tabName, false])));
            setCurrentDirectoryPath(null);
            setCurrentDirectoryWasAutoloaded(false);
            setSampleMode(true);
            setSampleDirectoryStatus(sampleInitializationState.available);
            setResetSampleVisible(true);
            setReloadDirectoryVisible(false);

            switchTab(getFirstVisibleConfigTab(), null, { skipRemember: true });
            updateUnsavedIndicators();
            updatePreview();
        }

        async function recoverFailedBootstrapLoad(operationToken, wasBootstrapEra) {
            if (!wasBootstrapEra) {
                return false;
            }

            // This await is also the completion boundary for sample initialization. The
            // operation must be revalidated after it so a newer Load/Reload cannot inherit
            // recovery ownership while the examples request is pending.
            const sampleInitializationState = await sampleInitializationPromise;
            if (getDirectorySessionGeneration() !== bootstrapSessionGeneration
                || !isLatestDirectoryOperation(operationToken)) {
                console.warn('Discarding stale generation-zero fallback for directory operation', operationToken);
                return false;
            }

            applyGenerationZeroSampleFallback(sampleInitializationState);
            return true;
        }

        // Initialize with sample configs
        const sampleInitializationState = await sampleInitializationPromise;
        const startupOperationIsCurrent = isLatestDirectoryOperation(startupToken);
        if (!sampleInitializationState.available && startupOperationIsCurrent) {
            console.error('Example configuration load failed:', sampleInitializationState.error);
            setSaveStatus('Could not load example configurations: ' + addErrorGuidance(sampleInitializationState.error, 'Reload the page and try again'), 'error');
        }

        // Do not reset a directory session that was installed while bootstrap was awaiting
        // settings, option definitions, or examples. A newer manual operation also owns the
        // generation-zero state, even when it has not installed a directory yet.
        if (getDirectorySessionGeneration() === bootstrapSessionGeneration && startupOperationIsCurrent) {
            applyGenerationZeroSampleFallback(sampleInitializationState);
        }
        document.getElementById('security-status').hidden = Boolean(window.APP_CONFIG && window.APP_CONFIG.loginRequired);
        try {
            const response = await fetch('/api/startup-directory');
            const startup = await response.json();

            if (startup.hasStartupDirectory && startup.directory && startup.files) {
                await applyLoadedDirectory(startup, 'services', { autoloaded: true }, startupToken);
            }
        } catch (error) {
            if (isLatestDirectoryOperation(startupToken)) {
                console.error('Startup directory load failed:', error);
                setSaveStatus(`Could not check the startup directory. ${addErrorGuidance(error, 'Use Load to choose a directory manually')}`, 'error');
            } else {
                console.warn('Discarding stale startup directory load error');
            }
        } finally {
            bootstrapComplete = true;
        }


        function rememberCurrentEditorValue() {
            if (currentTab) {
                setLoadedFileContent(currentTab, getEditorValue());
            }
        }

        function switchTab(tabName, event, options = {}) {
            if (!options.skipRemember) {
                rememberCurrentEditorValue();
            }
            setCurrentTab(tabName);
            updateSectionJumpButton();

            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

            if (event && event.target) {
                event.target.classList.add('active');
            } else {
                const activeTabElement = document.querySelector(`.tab[data-tab="${tabName}"]`);
                if (activeTabElement) {
                    activeTabElement.classList.add('active');
                }
            }

            let contentToSet;
            try {
                if (loadedFiles && Object.prototype.hasOwnProperty.call(loadedFiles, tabName)) {
                    const fileContent = loadedFiles[tabName];

                    if (typeof fileContent === 'object' && fileContent !== null) {
                        try {
                            contentToSet = jsyaml.dump(fileContent);
                        } catch (err) {
                            contentToSet = String(fileContent || '');
                        }
                    } else {
                        contentToSet = String(fileContent || '');
                    }
                } else {
                    contentToSet = sampleConfigs[tabName];
                }
            } catch (e) {
                console.warn("SwitchTab error for tab " + tabName + ", using sample");
                contentToSet = sampleConfigs[tabName];
            }

            setEditorValue(contentToSet);
            updatePreview();
        }

        function resetToSample() {
            setEditorValue(sampleConfigs[currentTab]);
            updatePreview();
        }


        function normalizeLoadedFiles(files, revisions = {}) {
            const normalizedFiles = {};
            const normalizedFileNames = {};
            const normalizedRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));

            Object.entries(files || {}).forEach(([filename, content]) => {
                const tabName = fileToTabMapping[filename] || fileToTabMapping[String(filename).toLowerCase()];
                if (tabName) {
                    // Normalize commented groups so every line inside a commented group is commented
                    let normalizedContent = content;
                    if (typeof ChunkTree !== 'undefined' && ChunkTree.normalizeCommentedGroups) {
                        try {
                            if (tabName === 'services') {
                                const chunks = ChunkTree.parseServicesDocument(content);
                                ChunkTree.normalizeCommentedGroups(chunks);
                                normalizedContent = ChunkTree.serializeDocument(chunks);
                            }
                        } catch (e) {
                            // If normalization fails, use the original content
                            normalizedContent = content;
                        }
                    }
                    normalizedFiles[tabName] = normalizedContent;
                    normalizedFileNames[tabName] = filename;
                    normalizedRevisions[tabName] = typeof revisions[filename] === 'string' ? revisions[filename] : null;
                }
            });

            return { files: normalizedFiles, fileNames: normalizedFileNames, revisions: normalizedRevisions };
        }

        // Installs a directory session only while the given operation token still owns the
        // directory lifecycle (i.e. no newer load/reload started after this one). Returns true
        // when the result was installed, false when it was discarded as stale.
        async function applyLoadedDirectory(data, tabName = currentTab, { autoloaded = false } = {}, operationToken) {
            const sampleInitializationState = await sampleInitializationPromise;
            if (!isLatestDirectoryOperation(operationToken)) {
                console.warn('Discarding stale directory load result for', data && data.directory);
                return false;
            }
            installDirectorySession(operationToken);
            supersedeSharedStatus(operationToken);

            setPreviewUndoState(null);
            updatePreviewUndoButton();
            const normalized = normalizeLoadedFiles(data.files, data.revisions);
            const presentTabs = new Set(Object.keys(normalized.files));
            // Tabs whose files are absent from the directory keep their sample view but must
            // start clean: initialize working and baseline text to the same sample content so
            // absence alone is never reported as a pending change or submitted on Save.
            for (const missingTab of configTabNames) {
                if (!presentTabs.has(missingTab)) {
                    normalized.files[missingTab] = String(sampleConfigs[missingTab] || '');
                }
            }
            setLoadedFiles(normalized.files);
            // Preserve the original (non-normalized) YAML as the baseline so that
            // normalization of commented groups is exposed as a pending change.
            const originalFilesByTab = {};
            Object.entries(data.files || {}).forEach(([filename, content]) => {
                const mappedTabName = fileToTabMapping[filename] || fileToTabMapping[String(filename).toLowerCase()];
                if (mappedTabName) originalFilesByTab[mappedTabName] = content;
            });
            setOriginalLoadedFiles(Object.fromEntries(configTabNames.map((tabName) => [
                tabName,
                presentTabs.has(tabName)
                    ? originalFilesByTab[tabName]
                    : String(sampleConfigs[tabName] || '')
            ])));
            // Absence metadata: which tabs actually exist on disk in the loaded directory.
            setLoadedFilePresent(Object.fromEntries(configTabNames.map((name) => [name, presentTabs.has(name)])));
            // Destination filenames: real names for present files, default name for absent ones
            // so an intentional edit can later create the file at its normal location.
            const destinationFileNames = Object.fromEntries(configTabNames.map((name) => [name, `${name}.yaml`]));
            Object.assign(destinationFileNames, normalized.fileNames);
            setLoadedFileNames(destinationFileNames);
            setLoadedFileRevisions(normalized.revisions);
            setCurrentDirectoryPath(data.directory);
            setCurrentDirectoryWasAutoloaded(autoloaded);

            setDirectoryStatus(currentDirectoryPath, Object.keys(data.files || {}).length, {
                autoloaded,
                missingCount: configTabNames.length - presentTabs.size,
                examplesAvailable: sampleInitializationState.available
            });
            setSampleMode(false);
            setResetSampleVisible(false);
            setReloadDirectoryVisible(true);
            switchTab(tabName, null, { skipRemember: true });
            return true;
        }

        // Save status is shared with load/reload and preview messages. Keep only a lightweight
        // identity for the status last written by Save so stale cleanup cannot clear a newer
        // operation's message after it has replaced the DOM text.
        function supersedeSharedStatus(operationToken) {
            clearSaveStatusNotOwnedByDirectoryOperation(operationToken);
            if (saveStatusOwner && saveStatusOwner.directoryOperationToken !== operationToken) {
                // Once a directory operation claims the shared surface, an older Save's finally
                // block has no ownership left to release or clear.
                saveStatusOwner = null;
            }
        }

        function clearSaveStatusOwnedBySave(saveToken = null) {
            if (!saveStatusOwner || (saveToken !== null && saveStatusOwner.token !== saveToken)) {
                return;
            }
            const owner = saveStatusOwner;
            saveStatusOwner = null;
            if (owner.directoryOperationToken !== null
                && owner.directoryOperationToken !== undefined
                && saveStatusElement
                && saveStatusElement.dataset.directoryOperationToken !== String(owner.directoryOperationToken)) {
                return;
            }
            if (saveStatusElement
                && !saveStatusElement.hidden
                && saveStatusElement.textContent === owner.message) {
                clearSaveStatus();
            }
        }


        async function saveConfig() {
            const saveButton = document.getElementById('save-config-button');
            if (!currentDirectoryPath) {
                setSaveStatus('Examples are read-only. Load a directory before saving.', 'error');
                return;
            }

            // Duplicate frontend save ownership: overlapping Save actions must not share or clear
            // each other's state; correctness does not rely on the disabled button below.
            const saveToken = beginSaveBatch();
            if (saveToken === null) {
                setSaveStatus('A save is already in progress. Wait for it to finish before saving again.', 'info');
                return;
            }
            const saveSessionGeneration = getDirectorySessionGeneration();
            const saveDirectoryOperationToken = getDirectorySessionOperationToken();

            try {
                rememberCurrentEditorValue();

                // Freeze the complete save batch before the first awaited request. Every field that
                // determines what will be written — originating session generation, directory path,
                // destination filenames, submitted text, and expected revisions — is captured now,
                // so switching directories or editing later cannot change this batch's requests.
                const frozenBatch = {
                    sessionGeneration: saveSessionGeneration,
                    directoryOperationToken: saveDirectoryOperationToken,
                    directoryPath: currentDirectoryPath,
                    configs: getUnsavedTabNames().map((tabName) => ({
                        tabName,
                        filename: loadedFileNames[tabName] || `${tabName}.yaml`,
                        yamlText: getTabYamlText(tabName),
                        expectedRevision: loadedFileRevisions[tabName] ?? null
                    }))
                };

                const isSaveUiCurrent = () => isDirectorySessionCurrent(frozenBatch.sessionGeneration)
                    && isLatestDirectoryOperation(frozenBatch.directoryOperationToken);
                const setSaveStatusIfCurrent = (message, state = 'info', source = null) => {
                    if (!isSaveUiCurrent()) return false;
                    setSaveStatus(message, state, source, {
                        directoryOperationToken: frozenBatch.directoryOperationToken,
                        directorySessionGeneration: frozenBatch.sessionGeneration
                    });
                    saveStatusOwner = {
                        token: saveToken,
                        message,
                        directoryOperationToken: frozenBatch.directoryOperationToken,
                        directorySessionGeneration: frozenBatch.sessionGeneration
                    };
                    return true;
                };

                if (frozenBatch.configs.length === 0) {
                    setSaveStatusIfCurrent('No unsaved changes.', 'info');
                    return;
                }

                for (const config of frozenBatch.configs) {
                    try {
                        jsyaml.load(config.yamlText);
                    } catch (error) {
                        const yamlError = formatYamlError(error);
                        setSaveStatusIfCurrent(
                            `${config.filename} - ${formatYamlErrorLocation(yamlError)} - ${yamlError.summary}`,
                            'error',
                            { tab: config.tabName, line: yamlError.line || 1 }
                        );
                        return;
                    }
                }

                const savedConfigs = [];
                const failedConfigs = [];

                saveButton.disabled = true;
                setSaveStatusIfCurrent(
                    `Saving ${frozenBatch.configs.length} changed configuration${frozenBatch.configs.length === 1 ? '' : 's'}...`,
                    'pending'
                );

                for (const config of frozenBatch.configs) {
                    try {
                        const response = await fetch('/api/directory/file/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                dirPath: frozenBatch.directoryPath,
                                filename: config.filename,
                                content: config.yamlText,
                                expectedRevision: config.expectedRevision
                            })
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok || data.error) {
                            const error = new Error(getApiErrorMessage(data, response, `Could not save ${config.filename}`));
                            error.status = response.status;
                            throw error;
                        }

                        savedConfigs.push(config);
                        // Reconcile only while the originating Save still owns the UI. The baseline is set to
                        // the submitted text (not whatever the editor holds now), so newer edits made during
                        // the save remain dirty against it; a stale response must not touch the newer
                        // session's baselines, revisions, or presence metadata.
                        if (isSaveUiCurrent()) {
                            setOriginalLoadedFileContent(config.tabName, config.yamlText);
                            setLoadedFileRevision(config.tabName, data.revision);
                            if (!loadedFilePresent[config.tabName]) {
                                // The save created a file that was absent from the loaded directory.
                                setLoadedFilePresence(config.tabName, true);
                            }
                        }
                    } catch (error) {
                        failedConfigs.push({ config, error });
                    }
                }

                if (!isSaveUiCurrent()) {
                    // The batch's session was replaced while saving; its outcome must not write
                    // notices or state into the newer directory-operation lifecycle.
                    console.warn('Discarding stale save result for', frozenBatch.directoryPath);
                    return;
                }

                if (failedConfigs.length > 0) {
                    const firstFailure = failedConfigs[0];
                    setSaveStatusIfCurrent(
                        `Saved ${savedConfigs.length} of ${frozenBatch.configs.length}. Could not save ${firstFailure.config.filename}: ${addErrorGuidance(
                            firstFailure.error,
                            firstFailure.error.status === 409
                                ? 'Your pending edit is still available. Reload the directory before saving again'
                                : 'Fix the error and try Save again'
                        )}`,
                        'error'
                    );
                } else {
                    const savedNames = savedConfigs.map(({ filename }) => filename).join(', ');
                    setSaveStatusIfCurrent(
                        savedConfigs.length === 1
                            ? `Saved ${savedNames}.`
                            : `Saved ${savedConfigs.length} configurations: ${savedNames}.`,
                        'success'
                    );
                }
            } finally {
                endSaveBatch(saveToken);
                // The token must always be released, but stale saves must not rewrite the UI
                // after a newer directory session or directory operation has taken ownership of it.
                if (isDirectorySessionCurrent(saveSessionGeneration)) {
                    if (!isLatestDirectoryOperation(saveDirectoryOperationToken)) {
                        clearSaveStatusOwnedBySave(saveToken);
                        // The pending Save still owns this control, but not the newer operation's
                        // status. Restore only the control and indicators that belong to Save.
                        saveButton.disabled = !currentDirectoryPath || sampleModeEnabled;
                        updateUnsavedIndicators();
                        return;
                    }
                    setSampleMode(!currentDirectoryPath);
                    updateUnsavedIndicators();
                }
            }
        }

        async function downloadAllConfigs() {
            try {
                rememberCurrentEditorValue();
                if (hasUnsavedChanges()) {
                    window.setTimeout(() => {
                        setSaveStatus('Save or discard pending changes before downloading.', 'error');
                    }, 0);
                    return;
                }
                const filesForDownload = configTabNames.reduce((files, tabName) => {
                    files[loadedFileNames[tabName] || `${tabName}.yaml`] = getTabYamlText(tabName);
                    return files;
                }, {});
                const blob = createZipBlob(filesForDownload);
                const filename = `homepage-config-${new Date().toISOString().slice(0, 10)}.zip`;
                const downloadUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(downloadUrl);
            } catch (error) {
                console.error('Error:', error);
                setSaveStatus(`Could not create the configuration download: ${getSaveErrorSummary(error)}`, 'error');
            }
        }


        async function loadFromServerPath() {
            const dirPath = document.getElementById('serverPathInput').value.trim();
            if (!dirPath) {
                setDirectoryModalStatus('Enter a directory path to continue.');
                document.getElementById('serverPathInput').focus();
                return;
            }

            const loadButton = document.getElementById('load-directory-submit');
            setDirectoryModalStatus();
            loadButton.disabled = true;
            const operationToken = beginDirectoryOperation();
            supersedeSharedStatus(operationToken);
            latestLoadOperationToken = operationToken;
            const requestedTab = currentTab;
            const wasBootstrapEra = !bootstrapComplete
                && getDirectorySessionGeneration() === bootstrapSessionGeneration;
            try {
                // Start the operation and freeze the tab to display before awaiting, so a
                // directory switch during the pending request cannot change this load's outcome.
                const data = await requestDirectoryLoad(dirPath);
                if (await applyLoadedDirectory(data, requestedTab, {}, operationToken)) {
                    closeDirectoryModal();
                }
            } catch (error) {
                if (isLatestDirectoryOperation(operationToken)) {
                    console.error('Directory load error:', error);
                    setDirectoryModalStatus(`Could not load the directory. ${addErrorGuidance(error, 'Check the path and permissions, then try again')}`);
                } else {
                    console.warn('Discarding stale directory load error for', dirPath);
                }
                await recoverFailedBootstrapLoad(operationToken, wasBootstrapEra);
            } finally {
                // The load button has independent ownership from reload; only a newer load
                // may keep it disabled, while a different operation may not strand it.
                if (latestLoadOperationToken === operationToken) {
                    latestLoadOperationToken = null;
                    loadButton.disabled = false;
                }
                finalizeDirectoryOperation(operationToken);
            }
        }

        async function reloadCurrentDirectory() {
            if (!currentDirectoryPath) {
                return;
            }
            const reloadSessionGeneration = getDirectorySessionGeneration();
            const directoryPath = currentDirectoryPath;
            const requestedTab = currentTab;
            const wasAutoloaded = currentDirectoryWasAutoloaded;
            rememberCurrentEditorValue();
            if (hasUnsavedChanges()) {
                const confirmed = await showConfirmationDialog({
                    title: 'Discard unsaved changes?',
                    message: 'Reloading the directory will replace every pending YAML edit with the files currently on disk.',
                    confirmText: 'Discard and reload'
                });
                if (!confirmed) {
                    return;
                }
            }

            if (!isDirectorySessionCurrent(reloadSessionGeneration)) {
                console.warn('Discarding reload continuation for a replaced directory session');
                return;
            }

            // Freeze everything this reload needs before awaiting: a directory switch during the
            // pending request must not change what it requests or how its result applies.
            const reloadButton = document.getElementById('reload-directory-button');
            const operationToken = beginDirectoryOperation();
            supersedeSharedStatus(operationToken);
            latestReloadOperationToken = operationToken;
            reloadButton.disabled = true;
            setSaveStatus('Reloading directory...', 'pending', null, {
                directoryOperationToken: operationToken,
                directorySessionGeneration: reloadSessionGeneration
            });

            try {
                const data = await requestDirectoryLoad(directoryPath);
                if (await applyLoadedDirectory(data, requestedTab, { autoloaded: wasAutoloaded }, operationToken)) {
                    setSaveStatus(`Reloaded ${Object.keys(data.files || {}).length} configurations.`, 'success', null, {
                        directoryOperationToken: operationToken,
                        directorySessionGeneration: getDirectorySessionGeneration()
                    });
                }
            } catch (error) {
                if (isLatestDirectoryOperation(operationToken)) {
                    console.error('Directory reload error:', error);
                    setSaveStatus(`Could not reload the directory. ${addErrorGuidance(error, 'Check the path and permissions, then try again')}`, 'error', null, {
                        directoryOperationToken: operationToken,
                        directorySessionGeneration: reloadSessionGeneration
                    });
                } else {
                    console.warn('Discarding stale directory reload error for', directoryPath);
                }
            } finally {
                // The reload button has independent ownership from manual load; only a newer
                // reload may keep it disabled, while a different operation may not strand it.
                if (latestReloadOperationToken === operationToken) {
                    latestReloadOperationToken = null;
                    reloadButton.disabled = false;
                }
                finalizeDirectoryOperation(operationToken);
            }
        }

        document.getElementById('directoryModal').addEventListener('click', function(event) {
            if (event.target === this) {
                closeDirectoryModal();
            }
        });
        document.getElementById('confirmation-modal').addEventListener('click', function(event) {
            if (event.target === this) {
                closeConfirmationDialog(false);
            }
        });
        document.getElementById('settings-button').addEventListener('click', openSettingsModal);
        document.getElementById('settings-modal-close').addEventListener('click', closeSettingsModal);
        document.getElementById('settings-modal-cancel').addEventListener('click', closeSettingsModal);
        document.getElementById('settings-form').addEventListener('submit', submitSettingsModal);
        document.getElementById('settings-tab-list').addEventListener('click', function(event) {
            const tab = event.target.closest('[role="tab"]');
            if (!tab || !this.contains(tab)) return;
            activateSettingsTab(tab.getAttribute('data-settings-tab'), { focus: true });
        });
        document.getElementById('settings-tab-list').addEventListener('keydown', handleSettingsTabKeydown);
        document.getElementById('settings-yaml-tabs').addEventListener('click', function(event) {
            const button = event.target.closest('[data-settings-tab-move]');
            if (!button || button.disabled) return;
            const row = button.closest('[data-settings-tab]');
            moveSettingsTab(row.getAttribute('data-settings-tab'), button.getAttribute('data-settings-tab-move'));
        });
        document.getElementById('settings-yaml-tabs').addEventListener('change', function(event) {
            if (!event.target.matches('[data-settings-tab-visible]')) return;
            updateSettingsTabVisibilityDraft();
        });
        document.getElementById('settings-modal').addEventListener('click', function(event) {
            if (event.target === this) closeSettingsModal();
        });
        document.getElementById('preview-edit-modal').addEventListener('click', function(event) {
            if (event.target === this) closePreviewEditDialog();
        });
        document.getElementById('preview-edit-modal-close').addEventListener('click', closePreviewEditDialog);
        document.getElementById('preview-edit-cancel').addEventListener('click', closePreviewEditDialog);
        document.getElementById('preview-edit-form').addEventListener('submit', submitPreviewEditForm);
        document.getElementById('preview-edit-group-nested').addEventListener('click', async function(event) {
            const convertButton = event.target.closest('#preview-edit-group-convert');
            const convertBackButton = event.target.closest('#preview-edit-group-convert-back');
            if (!convertButton && !convertBackButton) return;
            const state = previewEditDialogState;
            if (!state || state.action !== 'group.edit') return;
            event.preventDefault();
            if (convertButton) {
                convertButton.disabled = true;
                const applied = await applyPreviewEdit(
                    { type: 'group.convert-to-nested', target: state.source },
                    'Converted group into a nested group.'
                );
                convertButton.disabled = false;
                if (applied) renderPreviewEditGroupNested();
                return;
            }
            if (convertBackButton) {
                const confirmed = await showConfirmationDialog({
                    title: 'Convert back to normal service group?',
                    message: 'All nested sub-groups will be flattened. Every service across all sub-groups will collapse into this single group.',
                    confirmText: 'Convert back'
                });
                if (!confirmed) return;
                convertBackButton.disabled = true;
                const applied = await applyPreviewEdit(
                    { type: 'group.convert-from-nested', target: state.source },
                    'Converted nested group back to a normal service group.'
                );
                convertBackButton.disabled = false;
                if (applied) {
                    renderPreviewEditGroupNested();
                    closePreviewEditDialog();
                }
                return;
            }
        });
        document.getElementById('preview-edit-add-option').addEventListener('click', () => {
            syncPreviewEditOptionState();
            mutatePreviewEditDialogState((state) => {
                state.hasAddedOption = true;
                state.fields.push({ key: '', value: '', locked: false, commented: state.isCommented === true });
            });
            renderPreviewEditOptions();
            document.querySelector('[data-preview-option-row]:last-child [data-preview-option-key]')?.focus();
        });
        document.getElementById('preview-edit-options').addEventListener('input', () => {
            syncPreviewEditOptionState();
            updatePreviewEditTabWarning();
        });
        const previewEditOptions = document.getElementById('preview-edit-options');
        previewEditOptions.addEventListener('change', function(event) {
            if (!event.target.matches('[data-preview-option-key], [data-preview-option-value], [data-preview-option-value] input[type="radio"]')) return;
            const optionRow = event.target.closest('[data-preview-option-row]');
            const optionPath = optionRow && optionRow.getAttribute('data-preview-option-path');
            syncPreviewEditOptionState();
            updatePreviewEditTabWarning();
            if (event.target.matches('[data-preview-option-key]') || ['true', 'false'].includes(event.target.value.trim())) {
                if (event.target.matches('[data-preview-option-key]') && optionPath !== null) {
                    const selectedField = getPreviewEditFieldAtPath(optionPath);
                    if (selectedField?.key === 'widget' && Array.isArray(selectedField.fields) && selectedField.fields.length === 0) {
                        mutatePreviewEditDialogState((state) => {
                            const field = String(optionPath).split('.').reduce((fields, pathIndex, pathDepth, pathParts) => {
                                const candidate = fields[Number(pathIndex)];
                                return pathDepth === pathParts.length - 1 ? candidate : candidate.fields;
                            }, state.fields);
                            if (field?.key === 'widget' && Array.isArray(field.fields) && field.fields.length === 0) {
                                field.fields = getDefaultPreviewOptionFields('widget');
                            }
                        });
                    }
                }
                renderPreviewEditOptions();
                if (event.target.matches('[data-preview-option-key]') && optionPath !== null) {
                    const replacementRow = Array.from(document.querySelectorAll('[data-preview-option-row]'))
                        .find((row) => row.getAttribute('data-preview-option-path') === optionPath);
                    const replacementKey = replacementRow && replacementRow.querySelector('[data-preview-option-key]');
                    if (replacementKey instanceof HTMLInputElement || replacementKey instanceof HTMLSelectElement) {
                        replacementKey.focus();
                        if (replacementKey instanceof HTMLInputElement) replacementKey.select();
                    }
                }
            }
        });
        document.getElementById('preview-edit-options').addEventListener('click', function(event) {
            const addChildButton = event.target.closest('[data-preview-option-add-child]');
            if (addChildButton && this.contains(addChildButton)) {
                syncPreviewEditOptionState();
                const path = addChildButton.getAttribute('data-preview-option-path');
                const field = getPreviewEditFieldAtPath(path);
                if (!field || !Array.isArray(field.fields)) return;
                mutatePreviewEditDialogState((state) => {
                    const nestedField = String(path).split('.').reduce((fields, pathIndex, pathDepth, pathParts) => {
                        const candidate = fields[Number(pathIndex)];
                        return pathDepth === pathParts.length - 1 ? candidate : candidate.fields;
                    }, state.fields);
                    if (!nestedField || !Array.isArray(nestedField.fields)) return;
                    state.hasAddedOption = true;
                    nestedField.fields.push({ key: '', value: '', locked: false, commented: nestedField.commented === true });
                });
                renderPreviewEditOptions();
                return;
            }
            const button = event.target.closest('[data-preview-option-action]');
            if (!button || !this.contains(button)) return;
            syncPreviewEditOptionState();
            const index = Number(button.getAttribute('data-preview-option-index'));
            const action = button.getAttribute('data-preview-option-action');
            const parentPath = button.getAttribute('data-preview-option-parent-path');
            const applied = mutatePreviewEditDialogState((state) => {
                const fields = parentPath
                    ? parentPath.split('.').reduce((collection, pathIndex) => collection[Number(pathIndex)].fields, state.fields)
                    : state.fields;
                if (action === 'remove') {
                    fields.splice(index, 1);
                } else if (action === 'comment') {
                    fields[index].commented = !fields[index].commented;
                    if (Array.isArray(fields[index].fields)) {
                        fields[index].fields = markFieldsCommented(fields[index].fields, fields[index].commented);
                    }
                } else if (action === 'up' || action === 'down') {
                    // Reject movement if the option itself is commented
                    if (fields[index].commented === true) return false;
                    const destination = index + (action === 'up' ? -1 : 1);
                    if (destination < 0 || destination >= fields.length) return false;
                    const [field] = fields.splice(index, 1);
                    fields.splice(destination, 0, field);
                }
                return true;
            });
            if (applied === false) return;
            renderPreviewEditOptions();
        });
        document.getElementById('preview-option-types-button').addEventListener('click', openOptionTypesModal);
        document.getElementById('option-types-modal-close').addEventListener('click', closeOptionTypesModal);
        document.getElementById('option-types-cancel').addEventListener('click', closeOptionTypesModal);
        document.getElementById('option-types-form').addEventListener('submit', saveOptionTypes);
        document.getElementById('option-types-modal').addEventListener('click', function(event) {
            if (event.target === this) closeOptionTypesModal();
        });
        document.getElementById('option-types-add').addEventListener('click', function() {
            readOptionTypesDraft();
            mutateOptionTypesDraft((draft) => {
                draft.push({ name: '', type: 'text', appliesTo: ['service', 'group', 'bookmark', 'widget'], _originalName: '', _originalAppliesTo: [], values: [], rows: 2 });
            });
            renderOptionTypesDraft();
            document.querySelector('#option-types-list > [data-option-type-row]:last-child [data-option-type-name]')?.focus();
        });
        document.getElementById('option-types-list').addEventListener('input', function(event) {
            if (!event.target.matches('[data-option-type-name], [data-option-select-values], [data-option-textarea-rows]')) return;
            readOptionTypesDraft();
            if (event.target.matches('[data-option-type-name]')) renderOptionDefaultsDraft();
        });
        document.getElementById('option-types-list').addEventListener('change', function(event) {
            if (!event.target.matches('[data-option-value-type], [data-option-applies-to]')) return;
            readOptionTypesDraft();
            if (event.target.matches('[data-option-value-type]')) renderOptionTypesDraft();
            else renderOptionDefaultsDraft();
        });
        document.getElementById('option-types-list').addEventListener('click', async function(event) {
            const moveButton = event.target.closest('[data-option-type-move]');
            if (moveButton && this.contains(moveButton)) {
                readOptionTypesDraft();
                const index = Number(moveButton.getAttribute('data-option-type-index'));
                const direction = moveButton.getAttribute('data-option-type-move');
                const destination = index + (direction === 'up' ? -1 : 1);
                mutateOptionTypesDraft((draft) => {
                    if (index >= 0 && destination >= 0 && destination < draft.length) {
                        const [definition] = draft.splice(index, 1);
                        draft.splice(destination, 0, definition);
                    }
                });
                if (index >= 0 && destination >= 0 && destination < optionTypesDraft.length) {
                    renderOptionTypesDraft();
                    document.querySelector(`#option-types-list > [data-option-type-row]:nth-child(${destination + 1}) [data-option-type-name]`)?.focus();
                }
                return;
            }
            const removeButton = event.target.closest('[data-option-type-remove]');
            if (!removeButton || !this.contains(removeButton)) return;
            const row = removeButton.closest('[data-option-type-row]');
            const optionName = row?.querySelector('[data-option-type-name]')?.value.trim() || 'this option';
            const removeIndex = Number(removeButton.getAttribute('data-option-type-remove'));
            const confirmed = await showConfirmationDialog({
                title: 'Remove option type?',
                message: `Remove "${optionName}" from Option Types and remove every matching occurrence from the loaded YAML? YAML changes will remain pending until you use Save.`,
                confirmText: 'Remove option type'
            });
            if (!confirmed) return;
            readOptionTypesDraft();
            const removedDefinition = optionTypesDraft[removeIndex];
            if (removedDefinition?._originalName) {
                setOptionTypesRemovedDefinitions(new Map(optionTypesRemovedDefinitions).set(removedDefinition._originalName, {
                    name: removedDefinition._originalName,
                    appliesTo: [...removedDefinition._originalAppliesTo]
                }));
            }
            mutateOptionTypesDraft((draft) => {
                draft.splice(removeIndex, 1);
            });
            renderOptionTypesDraft();
        });
        document.getElementById('option-defaults-list').addEventListener('click', function(event) {
            const actionButton = event.target.closest('[data-option-default-action]');
            if (!actionButton || !this.contains(actionButton)) return;
            readOptionTypesDraft();
            const action = actionButton.getAttribute('data-option-default-action');
            const target = actionButton.getAttribute('data-option-default-target');
            if (action === 'add') {
                const group = actionButton.closest('[data-option-default-group]');
                const selectedIndex = group?.querySelector('[data-option-default-select]')?.value || '';
                const definitionIndex = Number(selectedIndex);
                if (!selectedIndex) return;
                if (!Number.isInteger(definitionIndex) || !optionTypesDraft[definitionIndex]) return;
                mutateOptionTypesDraft((draft) => {
                    const definition = draft[definitionIndex];
                    definition.defaultForAdd = [...new Set([...(definition.defaultForAdd || []), target])];
                });
                setOptionDefaultOrder(target, [...getOrderedOptionDefaultIndexes(target), definitionIndex]);
            } else {
                const definitionIndex = Number(actionButton.getAttribute('data-option-default-index'));
                const orderedIndexes = getOrderedOptionDefaultIndexes(target);
                const currentOrder = orderedIndexes.indexOf(definitionIndex);
                if (currentOrder < 0) return;
                if (action === 'remove') {
                    mutateOptionTypesDraft((draft) => {
                        const definition = draft[definitionIndex];
                        definition.defaultForAdd = (definition.defaultForAdd || []).filter((value) => value !== target);
                        if (definition.defaultForAdd.length === 0) delete definition.defaultForAdd;
                    });
                    orderedIndexes.splice(currentOrder, 1);
                    setOptionDefaultOrder(target, orderedIndexes);
                } else {
                    const destination = currentOrder + (action === 'up' ? -1 : 1);
                    if (destination < 0 || destination >= orderedIndexes.length) return;
                    [orderedIndexes[currentOrder], orderedIndexes[destination]] = [orderedIndexes[destination], orderedIndexes[currentOrder]];
                    setOptionDefaultOrder(target, orderedIndexes);
                }
            }
            renderOptionDefaultsDraft();
        });
        document.getElementById('serverPathInput').addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                loadFromServerPath();
            }
        });
        document.addEventListener('keydown', function(event) {
            if (event.key !== 'Escape') {
                return;
            }
            if (!document.getElementById('confirmation-modal').hidden) {
                closeConfirmationDialog(false);
            } else if (!document.getElementById('settings-modal').hidden) {
                closeSettingsModal();
            } else if (!document.getElementById('option-types-modal').hidden) {
                closeOptionTypesModal();
            } else if (!document.getElementById('preview-edit-modal').hidden) {
                closePreviewEditDialog();
            } else if (!previewAddTabModal.hidden) {
                closeInlineAddTabPanel({ restoreFocus: true });
            } else if (document.querySelector('[data-preview-tab-rename-input]')) {
                exitTabRenameMode(false);
            } else if (!document.getElementById('directoryModal').hidden) {
                closeDirectoryModal();
            }
        });

});
