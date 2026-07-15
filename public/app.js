// Sample homepage configuration files
        const sampleConfigs = {
            services: `# For configuration options and examples, please see:
# https://gethomepage.dev/configs/services/

- My First Group:
    - My First Service:
        href: http://localhost/
        description: Homepage is awesome

- My Second Group:
    - My Second Service:
        href: http://localhost/
        description: Homepage is the best`,
                    
            settings: `# For configuration options and examples, please see:
# https://gethomepage.dev/configs/settings/

providers:
  openweathermap: openweathermapapikey
  weatherapi: weatherapiurl`,
                    
            bookmarks: `- My First Bookmark:
    href: http://localhost/
    description: Homepage is awesome
    
- My Second Bookmark:
    href: http://localhost/
    description: Homepage is the best`,
                    
            widgets: `# For configuration options and examples, please see:
# https://gethomepage.dev/configs/widgets/

- weather:
    location: London
    units: metric
- clock:
    format: 12h`
        };

        let currentTab = 'services';
        let loadedFiles = {};
        let originalLoadedFiles = {};
        let loadedFileNames = {
            services: 'services.yaml',
            settings: 'settings.yaml',
            bookmarks: 'bookmarks.yaml',
            widgets: 'widgets.yaml'
        };
        let currentDirectoryPath = null;
        let previewHomepageTab = null;
        const parsedConfigCache = new Map();
        let previewUpdateTimer = null;
        let sourceHighlightLine = null;
        let sourceHighlightTimer = null;
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
            previewUpdateTimer = window.setTimeout(updateVisualPreview, 180);
        }

        const fileToTabMapping = {
            'services.yaml': 'services',
            'services.yml': 'services',
            'settings.yaml': 'settings',
            'settings.yml': 'settings',
            'bookmarks.yaml': 'bookmarks',
            'bookmarks.yml': 'bookmarks',
            'widgets.yaml': 'widgets',
            'widgets.yml': 'widgets'
        };

        function normalizeLoadedFiles(files) {
            const normalizedFiles = {};
            const normalizedFileNames = { ...loadedFileNames };

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
            return ['services', 'settings', 'bookmarks', 'widgets'].filter((tabName) => {
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

        function switchTab(tabName, event, options = {}) {
            if (!options.skipRemember) {
                rememberCurrentEditorValue();
            }
            currentTab = tabName;
            
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
                resetButton.style.display = isVisible ? '' : 'none';
            }
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

        function setDirectoryStatus(directory, fileCount) {
            const statusElement = document.getElementById('directory-info');
            statusElement.textContent = `Loaded ${fileCount}/4 from ${directory}`;
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
                        const endpoint = currentDirectoryPath ? '/api/directory/file/save' : '/api/config/save';
                        const requestBody = currentDirectoryPath
                            ? { dirPath: currentDirectoryPath, filename: config.filename, content: config.yamlText }
                            : { filename: config.filename, content: config.yamlText };
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody)
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
                saveButton.disabled = false;
            }
        }

        async function downloadAllConfigs() {
            try {
                rememberCurrentEditorValue();
                const filesForDownload = ['services', 'settings', 'bookmarks', 'widgets'].reduce((files, tabName) => {
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
                alert('Error occurred while trying to download configurations');
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
            
            loadedFiles = {
                'services': sampleConfigs.services,
                'settings': sampleConfigs.settings, 
                'bookmarks': sampleConfigs.bookmarks,
                'widgets': sampleConfigs.widgets
            };
            originalLoadedFiles = { ...loadedFiles };
            
            setEditorValue(sampleConfigs.services);
            updatePreview();

            try {
                const response = await fetch('/api/startup-directory');
                const startup = await response.json();

                if (startup.hasStartupDirectory && startup.directory && startup.files) {
                    const normalized = normalizeLoadedFiles(startup.files);
                    loadedFiles = normalized.files;
                    originalLoadedFiles = { ...normalized.files };
                    loadedFileNames = normalized.fileNames;
                    currentDirectoryPath = startup.directory;

                    setDirectoryStatus(currentDirectoryPath, Object.keys(startup.files).length);

                    setResetSampleVisible(false);
                    switchTab('services', null, { skipRemember: true });
                }
            } catch (error) {
                console.error('Startup directory load failed:', error);
            }
        };

        // Directory loading via API calls to server (the only functional approach)
        function handleLoadDirectory() {
            openDirectoryModal();
        }


        function openDirectoryModal() {
            document.getElementById('directoryModal').style.display = 'block';
        }

        function closeDirectoryModal() {
            document.getElementById('directoryModal').style.display = 'none';
        }

        async function loadFromServerPath() {
            const dirPath = document.getElementById('serverPathInput').value.trim();
            if (!dirPath) {
                alert('Please enter a directory path.');
                return;
            }

            try {
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
                    alert(`Error loading directory: ${message}`);
                    return;
                }

                const normalized = normalizeLoadedFiles(data.files);
                loadedFiles = normalized.files;
                originalLoadedFiles = { ...normalized.files };
                loadedFileNames = normalized.fileNames;
                currentDirectoryPath = data.directory;

                setDirectoryStatus(currentDirectoryPath, Object.keys(data.files || {}).length);

                closeDirectoryModal();
                switchTab(currentTab, null, { skipRemember: true });
            } catch (error) {
                console.error('Directory load error:', error);
                alert(`Error occurred while trying to load the directory: ${error.message}`);
            }
        }

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

        function getCurrentTabSource(source) {
            if (!source || typeof source !== 'object') {
                return source;
            }
            if (currentTab === 'settings' && source.settingsSource) {
                return source.settingsSource;
            }
            if (currentTab === 'services' && source.servicesSource) {
                return source.servicesSource;
            }
            return source;
        }

        function jumpToYamlSource(source) {
            const resolvedSource = getCurrentTabSource(source);
            const tabName = resolvedSource && resolvedSource.tab ? resolvedSource.tab : currentTab;
            const targetLine = Math.max(1, Number(findSourceLine(resolvedSource)) || 1);

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

        function updateVisualPreview() {
            const previewDiv = document.getElementById('visual-preview');
            const parsed = {
                services: parseTabConfig('services'),
                bookmarks: parseTabConfig('bookmarks'),
                widgets: parseTabConfig('widgets'),
                settings: parseTabConfig('settings')
            };

            const services = Array.isArray(parsed.services.data) ? parsed.services.data : [];
            const bookmarks = Array.isArray(parsed.bookmarks.data) ? parsed.bookmarks.data : [];
            const settingsProviders = parsed.settings.data && parsed.settings.data.providers && typeof parsed.settings.data.providers === 'object'
                ? Object.entries(parsed.settings.data.providers)
                : [];
            const widgetsData = parsed.widgets.data;
            const widgets = Array.isArray(widgetsData)
                ? widgetsData.map((item) => Object.keys(item || {})[0]).filter(Boolean)
                : widgetsData && typeof widgetsData === 'object'
                    ? Object.keys(widgetsData)
                    : [];

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
                        return allowedGroups.includes(groupName);
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
            services.forEach((group) => {
                const name = Object.keys(group || {})[0] || '';
                groupOccurrenceByItem.set(group, takeOccurrence(groupOccurrenceCounter, name));
            });
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
                const serviceOccurrenceCounter = new Map();
                const cards = Array.isArray(entries) ? entries.map((service) => {
                    const name = Object.keys(service || {})[0] || 'Service';
                    const serviceOccurrenceIndex = takeOccurrence(serviceOccurrenceCounter, name);
                    const data = service[name] || {};
                    const serviceSource = {
                        servicesSource: { tab: 'services', kind: 'service', groupName, groupIndex, serviceName: name, serviceIndex: serviceOccurrenceIndex },
                        settingsSource: { tab: 'settings', kind: 'settings-layout-group', groupName }
                    };
                    const serviceIcon = renderIcon(data.icon, name);
                    return `<div class="dashboard-card preview-jump-target" ${getSourceAttributes(serviceSource)} title="Jump to this item in the active YAML tab"><div class="dashboard-card-heading">${serviceIcon}<div class="dashboard-card-title">${escapeHtml(name)}</div></div><div class="dashboard-card-url">${escapeHtml(data.href || '')}</div><div class="dashboard-card-desc">${escapeHtml(data.description || '')}</div></div>`;
                }).join('') : '';
                groupsHtml += `<details class="dashboard-group" ${isCollapsed ? '' : 'open'}><summary class="dashboard-group-title">${groupIcon}<span class="preview-jump-target" ${getSourceAttributes(groupSource)} title="Jump to this group in the active YAML tab">${escapeHtml(groupName || 'Services')}</span></summary><div class="dashboard-cards">${cards || '<div class="dashboard-empty">No services in this group</div>'}</div></details>`;
            });

            const bookmarkOccurrenceCounter = new Map();
            const bookmarksHtml = bookmarks.map((item) => {
                const name = Object.keys(item || {})[0] || 'Bookmark';
                const occurrenceIndex = takeOccurrence(bookmarkOccurrenceCounter, name);
                const data = item[name] || {};
                return `<a class="bookmark-chip preview-jump-target" href="${escapeHtml(data.href || '#')}" target="_blank" rel="noopener noreferrer" ${getSourceAttributes({ tab: 'bookmarks', kind: 'bookmark', name, index: occurrenceIndex })} title="Jump to this bookmark in bookmarks.yaml">${escapeHtml(name)}</a>`;
            }).join('');

            const widgetOccurrenceCounter = new Map();
            const widgetsHtml = widgets.map((name) => `<span class="widget-block preview-jump-target" ${getSourceAttributes({ tab: 'widgets', kind: 'widget', name, index: takeOccurrence(widgetOccurrenceCounter, name), isList: Array.isArray(widgetsData) })} title="Jump to this widget in widgets.yaml">${escapeHtml(name)}</span>`).join('');

            const previewTabsHtml = homepageTabs.length > 0
                ? `<div class="preview-tab-strip">${homepageTabs.map((name) => `<button class="preview-tab-btn ${name === previewHomepageTab ? 'active' : ''}" data-preview-tab="${escapeHtml(name)}" ${getSourceAttributes({ tab: 'settings', kind: 'settings-tab', name })}>${escapeHtml(name)}</button>`).join('')}</div>`
                : '';

            previewDiv.innerHTML = `
                <div class="dashboard-shell">
                    ${previewTabsHtml}
                    <div class="dashboard-top">
                        <div class="dashboard-stat preview-jump-target" ${getSourceAttributes({ tab: 'services', line: 1 })} title="Jump to services.yaml"><span>Service Groups</span><strong>${filteredServices.length}</strong></div>
                        <div class="dashboard-stat preview-jump-target" ${getSourceAttributes({ tab: 'bookmarks', line: 1 })} title="Jump to bookmarks.yaml"><span>Bookmarks</span><strong>${bookmarks.length}</strong></div>
                        <div class="dashboard-stat preview-jump-target" ${getSourceAttributes({ tab: 'widgets', line: 1 })} title="Jump to widgets.yaml"><span>Widgets</span><strong>${widgets.length}</strong></div>
                        <div class="dashboard-stat preview-jump-target" ${getSourceAttributes({ tab: 'settings', kind: 'settings-key', key: 'providers' })} title="Jump to providers in settings.yaml"><span>Providers</span><strong>${settingsProviders.length}</strong></div>
                    </div>
                    ${errorItems ? `<div class="dashboard-errors">${errorItems}</div>` : ''}
                    <div class="dashboard-widgets">${widgetsHtml || '<div class="dashboard-empty">No widgets configured</div>'}</div>
                    <div class="dashboard-bookmarks">${bookmarksHtml || '<div class="dashboard-empty">No bookmarks configured</div>'}</div>
                    <div class="dashboard-grid">${groupsHtml || '<div class="dashboard-empty">No service groups configured</div>'}</div>
                </div>`;

        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function updatePreview() {
            window.clearTimeout(previewUpdateTimer);
            updateVisualPreview();
        }

        function refreshPreview() {
            // Add a small visual feedback when refreshing
            const refreshBtn = document.querySelector('.refresh-btn');
            const originalText = refreshBtn.textContent;
            refreshBtn.textContent = 'Refreshing...';
            refreshBtn.disabled = true;
            
            // Update the preview
            updatePreview();
            
            // Restore button after a short delay
            setTimeout(() => {
                refreshBtn.textContent = originalText;
                refreshBtn.disabled = false;
            }, 500);
        }

        function applyTheme(isDarkMode) {
            document.documentElement.classList.toggle('light-mode', !isDarkMode);
            document.body.classList.toggle('light-mode', !isDarkMode);
            themeToggle.textContent = isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        }

        // Theme toggle functionality
        const themeToggle = document.getElementById('themeToggle');
        const toggleCommentButton = document.getElementById('toggle-comment-button');
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

        yamlCodeEditor.on('change', function() {
            clearSaveStatus();
            scheduleVisualPreview();
        });

        document.getElementById('visual-preview').addEventListener('click', function(event) {
            const target = event.target.closest('[data-source]');
            if (!target || !this.contains(target)) {
                return;
            }
            if (target.classList.contains('preview-tab-btn')) {
                previewHomepageTab = target.getAttribute('data-preview-tab');
                updateVisualPreview();
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
