// Sample homepage configuration files loaded from the server-side examples directory.
        const configTabNames = Object.freeze([
            'services',
            'settings',
            'bookmarks',
            'widgets',
            'docker',
            'proxmox',
            'kubernetes'
        ]);
        const sampleConfigs = Object.fromEntries(configTabNames.map((tabName) => [tabName, '']));
        const createNewTabGroupValue = '__create_new_service_group__';

        async function loadSampleConfigs() {
            const response = await fetch('/api/examples', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.details || payload.error || 'The example files could not be loaded');
            }
            for (const tabName of Object.keys(sampleConfigs)) {
                if (typeof payload.samples?.[tabName] !== 'string') {
                    throw new Error(`${tabName}.yaml is missing from the examples directory`);
                }
                sampleConfigs[tabName] = payload.samples[tabName];
            }
        }

        let currentTab = 'services';
        let loadedFiles = {};
        let originalLoadedFiles = {};
        let loadedFileNames = Object.fromEntries(
            configTabNames.map((tabName) => [tabName, `${tabName}.yaml`])
        );
        let currentDirectoryPath = null;
        let currentDirectoryWasAutoloaded = false;
        let previewHomepageTab = null;
        const parsedConfigCache = new Map();
        let previewUpdateTimer = null;
        let sourceHighlightLine = null;
        let sourceHighlightTimer = null;
        let sampleModeEnabled = true;
        let previewUndoState = null;
        let applyingPreviewFiles = false;
        let previewEditDialogState = null;
        let previewEditPreviousFocus = null;
        let previewTabPreviousFocus = null;
        const yamlCodeEditor = CodeMirror.fromTextArea(document.getElementById('yaml-editor'), {
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
        });

        function getEditorValue() {
            return yamlCodeEditor.getValue();
        }

        function setEditorValue(value) {
            yamlCodeEditor.setValue(String(value || ''));
            yamlCodeEditor.clearHistory();
        }

        function getSelectedLineNumbers(editor) {
            const lineNumbers = new Set();
            editor.listSelections().forEach(({ anchor, head }) => {
                const from = CodeMirror.cmpPos(anchor, head) <= 0 ? anchor : head;
                const to = CodeMirror.cmpPos(anchor, head) <= 0 ? head : anchor;
                const endLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
                for (let line = from.line; line <= endLine; line++) {
                    lineNumbers.add(line);
                }
            });
            return Array.from(lineNumbers).sort((left, right) => left - right);
        }

        function toggleSelectedComments(editor) {
            const lineNumbers = getSelectedLineNumbers(editor);
            const lines = lineNumbers.map((lineNumber) => editor.getLine(lineNumber) || '');
            const nonBlankLines = lines.filter((line) => line.trim().length > 0);
            const shouldUncomment = nonBlankLines.length > 0
                && nonBlankLines.every((line) => /^\s*#/.test(line));

            editor.operation(() => {
                lineNumbers.forEach((lineNumber, index) => {
                    const currentLine = lines[index];
                    const nextLine = shouldUncomment
                        ? currentLine.replace(/^(\s*)# ?/, '$1')
                        : currentLine.replace(/^(\s*)/, '$1# ');
                    if (nextLine !== currentLine) {
                        editor.replaceRange(
                            nextLine,
                            { line: lineNumber, ch: 0 },
                            { line: lineNumber, ch: currentLine.length },
                            '+toggleComment'
                        );
                    }
                });
            });
            editor.focus();
        }

        function scheduleVisualPreview() {
            window.clearTimeout(previewUpdateTimer);
            if (!document.getElementById('preview-auto-refresh-toggle').checked) {
                return;
            }
            previewUpdateTimer = window.setTimeout(updatePreview, 180);
        }

        const fileToTabMapping = Object.fromEntries(configTabNames.flatMap((tabName) => [
            [`${tabName}.yaml`, tabName],
            [`${tabName}.yml`, tabName]
        ]));

        function normalizeLoadedFiles(files) {
            const normalizedFiles = {};
            const normalizedFileNames = {};

            Object.entries(files || {}).forEach(([filename, content]) => {
                const tabName = fileToTabMapping[filename] || fileToTabMapping[String(filename).toLowerCase()];
                if (tabName) {
                    normalizedFiles[tabName] = content;
                    normalizedFileNames[tabName] = filename;
                }
            });

            return { files: normalizedFiles, fileNames: normalizedFileNames };
        }

        function rememberCurrentEditorValue() {
            if (currentTab) {
                loadedFiles[currentTab] = getEditorValue();
            }
        }

        function getUnsavedTabNames() {
            return configTabNames.filter((tabName) => {
                const currentYaml = getTabYamlText(tabName);
                const originalYaml = Object.prototype.hasOwnProperty.call(originalLoadedFiles, tabName)
                    ? String(originalLoadedFiles[tabName] || '')
                    : String(sampleConfigs[tabName] || '');
                return currentYaml !== originalYaml;
            });
        }

        function hasUnsavedChanges() {
            return getUnsavedTabNames().length > 0;
        }

        function updateUnsavedIndicators() {
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
        
        function scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function scrollToEditor() {
            const editorSection = document.getElementById('yaml-editor-section');
            if (editorSection) {
                editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        function scrollToPreview() {
            const previewSection = document.getElementById('homepage-preview-section');
            if (previewSection) {
                previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        function updateFloatingNavVisibility() {
            const topButton = document.getElementById('scroll-top-button');
            if (!topButton) {
                return;
            }
            topButton.hidden = window.scrollY <= 100;
        }

        function updateSectionJumpButton() {
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

        function switchTab(tabName, event, options = {}) {
            if (!options.skipRemember) {
                rememberCurrentEditorValue();
            }
            currentTab = tabName;
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

        function setResetSampleVisible(isVisible) {
            const resetButton = document.getElementById('reset-sample-button');
            if (resetButton) {
                resetButton.hidden = !isVisible;
            }
        }

        function setSampleMode(isSampleMode) {
            sampleModeEnabled = isSampleMode;
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
            if (isSampleMode && editToggle.checked) {
                editToggle.checked = false;
                updatePreviewEditMode();
            }
        }

        function setReloadDirectoryVisible(isVisible) {
            const reloadButton = document.getElementById('reload-directory-button');
            if (reloadButton) {
                reloadButton.hidden = !isVisible;
            }
        }

        function applyLoadedDirectory(data, tabName = currentTab, { autoloaded = false } = {}) {
            previewUndoState = null;
            updatePreviewUndoButton();
            const normalized = normalizeLoadedFiles(data.files);
            const missingTabs = configTabNames.filter((tabName) => !Object.prototype.hasOwnProperty.call(normalized.files, tabName));
            loadedFiles = normalized.files;
            originalLoadedFiles = Object.fromEntries(configTabNames.map((tabName) => [
                tabName,
                Object.prototype.hasOwnProperty.call(normalized.files, tabName) ? normalized.files[tabName] : ''
            ]));
            loadedFileNames = normalized.fileNames;
            currentDirectoryPath = data.directory;
            currentDirectoryWasAutoloaded = autoloaded;

            setDirectoryStatus(currentDirectoryPath, Object.keys(data.files || {}).length, {
                autoloaded,
                missingCount: missingTabs.length
            });
            setSampleMode(false);
            setResetSampleVisible(false);
            setReloadDirectoryVisible(true);
            switchTab(tabName, null, { skipRemember: true });
        }

        function setSaveStatus(message, state = 'info', source = null) {
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

        function setPreviewStatus(messages = []) {
            const statusElement = document.getElementById('preview-status');
            const uniqueMessages = Array.from(new Set(messages.filter(Boolean)));
            statusElement.textContent = uniqueMessages.join(' ');
            statusElement.hidden = uniqueMessages.length === 0;
            statusElement.dataset.state = 'info';
        }

        function setDirectoryStatus(directory, fileCount, { autoloaded = false, missingCount = 0 } = {}) {
            const statusElement = document.getElementById('directory-info');
            const loadedMessage = autoloaded
                ? `Autoloaded ${fileCount}/${configTabNames.length}`
                : `Loaded ${fileCount}/${configTabNames.length} from ${directory}`;
            statusElement.textContent = missingCount > 0
                ? `${missingCount} YAML file${missingCount === 1 ? '' : 's'} missing; examples marked to save. ${loadedMessage}`
                : loadedMessage;
            statusElement.title = statusElement.textContent;
            statusElement.dataset.state = missingCount > 0 ? 'warning' : 'loaded';
        }

        function clearSaveStatus() {
            const statusElement = document.getElementById('save-status');
            statusElement.hidden = true;
            statusElement.textContent = '';
            delete statusElement.dataset.state;
            delete statusElement.dataset.source;
            statusElement.classList.remove('save-status-jump');
            statusElement.removeAttribute('tabindex');
            statusElement.removeAttribute('title');
        }

        function getSaveErrorSummary(error) {
            const message = error && error.message ? error.message : error;
            return String(message || 'Unknown error').split('\n')[0];
        }

        function formatYamlError(error) {
            const rawReason = String(
                (error && error.reason)
                || (error && error.message ? error.message.split('\n')[0] : '')
                || 'Invalid YAML'
            ).replace(/^YAMLException:\s*/i, '').trim();
            const friendlyReasons = [
                [/duplicated mapping key/i, 'This key is defined more than once.'],
                [/bad indentation of a mapping entry/i, 'Check the indentation for this key or value.'],
                [/bad indentation of a sequence entry/i, 'Check the indentation for this list item.'],
                [/can not read a block mapping entry/i, 'A key is missing a value, or the indentation is incorrect.'],
                [/end of the stream or a document separator is expected/i, 'Check for incorrect indentation or a missing colon.'],
                [/missed comma between flow collection entries/i, 'Add a comma between the inline list or object values.'],
                [/unexpected end of the stream/i, 'The YAML ends before this value or block is complete.'],
                [/unknown escape sequence/i, 'This quoted value contains an unsupported escape sequence.']
            ];
            const matchedReason = friendlyReasons.find(([pattern]) => pattern.test(rawReason));
            const summary = matchedReason
                ? matchedReason[1]
                : `${rawReason.charAt(0).toUpperCase()}${rawReason.slice(1)}${/[.!?]$/.test(rawReason) ? '' : '.'}`;
            const line = error && error.mark && typeof error.mark.line === 'number' ? error.mark.line + 1 : null;
            const column = error && error.mark && typeof error.mark.column === 'number' ? error.mark.column + 1 : null;
            return { summary, line, column };
        }

        function formatYamlErrorLocation(error) {
            if (!error.line) {
                return 'Location unavailable';
            }
            return `Line ${error.line}${error.column ? `, column ${error.column}` : ''}`;
        }

        async function saveConfig() {
            const saveButton = document.getElementById('save-config-button');
            if (!currentDirectoryPath) {
                setSaveStatus('Examples are read-only. Load a directory before saving.', 'error');
                return;
            }
            rememberCurrentEditorValue();
            const unsavedConfigs = getUnsavedTabNames().map((tabName) => ({
                tabName,
                filename: currentDirectoryPath
                    ? (loadedFileNames[tabName] || `${tabName}.yaml`)
                    : `${tabName}.yaml`,
                yamlText: getTabYamlText(tabName)
            }));

            if (unsavedConfigs.length === 0) {
                setSaveStatus('No unsaved changes.', 'info');
                return;
            }

            for (const config of unsavedConfigs) {
                try {
                    jsyaml.load(config.yamlText);
                } catch (error) {
                    const yamlError = formatYamlError(error);
                    setSaveStatus(
                        `${config.filename} - ${formatYamlErrorLocation(yamlError)} - ${yamlError.summary}`,
                        'error',
                        { tab: config.tabName, line: yamlError.line || 1 }
                    );
                    return;
                }
            }

            const savedConfigs = [];
            const failedConfigs = [];
            try {
                saveButton.disabled = true;
                setSaveStatus(
                    `Saving ${unsavedConfigs.length} changed configuration${unsavedConfigs.length === 1 ? '' : 's'}...`,
                    'pending'
                );

                for (const config of unsavedConfigs) {
                    try {
                        const response = await fetch('/api/directory/file/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                dirPath: currentDirectoryPath,
                                filename: config.filename,
                                content: config.yamlText
                            })
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok || data.error) {
                            const message = data.details
                                ? `${data.error}: ${data.details}`
                                : (data.error || `Request failed with status ${response.status}`);
                            throw new Error(message);
                        }

                        loadedFiles[config.tabName] = config.yamlText;
                        originalLoadedFiles[config.tabName] = config.yamlText;
                        savedConfigs.push(config);
                    } catch (error) {
                        failedConfigs.push({ config, error });
                    }
                }

                if (failedConfigs.length > 0) {
                    const firstFailure = failedConfigs[0];
                    setSaveStatus(
                        `Saved ${savedConfigs.length} of ${unsavedConfigs.length}. Could not save ${firstFailure.config.filename}: ${getSaveErrorSummary(firstFailure.error)}`,
                        'error'
                    );
                } else {
                    const savedNames = savedConfigs.map(({ filename }) => filename).join(', ');
                    setSaveStatus(
                        savedConfigs.length === 1
                            ? `Saved ${savedNames}.`
                            : `Saved ${savedConfigs.length} configurations: ${savedNames}.`,
                        'success'
                    );
                }
            } finally {
                setSampleMode(!currentDirectoryPath);
                updateUnsavedIndicators();
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
                setSaveStatus(`Could not download configurations: ${getSaveErrorSummary(error)}`, 'error');
            }
        }

        function makeCrc32Table() {
            const table = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let value = i;
                for (let bit = 0; bit < 8; bit++) {
                    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
                }
                table[i] = value >>> 0;
            }
            return table;
        }

        const crc32Table = makeCrc32Table();

        function getCrc32(bytes) {
            let crc = 0xffffffff;
            for (const byte of bytes) {
                crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
            }
            return (crc ^ 0xffffffff) >>> 0;
        }

        function writeUint16(bytes, value) {
            bytes.push(value & 0xff, (value >>> 8) & 0xff);
        }

        function writeUint32(bytes, value) {
            bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
        }

        function getZipDateParts(date) {
            const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
            const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
            return { dosTime, dosDate };
        }

        function createZipBlob(files) {
            const encoder = new TextEncoder();
            const localParts = [];
            const centralParts = [];
            let offset = 0;
            const { dosTime, dosDate } = getZipDateParts(new Date());

            Object.entries(files).forEach(([filename, content]) => {
                const nameBytes = encoder.encode(filename);
                const contentBytes = encoder.encode(String(content || ''));
                const crc = getCrc32(contentBytes);
                const localHeader = [];

                writeUint32(localHeader, 0x04034b50);
                writeUint16(localHeader, 20);
                writeUint16(localHeader, 0);
                writeUint16(localHeader, 0);
                writeUint16(localHeader, dosTime);
                writeUint16(localHeader, dosDate);
                writeUint32(localHeader, crc);
                writeUint32(localHeader, contentBytes.length);
                writeUint32(localHeader, contentBytes.length);
                writeUint16(localHeader, nameBytes.length);
                writeUint16(localHeader, 0);
                localParts.push(new Uint8Array(localHeader), nameBytes, contentBytes);

                const centralHeader = [];
                writeUint32(centralHeader, 0x02014b50);
                writeUint16(centralHeader, 20);
                writeUint16(centralHeader, 20);
                writeUint16(centralHeader, 0);
                writeUint16(centralHeader, 0);
                writeUint16(centralHeader, dosTime);
                writeUint16(centralHeader, dosDate);
                writeUint32(centralHeader, crc);
                writeUint32(centralHeader, contentBytes.length);
                writeUint32(centralHeader, contentBytes.length);
                writeUint16(centralHeader, nameBytes.length);
                writeUint16(centralHeader, 0);
                writeUint16(centralHeader, 0);
                writeUint16(centralHeader, 0);
                writeUint16(centralHeader, 0);
                writeUint32(centralHeader, 0);
                writeUint32(centralHeader, offset);
                centralParts.push(new Uint8Array(centralHeader), nameBytes);

                offset += localHeader.length + nameBytes.length + contentBytes.length;
            });

            const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
            const endRecord = [];
            writeUint32(endRecord, 0x06054b50);
            writeUint16(endRecord, 0);
            writeUint16(endRecord, 0);
            writeUint16(endRecord, Object.keys(files).length);
            writeUint16(endRecord, Object.keys(files).length);
            writeUint32(endRecord, centralSize);
            writeUint32(endRecord, offset);
            writeUint16(endRecord, 0);

            return new Blob([...localParts, ...centralParts, new Uint8Array(endRecord)], { type: 'application/zip' });
        }

        // Initialize with services tab and sample data
        window.onload = async function() {
            const configuredTheme = window.APP_CONFIG && window.APP_CONFIG.defaultTheme;
            applyTheme(configuredTheme !== 'light');
            document.getElementById('logout-form').hidden = !(window.APP_CONFIG && window.APP_CONFIG.loginRequired);

            try {
                applyPersistentAppSettings(await loadPersistentAppSettings());
            } catch (error) {
                console.warn('Could not load persistent app settings', error);
            }

            try {
                await loadOptionDefinitions();
            } catch (error) {
                console.warn('Could not load option type definitions', error);
            }

            try {
                await loadSampleConfigs();
            } catch (error) {
                console.error('Example configuration load failed:', error);
                setSaveStatus(`Could not load examples: ${error.message}`, 'error');
            }
            
            loadedFiles = { ...sampleConfigs };
            originalLoadedFiles = { ...loadedFiles };
            currentDirectoryPath = null;
            setSampleMode(true);
            const directoryInfo = document.getElementById('directory-info');
            directoryInfo.textContent = 'Examples loaded (read-only).';
            directoryInfo.dataset.state = 'idle';
            
            setEditorValue(sampleConfigs.services);
            updatePreview();

            try {
                const response = await fetch('/api/startup-directory');
                const startup = await response.json();

                if (startup.hasStartupDirectory && startup.directory && startup.files) {
                    applyLoadedDirectory(startup, 'services', { autoloaded: true });
                }
            } catch (error) {
                console.error('Startup directory load failed:', error);
            }
        };

        // Directory loading via API calls to server (the only functional approach)
        function handleLoadDirectory() {
            openDirectoryModal();
        }


        let directoryModalPreviousFocus = null;
        let confirmationDialogResolver = null;
        let confirmationDialogPreviousFocus = null;

        function setDirectoryModalStatus(message = '') {
            const statusElement = document.getElementById('directory-modal-status');
            statusElement.textContent = message;
            statusElement.hidden = !message;
        }

        function openDirectoryModal() {
            const modal = document.getElementById('directoryModal');
            directoryModalPreviousFocus = document.activeElement;
            setDirectoryModalStatus();
            modal.hidden = false;
            window.requestAnimationFrame(() => document.getElementById('serverPathInput').focus());
        }

        function closeDirectoryModal() {
            document.getElementById('directoryModal').hidden = true;
            setDirectoryModalStatus();
            if (directoryModalPreviousFocus && typeof directoryModalPreviousFocus.focus === 'function') {
                directoryModalPreviousFocus.focus();
            }
            directoryModalPreviousFocus = null;
        }

        function showConfirmationDialog({ title, message, confirmText = 'Continue' }) {
            const modal = document.getElementById('confirmation-modal');
            const confirmButton = document.getElementById('confirmation-modal-confirm');
            document.getElementById('confirmation-modal-title').textContent = title;
            document.getElementById('confirmation-modal-message').textContent = message;
            confirmButton.textContent = confirmText;
            confirmationDialogPreviousFocus = document.activeElement;
            modal.hidden = false;

            return new Promise((resolve) => {
                confirmationDialogResolver = resolve;
                window.requestAnimationFrame(() => confirmButton.focus());
            });
        }

        function closeConfirmationDialog(confirmed) {
            const modal = document.getElementById('confirmation-modal');
            if (modal.hidden) {
                return;
            }
            modal.hidden = true;
            const resolve = confirmationDialogResolver;
            confirmationDialogResolver = null;
            if (confirmationDialogPreviousFocus && typeof confirmationDialogPreviousFocus.focus === 'function') {
                confirmationDialogPreviousFocus.focus();
            }
            confirmationDialogPreviousFocus = null;
            if (resolve) {
                resolve(Boolean(confirmed));
            }
        }

        function setPreviewEditModalStatus(message = '') {
            const statusElement = document.getElementById('preview-edit-modal-status');
            statusElement.textContent = message;
            statusElement.hidden = !message;
        }

        function findPreviewGroup(source) {
            const services = parseTabConfig('services');
            if (services.error || !Array.isArray(services.data)) {
                throw new Error('Fix the services.yaml error before editing the Preview.');
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
            throw new Error(`Could not find service group "${source.groupName}".`);
        }

        function findPreviewService(source) {
            const group = findPreviewGroup(source);
            let seen = 0;
            for (const service of group.services) {
                const serviceName = Object.keys(service || {})[0] || '';
                if (serviceName !== source.serviceName) continue;
                if (seen === (Number(source.serviceIndex) || 0)) {
                    return { ...group, service, serviceName, data: service[serviceName] || {} };
                }
                seen++;
            }
            throw new Error(`Could not find service "${source.serviceName}".`);
        }

        let optionDefinitions = new Map();

        function setOptionDefinitions(definitions) {
            optionDefinitions = new Map((definitions || []).map((definition) => [definition.name, definition]));
            const datalist = document.getElementById('preview-known-options');
            datalist.innerHTML = Array.from(optionDefinitions.keys())
                .map((name) => `<option value="${escapeHtml(name)}"></option>`)
                .join('');
        }

        function getOptionDefinition(name) {
            return optionDefinitions.get(String(name || '').trim()) || null;
        }

        async function loadOptionDefinitions() {
            const response = await fetch('/api/option-types', { cache: 'no-store' });
            if (!response.ok) throw new Error('Option type definitions request failed');
            const data = await response.json();
            setOptionDefinitions(data.options);
            return data.options;
        }

        const optionValueTypeChoices = ['text', 'textarea', 'boolean', 'tab', 'mapping', 'select'];
        let optionTypesDraft = [];
        let optionTypesPreviousFocus = null;

        function setOptionTypesStatus(message = '') {
            const status = document.getElementById('option-types-status');
            status.textContent = message;
            status.hidden = !message;
        }

        function readOptionTypesDraft() {
            optionTypesDraft = Array.from(document.querySelectorAll('#option-types-list > [data-option-type-row]')).map((row) => ({
                name: row.querySelector('[data-option-type-name]').value,
                type: row.querySelector('[data-option-value-type]').value,
                values: (row.querySelector('[data-option-select-values]')?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
                rows: Number(row.querySelector('[data-option-textarea-rows]')?.value) || 2
            }));
        }

        function renderOptionTypesDraft() {
            const list = document.getElementById('option-types-list');
            list.innerHTML = optionTypesDraft.map((definition, index) => {
                const typeOptions = optionValueTypeChoices.map((type) => `<option value="${type}"${type === definition.type ? ' selected' : ''}>${type}</option>`).join('');
                const needsSelectValues = definition.type === 'select';
                const needsRows = definition.name.trim().toLowerCase() === 'description' && definition.type === 'textarea';
                return `<div class="option-types-row${needsSelectValues ? ' has-select-values' : ''}${needsRows ? ' has-textarea-rows' : ''}" data-option-type-row>
                    <input type="text" class="modal-input" data-option-type-name aria-label="Option name" value="${escapeHtml(definition.name)}" placeholder="Option name">
                    <select class="modal-input" data-option-value-type aria-label="Value type">${typeOptions}</select>
                    ${needsSelectValues ? `<input type="text" class="modal-input" data-option-select-values aria-label="Select choices" value="${escapeHtml((definition.values || []).join(', '))}" placeholder="Select choices">` : ''}
                    ${needsRows ? `<input type="number" class="modal-input" data-option-textarea-rows aria-label="Textarea rows" min="2" max="12" value="${definition.rows || 2}" placeholder="Rows">` : ''}
                    <button type="button" class="preview-edit-action preview-edit-delete" data-option-type-remove="${index}" aria-label="Remove ${escapeHtml(definition.name || 'option')}" title="Remove option type">&times;</button>
                </div>`;
            }).join('') || '<div class="preview-tab-manager-empty">No option types are configured.</div>';
        }

        function openOptionTypesModal() {
            optionTypesPreviousFocus = document.activeElement;
            optionTypesDraft = Array.from(optionDefinitions.values()).map((definition) => ({ ...definition, values: [...(definition.values || [])] }));
            renderOptionTypesDraft();
            setOptionTypesStatus();
            const modal = document.getElementById('option-types-modal');
            modal.hidden = false;
            window.requestAnimationFrame(() => document.querySelector('#option-types-list [data-option-type-name]')?.focus());
        }

        function closeOptionTypesModal() {
            const modal = document.getElementById('option-types-modal');
            if (modal.hidden) return;
            modal.hidden = true;
            setOptionTypesStatus();
            if (optionTypesPreviousFocus && typeof optionTypesPreviousFocus.focus === 'function') optionTypesPreviousFocus.focus();
            optionTypesPreviousFocus = null;
        }

        async function saveOptionTypes(event) {
            event.preventDefault();
            readOptionTypesDraft();
            const saveButton = document.getElementById('option-types-save');
            saveButton.disabled = true;
            setOptionTypesStatus();
            try {
                const response = await fetch('/api/option-types', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ options: optionTypesDraft })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.error) throw new Error(data.details || data.error || 'Could not save option types');
                setOptionDefinitions(data.options);
                setSaveStatus('Preview option types saved.', 'success');
                closeOptionTypesModal();
            } catch (error) {
                setOptionTypesStatus(getSaveErrorSummary(error));
            } finally {
                saveButton.disabled = false;
            }
        }

        function getPreviewOptionFields(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            return Object.entries(value).map(([key, optionValue]) => (
                optionValue && typeof optionValue === 'object' && !Array.isArray(optionValue)
                    ? { key, fields: getPreviewOptionFields(optionValue), locked: true }
                    : { key, value: Array.isArray(optionValue) ? JSON.stringify(optionValue) : optionValue === null ? 'null' : String(optionValue ?? ''), locked: true }
            ));
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
                    const key = keyControl instanceof HTMLInputElement ? keyControl.value : keyControl.textContent;
                    const locked = row.dataset.previewOptionLocked === 'true';
                    const nested = row.querySelector(':scope > [data-preview-nested-options]');
                    const booleanValue = row.querySelector(':scope > [data-preview-option-value] input:checked');
                    return nested
                        ? { key, fields: readPreviewOptionRows(nested), locked }
                        : { key, value: booleanValue ? booleanValue.value : row.querySelector(':scope > [data-preview-option-value]').value || '', locked };
                });
        }

        function syncPreviewEditOptionState() {
            if (!previewEditDialogState) return;
            previewEditDialogState.fields = readPreviewOptionRows(document.getElementById('preview-edit-options'));
            normalizePreviewOptionStyles(previewEditDialogState.fields);
        }

        function updatePreviewEditTabWarning() {
            const warning = document.getElementById('preview-edit-tab-warning');
            const isGroupEdit = previewEditDialogState && previewEditDialogState.action === 'group.edit';
            const hasTabOption = isGroupEdit && previewEditDialogState.fields.some((field) => field.key.trim() === 'tab');
            warning.hidden = !hasTabOption;
        }

        function renderPreviewEditOptions() {
            const options = document.getElementById('preview-edit-options');
            const addButton = document.getElementById('preview-edit-add-option');
            const state = previewEditDialogState;
            const supportsOptions = state && ['service.add', 'service.edit', 'group.edit'].includes(state.action);
            options.hidden = !supportsOptions;
            addButton.hidden = !supportsOptions;
            if (!supportsOptions) {
                options.innerHTML = '';
                document.getElementById('preview-edit-tab-warning').hidden = true;
                return;
            }
            function getFieldCollection(path = '') {
                if (!path) return state.fields;
                return path.split('.').reduce((fields, index) => fields[Number(index)].fields, state.fields);
            }
            function renderRows(fields, parentPath = '') {
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
                const selectOptions = [...new Set(field.value && !selectValues.includes(field.value)
                    ? [field.value, ...selectValues] : selectValues)]
                    .map((value) => `<option value="${escapeHtml(value)}"${value === field.value ? ' selected' : ''}>${escapeHtml(value)}</option>`)
                    .join('');
                const valueControl = field.fields
                    ? `<div class="preview-edit-nested-options" data-preview-nested-options>${renderRows(field.fields, path)}<button type="button" class="preview-add-option" data-preview-option-add-child data-preview-option-path="${path}">+ Add ${escapeHtml(field.key || 'nested')} option</button></div>`
                    : isTabOption
                    ? `<select class="modal-input preview-edit-option-value" data-preview-option-value aria-label="Preview tab"><option value="" disabled${field.value ? '' : ' selected'}>Select a tab</option>${tabOptions}</select>`
                    : isSelectOption
                    ? `<select class="modal-input preview-edit-option-value" data-preview-option-value aria-label="Value for ${escapeHtml(field.key || 'option')}"><option value="" disabled${field.value ? '' : ' selected'}>Select a value</option>${selectOptions}</select>`
                    : isBooleanOption
                        ? `<fieldset class="preview-edit-boolean-options" data-preview-option-value aria-label="Boolean value for ${escapeHtml(field.key || 'option')}"><legend>${escapeHtml(field.key || 'Option')}</legend><label title="true"><input type="radio" name="preview-option-${path}" value="true"${field.value === 'true' ? ' checked' : ''}><span class="preview-boolean-icon" aria-hidden="true">&#10003;</span><span class="sr-only">true</span></label><label title="false"><input type="radio" name="preview-option-${path}" value="false"${field.value === 'false' ? ' checked' : ''}><span class="preview-boolean-icon" aria-hidden="true">&times;</span><span class="sr-only">false</span></label></fieldset>`
                    : isSingleLineOption
                        ? `<input type="text" class="modal-input preview-edit-option-value" data-preview-option-value aria-label="Value for ${escapeHtml(field.key || 'option')}" value="${escapeHtml(field.value)}" placeholder="Value">`
                    : `<textarea class="modal-input preview-edit-option-value${isTextareaOption && (definition.rows || 2) > 2 ? ' preview-edit-option-description' : ''}" data-preview-option-value aria-label="Value for ${escapeHtml(field.key || 'option')}" rows="${isTextareaOption ? (definition.rows || 2) : 2}" placeholder="Value">${escapeHtml(field.value)}</textarea>`;
                const keyControl = field.locked
                    ? `<span class="preview-edit-option-key" data-preview-option-key>${escapeHtml(field.key)}</span>`
                    : `<input type="text" class="modal-input" data-preview-option-key list="preview-known-options" aria-label="Option name" value="${escapeHtml(field.key)}" placeholder="Option">`;
                return `<div class="preview-edit-option-row" data-preview-option-row data-preview-option-locked="${field.locked ? 'true' : 'false'}">
                ${keyControl}
                ${valueControl}
                <span class="preview-edit-actions preview-edit-option-actions">
                    <button type="button" class="preview-edit-action preview-edit-move-up" data-preview-option-action="up" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Move ${escapeHtml(field.key || 'option')} up" title="Move option up"${index === 0 ? ' disabled' : ''}>&uarr;</button>
                    <button type="button" class="preview-edit-action preview-edit-move-down" data-preview-option-action="down" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Move ${escapeHtml(field.key || 'option')} down" title="Move option down"${index === fields.length - 1 ? ' disabled' : ''}>&darr;</button>
                    <button type="button" class="preview-edit-action preview-edit-delete" data-preview-option-action="remove" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Remove ${escapeHtml(field.key || 'option')}" title="Remove option">&times;</button>
                </span>
            </div>`;
                }).join('');
            }
            options.innerHTML = renderRows(state.fields) || '<p class="preview-edit-note">No options are currently configured.</p>';
            updatePreviewEditTabWarning();
        }

        function openPreviewEditDialog(action, source) {
            if (sampleModeEnabled) {
                setSaveStatus('Load a configuration directory before editing the Preview.', 'error');
                return;
            }
            const modal = document.getElementById('preview-edit-modal');
            const title = document.getElementById('preview-edit-modal-title');
            const submit = document.getElementById('preview-edit-submit');
            const nameInput = document.getElementById('preview-edit-name');

            previewEditDialogState = { action, source, fields: [] };
            previewEditPreviousFocus = document.activeElement;
            modal.querySelector('.modal-content').classList.toggle('preview-edit-modal-wide', action === 'group.edit' || action.startsWith('service.'));
            nameInput.value = '';
            setPreviewEditModalStatus();

            if (action === 'group.add') {
                title.textContent = 'Add service group';
                submit.textContent = 'Add group';
            } else if (action === 'group.edit') {
                const group = findPreviewGroup(source);
                const settings = parseTabConfig('settings');
                if (settings.error) throw new Error('Fix the settings.yaml error before editing this group.');
                const layout = settings.data && settings.data.layout && typeof settings.data.layout === 'object'
                    ? settings.data.layout : {};
                title.textContent = 'Edit service group';
                submit.textContent = 'Apply';
                nameInput.value = group.groupName;
                previewEditDialogState.fields = getPreviewOptionFields(layout[group.groupName]);
                previewEditDialogState.availableTabs = getPreviewTabManagerData().tabs;
            } else if (action === 'service.add') {
                title.textContent = `Add service to ${source.groupName}`;
                submit.textContent = 'Add service';
                previewEditDialogState.fields = [
                    { key: 'href', value: '' },
                    { key: 'description', value: '' },
                    { key: 'icon', value: '' }
                ];
            } else if (action === 'service.edit') {
                const service = findPreviewService(source);
                title.textContent = 'Edit service';
                submit.textContent = 'Apply';
                nameInput.value = service.serviceName;
                previewEditDialogState.fields = getPreviewOptionFields(service.data);
            }

            renderPreviewEditOptions();
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
            previewEditDialogState = null;
            setPreviewEditModalStatus();
            if (previewEditPreviousFocus && typeof previewEditPreviousFocus.focus === 'function') {
                previewEditPreviousFocus.focus();
            }
            previewEditPreviousFocus = null;
        }

        function setPreviewTabModalStatus(message = '') {
            const statusElement = document.getElementById('preview-tab-modal-status');
            statusElement.textContent = message;
            statusElement.hidden = !message;
        }

        function getPreviewTabManagerData() {
            const settings = parseTabConfig('settings');
            const services = parseTabConfig('services');
            if (settings.error) {
                throw new Error('Fix the settings.yaml error before managing tabs.');
            }
            if (services.error || !Array.isArray(services.data)) {
                throw new Error('Fix the services.yaml error before managing tabs.');
            }
            const settingsData = settings.data && typeof settings.data === 'object' ? settings.data : {};
            const layout = settingsData.layout;
            if (layout !== undefined && (typeof layout !== 'object' || Array.isArray(layout) || layout === null)) {
                throw new Error('Tab management currently requires settings.yaml layout to use a group mapping.');
            }
            const layoutGroups = layout || {};
            const tabs = [];
            const groupsByTab = {};
            Object.entries(layoutGroups).forEach(([groupName, config]) => {
                const tabName = config && typeof config === 'object' && typeof config.tab === 'string'
                    ? config.tab.trim()
                    : '';
                if (!tabName) return;
                if (!groupsByTab[tabName]) {
                    tabs.push(tabName);
                    groupsByTab[tabName] = [];
                }
                groupsByTab[tabName].push(groupName);
            });
            const groupNames = [];
            const seenGroups = new Set();
            services.data.forEach((group) => {
                const groupName = Object.keys(group || {})[0];
                if (groupName && !seenGroups.has(groupName)) {
                    seenGroups.add(groupName);
                    groupNames.push(groupName);
                }
            });
            Object.keys(layoutGroups).forEach((groupName) => {
                if (!seenGroups.has(groupName)) {
                    seenGroups.add(groupName);
                    groupNames.push(groupName);
                }
            });
            return { tabs, groupsByTab, groupNames, layoutGroups };
        }

        function getTabManagerActionButton(action, tabName, label, icon, { disabled = false, danger = false } = {}) {
            const dangerClass = danger ? ' preview-edit-delete' : '';
            const actionClass = action === 'move-up' ? ' preview-edit-move-up' : action === 'move-down' ? ' preview-edit-move-down' : '';
            return `<button type="button" class="preview-edit-action${dangerClass}${actionClass}" data-tab-manager-action="${escapeHtml(action)}" data-tab-name="${escapeHtml(tabName)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${disabled ? ' disabled' : ''}>${icon}</button>`;
        }

        function renderPreviewTabManager() {
            const list = document.getElementById('preview-tab-manager-list');
            const groupSelect = document.getElementById('preview-tab-group');
            const submitButton = document.getElementById('preview-tab-add-submit');
            try {
                const data = getPreviewTabManagerData();
                list.innerHTML = data.tabs.length > 0
                    ? data.tabs.map((tabName, index) => {
                        const groupCount = (data.groupsByTab[tabName] || []).length;
                        return `<div class="preview-tab-manager-row">
                            <span class="preview-tab-manager-name">${escapeHtml(tabName)}</span>
                            <span class="preview-tab-manager-count">${groupCount} group${groupCount === 1 ? '' : 's'}</span>
                            <span class="preview-edit-actions">
                                ${getTabManagerActionButton('move-up', tabName, `Move ${tabName} up`, '&uarr;', { disabled: index === 0 })}
                                ${getTabManagerActionButton('move-down', tabName, `Move ${tabName} down`, '&darr;', { disabled: index === data.tabs.length - 1 })}
                                ${getTabManagerActionButton('remove', tabName, `Remove ${tabName}`, '&times;', { danger: true })}
                            </span>
                        </div>`;
                    }).join('')
                    : '<div class="preview-tab-manager-empty">No tabs are configured yet.</div>';
                const existingGroupOptions = data.groupNames.map((groupName) => {
                    const layoutConfig = data.layoutGroups[groupName];
                    const assignedTab = layoutConfig && typeof layoutConfig === 'object' ? layoutConfig.tab : '';
                    const suffix = assignedTab ? ` — currently ${assignedTab}` : ' — visible on all tabs';
                    return `<option value="${escapeHtml(groupName)}">${escapeHtml(groupName + suffix)}</option>`;
                }).join('');
                groupSelect.innerHTML = `<option value="" selected disabled>Select an initial group</option><option value="${createNewTabGroupValue}">+ Create a new service group</option>${existingGroupOptions}`;
                groupSelect.value = '';
                submitButton.disabled = false;
                setPreviewTabModalStatus();
                updatePreviewTabGroupMode();
            } catch (error) {
                list.innerHTML = `<div class="preview-tab-manager-empty">${escapeHtml(getSaveErrorSummary(error))}</div>`;
                groupSelect.innerHTML = '';
                submitButton.disabled = true;
                setPreviewTabModalStatus(getSaveErrorSummary(error));
            }
        }

        function updatePreviewTabGroupMode() {
            const groupSelect = document.getElementById('preview-tab-group');
            const newGroupField = document.getElementById('preview-tab-new-group-field');
            const newGroupInput = document.getElementById('preview-tab-new-group');
            const isCreatingGroup = groupSelect.value === createNewTabGroupValue;
            newGroupField.hidden = !isCreatingGroup;
            newGroupInput.setAttribute('aria-required', String(isCreatingGroup));
        }

        function openPreviewTabManager() {
            if (sampleModeEnabled) {
                setSaveStatus('Load a configuration directory before managing Preview tabs.', 'error');
                return;
            }
            const modal = document.getElementById('preview-tab-modal');
            previewTabPreviousFocus = document.activeElement;
            document.getElementById('preview-tab-name').value = '';
            document.getElementById('preview-tab-new-group').value = '';
            renderPreviewTabManager();
            modal.hidden = false;
            window.requestAnimationFrame(() => document.getElementById('preview-tab-name').focus());
        }

        function closePreviewTabManager() {
            const modal = document.getElementById('preview-tab-modal');
            if (modal.hidden) return;
            modal.hidden = true;
            setPreviewTabModalStatus();
            if (previewTabPreviousFocus && typeof previewTabPreviousFocus.focus === 'function') {
                previewTabPreviousFocus.focus();
            }
            previewTabPreviousFocus = null;
        }

        async function submitPreviewTabAdd(event) {
            event.preventDefault();
            const nameInput = document.getElementById('preview-tab-name');
            const groupSelect = document.getElementById('preview-tab-group');
            const newGroupInput = document.getElementById('preview-tab-new-group');
            const name = nameInput.value.trim();
            const createGroup = groupSelect.value === createNewTabGroupValue;
            const groupName = createGroup ? newGroupInput.value.trim() : groupSelect.value;
            if (!name || !groupName) {
                setPreviewTabModalStatus(createGroup
                    ? 'Enter a tab name and a new service group name.'
                    : 'Enter a tab name and choose its initial group.');
                return;
            }
            const submitButton = document.getElementById('preview-tab-add-submit');
            submitButton.disabled = true;
            const applied = await applyPreviewEdit({
                type: 'tab.add',
                values: { name, groupName, createGroup }
            }, createGroup ? `Added tab ${name} with group ${groupName}.` : `Added tab ${name}.`);
            submitButton.disabled = false;
            if (applied) {
                nameInput.value = '';
                newGroupInput.value = '';
                renderPreviewTabManager();
                nameInput.focus();
            } else {
                setPreviewTabModalStatus('The tab was not added. Check the page message for details.');
            }
        }

        async function handlePreviewTabManagerAction(action, tabName) {
            if (action === 'move-up' || action === 'move-down') {
                const direction = action === 'move-up' ? 'up' : 'down';
                const applied = await applyPreviewEdit(
                    { type: 'tab.move', target: { name: tabName }, direction },
                    `Moved tab ${tabName} ${direction}.`
                );
                if (applied) renderPreviewTabManager();
                return;
            }
            if (action === 'remove') {
                const data = getPreviewTabManagerData();
                const groupCount = (data.groupsByTab[tabName] || []).length;
                const confirmed = await showConfirmationDialog({
                    title: 'Remove Preview tab?',
                    message: `Remove ${tabName}? ${groupCount} assigned group${groupCount === 1 ? '' : 's'} will become visible on every tab. No groups or services will be deleted.`,
                    confirmText: 'Remove tab'
                });
                if (confirmed) {
                    const applied = await applyPreviewEdit(
                        { type: 'tab.remove', target: { name: tabName } },
                        `Removed tab ${tabName}.`
                    );
                    if (applied) renderPreviewTabManager();
                }
            }
        }

        function replacePreviewEditedFiles(files) {
            applyingPreviewFiles = true;
            try {
                for (const tabName of ['services', 'settings']) {
                    if (typeof files[tabName] === 'string') loadedFiles[tabName] = files[tabName];
                }
                if (typeof files[currentTab] === 'string' && getEditorValue() !== files[currentTab]) {
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
                    loadedFiles[currentTab] = getEditorValue();
                }
            } finally {
                applyingPreviewFiles = false;
            }
            updateUnsavedIndicators();
            updatePreview({ force: true });
            if (!document.getElementById('preview-tab-modal').hidden) renderPreviewTabManager();
        }

        function updatePreviewUndoButton() {
            document.getElementById('preview-undo-button').hidden = !previewUndoState;
        }

        async function applyPreviewEdit(operation, successMessage) {
            if (sampleModeEnabled) return false;
            const beforeFiles = {
                services: getTabYamlText('services'),
                settings: getTabYamlText('settings')
            };
            try {
                const response = await fetch('/api/yaml/transform', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: beforeFiles, operation })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.error) {
                    throw new Error(data.details || data.error || 'The Preview edit could not be applied');
                }
                previewUndoState = { files: beforeFiles, message: successMessage };
                replacePreviewEditedFiles(data.files);
                updatePreviewUndoButton();
                setSaveStatus(`${successMessage} Save to write the pending YAML changes.`, 'info');
                return true;
            } catch (error) {
                setSaveStatus(`Could not edit Preview: ${getSaveErrorSummary(error)}`, 'error');
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
            syncPreviewEditOptionState();
            const normalizeFields = (currentFields) => currentFields.map((field) => ({
                key: field.key.trim(),
                ...(Array.isArray(field.fields)
                    ? { fields: normalizeFields(field.fields) }
                    : { value: field.value })
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
            if (action === 'group.edit' && fields.some((field) => field.key === 'tab' && !field.value.trim())) {
                setPreviewEditModalStatus('Choose a Preview tab or remove the tab option.');
                return;
            }
            const values = { name, fields };
            const submitButton = document.getElementById('preview-edit-submit');
            submitButton.disabled = true;
            setPreviewEditModalStatus();
            const message = action === 'group.add'
                ? `Added group ${name}.`
                : action === 'group.edit'
                    ? `Updated group ${name}.`
                    : action === 'service.add'
                        ? `Added service ${name}.`
                        : `Updated service ${name}.`;
            const applied = await applyPreviewEdit({ type: action, target: source, values }, message);
            submitButton.disabled = false;
            if (applied) closePreviewEditDialog();
            else setPreviewEditModalStatus('The edit was not applied. Check the page message for details.');
        }

        function undoPreviewEdit() {
            if (!previewUndoState) return;
            const undoState = previewUndoState;
            previewUndoState = null;
            replacePreviewEditedFiles(undoState.files);
            updatePreviewUndoButton();
            setSaveStatus(`Undid: ${undoState.message}`, 'info');
        }

        async function handlePreviewEditAction(action, source) {
            try {
                if (action === 'tabs.manage') {
                    openPreviewTabManager();
                    return;
                }
                if (['group.add', 'group.edit', 'service.add', 'service.edit'].includes(action)) {
                    openPreviewEditDialog(action, source);
                    return;
                }
                if (action === 'service.move-up' || action === 'service.move-down') {
                    const direction = action.endsWith('up') ? 'up' : 'down';
                    await applyPreviewEdit(
                        { type: 'service.move', target: source, direction },
                        `Moved service ${source.serviceName} ${direction}.`
                    );
                    return;
                }
                if (action === 'group.move-up' || action === 'group.move-down') {
                    const direction = action.endsWith('up') ? 'up' : 'down';
                    await applyPreviewEdit(
                        { type: 'group.move', target: source, direction },
                        `Moved group ${source.groupName} ${direction}.`
                    );
                    return;
                }
                if (action === 'service.remove') {
                    const confirmed = await showConfirmationDialog({
                        title: 'Delete service?',
                        message: `Delete ${source.serviceName} from ${source.groupName}? Its complete YAML block will be removed.`,
                        confirmText: 'Delete service'
                    });
                    if (confirmed) {
                        await applyPreviewEdit(
                            { type: 'service.remove', target: source },
                            `Deleted service ${source.serviceName}.`
                        );
                    }
                    return;
                }
                if (action === 'group.remove') {
                    const group = findPreviewGroup(source);
                    const count = group.services.length;
                    const confirmed = await showConfirmationDialog({
                        title: 'Delete service group?',
                        message: `Delete ${source.groupName} and ${count} service${count === 1 ? '' : 's'}? A matching settings.yaml layout entry will also be removed.`,
                        confirmText: 'Delete group'
                    });
                    if (confirmed) {
                        await applyPreviewEdit(
                            { type: 'group.remove', target: source },
                            `Deleted group ${source.groupName}.`
                        );
                    }
                }
            } catch (error) {
                setSaveStatus(`Could not edit Preview: ${getSaveErrorSummary(error)}`, 'error');
            }
        }

        async function requestDirectoryLoad(dirPath) {
            const response = await fetch('/api/directory/load', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ dirPath })
            });

            const data = await response.json();
            if (!response.ok || data.error) {
                const message = data.details ? `${data.error}: ${data.details}` : (data.error || 'Failed to load directory');
                throw new Error(message);
            }
            return data;
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
            try {
                const data = await requestDirectoryLoad(dirPath);
                applyLoadedDirectory(data);
                closeDirectoryModal();
            } catch (error) {
                console.error('Directory load error:', error);
                setDirectoryModalStatus(`Could not load the directory: ${getSaveErrorSummary(error)}`);
            } finally {
                loadButton.disabled = false;
            }
        }

        async function reloadCurrentDirectory() {
            if (!currentDirectoryPath) {
                return;
            }
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

            const reloadButton = document.getElementById('reload-directory-button');
            reloadButton.disabled = true;
            setSaveStatus('Reloading directory...', 'pending');

            try {
                const data = await requestDirectoryLoad(currentDirectoryPath);
                applyLoadedDirectory(data, currentTab, { autoloaded: currentDirectoryWasAutoloaded });
                setSaveStatus(`Reloaded ${Object.keys(data.files || {}).length} configurations.`, 'success');
            } catch (error) {
                console.error('Directory reload error:', error);
                setSaveStatus(`Could not reload directory: ${getSaveErrorSummary(error)}`, 'error');
            } finally {
                reloadButton.disabled = false;
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
        document.getElementById('preview-edit-modal').addEventListener('click', function(event) {
            if (event.target === this) closePreviewEditDialog();
        });
        document.getElementById('preview-edit-modal-close').addEventListener('click', closePreviewEditDialog);
        document.getElementById('preview-edit-cancel').addEventListener('click', closePreviewEditDialog);
        document.getElementById('preview-edit-form').addEventListener('submit', submitPreviewEditForm);
        document.getElementById('preview-edit-add-option').addEventListener('click', () => {
            syncPreviewEditOptionState();
            previewEditDialogState.fields.push({ key: '', value: '', locked: false });
            renderPreviewEditOptions();
            document.querySelector('[data-preview-option-row]:last-child [data-preview-option-key]')?.focus();
        });
        document.getElementById('preview-edit-options').addEventListener('input', () => {
            syncPreviewEditOptionState();
            updatePreviewEditTabWarning();
        });
        document.getElementById('preview-edit-options').addEventListener('change', function(event) {
            if (!event.target.matches('[data-preview-option-key], [data-preview-option-value], [data-preview-option-value] input[type="radio"]')) return;
            syncPreviewEditOptionState();
            if (event.target.matches('[data-preview-option-key]') || ['true', 'false'].includes(event.target.value.trim())) {
                renderPreviewEditOptions();
            }
        });
        document.getElementById('preview-edit-options').addEventListener('click', function(event) {
            const addChildButton = event.target.closest('[data-preview-option-add-child]');
            if (addChildButton && this.contains(addChildButton)) {
                syncPreviewEditOptionState();
                const path = addChildButton.getAttribute('data-preview-option-path');
                const field = path.split('.').reduce((fields, index) => fields[Number(index)], previewEditDialogState.fields);
                field.fields.push({ key: '', value: '', locked: false });
                renderPreviewEditOptions();
                return;
            }
            const button = event.target.closest('[data-preview-option-action]');
            if (!button || !this.contains(button)) return;
            syncPreviewEditOptionState();
            const index = Number(button.getAttribute('data-preview-option-index'));
            const action = button.getAttribute('data-preview-option-action');
            const parentPath = button.getAttribute('data-preview-option-parent-path');
            const fields = parentPath
                ? parentPath.split('.').reduce((collection, pathIndex) => collection[Number(pathIndex)].fields, previewEditDialogState.fields)
                : previewEditDialogState.fields;
            if (action === 'remove') {
                fields.splice(index, 1);
            } else {
                const destination = index + (action === 'up' ? -1 : 1);
                if (destination < 0 || destination >= fields.length) return;
                const [field] = fields.splice(index, 1);
                fields.splice(destination, 0, field);
            }
            renderPreviewEditOptions();
        });
        document.getElementById('preview-tab-modal').addEventListener('click', function(event) {
            if (event.target === this) closePreviewTabManager();
        });
        document.getElementById('preview-tab-modal-close').addEventListener('click', closePreviewTabManager);
        document.getElementById('preview-tab-modal-done').addEventListener('click', closePreviewTabManager);
        document.getElementById('preview-tab-add-form').addEventListener('submit', submitPreviewTabAdd);
        document.getElementById('preview-tab-group').addEventListener('change', updatePreviewTabGroupMode);
        document.getElementById('preview-option-types-button').addEventListener('click', openOptionTypesModal);
        document.getElementById('option-types-modal-close').addEventListener('click', closeOptionTypesModal);
        document.getElementById('option-types-cancel').addEventListener('click', closeOptionTypesModal);
        document.getElementById('option-types-form').addEventListener('submit', saveOptionTypes);
        document.getElementById('option-types-modal').addEventListener('click', function(event) {
            if (event.target === this) closeOptionTypesModal();
        });
        document.getElementById('option-types-add').addEventListener('click', function() {
            readOptionTypesDraft();
            optionTypesDraft.push({ name: '', type: 'text', values: [], rows: 2 });
            renderOptionTypesDraft();
            document.querySelector('#option-types-list > [data-option-type-row]:last-child [data-option-type-name]')?.focus();
        });
        document.getElementById('option-types-list').addEventListener('change', function(event) {
            if (!event.target.matches('[data-option-value-type], [data-option-type-name]')) return;
            readOptionTypesDraft();
            renderOptionTypesDraft();
        });
        document.getElementById('option-types-list').addEventListener('click', function(event) {
            const removeButton = event.target.closest('[data-option-type-remove]');
            if (!removeButton || !this.contains(removeButton)) return;
            readOptionTypesDraft();
            optionTypesDraft.splice(Number(removeButton.getAttribute('data-option-type-remove')), 1);
            renderOptionTypesDraft();
        });
        document.getElementById('preview-tab-manager-list').addEventListener('click', function(event) {
            const actionButton = event.target.closest('[data-tab-manager-action]');
            if (!actionButton || !this.contains(actionButton)) return;
            handlePreviewTabManagerAction(
                actionButton.getAttribute('data-tab-manager-action'),
                actionButton.getAttribute('data-tab-name')
            );
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
            } else if (!document.getElementById('preview-tab-modal').hidden) {
                closePreviewTabManager();
            } else if (!document.getElementById('directoryModal').hidden) {
                closeDirectoryModal();
            }
        });

        function getTabYamlText(tabName) {
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

        function parseTabConfig(tabName) {
            const yamlText = getTabYamlText(tabName);
            const cached = parsedConfigCache.get(tabName);
            if (cached && cached.yamlText === yamlText) {
                return cached.result;
            }
            if (!yamlText || !yamlText.trim()) {
                const result = { data: null, error: null };
                parsedConfigCache.set(tabName, { yamlText, result });
                return result;
            }
            try {
                const result = { data: jsyaml.load(yamlText), error: null };
                parsedConfigCache.set(tabName, { yamlText, result });
                return result;
            } catch (error) {
                const yamlError = formatYamlError(error);
                const result = {
                    data: null,
                    error: yamlError
                };
                parsedConfigCache.set(tabName, { yamlText, result });
                return result;
            }
        }

        function getHomepageTabInfo(settingsData) {
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

        function isInitiallyCollapsed(layoutConfig) {
            if (!layoutConfig || typeof layoutConfig !== 'object') {
                return false;
            }
            return layoutConfig.initiallyCollapsed === true
                || String(layoutConfig.initiallyCollapsed).toLowerCase() === 'true';
        }

        function resolveIconUrl(icon) {
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

        function renderIcon(icon, label) {
            const iconUrl = resolveIconUrl(icon);
            if (!iconUrl) {
                return '';
            }
            return `<img class="dashboard-icon" src="${escapeHtml(iconUrl)}" alt="" title="${escapeHtml(label || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
        }

        function getYamlLines(tabName) {
            return String(getTabYamlText(tabName) || '').replace(/\r\n/g, '\n').split('\n');
        }

        function getYamlKeyFromLine(line) {
            const trimmed = String(line || '').trim();
            const withoutListMarker = trimmed.startsWith('- ') ? trimmed.slice(2).trimStart() : trimmed;
            const match = withoutListMarker.match(/^(['"]?)(.*?)\1\s*:/);
            return match ? match[2] : null;
        }

        function getYamlIndent(line) {
            const match = String(line || '').match(/^\s*/);
            return match ? match[0].length : 0;
        }

        function findYamlKeyLine(tabName, key, options = {}) {
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

        function findNthYamlListKeyLine(tabName, key, occurrenceIndex, options = {}) {
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

        function findYamlGroupRange(tabName, groupName, occurrenceIndex = 0) {
            const lines = getYamlLines(tabName);
            const groupLine = findNthYamlListKeyLine(tabName, groupName, occurrenceIndex, { indent: 0 });
            const groupIndex = Math.max(0, groupLine - 1);
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

            return { startLine: groupLine, endLine };
        }

        function findServicesGroupAtLine(lineIndex) {
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

        function findSettingsLayoutGroupAtLine(lineIndex) {
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

        function findNestedYamlKeyLine(tabName, parentKey, childKey, parentIndex = 0, childIndex = 0) {
            const range = findYamlGroupRange(tabName, parentKey, parentIndex);
            return findNthYamlListKeyLine(tabName, childKey, childIndex, {
                startLine: range.startLine + 1,
                endLine: range.endLine,
                minIndent: getYamlIndent(getYamlLines(tabName)[range.startLine - 1]) + 1,
                fallbackLine: range.startLine
            });
        }

        function findLineContainingValue(tabName, value, options = {}) {
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

        function findSourceLine(source) {
            if (!source || !source.tab) {
                return 1;
            }

            if (source.kind === 'services-group') {
                return findNthYamlListKeyLine('services', source.groupName, source.groupIndex || 0, { indent: 0 });
            }
            if (source.kind === 'service') {
                return findNestedYamlKeyLine('services', source.groupName, source.serviceName, source.groupIndex || 0, source.serviceIndex || 0);
            }
            if (source.kind === 'bookmark') {
                return findNthYamlListKeyLine('bookmarks', source.name, source.index || 0, { indent: 0 });
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

        function getSourceAttributes(source) {
            return `data-source="${escapeHtml(JSON.stringify(source))}"`;
        }

        function takeOccurrence(counter, name) {
            const occurrenceIndex = counter.get(name) || 0;
            counter.set(name, occurrenceIndex + 1);
            return occurrenceIndex;
        }

        function formatPreviewTooltipLabel(key) {
            if (String(key).toLowerCase() === 'href') {
                return 'URL';
            }
            return String(key)
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/[-_]+/g, ' ')
                .replace(/^./, (character) => character.toUpperCase());
        }

        function formatPreviewTooltipValue(value) {
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

        function getPreviewDetailLines(data, keys, limit = 6) {
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

        function getPreviewTooltipAttributes(lines, { focusable = true } = {}) {
            const cleanLines = lines.map((line) => String(line || '').trim()).filter(Boolean);
            const tooltip = escapeHtml(cleanLines.join('\n')).replace(/\n/g, '&#10;');
            const ariaLabel = escapeHtml(cleanLines.join('. '));
            return `data-preview-tooltip="${tooltip}" aria-label="${ariaLabel}"${focusable ? ' tabindex="0"' : ''}`;
        }

        function getBookmarkTooltipLines(name, data) {
            const lines = [`Group: ${name}`];
            const entries = Array.isArray(data) ? data : [];
            entries.slice(0, 5).forEach((entry) => {
                const entryName = Object.keys(entry || {})[0];
                if (!entryName) {
                    return;
                }
                const entryValue = entry[entryName];
                const details = Array.isArray(entryValue) ? entryValue[0] : entryValue;
                const href = details && typeof details === 'object' ? details.href : null;
                lines.push(href ? `${entryName}: ${href}` : entryName);
            });
            return lines;
        }

        function getCurrentTabSource(source) {
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
                sourceHighlightLine = yamlCodeEditor.addLineClass(lineIndex, 'background', 'source-line-highlight');

                const editorElement = yamlCodeEditor.getWrapperElement();
                editorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                sourceHighlightTimer = window.setTimeout(() => {
                    if (sourceHighlightLine) {
                        yamlCodeEditor.removeLineClass(sourceHighlightLine, 'background', 'source-line-highlight');
                        sourceHighlightLine = null;
                    }
                }, 1400);
            });
        }

        function getPreviewEditActionButton(action, source, label, icon, { disabled = false, danger = false } = {}) {
            const dangerClass = danger ? ' preview-edit-delete' : '';
            const actionClass = action.endsWith('.edit')
                ? ' preview-edit-modify'
                : action.endsWith('.move-up')
                    ? ' preview-edit-move-up'
                    : action.endsWith('.move-down')
                        ? ' preview-edit-move-down'
                        : '';
            return `<button type="button" class="preview-edit-action${dangerClass}${actionClass}" data-preview-action="${escapeHtml(action)}" ${getSourceAttributes(source)} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${disabled ? ' disabled' : ''}>${icon}</button>`;
        }

        function getGroupEditControls(source, position, groupCount) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('group.edit', source, 'Edit group', '&#9998;')}
                ${getPreviewEditActionButton('group.move-up', source, 'Move group up', '&uarr;', { disabled: position === 0 })}
                ${getPreviewEditActionButton('group.move-down', source, 'Move group down', '&darr;', { disabled: position === groupCount - 1 })}
                ${getPreviewEditActionButton('group.remove', source, 'Delete group', '&times;', { danger: true })}
            </span>`;
        }

        function getServiceEditControls(source, position, serviceCount) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('service.edit', source, 'Edit service', '&#9998;')}
                ${getPreviewEditActionButton('service.move-up', source, 'Move service up', '&uarr;', { disabled: position === 0 })}
                ${getPreviewEditActionButton('service.move-down', source, 'Move service down', '&darr;', { disabled: position === serviceCount - 1 })}
                ${getPreviewEditActionButton('service.remove', source, 'Delete service', '&times;', { danger: true })}
            </span>`;
        }

        function updateVisualPreview() {
            const previewDiv = document.getElementById('visual-preview');
            const parsed = Object.fromEntries(
                configTabNames.map((tabName) => [tabName, parseTabConfig(tabName)])
            );
            const previewEditToggleElement = document.getElementById('preview-edit-toggle');
            previewEditToggleElement.disabled = sampleModeEnabled || Boolean(parsed.services.error);
            if (parsed.services.error && previewEditToggleElement.checked) {
                previewEditToggleElement.checked = false;
                document.getElementById('preview-edit-label').textContent = 'Interactive editor off';
                document.getElementById('preview-title-label').textContent = 'Preview';
                previewEditToggleElement.setAttribute('aria-label', 'Enable Interactive editor');
                document.getElementById('preview-option-types-button').hidden = true;
            }
            const previewEditMode = previewEditToggleElement.checked && !previewEditToggleElement.disabled;
            const previewNotices = [];
            const addPreviewNotice = (message) => previewNotices.push(message);

            const services = Array.isArray(parsed.services.data) ? parsed.services.data : [];
            const bookmarks = Array.isArray(parsed.bookmarks.data) ? parsed.bookmarks.data : [];
            const widgetsData = parsed.widgets.data;
            const widgets = Array.isArray(widgetsData)
                ? widgetsData.map((item) => Object.keys(item || {})[0]).filter(Boolean)
                : widgetsData && typeof widgetsData === 'object'
                    ? Object.keys(widgetsData)
                    : [];
            const previewWidgets = widgets.filter((name) => String(name).trim().toLowerCase() !== 'search');

            const homepageTabInfo = getHomepageTabInfo(parsed.settings.data);
            const homepageTabs = homepageTabInfo.tabs;
            const groupsByTab = homepageTabInfo.groupsByTab;
            const groupLayout = homepageTabInfo.groupLayout;
            if (homepageTabs.length > 0 && (!previewHomepageTab || !homepageTabs.includes(previewHomepageTab))) {
                previewHomepageTab = homepageTabs[0];
            }
            if (homepageTabs.length === 0) {
                previewHomepageTab = null;
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
                groupOccurrenceByItem.set(group, takeOccurrence(groupOccurrenceCounter, name));
                groupPositionByItem.set(group, groupPosition);
            });

            function getPreviewLayoutAttributes(layoutConfig) {
                const style = String(layoutConfig && layoutConfig.style || '').trim().toLowerCase();
                const columns = Math.max(1, Math.min(12, Number.parseInt(layoutConfig && layoutConfig.columns, 10) || 1));
                return style === 'row'
                    ? ` data-preview-layout-style="row" style="--preview-card-columns: ${columns}"`
                    : '';
            }

            function getNestedGroupColumns(layoutConfig) {
                return Math.max(1, Math.min(8, Number.parseInt(layoutConfig && layoutConfig.columns, 10) || 2));
            }

            function isNestedServiceGroup(item) {
                const name = Object.keys(item || {})[0];
                return Boolean(name && Array.isArray(item[name]));
            }

            function renderPreviewServiceCards(entries, { groupName, groupIndex, layoutConfig, nested = false, parentSource = null } = {}) {
                const servicesOnly = Array.isArray(entries) ? entries.filter((entry) => !isNestedServiceGroup(entry)) : [];
                const serviceOccurrenceCounter = new Map();
                return servicesOnly.map((service, servicePosition) => {
                    const name = Object.keys(service || {})[0] || 'Service';
                    const serviceOccurrenceIndex = takeOccurrence(serviceOccurrenceCounter, name);
                    const data = service[name] || {};
                    const directSource = {
                        servicesSource: { tab: 'services', kind: 'service', groupName, groupIndex, serviceName: name, serviceIndex: serviceOccurrenceIndex },
                        settingsSource: { tab: 'settings', kind: 'settings-layout-group', groupName }
                    };
                    const serviceSource = nested ? parentSource : directSource;
                    const serviceIcon = renderIcon(data.icon, name);
                    const serviceSourceFile = currentTab === 'settings' ? 'settings.yaml' : 'services.yaml';
                    const serviceTooltip = getPreviewTooltipAttributes([
                        nested ? `Nested service in ${groupName}` : `Jump to this item in ${serviceSourceFile}`,
                        `Service: ${name}`,
                        ...getPreviewDetailLines(data, ['description', 'href', 'icon', 'siteMonitor', 'ping', 'container', 'server']),
                        ...getPreviewDetailLines(data.widget, ['type', 'url'])
                    ]);
                    const serviceEditControls = previewEditMode && !nested
                        ? getServiceEditControls(directSource.servicesSource, servicePosition, servicesOnly.length)
                        : '';
                    return `<div class="dashboard-card preview-jump-target" ${getSourceAttributes(serviceSource)} ${serviceTooltip}>${serviceEditControls}<div class="dashboard-card-heading">${serviceIcon}<div class="dashboard-card-title">${escapeHtml(name)}</div></div><div class="dashboard-card-desc">${escapeHtml(data.description || '')}</div></div>`;
                }).join('');
            }

            function renderNestedPreviewGroups(entries, layoutConfig, groupName, groupIndex, parentSource) {
                if (!Array.isArray(entries)) return '';
                return entries.filter(isNestedServiceGroup).map((nestedGroup) => {
                    const nestedName = Object.keys(nestedGroup)[0];
                    const nestedEntries = nestedGroup[nestedName];
                    const nestedLayout = layoutConfig && typeof layoutConfig === 'object' && !Array.isArray(layoutConfig)
                        ? layoutConfig[nestedName]
                        : null;
                    const nestedIcon = renderIcon(nestedLayout && nestedLayout.icon, nestedName);
                    const nestedCards = renderPreviewServiceCards(nestedEntries, {
                        groupName,
                        groupIndex,
                        layoutConfig: nestedLayout,
                        nested: true,
                        parentSource
                    });
                    const nestedChildren = renderNestedPreviewGroups(nestedEntries, nestedLayout, groupName, groupIndex, parentSource);
                    if (!nestedCards && !nestedChildren) {
                        addPreviewNotice(`No services configured in ${nestedName}.`);
                    }
                    return `<section class="dashboard-nested-group"${getPreviewLayoutAttributes(nestedLayout)}><div class="dashboard-nested-group-title">${nestedIcon}<span>${escapeHtml(nestedName)}</span></div>${nestedCards ? `<div class="dashboard-cards">${nestedCards}</div>` : ''}${nestedChildren}</section>`;
                }).join('');
            }

            filteredServices.forEach((group) => {
                const groupName = Object.keys(group || {})[0];
                const groupIndex = groupOccurrenceByItem.get(group) || 0;
                const entries = groupName ? group[groupName] : [];
                const layoutConfig = groupLayout[groupName];
                const isCollapsed = isInitiallyCollapsed(layoutConfig);
                const groupIcon = renderIcon(layoutConfig && layoutConfig.icon, groupName || 'Services');
                const groupSource = {
                    servicesSource: { tab: 'services', kind: 'services-group', groupName, groupIndex },
                    settingsSource: { tab: 'settings', kind: 'settings-layout-group', groupName }
                };
                const serviceGroupSource = groupSource.servicesSource;
                const groupEditControls = previewEditMode
                    ? getGroupEditControls(serviceGroupSource, groupPositionByItem.get(group) || 0, services.length)
                    : '';
                const cards = renderPreviewServiceCards(entries, { groupName, groupIndex, layoutConfig });
                const nestedGroups = renderNestedPreviewGroups(entries, layoutConfig, groupName, groupIndex, groupSource);
                const groupSourceFile = currentTab === 'settings' ? 'settings.yaml' : 'services.yaml';
                const groupTooltip = getPreviewTooltipAttributes([
                    `Jump to this group in ${groupSourceFile}`,
                    `Group: ${groupName || 'Services'}`,
                    `Services: ${Array.isArray(entries) ? entries.length : 0}`,
                    ...getPreviewDetailLines(layoutConfig, ['icon', 'style', 'columns', 'header'])
                ], { focusable: false });
                const addServiceButton = previewEditMode
                    ? `<button type="button" class="preview-add-button preview-add-service" data-preview-action="service.add" ${getSourceAttributes(serviceGroupSource)}><span aria-hidden="true">+</span> Add service</button>`
                    : '';
                const hasNestedGroups = Array.isArray(entries) && entries.some(isNestedServiceGroup);
                if (hasNestedGroups) {
                    groupsHtml += `<section class="dashboard-group dashboard-group-nested-root"${getPreviewLayoutAttributes(layoutConfig)}><div class="dashboard-group-title">${groupIcon}<span class="preview-jump-target" ${getSourceAttributes(groupSource)} ${groupTooltip}>${escapeHtml(groupName || 'Services')}</span>${groupEditControls}</div>${cards ? `<div class="dashboard-cards">${cards}</div>` : ''}<div class="dashboard-nested-groups" style="--preview-nested-columns: ${getNestedGroupColumns(layoutConfig)}">${nestedGroups}</div>${addServiceButton}</section>`;
                } else {
                    if (!cards) {
                        addPreviewNotice(`No services configured in ${groupName || 'this group'}.`);
                    }
                    groupsHtml += `<details class="dashboard-group"${getPreviewLayoutAttributes(layoutConfig)} ${isCollapsed ? '' : 'open'}><summary class="dashboard-group-title">${groupIcon}<span class="preview-jump-target" ${getSourceAttributes(groupSource)} ${groupTooltip}>${escapeHtml(groupName || 'Services')}</span>${groupEditControls}</summary>${cards ? `<div class="dashboard-cards">${cards}</div>` : ''}${addServiceButton}</details>`;
                }
            });

            if (!parsed.widgets.error && widgets.length === 0) addPreviewNotice('No widgets configured.');
            if (!parsed.bookmarks.error && bookmarks.length === 0) addPreviewNotice('No bookmarks configured.');
            if (!parsed.services.error && services.length === 0) addPreviewNotice('No service groups configured.');

            const bookmarkOccurrenceCounter = new Map();
            const bookmarksHtml = bookmarks.map((item) => {
                const name = Object.keys(item || {})[0] || 'Bookmark';
                const occurrenceIndex = takeOccurrence(bookmarkOccurrenceCounter, name);
                const data = item[name] || {};
                const bookmarkTooltip = getPreviewTooltipAttributes([
                    'Jump to this bookmark in bookmarks.yaml',
                    ...getBookmarkTooltipLines(name, data)
                ], { focusable: false });
                return `<a class="bookmark-chip preview-jump-target" href="${escapeHtml(data.href || '#')}" target="_blank" rel="noopener noreferrer" ${getSourceAttributes({ tab: 'bookmarks', kind: 'bookmark', name, index: occurrenceIndex })} ${bookmarkTooltip}>${escapeHtml(name)}</a>`;
            }).join('');

            const widgetOccurrenceCounter = new Map();
            const widgetsHtml = previewWidgets.map((name) => {
                const occurrenceIndex = takeOccurrence(widgetOccurrenceCounter, name);
                const widgetData = Array.isArray(widgetsData)
                    ? widgetsData.filter((item) => Object.prototype.hasOwnProperty.call(item || {}, name))[occurrenceIndex]?.[name]
                    : widgetsData?.[name];
                const widgetTooltip = getPreviewTooltipAttributes([
                    'Jump to this widget in widgets.yaml',
                    `Widget: ${name}`,
                    ...getPreviewDetailLines(widgetData, Object.keys(widgetData || {}))
                ]);
                return `<span class="widget-block preview-jump-target" ${getSourceAttributes({ tab: 'widgets', kind: 'widget', name, index: occurrenceIndex, isList: Array.isArray(widgetsData) })} ${widgetTooltip}>${escapeHtml(name)}</span>`;
            }).join('');

            const previewTabsHtml = homepageTabs.length > 0
                ? `<div class="preview-tab-navigation">
                    <span class="preview-tab-label">Tabs</span>
                    <div class="preview-tab-strip" role="tablist" aria-label="Homepage preview pages">${homepageTabs.map((name) => {
                        const isActive = name === previewHomepageTab;
                        return `<button type="button" role="tab" aria-selected="${isActive}" tabindex="${isActive ? '0' : '-1'}" class="preview-tab-btn ${isActive ? 'active' : ''}" data-preview-tab="${escapeHtml(name)}" ${getSourceAttributes({ tab: 'settings', kind: 'settings-tab', name })}>${escapeHtml(name)}</button>`;
                    }).join('')}</div>
                </div>`
                : '';

            const addGroupButton = previewEditMode
                ? '<button type="button" class="preview-add-button preview-add-group" data-preview-action="group.add"><span aria-hidden="true">+</span> Add service group</button>'
                : '';
            previewDiv.innerHTML = `
                <div class="dashboard-shell ${previewEditMode ? 'preview-edit-enabled' : ''}">
                    ${errorItems ? `<div class="dashboard-errors">${errorItems}</div>` : ''}
                    ${previewEditMode ? '<div class="preview-edit-mode-note"><span>Preview editing is on. Changes update the YAML editor and remain pending until Save is clicked.</span><button type="button" class="preview-manage-tabs-button" data-preview-action="tabs.manage">Manage tabs</button></div>' : ''}
                    ${previewTabsHtml}
                    ${widgetsHtml ? `<div class="dashboard-widgets">${widgetsHtml}</div>` : ''}
                    ${bookmarksHtml ? `<div class="dashboard-bookmarks">${bookmarksHtml}</div>` : ''}
                    ${groupsHtml || addGroupButton ? `<div class="dashboard-grid">${groupsHtml}${addGroupButton}</div>` : ''}
                </div>`;
            setPreviewStatus(previewNotices);

        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function updatePreview({ force = false } = {}) {
            window.clearTimeout(previewUpdateTimer);
            if (!force && !document.getElementById('preview-auto-refresh-toggle').checked) {
                return;
            }
            updateVisualPreview();
        }

        function refreshPreview() {
            const refreshBtn = document.getElementById('manual-refresh-button');
            refreshBtn.disabled = true;
            refreshBtn.classList.add('is-refreshing');
            refreshBtn.setAttribute('aria-label', 'Refreshing preview');
            refreshBtn.querySelector('.preview-control-label').textContent = 'Refreshing preview';

            updatePreview({ force: true });

            setTimeout(() => {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('is-refreshing');
                refreshBtn.setAttribute('aria-label', 'Refresh preview manually');
                refreshBtn.querySelector('.preview-control-label').textContent = 'Refresh preview manually';
            }, 500);
        }

        function applyTheme(isDarkMode) {
            document.documentElement.classList.toggle('light-mode', !isDarkMode);
            document.body.classList.toggle('light-mode', !isDarkMode);
            const nextTheme = isDarkMode ? 'Light' : 'Dark';
            themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} Mode`);
            document.getElementById('theme-toggle-icon').textContent = isDarkMode ? '\u2600' : '\u263E';
            document.getElementById('theme-toggle-label').textContent = `${nextTheme} mode`;
        }

        // Theme toggle functionality
        const themeToggle = document.getElementById('themeToggle');
        const autoIndentToggle = document.getElementById('auto-indent-toggle');
        const autoIndentLabel = document.getElementById('auto-indent-label');
        const editorVisibilityToggle = document.getElementById('editor-visibility-toggle');
        const editorVisibilityLabel = document.getElementById('editor-visibility-label');
        const previewAutoRefreshToggle = document.getElementById('preview-auto-refresh-toggle');
        const previewAutoRefreshLabel = document.getElementById('preview-auto-refresh-label');
        const previewEditToggle = document.getElementById('preview-edit-toggle');
        const previewEditLabel = document.getElementById('preview-edit-label');
        const manualRefreshButton = document.getElementById('manual-refresh-button');
        const toggleCommentButton = document.getElementById('toggle-comment-button');
        const jumpSectionButton = document.getElementById('jump-section-button');
        let pendingAppSettingsSave = Promise.resolve();
        let savedAppSettings = {
            theme: document.body.classList.contains('light-mode') ? 'light' : 'dark',
            autoIndent: autoIndentToggle.checked,
            previewAutoRefresh: previewAutoRefreshToggle.checked,
            editorVisible: editorVisibilityToggle.checked,
            interactiveEditor: previewEditToggle.checked
        };
        function getPersistentAppSettings() {
            return { ...savedAppSettings };
        }
        async function loadPersistentAppSettings() {
            const response = await fetch('/api/app-settings', { cache: 'no-store' });
            if (!response.ok) throw new Error('Settings request failed');
            const data = await response.json();
            return data.settings || {};
        }
        function applyPersistentAppSettings(settings) {
            savedAppSettings = {
                theme: settings.theme === 'light' ? 'light' : 'dark',
                autoIndent: settings.autoIndent !== false,
                previewAutoRefresh: settings.previewAutoRefresh !== false,
                editorVisible: settings.editorVisible !== false,
                interactiveEditor: settings.interactiveEditor === true
            };
            applyTheme(savedAppSettings.theme !== 'light');
            autoIndentToggle.checked = savedAppSettings.autoIndent;
            previewAutoRefreshToggle.checked = savedAppSettings.previewAutoRefresh;
            editorVisibilityToggle.checked = savedAppSettings.editorVisible;
            previewEditToggle.checked = savedAppSettings.interactiveEditor;
            updateAutoIndentLabel();
            updateEditorVisibility();
            previewAutoRefreshLabel.textContent = `Auto Refresh ${previewAutoRefreshToggle.checked ? 'on' : 'off'}`;
            manualRefreshButton.hidden = previewAutoRefreshToggle.checked;
            updatePreviewEditMode();
            yamlCodeEditor.refresh();
        }
        function persistAppSettings() {
            const settings = getPersistentAppSettings();
            pendingAppSettingsSave = pendingAppSettingsSave
                .catch(() => undefined)
                .then(async () => {
                    const response = await fetch('/api/app-settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ settings })
                    });
                    if (!response.ok) throw new Error('Settings save failed');
                })
                .then(() => true)
                .catch((error) => {
                    console.warn('Could not save persistent app settings', error);
                    return false;
                });
            return pendingAppSettingsSave;
        }
        let settingsModalPreviousFocus = null;
        function openSettingsModal() {
            const modal = document.getElementById('settings-modal');
            settingsModalPreviousFocus = document.activeElement;
            const settings = getPersistentAppSettings();
            document.querySelector(`input[name="settings-theme"][value="${settings.theme}"]`).checked = true;
            document.getElementById('settings-auto-indent').checked = settings.autoIndent;
            document.getElementById('settings-preview-auto-refresh').checked = settings.previewAutoRefresh;
            document.getElementById('settings-editor-visible').checked = settings.editorVisible;
            document.getElementById('settings-interactive-editor').checked = settings.interactiveEditor;
            modal.hidden = false;
            window.requestAnimationFrame(() => document.querySelector('input[name="settings-theme"]:checked').focus());
        }
        function closeSettingsModal() {
            const modal = document.getElementById('settings-modal');
            if (modal.hidden) return;
            modal.hidden = true;
            if (settingsModalPreviousFocus && typeof settingsModalPreviousFocus.focus === 'function') {
                settingsModalPreviousFocus.focus();
            }
            settingsModalPreviousFocus = null;
        }
        async function submitSettingsModal(event) {
            event.preventDefault();
            const theme = document.querySelector('input[name="settings-theme"]:checked').value;
            applyPersistentAppSettings({
                theme,
                autoIndent: document.getElementById('settings-auto-indent').checked,
                previewAutoRefresh: document.getElementById('settings-preview-auto-refresh').checked,
                editorVisible: document.getElementById('settings-editor-visible').checked,
                interactiveEditor: document.getElementById('settings-interactive-editor').checked
            });
            if (await persistAppSettings()) {
                setSaveStatus('Editor settings saved.', 'success');
                closeSettingsModal();
            } else {
                setSaveStatus('Could not save editor settings.', 'error');
            }
        }
        function updateAutoIndentLabel() {
            autoIndentLabel.textContent = `Auto Indent ${autoIndentToggle.checked ? 'on' : 'off'}`;
        }
        function updateEditorVisibility() {
            const isVisible = editorVisibilityToggle.checked;
            document.getElementById('yaml-editor-section').classList.toggle('editor-collapsed', !isVisible);
            editorVisibilityLabel.textContent = isVisible ? 'Hide editor' : 'Show editor';
            editorVisibilityToggle.setAttribute('aria-label', isVisible ? 'Hide editor' : 'Show editor');
            if (isVisible) {
                window.requestAnimationFrame(() => yamlCodeEditor.refresh());
            }
        }
        function updatePreviewEditMode() {
            const isEnabled = previewEditToggle.checked && !previewEditToggle.disabled;
            previewEditLabel.textContent = `Interactive editor ${isEnabled ? 'on' : 'off'}`;
            document.getElementById('preview-title-label').textContent = isEnabled ? 'Interactive editor' : 'Preview';
            previewEditToggle.setAttribute('aria-label', `${isEnabled ? 'Disable' : 'Enable'} Interactive editor`);
            document.getElementById('preview-option-types-button').hidden = !isEnabled;
            updatePreview({ force: true });
        }
        autoIndentToggle.addEventListener('change', function() {
            updateAutoIndentLabel();
        });
        updateAutoIndentLabel();
        editorVisibilityToggle.addEventListener('change', function() {
            updateEditorVisibility();
        });
        updateEditorVisibility();
        document.getElementById('settings-button').addEventListener('click', openSettingsModal);
        document.getElementById('settings-modal-close').addEventListener('click', closeSettingsModal);
        document.getElementById('settings-modal-cancel').addEventListener('click', closeSettingsModal);
        document.getElementById('settings-form').addEventListener('submit', submitSettingsModal);
        document.getElementById('settings-modal').addEventListener('click', function(event) {
            if (event.target === this) closeSettingsModal();
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
        themeToggle.addEventListener('click', function() {
            applyTheme(document.body.classList.contains('light-mode'));
            yamlCodeEditor.refresh();
        });
        toggleCommentButton.addEventListener('mousedown', function(event) {
            event.preventDefault();
        });
        toggleCommentButton.addEventListener('click', function() {
            toggleSelectedComments(yamlCodeEditor);
        });
        jumpSectionButton.addEventListener('mousedown', function(event) {
            event.preventDefault();
        });
        jumpSectionButton.addEventListener('click', jumpToMatchingConfigSection);

        yamlCodeEditor.on('change', function(editor, change) {
            if (!applyingPreviewFiles && previewUndoState && change.origin !== 'setValue') {
                previewUndoState = null;
                updatePreviewUndoButton();
            }
            clearSaveStatus();
            updateUnsavedIndicators();
            scheduleVisualPreview();
        });

        document.getElementById('visual-preview').addEventListener('click', function(event) {
            const actionTarget = event.target.closest('[data-preview-action]');
            if (actionTarget && this.contains(actionTarget)) {
                event.preventDefault();
                event.stopPropagation();
                const source = JSON.parse(actionTarget.getAttribute('data-source') || '{}');
                handlePreviewEditAction(actionTarget.getAttribute('data-preview-action'), source);
                return;
            }
            const target = event.target.closest('[data-source]');
            if (!target || !this.contains(target)) {
                return;
            }
            if (target.classList.contains('preview-tab-btn')) {
                previewHomepageTab = target.getAttribute('data-preview-tab');
                updatePreview();
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
        document.getElementById('visual-preview').addEventListener('keydown', function(event) {
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
            previewHomepageTab = tabs[nextIndex].getAttribute('data-preview-tab');
            updatePreview();
            requestAnimationFrame(() => this.querySelector('.preview-tab-btn.active')?.focus());
        });
        const saveStatusElement = document.getElementById('save-status');
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
        saveStatusElement.addEventListener('click', jumpFromSaveStatus);
        saveStatusElement.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                jumpFromSaveStatus();
            }
        });
        window.addEventListener('scroll', updateFloatingNavVisibility);
        window.addEventListener('beforeunload', function(event) {
            if (!hasUnsavedChanges()) {
                return;
            }
            event.preventDefault();
            event.returnValue = true;
        });
        updateFloatingNavVisibility();
