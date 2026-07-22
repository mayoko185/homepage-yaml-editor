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
        const configTabLabels = Object.freeze({
            services: 'Services',
            settings: 'Settings',
            bookmarks: 'Bookmarks',
            widgets: 'Widgets',
            docker: 'Docker',
            proxmox: 'Proxmox',
            kubernetes: 'Kubernetes'
        });
        const sampleConfigs = Object.fromEntries(configTabNames.map((tabName) => [tabName, '']));
        const createNewTabGroupValue = '__create_new_service_group__';
        const defaultPageTitle = 'Homepage YAML Editor';

        async function loadSampleConfigs() {
            const response = await fetch('/api/examples', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(getApiErrorMessage(payload, response, 'Could not load example configurations'));
            }
            for (const tabName of Object.keys(sampleConfigs)) {
                if (typeof payload.samples?.[tabName] !== 'string') {
                    throw new Error(`The server did not return the ${tabName}.yaml example configuration`);
                }
                sampleConfigs[tabName] = payload.samples[tabName];
            }
        }

        let currentTab = 'services';
        let loadedFiles = {};
        let originalLoadedFiles = {};
        let loadedFileRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));
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
        let previewShowCommentsState = false;
        let previewEditDialogState = null;
        let previewEditPreviousFocus = null;
        let previewEditPreviousFocusVisible = false;
        let pendingInlineRenameTab = null;
        let pendingInlineRenameBackup = null;
        const previewAddTabModal = document.getElementById('preview-add-tab-modal');
        let previewTabAddAnchor = null;
        let previewTabAddAfterTab = null;
        let previewTabAddInFlight = false;
        let activePreviewDrag = null;
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

        function toggleLineRangeComments(editor, startLine, endLine, forceUncomment) {
            const lines = [];
            for (let i = startLine; i <= endLine; i++) {
                lines.push(editor.getLine(i) || '');
            }
            const nonBlankLines = lines.filter((line) => line.trim().length > 0);
            const shouldUncomment = forceUncomment || (nonBlankLines.length > 0 && nonBlankLines.every((line) => /^\s*#/.test(line)));

            editor.operation(() => {
                lines.forEach((currentLine, offset) => {
                    const lineNumber = startLine + offset;
                    const nextLine = shouldUncomment
                        ? currentLine.replace(/^(\s*)# ?/, '$1')
                        : currentLine.replace(/^(\s*)/, '$1# ');
                    if (nextLine !== currentLine) {
                        editor.replaceRange(
                            nextLine,
                            { line: lineNumber, ch: 0 },
                            { line: lineNumber, ch: currentLine.length },
                            '+toggleCommentBlock'
                        );
                    }
                });
            });
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
                switchTab(tabName, null);
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
            loadedFiles[tabName] = newText;
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
                const buildDataFromFields = (fieldList) => {
                    const data = {};
                    for (const f of fieldList) {
                        if (Array.isArray(f.fields)) {
                            const nested = buildDataFromFields(f.fields);
                            if (Object.keys(nested).length > 0) {
                                data[f.key] = nested;
                            }
                        } else if (f.blankValue || String(f.value || '').trim() !== '') {
                            data[f.key] = f.value;
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
                previewUndoState = { files: beforeFiles, message: successMessage };
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
                previewUndoState = { files: beforeFiles, message: successMessage };
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
            previewUpdateTimer = window.setTimeout(updatePreview, 180);
        }

        const fileToTabMapping = Object.fromEntries(configTabNames.flatMap((tabName) => [
            [`${tabName}.yaml`, tabName],
            [`${tabName}.yml`, tabName]
        ]));

        function normalizeLoadedFiles(files, revisions = {}) {
            const normalizedFiles = {};
            const normalizedFileNames = {};
            const normalizedRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));

            Object.entries(files || {}).forEach(([filename, content]) => {
                const tabName = fileToTabMapping[filename] || fileToTabMapping[String(filename).toLowerCase()];
                if (tabName) {
                    normalizedFiles[tabName] = content;
                    normalizedFileNames[tabName] = filename;
                    normalizedRevisions[tabName] = typeof revisions[filename] === 'string' ? revisions[filename] : null;
                }
            });

            return { files: normalizedFiles, fileNames: normalizedFileNames, revisions: normalizedRevisions };
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
            syncPreviewEditModePresentation(editToggle.checked && !editToggle.disabled);
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
            const normalized = normalizeLoadedFiles(data.files, data.revisions);
            const missingTabs = configTabNames.filter((tabName) => !Object.prototype.hasOwnProperty.call(normalized.files, tabName));
            loadedFiles = normalized.files;
            originalLoadedFiles = Object.fromEntries(configTabNames.map((tabName) => [
                tabName,
                Object.prototype.hasOwnProperty.call(normalized.files, tabName) ? normalized.files[tabName] : ''
            ]));
            loadedFileNames = normalized.fileNames;
            loadedFileRevisions = normalized.revisions;
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
                ? `${missingCount} YAML file${missingCount === 1 ? '' : 's'} missing; example content is shown and will be created if saved. ${loadedMessage}`
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
            return String(message || 'The operation could not be completed').split('\n')[0].trim();
        }

        function addErrorGuidance(error, guidance) {
            const summary = getSaveErrorSummary(error);
            return `${summary}${/[.!?]$/.test(summary) ? '' : '.'} ${guidance}`;
        }

        function getApiErrorMessage(data, response, fallback) {
            const details = typeof data?.details === 'string' ? data.details.trim() : '';
            const errorMessage = typeof data?.error === 'string' ? data.error.trim() : '';
            if (details) return details;
            if (errorMessage) return errorMessage;
            const status = response && response.status ? ` (HTTP ${response.status})` : '';
            return `${fallback}${status}`;
        }

        function formatYamlError(error) {
            const rawReason = String(
                (error && error.reason)
                || (error && error.message ? error.message.split('\n')[0] : '')
                || 'Invalid YAML'
            ).replace(/^YAMLException:\s*/i, '').trim();
            const friendlyReasons = [
                [/map keys must be unique|duplicated mapping key/i, 'Duplicate mapping key. Each key in a YAML mapping must be unique; rename or remove the duplicate key.'],
                [/bad indentation of a mapping entry/i, 'Invalid indentation. Align this key with the surrounding YAML structure.'],
                [/bad indentation of a sequence entry/i, 'Invalid indentation. Align this list item with the surrounding YAML structure.'],
                [/tab.*indentation/i, 'Tabs cannot be used for YAML indentation; replace tabs with spaces.'],
                [/can not read a block mapping entry/i, 'A key is missing a value, or the indentation is incorrect.'],
                [/end of the stream or a document separator is expected/i, 'Check for incorrect indentation or a missing colon.'],
                [/missed comma between flow collection entries/i, 'Add a comma between the inline list or object values.'],
                [/unexpected end of the stream/i, 'The YAML ends before this value or block is complete.'],
                [/unknown escape sequence/i, 'This quoted value contains an unsupported escape sequence.'],
                [/unexpected character/i, 'Unexpected character. Check quotes, colons, brackets, and commas near this line.']
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
                return 'Line unavailable';
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
                                content: config.yamlText,
                                expectedRevision: loadedFileRevisions[config.tabName] ?? null
                            })
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok || data.error) {
                            const error = new Error(getApiErrorMessage(data, response, `Could not save ${config.filename}`));
                            error.status = response.status;
                            throw error;
                        }

                        originalLoadedFiles[config.tabName] = config.yamlText;
                        loadedFileRevisions[config.tabName] = data.revision;
                        savedConfigs.push(config);
                    } catch (error) {
                        failedConfigs.push({ config, error });
                    }
                }

                if (failedConfigs.length > 0) {
                    const firstFailure = failedConfigs[0];
                    setSaveStatus(
                        `Saved ${savedConfigs.length} of ${unsavedConfigs.length}. Could not save ${firstFailure.config.filename}: ${addErrorGuidance(
                            firstFailure.error,
                            firstFailure.error.status === 409
                                ? 'Your pending edit is still available. Reload the directory before saving again'
                                : 'Fix the error and try Save again'
                        )}`,
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
                setSaveStatus(`Could not create the configuration download: ${getSaveErrorSummary(error)}`, 'error');
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
                setSaveStatus(`Could not load editor settings; using defaults. ${addErrorGuidance(error, 'You can try again from the Settings dialog')}`, 'error');
            }

            try {
                await loadOptionDefinitions();
            } catch (error) {
                console.warn('Could not load option type definitions', error);
                setSaveStatus(`Could not load option types. Some editing controls may be unavailable. ${addErrorGuidance(error, 'You can try again by reloading the page')}`, 'error');
            }

            try {
                await loadSampleConfigs();
            } catch (error) {
                console.error('Example configuration load failed:', error);
                setSaveStatus(`Could not load example configurations: ${addErrorGuidance(error, 'Reload the page and try again')}`, 'error');
            }
            
            loadedFiles = { ...sampleConfigs };
            originalLoadedFiles = { ...loadedFiles };
            loadedFileRevisions = Object.fromEntries(configTabNames.map((tabName) => [tabName, null]));
            currentDirectoryPath = null;
            document.getElementById('security-status').hidden = Boolean(window.APP_CONFIG && window.APP_CONFIG.loginRequired);
            setSampleMode(true);
            const directoryInfo = document.getElementById('directory-info');
            directoryInfo.textContent = 'Examples loaded (read-only).';
            directoryInfo.dataset.state = 'idle';
            
            switchTab(getFirstVisibleConfigTab(), null, { skipRemember: true });
            updatePreview();

            try {
                const response = await fetch('/api/startup-directory');
                const startup = await response.json();

                if (startup.hasStartupDirectory && startup.directory && startup.files) {
                    applyLoadedDirectory(startup, 'services', { autoloaded: true });
                }
            } catch (error) {
                console.error('Startup directory load failed:', error);
                setSaveStatus(`Could not check the startup directory. ${addErrorGuidance(error, 'Use Load to choose a directory manually')}`, 'error');
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
            const result = [];
            if (startLine < 0 || endLine >= lines.length || endLine < startLine) return result;
            const baseIndent = lines[startLine].search(/\S/);
            let i = startLine + 1;
            while (i <= endLine) {
                const line = lines[i];
                if (line.trim() === '') { i++; continue; }
                const indent = line.search(/\S/);
                if (indent <= baseIndent) break;
                // Match a commented key-value or key-only line: optional ws, #, optional space, key, colon
                const commentedMatch = line.match(/^(\s*)#\s+(\S[\S\s]*?):\s*(.*)$/);
                if (!commentedMatch) { i++; continue; }
                const keyIndent = commentedMatch[1].length;
                const key = commentedMatch[2].trim();
                const valuePart = commentedMatch[3].trim();
                if (valuePart) {
                    // Scalar or inline value
                    result.push({ key, value: valuePart, commented: true, locked: true });
                    i++;
                } else {
                    // Nested mapping — collect child lines
                    let j = i + 1;
                    const childLines = [];
                    while (j <= endLine) {
                        const childLine = lines[j];
                        if (childLine.trim() === '') { j++; continue; }
                        const childIndent = childLine.search(/\S/);
                        if (childIndent <= keyIndent + 2) break;
                        childLines.push(childLine);
                        j++;
                    }
                    const subFields = [];
                    for (const cl of childLines) {
                        const cm = cl.match(/^(\s*)#\s+(\S[\S\s]*?):\s*(.*)$/);
                        if (cm) {
                            const subKey = cm[2].trim();
                            const subVal = cm[3].trim();
                            if (subVal) {
                                subFields.push({ key: subKey, value: subVal, commented: true, locked: true });
                            } else {
                                subFields.push({ key: subKey, fields: [], commented: true, locked: true });
                            }
                        }
                    }
                    result.push({ key, fields: subFields, commented: true, locked: true });
                    i = j;
                }
            }
            return result;
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

        async function loadOptionDefinitions() {
            const response = await fetch('/api/option-types', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                throw new Error(getApiErrorMessage(data, response, 'Could not load option types'));
            }
            setOptionDefinitions(data.options);
            return data.options;
        }

        const optionValueTypeChoices = ['text', 'textarea', 'boolean', 'tab', 'mapping', 'select'];
        const blankSelectControlValue = '__homepage_yaml_editor_blank_select__';
        const optionAppliesToChoices = [
            { value: 'service', label: 'S', tooltip: 'Services' },
            { value: 'group', label: 'G', tooltip: 'Service groups' },
            { value: 'bookmark', label: 'B', tooltip: 'Bookmarks' },
            { value: 'widget', label: 'W', tooltip: 'Service widgets' }
        ];
        let optionTypesDraft = [];
        let optionTypesRemovedDefinitions = new Map();
        let optionTypesPreviousFocus = null;

        function setOptionTypesStatus(message = '') {
            const status = document.getElementById('option-types-status');
            status.textContent = message;
            status.hidden = !message;
        }

        function readOptionTypesDraft() {
            optionTypesDraft = Array.from(document.querySelectorAll('#option-types-list > [data-option-type-row]')).map((row, index) => {
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
            });
            normalizeOptionDefaultOrders();
        }

        function renderOptionTypesDraft() {
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

        function getOrderedOptionDefaultIndexes(target) {
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

        function setOptionDefaultOrder(target, orderedIndexes) {
            optionTypesDraft.forEach((definition) => {
                if (!definition.defaultOrder) return;
                delete definition.defaultOrder[target];
                if (Object.keys(definition.defaultOrder).length === 0) delete definition.defaultOrder;
            });
            orderedIndexes.forEach((definitionIndex, order) => {
                optionTypesDraft[definitionIndex].defaultOrder = {
                    ...(optionTypesDraft[definitionIndex].defaultOrder || {}),
                    [target]: order
                };
            });
        }

        function normalizeOptionDefaultOrders() {
            optionTypesDraft.forEach((definition) => {
                const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
                const defaultForAdd = (definition.defaultForAdd || []).filter((target) => appliesTo.includes(target));
                if (defaultForAdd.length > 0) definition.defaultForAdd = [...new Set(defaultForAdd)];
                else delete definition.defaultForAdd;
            });
            optionAppliesToChoices.forEach((choice) => setOptionDefaultOrder(choice.value, getOrderedOptionDefaultIndexes(choice.value)));
        }

        function renderOptionDefaultsDraft() {
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

        function openOptionTypesModal() {
            optionTypesPreviousFocus = document.activeElement;
            optionTypesDraft = Array.from(optionDefinitions.values()).map((definition) => ({
                ...definition,
                _originalName: definition.name,
                _originalAppliesTo: [...(definition.appliesTo || [])],
                values: [...(definition.values || [])],
                ...(definition.defaultForAdd ? { defaultForAdd: [...definition.defaultForAdd] } : {}),
                ...(definition.defaultOrder ? { defaultOrder: { ...definition.defaultOrder } } : {})
            }));
            optionTypesRemovedDefinitions = new Map();
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
            const optionTypesToSave = optionTypesDraft.map(({ _originalName, _originalAppliesTo, ...definition }) => definition);
            const remainingNames = new Set(optionTypesToSave.map((definition) => definition.name.trim()));
            const removedDefinitions = Array.from(optionTypesRemovedDefinitions.values())
                .filter((definition) => !remainingNames.has(definition.name));
            const saveButton = document.getElementById('option-types-save');
            saveButton.disabled = true;
            setOptionTypesStatus();
            try {
                if (removedDefinitions.length > 0) {
                    const removedFromYaml = await applyPreviewEdit(
                        { type: 'option-types.remove', options: removedDefinitions },
                        `Removed deleted option type${removedDefinitions.length === 1 ? '' : 's'} from the loaded YAML.`
                    );
                    if (!removedFromYaml) throw new Error('Could not remove deleted option types from the loaded YAML');
                }
                const response = await fetch('/api/option-types', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ options: optionTypesToSave })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.error) {
                    throw new Error(getApiErrorMessage(data, response, 'Could not save option types'));
                }
                setOptionDefinitions(data.options);
                optionTypesRemovedDefinitions = new Map();
                if (previewEditDialogState) renderPreviewEditOptions();
                setSaveStatus(removedDefinitions.length > 0
                    ? `Option types saved. Removed matching YAML options; Save to write the pending YAML changes.`
                    : 'Option types saved.', removedDefinitions.length > 0 ? 'info' : 'success');
                closeOptionTypesModal();
            } catch (error) {
                setOptionTypesStatus(addErrorGuidance(error, 'Review the option type values and try again'));
            } finally {
                saveButton.disabled = false;
            }
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
            if (!previewEditDialogState) return;
            previewEditDialogState.fields = readPreviewOptionRows(document.getElementById('preview-edit-options'));
            normalizePreviewOptionStyles(previewEditDialogState.fields);
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
                    ? `<div class="preview-edit-nested-options" data-preview-nested-options>${renderRows(field.fields, path, field.key === 'widget' ? 'widget' : currentTarget)}<button type="button" class="preview-add-option" data-preview-option-add-child data-preview-option-path="${path}">+ Add ${escapeHtml(field.key || 'nested')} option</button></div>`
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
                return `<div class="preview-edit-option-row${field.fields ? ' has-nested-options' : ''}${field.commented ? ' preview-edit-option-row--commented' : ''}" data-preview-option-row data-preview-option-path="${path}" data-preview-option-locked="${field.locked ? 'true' : 'false'}" data-preview-option-commented="${field.commented ? 'true' : 'false'}" ${getDragItemAttributes('edit-option', null, index, parentPath)} data-preview-drop-kind="edit-option" data-preview-drop-index="${index}">
                ${keyControl}
                ${valueControl}
                <span class="preview-edit-actions preview-edit-option-actions">
                    <button type="button" class="preview-edit-action preview-edit-comment" data-preview-option-action="comment" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="${field.commented ? 'Uncomment' : 'Comment'} ${escapeHtml(field.key || 'option')}">#<span class="preview-control-label preview-edit-action-label" aria-hidden="true">${field.commented ? 'Uncomment' : 'Comment'} option</span></button>
                    <button type="button" class="preview-edit-action preview-edit-move-up" data-preview-option-action="up" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Move ${escapeHtml(field.key || 'option')} up"${index === 0 ? ' disabled' : ''}>&uarr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move option up</span></button>
                    <button type="button" class="preview-edit-action preview-edit-move-down" data-preview-option-action="down" data-preview-option-parent-path="${parentPath}" data-preview-option-index="${index}" aria-label="Move ${escapeHtml(field.key || 'option')} down"${index === fields.length - 1 ? ' disabled' : ''}>&darr;<span class="preview-control-label preview-edit-action-label" aria-hidden="true">Move option down</span></button>
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
            const visible = state?.action === 'service.edit' && (state.availableTabs || []).length > 0 && choices.length > 0;
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
            const visible = state?.action === 'group.edit' && tabs.length > 0;
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
            let entries;
            try {
                if (isNestedGroup) {
                    entries = findPreviewNestedGroup(source).entries;
                } else {
                    entries = findPreviewGroup(source).services;
                }
            } catch (error) {
                section.innerHTML = `<p class="preview-edit-note">${escapeHtml(error.message)}</p>`;
                return;
            }
            const nestedSubGroups = Array.isArray(entries) ? entries.filter(isNestedServiceGroup) : [];
            const hasNestedSubGroups = nestedSubGroups.length > 0;
            const settings = parseTabConfig('settings');
            const layout = settings.data && settings.data.layout && typeof settings.data.layout === 'object'
                ? settings.data.layout : {};
            const groupName = isNestedGroup ? source.nestedGroupPath[source.nestedGroupPath.length - 1].name : source.groupName;
            const layoutConfig = layout[groupName];
            const columnsDefault = getNestedGroupColumns(layoutConfig);
            if (!hasNestedSubGroups) {
                section.innerHTML = `
                    <button type="button" id="preview-edit-group-convert" class="preview-add-option preview-edit-group-convert-button">Convert into a nested group</button>
                    <p class="preview-edit-note">Wraps this group's services into a single nested sub-group named "1".</p>
                `;
            } else {
                section.innerHTML = `
                    <label for="preview-edit-group-nested-count">Nested sub-groups</label>
                    <div class="preview-edit-group-nested-row">
                        <input type="number" id="preview-edit-group-nested-count" class="modal-input" min="1" max="12" value="${columnsDefault}">
                        <button type="button" id="preview-edit-group-nested-apply" class="modal-button modal-button-secondary">Apply</button>
                    </div>
                    <p class="preview-edit-note">Renames sub-groups to 1..N and adjusts the count. Currently ${nestedSubGroups.length} sub-group${nestedSubGroups.length === 1 ? '' : 's'}; columns suggests ${columnsDefault}.</p>
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

            previewEditDialogState = { action, source, fields: [], availableTabs: [] };
            previewEditPreviousFocus = document.activeElement;
            previewEditPreviousFocusVisible = Boolean(previewEditPreviousFocus?.matches?.(':focus-visible'));
            modal.querySelector('.modal-content').classList.toggle('preview-edit-modal-wide', ['group.add', 'group.edit'].includes(action) || action.startsWith('service.') || action.startsWith('bookmark.'));
            nameInput.value = '';
            setPreviewEditModalStatus();

            const settingsForTabs = parseTabConfig('settings');
            if (!settingsForTabs.error) {
                previewEditDialogState.availableTabs = getHomepageTabInfo(settingsForTabs.data).tabs;
            }

            if (action === 'group.add') {
                title.textContent = 'Add service group';
                submit.textContent = 'Add group';
                previewEditDialogState.fields = getDefaultPreviewOptionFields('group', { availableTabs: previewEditDialogState.availableTabs });
            } else if (action === 'group.edit') {
                const isNestedGroup = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0;
                title.textContent = isNestedGroup ? 'Edit nested service group' : 'Edit service group';
                submit.textContent = 'Save';
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    nameInput.value = parsed ? parsed.name : source.groupName;
                    previewEditDialogState.fields = [];
                    previewEditDialogState.originalTab = '';
                    previewEditDialogState.isCommented = true;
                } else {
                    const group = isNestedGroup ? findPreviewNestedGroup(source) : findPreviewGroup(source);
                    const settings = parseTabConfig('settings');
                    if (settings.error) throw new Error('Fix the settings.yaml error shown on the dashboard before editing this group.');
                    const layout = settings.data && settings.data.layout && typeof settings.data.layout === 'object'
                        ? settings.data.layout : {};
                    nameInput.value = group.groupName;
                    previewEditDialogState.availableTabs = getHomepageTabInfo(settings.data).tabs;
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
                    previewEditDialogState.originalTab = String(groupLayout?.tab || '').trim();
                    const groupFields = getPreviewOptionFields(groupLayout);
                    previewEditDialogState.groupTabFieldIndex = groupFields.findIndex((field) => field.key === 'tab');
                    previewEditDialogState.fields = previewEditDialogState.availableTabs.length > 0
                        ? groupFields.filter((field) => field.key !== 'tab')
                        : groupFields;
                }
            } else if (action === 'service.add') {
                const targetGroupName = Array.isArray(source.nestedGroupPath) && source.nestedGroupPath.length > 0
                    ? source.nestedGroupPath[source.nestedGroupPath.length - 1].name
                    : source.groupName;
                title.textContent = `Add service to ${targetGroupName}`;
                submit.textContent = 'Add service';
                previewEditDialogState.fields = getDefaultPreviewOptionFields('service');
            } else if (action === 'service.edit') {
                let serviceName;
                let serviceData;
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    serviceName = parsed ? parsed.name : source.serviceName;
                    serviceData = parsed ? parsed.data : {};
                    previewEditDialogState.isCommented = true;
                } else {
                    const service = findPreviewService(source);
                    serviceName = service.serviceName;
                    serviceData = service.data;
                }
                const groupMoveData = getServiceGroupMoveChoices(source);
                title.textContent = 'Edit service';
                submit.textContent = 'Save';
                nameInput.value = serviceName;
                previewEditDialogState.fields = getPreviewOptionFields(serviceData, { commented: source.commented === true });
                if (source.commented !== true) {
                    previewEditDialogState.fields = appendCommentedSubOptions(source, previewEditDialogState.fields);
                }
                previewEditDialogState.availableTabs = groupMoveData.tabs;
                previewEditDialogState.serviceGroupChoices = groupMoveData.choices;
            } else if (action === 'bookmark-group.add') {
                title.textContent = 'Add bookmark group';
                submit.textContent = 'Add group';
            } else if (action === 'bookmark-group.edit') {
                title.textContent = 'Edit bookmark group';
                submit.textContent = 'Save';
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    nameInput.value = parsed ? parsed.name : source.groupName;
                    previewEditDialogState.isCommented = true;
                } else {
                    const group = findPreviewBookmarkGroup(source);
                    nameInput.value = group.groupName;
                }
            } else if (action === 'bookmark.add') {
                title.textContent = `Add bookmark to ${source.groupName}`;
                submit.textContent = 'Add bookmark';
                previewEditDialogState.fields = getDefaultPreviewOptionFields('bookmark');
            } else if (action === 'bookmark.edit') {
                let bookmarkName;
                let bookmarkData;
                if (source.commented === true) {
                    const parsed = parseCommentedBlockData(source);
                    bookmarkName = parsed ? parsed.name : source.bookmarkName;
                    bookmarkData = parsed ? parsed.data : {};
                    previewEditDialogState.isCommented = true;
                } else {
                    const bookmark = findPreviewBookmark(source);
                    bookmarkName = bookmark.bookmarkName;
                    bookmarkData = bookmark.data;
                }
                title.textContent = 'Edit bookmark';
                submit.textContent = 'Save';
                nameInput.value = bookmarkName;
                previewEditDialogState.fields = getPreviewOptionFields(bookmarkData, { commented: source.commented === true });
                if (source.commented !== true) {
                    previewEditDialogState.fields = appendCommentedSubOptions(source, previewEditDialogState.fields);
                }
            } else if (action === 'widget.edit') {
                title.textContent = 'Edit widget';
                submit.textContent = 'Save';
                const parsed = parseCommentedBlockData(source);
                nameInput.value = parsed ? parsed.name : source.name;
                previewEditDialogState.fields = getPreviewOptionFields(parsed ? parsed.data : {}, { commented: source.commented === true });
                if (source.commented === true) previewEditDialogState.isCommented = true;
                if (source.commented !== true) {
                    previewEditDialogState.fields = appendCommentedSubOptions(source, previewEditDialogState.fields);
                }
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
            previewEditDialogState = null;
            setPreviewEditModalStatus();
            if (previewEditPreviousFocusVisible && previewEditPreviousFocus && typeof previewEditPreviousFocus.focus === 'function') {
                previewEditPreviousFocus.focus();
            } else if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
            previewEditPreviousFocus = null;
            previewEditPreviousFocusVisible = false;
        }

        function findPreviewTabButton(tabName) {
            if (!tabName) return null;
            return Array.from(document.querySelectorAll('.preview-tab-strip .preview-tab-btn[data-preview-tab]'))
                .find((button) => button.getAttribute('data-preview-tab') === tabName) || null;
        }

        function enterTabRenameMode(tabName) {
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

            pendingInlineRenameBackup = button.cloneNode(true);
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

        async function exitTabRenameMode(save) {
            const input = document.querySelector('[data-preview-tab-rename-input]');
            if (!input) return;
            const originalName = input.getAttribute('data-preview-tab');
            const backup = pendingInlineRenameBackup;
            pendingInlineRenameBackup = null;

            if (!save) {
                if (backup) input.replaceWith(backup);
                return;
            }

            const newName = input.value.trim();
            if (!newName) {
                pendingInlineRenameBackup = backup;
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
                previewHomepageTab = newName;
            }
            const applied = await applyPreviewEdit(
                { type: 'tab.rename', target: { name: originalName }, values: { name: newName } },
                `Renamed tab ${originalName} to ${newName}.`
            );
            if (applied) {
                // The strip is rebuilt by updateVisualPreview() (called via replacePreviewEditedFiles),
                // which already reflects the new name. No further action needed.
                return;
            }

            if (wasActive) {
                previewHomepageTab = originalName;
            }
            // The strip was not rebuilt on failure; restore the source button and re-enter rename mode.
            if (backup) input.replaceWith(backup);
            enterTabRenameMode(originalName);
        }

        function getTabEditControls(source) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('tab.edit', source, 'Rename tab', '&#9998;')}
                ${getPreviewEditActionButton('tab.add', source, 'Add tab to the right', '+')}
                ${getPreviewEditActionButton('tab.remove', source, 'Remove tab', '&times;', { danger: true })}
            </span>`;
        }

        function buildInlineAddTabGroupOptions() {
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

        function setInlineAddTabStatus(message) {
            const statusElement = document.getElementById('preview-add-tab-status');
            if (!statusElement) return;
            statusElement.textContent = message || '';
            statusElement.hidden = !message;
        }

        function initInlineAddTabModal() {
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

        function openInlineAddTabPanel(openedByButton, afterTab) {
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
            previewTabAddAnchor = openedByButton || null;
            previewTabAddAfterTab = afterTab || null;
            previewTabAddInFlight = false;
            previewAddTabModal.hidden = false;
            nameInput.focus();
        }

        function closeInlineAddTabPanel({ restoreFocus } = {}) {
            const anchor = previewTabAddAnchor;
            previewAddTabModal.hidden = true;
            previewTabAddAnchor = null;
            previewTabAddAfterTab = null;
            previewTabAddInFlight = false;
            pendingInlineRenameTab = null;
            if (restoreFocus !== false && anchor && document.body.contains(anchor) && anchor.offsetParent !== null && typeof anchor.focus === 'function') {
                anchor.focus();
            } else if (restoreFocus !== false) {
                const visualPreview = document.getElementById('visual-preview');
                if (visualPreview) {
                    visualPreview.tabIndex = -1;
                    visualPreview.focus();
                    visualPreview.removeAttribute('tabindex');
                }
            }
        }

        async function submitInlineAddTab() {
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
            previewTabAddInFlight = true;
            submitButton.disabled = true;
            pendingInlineRenameTab = name;
            const applied = await applyPreviewEdit({
                type: 'tab.add',
                values: { name, groupName, createGroup, afterTab: previewTabAddAfterTab }
            }, createGroup ? `Added tab ${name} with group ${groupName}.` : `Added tab ${name}.`);
            if (applied) {
                // updateVisualPreview() runs inside applyPreviewEdit's success path; the
                // pendingInlineRenameTab hook at the end of updateVisualPreview will enter
                // inline rename mode for the new tab. Close the modal without stealing focus.
                closeInlineAddTabPanel({ restoreFocus: false });
            } else {
                previewTabAddInFlight = false;
                submitButton.disabled = false;
                pendingInlineRenameTab = null;
                setInlineAddTabStatus('Could not add the tab. See the application notification for the reason.');
            }
        }

        initInlineAddTabModal();

        function replacePreviewEditedFiles(files) {
            applyingPreviewFiles = true;
            try {
                for (const tabName of configTabNames) {
                    if (typeof files?.[tabName] === 'string') loadedFiles[tabName] = files[tabName];
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
                    loadedFiles[currentTab] = getEditorValue();
                }
            } finally {
                applyingPreviewFiles = false;
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
                const response = await fetch('/api/yaml/transform', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: beforeFiles, operation })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.error) {
                    throw new Error(getApiErrorMessage(data, response, 'Could not apply the edit'));
                }
                previewUndoState = { files: beforeFiles, message: successMessage };
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
                previewEditDialogState.fields = previewEditDialogState.fields.filter((field) => field.key.trim() !== 'tab');
                if (selectedGroupTab) {
                    const insertionIndex = previewEditDialogState.groupTabFieldIndex >= 0
                        ? Math.min(previewEditDialogState.groupTabFieldIndex, previewEditDialogState.fields.length)
                        : previewEditDialogState.fields.length;
                    previewEditDialogState.fields.splice(insertionIndex, 0, {
                        key: 'tab',
                        value: selectedGroupTab,
                        locked: true
                    });
                }
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
            const message = action === 'group.add'
                ? `Added group ${name}.`
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
            previewUndoState = null;
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

        async function requestDirectoryLoad(dirPath) {
            const response = await fetch('/api/directory/load', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ dirPath })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                throw new Error(getApiErrorMessage(data, response, 'Could not load the configuration directory'));
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
                setDirectoryModalStatus(`Could not load the directory. ${addErrorGuidance(error, 'Check the path and permissions, then try again')}`);
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
                setSaveStatus(`Could not reload the directory. ${addErrorGuidance(error, 'Check the path and permissions, then try again')}`, 'error');
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
        document.getElementById('preview-edit-group-nested').addEventListener('click', async function(event) {
            const convertButton = event.target.closest('#preview-edit-group-convert');
            const convertBackButton = event.target.closest('#preview-edit-group-convert-back');
            const applyButton = event.target.closest('#preview-edit-group-nested-apply');
            if (!convertButton && !convertBackButton && !applyButton) return;
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
                if (applied) renderPreviewEditGroupNested();
                return;
            }
            if (applyButton) {
                const countInput = document.getElementById('preview-edit-group-nested-count');
                const count = Math.max(1, Math.min(12, Number(countInput && countInput.value) || 1));
                applyButton.disabled = true;
                const applied = await applyPreviewEdit(
                    { type: 'group.set-nested-count', target: state.source, values: { count } },
                    `Updated nested sub-groups to ${count}.`
                );
                applyButton.disabled = false;
                if (applied) renderPreviewEditGroupNested();
            }
        });
        document.getElementById('preview-edit-add-option').addEventListener('click', () => {
            syncPreviewEditOptionState();
            previewEditDialogState.hasAddedOption = true;
            previewEditDialogState.fields.push({ key: '', value: '', locked: false, commented: previewEditDialogState.isCommented === true });
            renderPreviewEditOptions();
            document.querySelector('[data-preview-option-row]:last-child [data-preview-option-key]')?.focus();
        });
        document.getElementById('preview-edit-options').addEventListener('input', () => {
            syncPreviewEditOptionState();
            updatePreviewEditTabWarning();
        });
        document.getElementById('preview-edit-options').addEventListener('change', function(event) {
            if (!event.target.matches('[data-preview-option-key], [data-preview-option-value], [data-preview-option-value] input[type="radio"]')) return;
            const optionRow = event.target.closest('[data-preview-option-row]');
            const optionPath = optionRow && optionRow.getAttribute('data-preview-option-path');
            syncPreviewEditOptionState();
            updatePreviewEditTabWarning();
            if (event.target.matches('[data-preview-option-key]') || ['true', 'false'].includes(event.target.value.trim())) {
                if (event.target.matches('[data-preview-option-key]') && optionPath !== null) {
                    const selectedField = getPreviewEditFieldAtPath(optionPath);
                    if (selectedField?.key === 'widget' && Array.isArray(selectedField.fields) && selectedField.fields.length === 0) {
                        selectedField.fields = getDefaultPreviewOptionFields('widget');
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
                previewEditDialogState.hasAddedOption = true;
                field.fields.push({ key: '', value: '', locked: false, commented: field.commented === true });
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
            } else if (action === 'comment') {
                fields[index].commented = !fields[index].commented;
            } else {
                const destination = index + (action === 'up' ? -1 : 1);
                if (destination < 0 || destination >= fields.length) return;
                const [field] = fields.splice(index, 1);
                fields.splice(destination, 0, field);
            }
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
            optionTypesDraft.push({ name: '', type: 'text', appliesTo: ['service', 'group', 'bookmark', 'widget'], _originalName: '', _originalAppliesTo: [], values: [], rows: 2 });
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
                if (index >= 0 && destination >= 0 && destination < optionTypesDraft.length) {
                    const [definition] = optionTypesDraft.splice(index, 1);
                    optionTypesDraft.splice(destination, 0, definition);
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
                optionTypesRemovedDefinitions.set(removedDefinition._originalName, {
                    name: removedDefinition._originalName,
                    appliesTo: [...removedDefinition._originalAppliesTo]
                });
            }
            optionTypesDraft.splice(removeIndex, 1);
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
                const definition = optionTypesDraft[definitionIndex];
                definition.defaultForAdd = [...new Set([...(definition.defaultForAdd || []), target])];
                setOptionDefaultOrder(target, [...getOrderedOptionDefaultIndexes(target), definitionIndex]);
            } else {
                const definitionIndex = Number(actionButton.getAttribute('data-option-default-index'));
                const orderedIndexes = getOrderedOptionDefaultIndexes(target);
                const currentOrder = orderedIndexes.indexOf(definitionIndex);
                if (currentOrder < 0) return;
                if (action === 'remove') {
                    const definition = optionTypesDraft[definitionIndex];
                    definition.defaultForAdd = (definition.defaultForAdd || []).filter((value) => value !== target);
                    if (definition.defaultForAdd.length === 0) delete definition.defaultForAdd;
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

        function isNestedServiceGroup(item) {
            const name = Object.keys(item || {})[0];
            return Boolean(name && Array.isArray(item[name]));
        }

        function getNestedGroupColumns(layoutConfig) {
            return Math.max(1, Math.min(8, Number.parseInt(layoutConfig && layoutConfig.columns, 10) || 2));
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
            return `<img class="dashboard-icon" src="${escapeHtml(iconUrl)}" alt="" title="${escapeHtml(label || '')}" loading="lazy" referrerpolicy="no-referrer">`;
        }

        function getSafeLinkUrl(value) {
            const rawValue = String(value || '').trim();
            if (!rawValue) return '#';
            try {
                const url = new URL(rawValue, window.location.origin);
                return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
            } catch {
                return '#';
            }
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

        function findGroupRangeFromLine(lines, startLine) {
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

        function findYamlGroupRange(tabName, groupName, occurrenceIndex = 0) {
            const lines = getYamlLines(tabName);
            const groupLine = findNthYamlListKeyLine(tabName, groupName, occurrenceIndex, { indent: 0 });
            const range = findGroupRangeFromLine(lines, groupLine);
            return { startLine: range.startLine, endLine: range.endLine };
        }

        function findNestedGroupPathRange(tabName, source) {
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

        function findBlockLineRange(source) {
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

        function getSourceAttributes(source) {
            return `data-source="${escapeHtml(JSON.stringify(source))}"`;
        }

        function getDragItemAttributes(kind, source, index, scope = '') {
            return `draggable="true" data-preview-drag-item data-preview-drag-kind="${escapeHtml(kind)}" data-preview-drag-index="${index}" data-preview-drag-scope="${escapeHtml(scope)}" data-preview-drag-source="${escapeHtml(JSON.stringify(source || {}))}"`;
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
                lines.push(entryName);
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
            const actionClass = (action.endsWith('.edit') || action.endsWith('.add'))
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

        function getGroupEditControls(source, position, groupCount) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('group.edit', source, 'Edit group', '&#9998;')}
                ${getPreviewEditActionButton('group.comment', source, 'Comment/uncomment group', '#')}
                ${getPreviewEditActionButton('group.move-up', source, 'Move group up', '&uarr;', { disabled: position === 0 })}
                ${getPreviewEditActionButton('group.move-down', source, 'Move group down', '&darr;', { disabled: position === groupCount - 1 })}
                ${getPreviewEditActionButton('group.remove', source, 'Delete group', '&times;', { danger: true })}
            </span>`;
        }

        function getServiceEditControls(source, position, serviceCount) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('service.edit', source, 'Edit service', '&#9998;')}
                ${getPreviewEditActionButton('service.comment', source, 'Comment/uncomment service', '#')}
                ${getPreviewEditActionButton('service.duplicate', source, 'Duplicate service', '&#10697;')}
                ${getPreviewEditActionButton('service.move-up', source, 'Move service up', '&uarr;', { disabled: position === 0 })}
                ${getPreviewEditActionButton('service.move-down', source, 'Move service down', '&darr;', { disabled: position === serviceCount - 1 })}
                ${getPreviewEditActionButton('service.remove', source, 'Delete service', '&times;', { danger: true })}
            </span>`;
        }

        function getBookmarkGroupEditControls(source, position, groupCount) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('bookmark-group.edit', source, 'Edit bookmark group', '&#9998;')}
                ${getPreviewEditActionButton('bookmark-group.comment', source, 'Comment/uncomment bookmark group', '#')}
                ${getPreviewEditActionButton('bookmark-group.move-up', source, 'Move bookmark group up', '&uarr;', { disabled: position === 0 })}
                ${getPreviewEditActionButton('bookmark-group.move-down', source, 'Move bookmark group down', '&darr;', { disabled: position === groupCount - 1 })}
                ${getPreviewEditActionButton('bookmark-group.remove', source, 'Delete bookmark group', '&times;', { danger: true })}
            </span>`;
        }

        function getBookmarkEditControls(source, position, bookmarkCount) {
            return `<span class="preview-edit-actions">
                ${getPreviewEditActionButton('bookmark.edit', source, 'Edit bookmark', '&#9998;')}
                ${getPreviewEditActionButton('bookmark.comment', source, 'Comment/uncomment bookmark', '#')}
                ${getPreviewEditActionButton('bookmark.move-up', source, 'Move bookmark up', '&uarr;', { disabled: position === 0 })}
                ${getPreviewEditActionButton('bookmark.move-down', source, 'Move bookmark down', '&darr;', { disabled: position === bookmarkCount - 1 })}
                ${getPreviewEditActionButton('bookmark.remove', source, 'Delete bookmark', '&times;', { danger: true })}
            </span>`;
        }

        // --- Commented-item detection for Preview ---

        function extractCommentedLines(yamlText) {
            if (!yamlText || typeof yamlText !== 'string') return [];
            const lines = yamlText.split('\n');
            const blocks = [];
            let i = 0;

            while (i < lines.length) {
                const line = lines[i];
                // Match commented-out YAML list item: optional ws, #, optional space, dash, space, name, colon
                let match = line.match(/^(\s*)#\s*(-\s+\S[\S\s]*?:)\s*$/);
                // Also match commented-out mapping keys (non-list widgets): # key:
                if (!match) {
                    const mapMatch = line.match(/^(\s*)#\s*(\S[\S\s]*?:)\s*$/);
                    if (mapMatch) {
                        const contentAfterHash = line.slice(line.indexOf('#') + 1).trimStart();
                        if (!contentAfterHash.startsWith('- ')) {
                            match = mapMatch;
                        }
                    }
                }

                if (match) {
                    const indent = match[1].length;
                    const blockStart = i;
                    const isListItem = /^\s*#\s*-\s+\S/.test(line);
                    const uncommentedLines = [match[1] + match[2]];
                    i++;

                    // Collect continuation lines (commented lines at same or deeper indent)
                    while (i < lines.length) {
                        const next = lines[i];
                        const hashPos = next.indexOf('#');
                        if (hashPos < 0 || hashPos < indent) break;
                        // Stop at a sibling commented list item at the same base indent
                        if (i > blockStart && hashPos === indent) {
                            const afterHash = next.slice(hashPos + 1);
                            const stripped = afterHash.startsWith(' ') ? afterHash.slice(1) : afterHash;
                            if (stripped.startsWith('- ')) break;
                        }
                        // Strip '# ' (hash + at most one space), preserve the rest
                        const beforeHash = next.slice(0, hashPos);
                        let afterHash = next.slice(hashPos + 1);
                        if (afterHash.startsWith(' ')) afterHash = afterHash.slice(1);
                        uncommentedLines.push(beforeHash + afterHash);
                        i++;
                    }

                    // Try to parse the uncommented block as valid YAML
                    try {
                        const blockText = uncommentedLines.join('\n');
                        const parsed = jsyaml.load(blockText);
                        if (parsed !== null && parsed !== undefined && parsed !== '') {
                        blocks.push({
                            parsed,
                            startLine: blockStart,
                            endLine: i - 1,
                            indent,
                            isListItem
                        });
                        }
                    } catch (e) {
                        // Not a structured YAML entry; skip (filters header notes)
                    }
                } else {
                    i++;
                }
            }

            return blocks;
        }

        function buildCommentedServicesData(yamlText, activeServices) {
            const blocks = extractCommentedLines(yamlText);
            if (blocks.length === 0) return { groups: [], servicesMap: new Map(), nestedServicesMap: new Map() };

            // Index active groups by occurrence
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
                        // Commented-out top-level group
                        const groupEntry = {};
                        const innerData = entry[entryName];
                        if (Array.isArray(innerData)) {
                            // Mark services inside commented group as commented (deep)
                            groupEntry[entryName] = markDeepCommented(innerData);
                        } else {
                            groupEntry[entryName] = innerData;
                        }
                        groupEntry.__commented = true;
                        groupEntry.__commentedStartLine = block.startLine;
                        groupEntry.__commentedEndLine = block.endLine;
                        commentedGroups.push(groupEntry);
                    } else if (block.indent > 0) {
                        // Build full enclosing path from YAML indentation
                        const lines = yamlText.split('\n');
                        const ancestors = [];
                        let currentIndent = block.indent;
                        for (let j = block.startLine - 1; j >= 0; j--) {
                            const m = lines[j].match(/^(\s*)-\s+(\S.*?):\s*$/);
                            if (m && m[1].length < currentIndent && m[2].trim()) {
                                ancestors.unshift({ name: m[2].trim(), indent: m[1].length, line: j });
                                currentIndent = m[1].length;
                                if (m[1].length === 0) break;
                            }
                        }
                        if (ancestors.length === 0) return;

                        const topParent = ancestors[0];
                        const parentName = ancestors[ancestors.length - 1].name;

                        // Count top-level group occurrence
                        let parentOccurrence = 0;
                        for (let j = block.startLine - 1; j >= 0; j--) {
                            const m = lines[j].match(/^(\s*)-\s+(\S.*?):\s*$/);
                            if (m && m[1].length === 0 && m[2].trim() === topParent.name) {
                                parentOccurrence++;
                            }
                        }

                        const lineInfo = { __commentedStartLine: block.startLine, __commentedEndLine: block.endLine };
                        const innerValue = entry[entryName];
                        const isNestedGroup = Array.isArray(innerValue);

                        if (ancestors.length === 1) {
                            // Direct child of a top-level group (existing behavior)
                            const matchedIdx = activeGroupInfo.findIndex((gi) => gi.name === parentName && gi.idx === parentOccurrence - 1);
                            if (matchedIdx >= 0) {
                                if (!commentedServicesMap.has(matchedIdx)) {
                                    commentedServicesMap.set(matchedIdx, []);
                                }
                                const commentedEntry = isNestedGroup
                                    ? { [entryName]: markDeepCommented(innerValue), __commented: true, ...lineInfo }
                                    : { [entryName]: entry[entryName], __commented: true, ...lineInfo };
                                commentedServicesMap.get(matchedIdx).push(commentedEntry);
                            } else {
                                // Parent is a commented-out group — add service there
                                const parentGroup = commentedGroups.find((g) => Object.keys(g)[0] === parentName);
                                if (parentGroup) {
                                    const parentEntries = parentGroup[parentName];
                                    if (!Array.isArray(parentEntries)) {
                                        parentGroup[parentName] = [];
                                    }
                                    const commentedEntry = isNestedGroup
                                        ? { [entryName]: markDeepCommented(innerValue), __commented: true, ...lineInfo }
                                        : { [entryName]: entry[entryName], __commented: true, ...lineInfo };
                                    parentGroup[parentName].push(commentedEntry);
                                }
                            }
                        } else {
                            // Nested group child — store by top-level group index + nested path
                            const matchedIdx = activeGroupInfo.findIndex((gi) => gi.name === topParent.name && gi.idx === parentOccurrence - 1);
                            if (matchedIdx >= 0) {
                                // Build nested path with occurrence indexes for each step,
                                // scoped to the parent's line range
                                const nestedPath = [];
                                for (let p = 1; p < ancestors.length; p++) {
                                    const stepName = ancestors[p].name;
                                    const parentLine = ancestors[p - 1].line;
                                    let stepOccurrence = 0;
                                    for (let q = parentLine; q <= block.startLine; q++) {
                                        const m2 = lines[q].match(/^(\s*)-\s+(\S.*?):\s*$/);
                                        if (m2 && m2[1].length === ancestors[p].indent && m2[2].trim() === stepName) {
                                            stepOccurrence++;
                                        }
                                    }
                                    nestedPath.push({ name: stepName, index: stepOccurrence - 1 });
                                }
                                const key = `${matchedIdx}:${nestedPath.map((s) => `${s.name}[${s.index}]`).join('/')}`;
                                if (!nestedServicesMap.has(key)) {
                                    nestedServicesMap.set(key, []);
                                }
                                const commentedEntry = isNestedGroup
                                    ? { [entryName]: markDeepCommented(innerValue), __commented: true, ...lineInfo }
                                    : { [entryName]: entry[entryName], __commented: true, ...lineInfo };
                                nestedServicesMap.get(key).push(commentedEntry);
                            } else {
                                // Parent chain includes a commented-out group — add to commentedGroups
                                const parentGroup = commentedGroups.find((g) => Object.keys(g)[0] === topParent.name);
                                if (parentGroup) {
                                    const parentEntries = parentGroup[topParent.name];
                                    if (!Array.isArray(parentEntries)) {
                                        parentGroup[topParent.name] = [];
                                    }
                                    const commentedEntry = isNestedGroup
                                        ? { [entryName]: markDeepCommented(innerValue), __commented: true, ...lineInfo }
                                        : { [entryName]: entry[entryName], __commented: true, ...lineInfo };
                                    parentGroup[topParent.name].push(commentedEntry);
                                }
                            }
                        }
                    }
            });

            return { groups: commentedGroups, servicesMap: commentedServicesMap, nestedServicesMap };
        }

        function buildCommentedWidgetsData(yamlText) {
            const blocks = extractCommentedLines(yamlText);
            if (blocks.length === 0) return [];

            const result = [];
            blocks.forEach((block) => {
                if (block.indent !== 0) return;
                const entry = Array.isArray(block.parsed) ? block.parsed[0] : block.parsed;
                if (!entry || typeof entry !== 'object') return;
                const name = Object.keys(entry)[0];
                if (!name) return;
                const widgetEntry = { [name]: entry[name], __commented: true, __commentedStartLine: block.startLine, __commentedEndLine: block.endLine };
                result.push(widgetEntry);
            });
            return result;
        }

        function updateVisualPreview() {
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
                const commentedServicesData = buildCommentedServicesData(servicesYamlText, services);
                const serviceGroupPositions = getGroupPositions(servicesYamlText);
                // Merge commented services into their active groups in YAML order
                commentedServicesData.servicesMap.forEach((commentEntries, groupIdx) => {
                    try {
                        const group = services[groupIdx];
                        if (!group) return;
                        const groupName = Object.keys(group)[0];
                        if (!groupName) return;
                        if (!Array.isArray(group[groupName])) {
                            group[groupName] = [];
                        }
                        const groupPos = serviceGroupPositions[groupIdx];
                        if (!groupPos) return;
                        group[groupName] = mergeGroupEntries(group[groupName], commentEntries, groupPos.startLine, servicesYamlText);
                    } catch (groupErr) {
                        console.error('[showComments] mergeGroupEntries failed for services group', groupIdx, groupErr);
                        // Fallback: append commented entries at the end of the group
                        const group = services[groupIdx];
                        if (group) {
                            const groupName = Object.keys(group)[0];
                            if (groupName && Array.isArray(group[groupName])) {
                                group[groupName] = group[groupName].concat(commentEntries);
                            }
                        }
                    }
                });
                // Merge commented entries into nested groups
                commentedServicesData.nestedServicesMap.forEach((commentEntries, key) => {
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
                // Merge commented groups into the services list in YAML order
                try {
                    services = mergeGroupsByLine(services, commentedServicesData.groups, servicesYamlText);
                } catch (mergeErr) {
                    console.error('[showComments] mergeGroupsByLine failed for services:', mergeErr);
                    // Fallback: append commented groups at the end
                    services = services.concat(commentedServicesData.groups);
                }
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
                const serviceOccurrenceCounter = new Map();
                return servicesOnly.map(({ entry: service, entryIndex }, servicePosition) => {
                    const name = Object.keys(service || {})[0] || 'Service';
                    const isCommented = service.__commented === true;
                    const serviceOccurrenceIndex = isCommented ? 0 : takeOccurrence(serviceOccurrenceCounter, name);
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
                        ? `Nested service in ${nestedGroupPath.map((step) => step.name).join(' \u203a ')}`
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
                        ? `${getDragItemAttributes('service', directSource.servicesSource, entryIndex)} data-preview-drop-kind="service" data-preview-drop-index="${entryIndex}" data-preview-service-drop-source="${escapeHtml(JSON.stringify(dropSource))}"`
                        : '';
                    return `<div class="dashboard-card preview-jump-target${isCommented ? ' dashboard-card--commented' : ''}" ${serviceDragAttributes} ${getSourceAttributes(directSource)} ${serviceTooltip}>${serviceEditControls}<div class="dashboard-card-heading">${serviceIcon}<div class="dashboard-card-title">${escapeHtml(name)}</div></div><div class="dashboard-card-desc">${escapeHtml(data.description || '')}</div></div>`;
                }).join('');
            }

            function buildNestedGroupSource(groupName, groupIndex, nestedName, nestedGroupPath) {
                const servicesSource = {
                    tab: 'services',
                    kind: 'services-group',
                    groupName,
                    groupIndex,
                    nestedGroupPath
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
                    const nestedGroupSource = buildNestedGroupSource(groupName, groupIndex, nestedName, nestedGroupPath);
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
                        ? `<div class="dashboard-cards"${previewEditMode ? ` data-preview-service-drop-zone data-preview-service-drop-index="${Array.isArray(nestedEntries) ? nestedEntries.length : 0}" data-preview-service-drop-source="${escapeHtml(JSON.stringify(dropSource))}"` : ''}>${nestedCards}${addServiceButton}</div>`
                        : '';
                    const isCollapsed = isInitiallyCollapsed(nestedLayout);
                    const nestedGroupClass = 'dashboard-nested-group' + (nestedIsCommented ? ' dashboard-nested-group--commented' : '');
                    return `<details class="${nestedGroupClass}" ${getPreviewLayoutAttributes(nestedLayout)} ${isCollapsed ? '' : 'open'}><summary class="dashboard-nested-group-title">${nestedIcon}<span class="preview-jump-target" ${getSourceAttributes(nestedGroupSource)} ${nestedGroupTooltip}>${escapeHtml(nestedName)}</span>${nestedGroupEditControls}</summary>${serviceCardsGrid}${nestedChildren}</details>`;
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
                    ? `<div class="dashboard-cards"${previewEditMode ? ` data-preview-service-drop-zone data-preview-service-drop-index="${Array.isArray(entries) ? entries.length : 0}" data-preview-service-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"` : ''}>${cards}${addServiceButton}</div>`
                    : '';
                const groupPosition = groupPositionByItem.get(group) || 0;
                const groupDragAttributes = previewEditMode
                    ? `${getDragItemAttributes('group', serviceGroupSource, groupPosition)} data-preview-drop-kind="group" data-preview-drop-index="${groupPosition}" data-preview-service-drop data-preview-service-drop-index="${Array.isArray(entries) ? entries.length : 0}" data-preview-service-drop-source="${escapeHtml(JSON.stringify({ groupName, groupIndex }))}"`
                    : '';
                const groupClass = 'dashboard-group' + (groupIsCommented ? ' dashboard-group--commented' : '');
                if (hasNestedGroups) {
                    groupsHtml += `<section class="${groupClass} dashboard-group-nested-root" ${groupDragAttributes}${getPreviewLayoutAttributes(layoutConfig)}><div class="dashboard-group-title">${groupIcon}<span class="preview-jump-target" ${getSourceAttributes(groupSource)} ${groupTooltip}>${escapeHtml(groupName || 'Services')}</span>${groupEditControls}</div>${serviceCardsGrid}<div class="dashboard-nested-groups" data-preview-nested-columns="${getNestedGroupColumns(layoutConfig)}">${nestedGroups}</div></section>`;
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
                return `<span class="widget-block preview-jump-target${isCommented ? ' widget-block--commented' : ''}" ${getSourceAttributes(widgetSource)} ${widgetTooltip}>${escapeHtml(name)}${widgetEditButton}${widgetCommentButton}${widgetRemoveButton}</span>`;
            }).join('');

            const previewTabsHtml = homepageTabs.length > 0 || previewEditMode
                ? `<div class="preview-tab-navigation">
                    <span class="preview-tab-label">Tabs</span>
                    <div class="preview-tab-strip" role="tablist" aria-label="Homepage dashboard pages">${homepageTabs.map((name, index) => {
                        const isActive = name === previewHomepageTab;
                        const tabSource = { tab: 'settings', kind: 'settings-tab', name };
                        const dragAttributes = previewEditMode ? getDragItemAttributes('tab', tabSource, index) : '';
                        const dropAttributes = previewEditMode ? ` data-preview-drop-kind="tab" data-preview-drop-index="${index}"` : '';
                        const editControls = previewEditMode ? getTabEditControls(tabSource) : '';
                        return `<span class="preview-tab" ${dragAttributes}${dropAttributes}>
                            <button type="button" role="tab" aria-selected="${isActive}" tabindex="${isActive ? '0' : '-1'}" class="preview-tab-btn ${isActive ? 'active' : ''}" data-preview-tab="${escapeHtml(name)}" ${getSourceAttributes(tabSource)}>${escapeHtml(name)}</button>
                            ${editControls}
                        </span>`;
                    }).join('')}</div>
                </div>`
                : '';

            const addGroupButton = previewEditMode
                ? '<button type="button" class="preview-add-button preview-add-group" data-preview-action="group.add"><span aria-hidden="true">+</span> Add service group</button>'
                : '';
            previewDiv.innerHTML = `
                <div class="dashboard-shell ${previewEditMode ? 'preview-edit-enabled' : ''}">
                    ${errorItems ? `<div class="dashboard-errors">${errorItems}</div>` : ''}
                    ${previewTabsHtml}
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
                        pendingInlineRenameTab = null;
                    }
                });
            }

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
        let settingsTabOrderDraft = [...configTabNames];
        let savedAppSettings = {
            theme: document.body.classList.contains('light-mode') ? 'light' : 'dark',
            customPageTitle: '',
            liveHomepageUrl: '',
            autoIndent: autoIndentToggle.checked,
            previewAutoRefresh: previewAutoRefreshToggle.checked,
            editorVisible: editorVisibilityToggle.checked,
            interactiveEditor: previewEditToggle.checked,
            visibleTabs: [...configTabNames],
            tabOrder: [...configTabNames]
        };
        function normalizeConfigTabOrder(tabOrder) {
            const requestedOrder = Array.isArray(tabOrder) ? tabOrder : [];
            const knownTabs = requestedOrder.filter((tabName, index) => (
                configTabNames.includes(tabName) && requestedOrder.indexOf(tabName) === index
            ));
            return [...knownTabs, ...configTabNames.filter((tabName) => !knownTabs.includes(tabName))];
        }
        function normalizeVisibleConfigTabs(visibleTabs, tabOrder) {
            const requestedTabs = Array.isArray(visibleTabs) ? visibleTabs : [];
            const normalizedTabs = tabOrder.filter((tabName) => requestedTabs.includes(tabName));
            return normalizedTabs.length > 0 ? normalizedTabs : [...tabOrder];
        }
        function normalizeLiveHomepageUrl(value) {
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
        function applyLiveHomepageLink(url) {
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
        function getFirstVisibleConfigTab() {
            return savedAppSettings.tabOrder.find((tabName) => savedAppSettings.visibleTabs.includes(tabName)) || 'services';
        }
        function applyConfigTabNavigation() {
            const tabContainer = document.querySelector('.config-tabs');
            const visibleTabs = new Set(savedAppSettings.visibleTabs);
            savedAppSettings.tabOrder.forEach((tabName) => {
                const tab = tabContainer.querySelector(`.tab[data-tab="${tabName}"]`);
                if (!tab) return;
                tab.hidden = !visibleTabs.has(tabName);
                tabContainer.append(tab);
            });
            if (!visibleTabs.has(currentTab) && Object.keys(loadedFiles).length > 0) {
                switchTab(getFirstVisibleConfigTab(), null);
            }
        }
        function getSettingsTabDraftFromControls() {
            const rows = document.querySelectorAll('#settings-yaml-tabs [data-settings-tab]');
            const tabOrder = Array.from(rows, (row) => row.getAttribute('data-settings-tab'));
            const visibleTabs = Array.from(rows)
                .filter((row) => row.querySelector('[data-settings-tab-visible]').checked)
                .map((row) => row.getAttribute('data-settings-tab'));
            return {
                tabOrder: normalizeConfigTabOrder(tabOrder),
                visibleTabs: normalizeVisibleConfigTabs(visibleTabs, normalizeConfigTabOrder(tabOrder))
            };
        }
        function renderSettingsTabControls() {
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
        function moveSettingsTab(tabName, direction) {
            const draft = getSettingsTabDraftFromControls();
            const currentIndex = draft.tabOrder.indexOf(tabName);
            const destination = currentIndex + (direction === 'up' ? -1 : 1);
            if (currentIndex === -1 || destination < 0 || destination >= draft.tabOrder.length) return;
            [draft.tabOrder[currentIndex], draft.tabOrder[destination]] = [draft.tabOrder[destination], draft.tabOrder[currentIndex]];
            settingsTabOrderDraft = draft;
            renderSettingsTabControls();
        }
        function getPersistentAppSettings() {
            return { ...savedAppSettings };
        }
        async function loadPersistentAppSettings() {
            const response = await fetch('/api/app-settings', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                throw new Error(getApiErrorMessage(data, response, 'Could not load editor settings'));
            }
            return data.settings || {};
        }
        function applyPersistentAppSettings(settings) {
            savedAppSettings = {
                theme: settings.theme === 'light' ? 'light' : 'dark',
                customPageTitle: typeof settings.customPageTitle === 'string' ? settings.customPageTitle.trim() : '',
                liveHomepageUrl: normalizeLiveHomepageUrl(settings.liveHomepageUrl),
                autoIndent: settings.autoIndent !== false,
                previewAutoRefresh: settings.previewAutoRefresh !== false,
                editorVisible: settings.editorVisible !== false,
                interactiveEditor: settings.interactiveEditor === true,
                showComments: settings.showComments === true,
                tabOrder: normalizeConfigTabOrder(settings.tabOrder),
                visibleTabs: normalizeVisibleConfigTabs(settings.visibleTabs, normalizeConfigTabOrder(settings.tabOrder))
            };
            applyConfigTabNavigation();
            const pageTitle = savedAppSettings.customPageTitle || defaultPageTitle;
            document.title = pageTitle;
            document.getElementById('app-title').textContent = pageTitle;
            applyTheme(savedAppSettings.theme !== 'light');
            applyLiveHomepageLink(savedAppSettings.liveHomepageUrl);
            autoIndentToggle.checked = savedAppSettings.autoIndent;
            previewAutoRefreshToggle.checked = savedAppSettings.previewAutoRefresh;
            editorVisibilityToggle.checked = savedAppSettings.editorVisible;
            previewEditToggle.checked = savedAppSettings.interactiveEditor;
            previewShowCommentsState = savedAppSettings.showComments;
            const commentsToggle = document.getElementById('preview-comments-toggle');
            if (commentsToggle) commentsToggle.checked = savedAppSettings.showComments;
            const commentsLabel = document.getElementById('preview-comments-label');
            if (commentsLabel) commentsLabel.textContent = savedAppSettings.showComments ? 'Hide comments' : 'Show comments';
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
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok || data.error) {
                        throw new Error(getApiErrorMessage(data, response, 'Could not save editor settings'));
                    }
                })
                .then(() => true)
                .catch((error) => {
                    console.warn('Could not save persistent app settings', error);
                    return { ok: false, error };
                });
            return pendingAppSettingsSave;
        }
        const settingsTabNames = ['misc', 'appearance', 'yaml'];
        let settingsActiveTab = 'misc';
        let settingsModalPreviousFocus = null;
        function activateSettingsTab(tabName, { focus = false } = {}) {
            const activeTabName = settingsTabNames.includes(tabName) ? tabName : settingsTabNames[0];
            settingsActiveTab = activeTabName;
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
        function handleSettingsTabKeydown(event) {
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
        function openSettingsModal() {
            const modal = document.getElementById('settings-modal');
            settingsModalPreviousFocus = document.activeElement;
            const settings = getPersistentAppSettings();
            document.querySelector(`input[name="settings-theme"][value="${settings.theme}"]`).checked = true;
            document.getElementById('settings-custom-page-title').value = settings.customPageTitle;
            document.getElementById('settings-live-homepage-url').value = settings.liveHomepageUrl || '';
            document.getElementById('settings-auto-indent').checked = settings.autoIndent;
            document.getElementById('settings-preview-auto-refresh').checked = settings.previewAutoRefresh;
            document.getElementById('settings-editor-visible').checked = settings.editorVisible;
            document.getElementById('settings-interactive-editor').checked = settings.interactiveEditor;
            document.getElementById('settings-show-comments').checked = settings.showComments === true;
            settingsTabOrderDraft = { tabOrder: [...settings.tabOrder], visibleTabs: [...settings.visibleTabs] };
            renderSettingsTabControls();
            activateSettingsTab(settingsActiveTab);
            modal.hidden = false;
            modal.querySelector('.modal-content').scrollTop = 0;
            window.requestAnimationFrame(() => document.querySelector('#settings-tab-list [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }));
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
            const tabSettings = getSettingsTabDraftFromControls();
            applyPersistentAppSettings({
                theme,
                customPageTitle: document.getElementById('settings-custom-page-title').value,
                liveHomepageUrl: document.getElementById('settings-live-homepage-url').value,
                autoIndent: document.getElementById('settings-auto-indent').checked,
                previewAutoRefresh: document.getElementById('settings-preview-auto-refresh').checked,
                editorVisible: document.getElementById('settings-editor-visible').checked,
                interactiveEditor: document.getElementById('settings-interactive-editor').checked,
                showComments: document.getElementById('settings-show-comments').checked,
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
        function syncPreviewEditModePresentation(isEnabled) {
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
        function updatePreviewEditMode() {
            const isEnabled = previewEditToggle.checked && !previewEditToggle.disabled;
            syncPreviewEditModePresentation(isEnabled);
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
        document.getElementById('preview-comments-toggle').addEventListener('change', function() {
            previewShowCommentsState = this.checked;
            document.getElementById('preview-comments-label').textContent = this.checked ? 'Hide comments' : 'Show comments';
            updatePreview({ force: true });
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
            settingsTabOrderDraft = getSettingsTabDraftFromControls();
            renderSettingsTabControls();
        });
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

        function clearPreviewDropIndicators() {
            document.querySelectorAll('.preview-drag-over, .preview-drop-before, .preview-drop-after, .preview-drop-inside, .preview-drop-left, .preview-drop-right').forEach((element) => {
                element.classList.remove('preview-drag-over', 'preview-drop-before', 'preview-drop-after', 'preview-drop-inside', 'preview-drop-left', 'preview-drop-right');
            });
            document.querySelectorAll('.preview-main-drop-indicator').forEach((element) => element.remove());
        }

        function ensurePreviewMainDropIndicator(vertical) {
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

        function clearPreviewDragState() {
            document.querySelectorAll('.preview-dragging').forEach((element) => {
                element.classList.remove('preview-dragging');
            });
            clearPreviewDropIndicators();
            activePreviewDrag = null;
        }

        function isSamePreviewDropCollection(drag, destinationTarget) {
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

        async function applyPreviewDrop(drag, destinationIndex, destinationTarget = null) {
            const sameCollection = isSamePreviewDropCollection(drag, destinationTarget);
            const adjustedDestinationIndex = sameCollection && drag.index < destinationIndex
                ? destinationIndex - 1
                : destinationIndex;
            if (drag.kind === 'option-type') {
                if (drag.index === adjustedDestinationIndex) return;
                readOptionTypesDraft();
                const [item] = optionTypesDraft.splice(drag.index, 1);
                optionTypesDraft.splice(adjustedDestinationIndex, 0, item);
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
                const fields = drag.scope
                    ? drag.scope.split('.').reduce((collection, pathIndex) => collection[Number(pathIndex)].fields, previewEditDialogState.fields)
                    : previewEditDialogState.fields;
                const [item] = fields.splice(drag.index, 1);
                fields.splice(adjustedDestinationIndex, 0, item);
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

        function getPreviewDropTarget(eventTarget, drag, event) {
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

        function getPreviewDropDetails(target, drag, event, forcedPosition = null) {
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
            const verticalLine = drag.kind === 'service' && target.classList.contains('dashboard-card');
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
            return {
                destinationIndex: Number(target.dataset.previewDropIndex) + (after ? 1 : 0),
                destinationTarget,
                position: after ? 'after' : 'before',
                verticalLine
            };
        }

        function showPreviewDropIndicator(target, details, drag) {
            clearPreviewDropIndicators();
            target.classList.add('preview-drag-over');
            if (['service', 'bookmark', 'group', 'bookmark-group'].includes(drag.kind)) {
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

        document.addEventListener('dragstart', function(event) {
            const item = event.target.closest('[data-preview-drag-item]');
            if (!item) return;
            if (item && event.target.closest('.preview-edit-actions, input, select, textarea, [data-preview-tab-rename-input]')) {
                event.preventDefault();
                return;
            }
            activePreviewDrag = {
                kind: item.dataset.previewDragKind,
                index: Number(item.dataset.previewDragIndex),
                scope: item.dataset.previewDragScope || '',
                source: JSON.parse(item.getAttribute('data-preview-drag-source') || '{}')
            };
            item.classList.add('preview-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', activePreviewDrag.kind);
        });
        document.addEventListener('dragover', function(event) {
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
        });
        document.addEventListener('drop', function(event) {
            if (!activePreviewDrag) return;
            const dropTarget = getPreviewDropTarget(event.target, activePreviewDrag, event);
            const target = dropTarget?.element;
            const canCrossGroups = ['service', 'bookmark'].includes(activePreviewDrag.kind);
            const matchesKind = canCrossGroups
                ? Boolean(target)
                : target?.dataset.previewDropKind === activePreviewDrag.kind;
            if (!matchesKind || (!canCrossGroups && (target.dataset.previewDragScope || '') !== activePreviewDrag.scope)) return;
            event.preventDefault();
            const drag = activePreviewDrag;
            const { destinationIndex, destinationTarget } = getPreviewDropDetails(target, drag, event, dropTarget.position);
            clearPreviewDragState();
            applyPreviewDrop(drag, destinationIndex, destinationTarget).catch((error) => {
                setSaveStatus(`Could not reorder the item: ${addErrorGuidance(error, 'Try the move again')}`, 'error');
            });
        });
        document.addEventListener('dragend', clearPreviewDragState);

        yamlCodeEditor.on('change', function(editor, change) {
            if (!applyingPreviewFiles && previewUndoState && change.origin !== 'setValue') {
                previewUndoState = null;
                updatePreviewUndoButton();
            }
            clearSaveStatus();
            updateUnsavedIndicators();
            scheduleVisualPreview();
        });

        function updateTabToolbarPosition(tabEl) {
            const strip = tabEl.closest('.preview-tab-strip');
            if (!strip) return;
            const myTop = tabEl.offsetTop;
            const peers = strip.querySelectorAll('.preview-tab');
            const hasRowBelow = Array.from(peers).some((p) => p.offsetTop > myTop + 1);
            tabEl.setAttribute('data-toolbar-side', hasRowBelow ? 'up' : 'down');
        }

        const previewDiv = document.getElementById('visual-preview');
        previewDiv.addEventListener('mouseover', function(event) {
            const tab = event.target.closest('.preview-tab');
            if (tab && this.contains(tab)) updateTabToolbarPosition(tab);
        });
        previewDiv.addEventListener('focusin', function(event) {
            const tab = event.target.closest('.preview-tab');
            if (tab && this.contains(tab)) updateTabToolbarPosition(tab);
        });

        document.getElementById('visual-preview').addEventListener('click', function(event) {
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
                previewHomepageTab = target.getAttribute('data-preview-tab');
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

        // Expose for browser tests
        window.__applyCommentedPreviewEdit = applyCommentedPreviewEdit;
