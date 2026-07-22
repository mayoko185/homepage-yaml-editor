// Chunk-tree parser/serializer for Homepage YAML documents.
// Treats comments as first-class chunks so structural edits never lose them.

(function (global) {
    'use strict';

    function getYamlIndent(line) {
        const match = String(line || '').match(/^\s*/);
        return match ? match[0].length : 0;
    }

    function getEffectiveIndent(line) {
        const str = String(line || '');
        const commented = str.match(/^(\s*)#\s?(.*)/);
        if (commented) {
            const content = commented[2];
            const contentIndent = content.match(/^\s*/)[0].length;
            return commented[1].length + contentIndent;
        }
        return getYamlIndent(str);
    }

    function getYamlKeyFromLine(line) {
        const trimmed = String(line || '').trim();
        const withoutListMarker = trimmed.startsWith('- ') ? trimmed.slice(2).trimStart() : trimmed;
        const match = withoutListMarker.match(/^(['"]?)(.*?)\1\s*:/);
        return match ? match[2] : null;
    }

    function isCommentedListItem(line) {
        return /^\s*#\s*-\s+\S/.test(line);
    }

    function isActiveListItem(line) {
        return /^\s*-\s+\S/.test(line);
    }

    function isBlankLine(line) {
        return line.trim() === '';
    }

    // ── Generic line chunking ──

    function chunkLines(lines, startIndex, baseIndent, isEntryLine) {
        const rawLines = [];
        let i = startIndex;
        while (i < lines.length) {
            const line = lines[i];
            if (isBlankLine(line)) {
                rawLines.push(line);
                i++;
                continue;
            }
            const indent = getEffectiveIndent(line);
            if (i > startIndex && indent <= baseIndent && isEntryLine(line)) {
                break;
            }
            rawLines.push(line);
            i++;
        }
        return { rawLines, endIndex: i };
    }

    // ── Services parser ──

    function parseServicesDocument(yamlText) {
        if (!yamlText || typeof yamlText !== 'string') return [];
        const lines = yamlText.split('\n');
        const chunks = [];
        let i = 0;
        const isTopLevelEntry = (l) => getYamlIndent(l) === 0 && (isActiveListItem(l) || isCommentedListItem(l));

        while (i < lines.length) {
            const line = lines[i];
            if (isBlankLine(line)) {
                i++;
                continue;
            }
            const indent = getYamlIndent(line);
            if (indent !== 0) {
                // Stray indented line at top level — treat as orphan comment
                const orphan = chunkLines(lines, i, 0, (l) => getYamlIndent(l) === 0);
                chunks.push({ kind: 'comment', rawLines: orphan.rawLines });
                i = orphan.endIndex;
                continue;
            }

            if (isCommentedListItem(line)) {
                // Commented group
                const groupChunk = chunkLines(lines, i, 0, isTopLevelEntry);
                const name = getYamlKeyFromLine(line.replace(/^\s*#\s*/, ''));
                chunks.push({
                    kind: 'commented-group',
                    name: name || '',
                    rawLines: groupChunk.rawLines,
                    entries: parseGroupEntries(groupChunk.rawLines, 0)
                });
                i = groupChunk.endIndex;
                continue;
            }

            if (isActiveListItem(line)) {
                // Active group
                const groupChunk = chunkLines(lines, i, 0, isTopLevelEntry);
                const name = getYamlKeyFromLine(line);
                const entries = parseGroupEntries(groupChunk.rawLines, 0);
                // Try to parse data for the group itself (not entries)
                let data = {};
                try {
                    const cleanText = groupChunk.rawLines.map((l) => l.replace(/^\s*#/, '')).join('\n');
                    const parsed = jsyaml.load(cleanText);
                    if (parsed && typeof parsed === 'object' && name && parsed[name]) {
                        data = parsed[name];
                    }
                } catch (e) { /* ignore parse errors */ }

                chunks.push({
                    kind: 'group',
                    name: name || '',
                    rawLines: groupChunk.rawLines,
                    entries,
                    data
                });
                i = groupChunk.endIndex;
                continue;
            }

            // Top-level comment line
            const commentChunk = chunkLines(lines, i, 0, isTopLevelEntry);
            chunks.push({ kind: 'comment', rawLines: commentChunk.rawLines });
            i = commentChunk.endIndex;
        }

        return chunks;
    }

    function isNestedGroupEntry(entry) {
        return entry && Array.isArray(entry.data);
    }

    function parseGroupEntries(groupRawLines, groupBaseIndent) {
        const entries = [];
        const lines = groupRawLines;
        let i = 1; // skip group header line
        let pendingBlanks = [];

        // Find entry indent (typically groupBaseIndent + 4)
        let entryIndent = null;
        for (let j = 1; j < lines.length; j++) {
            const line = lines[j];
            if (isBlankLine(line)) continue;
            const indent = getEffectiveIndent(line);
            if (indent > groupBaseIndent && (isActiveListItem(line) || isCommentedListItem(line))) {
                entryIndent = indent;
                break;
            }
        }
        if (entryIndent === null) return entries;

        while (i < lines.length) {
            const line = lines[i];
            if (isBlankLine(line)) {
                pendingBlanks.push(line);
                i++;
                continue;
            }
            const indent = getEffectiveIndent(line);

            if (indent === entryIndent && isCommentedListItem(line)) {
                const entryChunk = chunkLines(lines, i, entryIndent, (l) => {
                    const ind = getEffectiveIndent(l);
                    return (ind === entryIndent && (isActiveListItem(l) || isCommentedListItem(l)))
                        || (ind <= entryIndent && l.trim().startsWith('#') && !isCommentedListItem(l) && !isActiveListItem(l));
                });
                const name = getYamlKeyFromLine(line.replace(/^\s*#\s*/, ''));
                let data = null;
                try {
                    const cleanText = entryChunk.rawLines.map((l) => l.replace(/^\s*#\s?/, '')).join('\n');
                    const parsed = jsyaml.load(cleanText);
                    if (parsed && typeof parsed === 'object' && name && parsed[name]) {
                        data = parsed[name];
                    }
                } catch (e) { /* ignore */ }
                entryChunk.rawLines.unshift(...pendingBlanks);
                pendingBlanks = [];
                // A commented list item whose cleaned data is an array is a commented nested-group
                // header.
                const kind = data && Array.isArray(data) ? 'commented-nested-group' : 'commented-service';
                entries.push({
                    kind,
                    name: name || '',
                    rawLines: entryChunk.rawLines,
                    data
                });
                i = entryChunk.endIndex;
                continue;
            }

            if (indent === entryIndent && isActiveListItem(line)) {
                const entryChunk = chunkLines(lines, i, entryIndent, (l) => {
                    const ind = getEffectiveIndent(l);
                    return (ind === entryIndent && (isActiveListItem(l) || isCommentedListItem(l)))
                        || (ind <= entryIndent && l.trim().startsWith('#') && !isCommentedListItem(l) && !isActiveListItem(l));
                });
                const name = getYamlKeyFromLine(line);
                let data = {};
                try {
                    const cleanText = entryChunk.rawLines.join('\n');
                    const parsed = jsyaml.load(cleanText);
                    if (parsed && typeof parsed === 'object' && name && parsed[name]) {
                        data = parsed[name];
                    }
                } catch (e) { /* ignore */ }
                entryChunk.rawLines.unshift(...pendingBlanks);
                pendingBlanks = [];
                entries.push({
                    kind: data && Array.isArray(data) ? 'nested-group' : 'service',
                    name: name || '',
                    rawLines: entryChunk.rawLines,
                    data
                });
                i = entryChunk.endIndex;
                continue;
            }

            // Intra-group comment at entry indent
            if (indent === entryIndent && line.trim().startsWith('#')) {
                const commentChunk = chunkLines(lines, i, entryIndent, (l) => {
                    const ind = getEffectiveIndent(l);
                    return (ind === entryIndent && (isActiveListItem(l) || isCommentedListItem(l)))
                        || (ind <= entryIndent && l.trim().startsWith('#') && !isCommentedListItem(l) && !isActiveListItem(l));
                });
                commentChunk.rawLines.unshift(...pendingBlanks);
                pendingBlanks = [];
                entries.push({ kind: 'comment', rawLines: commentChunk.rawLines });
                i = commentChunk.endIndex;
                continue;
            }

            // Standalone comment at or above entry indent (e.g. separator line)
            if (indent <= entryIndent && line.trim().startsWith('#') && !isCommentedListItem(line) && !isActiveListItem(line)) {
                const commentChunk = chunkLines(lines, i, entryIndent, (l) => {
                    const ind = getEffectiveIndent(l);
                    return (ind === entryIndent && (isActiveListItem(l) || isCommentedListItem(l)))
                        || (ind <= entryIndent && l.trim().startsWith('#') && !isCommentedListItem(l) && !isActiveListItem(l));
                });
                commentChunk.rawLines.unshift(...pendingBlanks);
                pendingBlanks = [];
                entries.push({ kind: 'comment', rawLines: commentChunk.rawLines });
                i = commentChunk.endIndex;
                continue;
            }

            i++;
        }

        // Append trailing blank lines to the last entry so they are not lost
        if (pendingBlanks.length > 0 && entries.length > 0) {
            entries[entries.length - 1].rawLines.push(...pendingBlanks);
        }

        return entries;
    }

    // ── Bookmarks parser ──

    function parseBookmarksDocument(yamlText) {
        // Bookmarks have identical top-level structure to services
        return parseServicesDocument(yamlText);
    }

    // ── Widgets parser ──

    function parseWidgetsDocument(yamlText) {
        if (!yamlText || typeof yamlText !== 'string') return [];
        const lines = yamlText.split('\n');
        const chunks = [];
        const isTopLevelEntry = (l) => getYamlIndent(l) === 0 && (isActiveListItem(l) || isCommentedListItem(l));
        const isTopLevelMapping = (l) => getYamlIndent(l) === 0 && !isBlankLine(l) && !isActiveListItem(l) && !isCommentedListItem(l) && l.trim().startsWith('#');

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (isBlankLine(line)) {
                i++;
                continue;
            }
            const indent = getYamlIndent(line);
            if (indent !== 0) {
                const orphan = chunkLines(lines, i, 0, (l) => getYamlIndent(l) === 0);
                chunks.push({ kind: 'comment', rawLines: orphan.rawLines });
                i = orphan.endIndex;
                continue;
            }

            if (isCommentedListItem(line)) {
                const chunk = chunkLines(lines, i, 0, isTopLevelEntry);
                const name = getYamlKeyFromLine(line.replace(/^\s*#\s*/, ''));
                let data = null;
                try {
                    const cleanText = chunk.rawLines.map((l) => l.replace(/^\s*#/, '')).join('\n');
                    const parsed = jsyaml.load(cleanText);
                    if (parsed && typeof parsed === 'object' && name) {
                        data = parsed[name];
                    }
                } catch (e) { /* ignore */ }
                chunks.push({ kind: 'commented-widget', name: name || '', rawLines: chunk.rawLines, data });
                i = chunk.endIndex;
                continue;
            }

            if (isActiveListItem(line)) {
                const chunk = chunkLines(lines, i, 0, isTopLevelEntry);
                const name = getYamlKeyFromLine(line);
                let data = null;
                try {
                    const parsed = jsyaml.load(chunk.rawLines.join('\n'));
                    if (parsed && typeof parsed === 'object' && name) {
                        data = parsed[name];
                    }
                } catch (e) { /* ignore */ }
                chunks.push({ kind: 'widget', name: name || '', rawLines: chunk.rawLines, data });
                i = chunk.endIndex;
                continue;
            }

            // Non-list commented mapping key (e.g. # resources:)
            if (line.trim().startsWith('#') && !line.trim().startsWith('# -')) {
                const uncommented = line.replace(/^\s*#\s*/, '');
                const name = getYamlKeyFromLine(uncommented);
                if (name) {
                    const chunk = chunkLines(lines, i, 0, (l) => getYamlIndent(l) === 0 && !isBlankLine(l));
                    let data = null;
                    try {
                        const cleanText = chunk.rawLines.map((l) => l.replace(/^\s*#/, '')).join('\n');
                        const parsed = jsyaml.load(cleanText);
                        if (parsed && typeof parsed === 'object' && name) {
                            data = parsed[name];
                        }
                    } catch (e) { /* ignore */ }
                    chunks.push({ kind: 'commented-widget', name: name || '', rawLines: chunk.rawLines, data });
                    i = chunk.endIndex;
                    continue;
                }
            }

            // Non-list active mapping key (e.g. resources:)
            if (!line.trim().startsWith('-') && !line.trim().startsWith('#')) {
                const name = getYamlKeyFromLine(line);
                if (name) {
                    const chunk = chunkLines(lines, i, 0, (l) => getYamlIndent(l) === 0 && !isBlankLine(l));
                    let data = null;
                    try {
                        const parsed = jsyaml.load(chunk.rawLines.join('\n'));
                        if (parsed && typeof parsed === 'object' && name) {
                            data = parsed[name];
                        }
                    } catch (e) { /* ignore */ }
                    chunks.push({ kind: 'widget', name: name || '', rawLines: chunk.rawLines, data });
                    i = chunk.endIndex;
                    continue;
                }
            }

            // Top-level comment
            const commentChunk = chunkLines(lines, i, 0, isTopLevelEntry);
            chunks.push({ kind: 'comment', rawLines: commentChunk.rawLines });
            i = commentChunk.endIndex;
        }

        return chunks;
    }

    // ── Serializers ──

    function serializeDocument(chunks) {
        const lines = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            lines.push(...chunk.rawLines);
        }
        return lines.join('\n');
    }

    // ── Structural operations ──

    function findChunkIndexByName(entries, name, occurrenceIndex) {
        let seen = 0;
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].name === name) {
                if (seen === occurrenceIndex) return i;
                seen++;
            }
        }
        return -1;
    }

    function rebuildGroupRawLines(group) {
        if (!group.entries) return;
        const header = group.rawLines[0];
        const newRawLines = [header];
        group.entries.forEach((entry) => {
            newRawLines.push(...entry.rawLines);
        });
        group.rawLines = newRawLines;
    }

    function reindentLines(lines, newBaseIndent) {
        if (lines.length === 0) return lines;
        // Find the first non-blank line to determine the old base indent
        let firstContentIdx = 0;
        while (firstContentIdx < lines.length && isBlankLine(lines[firstContentIdx])) {
            firstContentIdx++;
        }
        if (firstContentIdx >= lines.length) return lines;
        const oldBaseIndent = getEffectiveIndent(lines[firstContentIdx]);
        const delta = newBaseIndent - oldBaseIndent;
        if (delta === 0) return lines;
        return lines.map((line) => {
            if (isBlankLine(line)) return line;
            const currentIndent = getYamlIndent(line);
            const newIndent = Math.max(0, currentIndent + delta);
            return ' '.repeat(newIndent) + line.trimStart();
        });
    }

    function normalizeCommentedGroups(chunks) {
        for (const chunk of chunks) {
            if (chunk.kind === 'commented-group' || chunk.kind === 'commented-widget') {
                // Use the base indent of the first line (matching toggleComment behavior)
                const baseIndent = getYamlIndent(chunk.rawLines[0]);
                // Ensure every non-blank line in the chunk is commented
                chunk.rawLines = chunk.rawLines.map((line) => {
                    if (isBlankLine(line)) return line;
                    if (line.trim().startsWith('#')) return line;
                    return line.slice(0, baseIndent) + '# ' + line.slice(baseIndent);
                });
                if (chunk.entries) {
                    chunk.entries.forEach((entry) => {
                        normalizeCommentedEntry(entry);
                    });
                    rebuildGroupRawLines(chunk);
                }
            } else if (chunk.entries) {
                // Also normalize commented-nested-group entries inside active groups
                chunk.entries.forEach((entry) => {
                    if (entry.kind === 'commented-nested-group') {
                        normalizeCommentedEntry(entry);
                    } else if (entry.kind === 'commented-service' && Array.isArray(entry.data)) {
                        // A commented service whose parsed data is an array is actually a commented
                        // nested-group header with active descendants; reclassify and normalize it.
                        entry.kind = 'commented-nested-group';
                        normalizeCommentedEntry(entry);
                    }
                });
                rebuildGroupRawLines(chunk);
            }
        }
        return chunks;
    }

    function normalizeCommentedEntry(entry) {
        const entryBaseIndent = getYamlIndent(entry.rawLines[0]);
        entry.rawLines = entry.rawLines.map((line) => {
            if (isBlankLine(line)) return line;
            if (line.trim().startsWith('#')) return line;
            return line.slice(0, entryBaseIndent) + '# ' + line.slice(entryBaseIndent);
        });
        if (entry.kind === 'service') entry.kind = 'commented-service';
        else if (entry.kind === 'nested-group') entry.kind = 'commented-nested-group';
        else if (entry.kind === 'widget') entry.kind = 'commented-widget';
        // Recurse into nested group entries' raw lines
        if (entry.kind === 'commented-nested-group' && Array.isArray(entry.data)) {
            entry.data.forEach((nestedEntry) => {
                if (nestedEntry && typeof nestedEntry === 'object') {
                    nestedEntry.__commented = true;
                }
            });
        }
    }

    function moveEntry(entries, fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= entries.length) return false;
        if (toIndex < 0 || toIndex > entries.length) return false;
        const [item] = entries.splice(fromIndex, 1);
        entries.splice(toIndex, 0, item);
        return true;
    }

    function moveChunk(chunks, fromPath, toPath) {
        // fromPath/toPath: { groupName, groupIndex, entryName?, entryIndex? }
        // If entryName is present, move within group's entries.
        // Otherwise, move top-level group.
        if (!fromPath.entryName) {
            // Move group — reject commented group movement
            const fromIdx = findChunkIndexByName(chunks, fromPath.groupName, fromPath.groupIndex || 0);
            if (fromIdx < 0) return null;
            const fromChunk = chunks[fromIdx];
            if (fromChunk.kind === 'commented-group' || fromChunk.kind === 'commented-widget') return null;
            let toIdx;
            if (toPath.destinationIndex !== undefined) {
                toIdx = toPath.destinationIndex;
            } else if (toPath.direction === 'up') {
                toIdx = Math.max(0, fromIdx - 1);
            } else if (toPath.direction === 'down') {
                toIdx = fromIdx + 1;
            } else {
                toIdx = fromIdx;
            }
            const [chunk] = chunks.splice(fromIdx, 1);
            chunks.splice(toIdx, 0, chunk);
            return serializeDocument(chunks);
        }

        // Move entry within group or across groups
        const fromGroupIdx = findChunkIndexByName(chunks, fromPath.groupName, fromPath.groupIndex || 0);
        if (fromGroupIdx < 0) return null;
        const fromGroup = chunks[fromGroupIdx];
        if (!fromGroup.entries) return null;
        const fromEntryIdx = findChunkIndexByName(fromGroup.entries, fromPath.entryName, fromPath.entryIndex || 0);
        if (fromEntryIdx < 0) return null;

        const fromEntry = fromGroup.entries[fromEntryIdx];

        // Reject moves from commented groups or of commented entries
        if (fromGroup.kind === 'commented-group' || fromGroup.kind === 'commented-widget') return null;
        if (fromEntry.kind === 'commented-service' || fromEntry.kind === 'commented-nested-group' || fromEntry.kind === 'commented-widget') return null;

        const toGroupIdx = toPath.groupName
            ? findChunkIndexByName(chunks, toPath.groupName, toPath.groupIndex || 0)
            : fromGroupIdx;
        if (toGroupIdx < 0) return null;
        const toGroup = chunks[toGroupIdx];
        if (!toGroup.entries) return null;

        // Reject moves into commented groups
        if (toGroup.kind === 'commented-group' || toGroup.kind === 'commented-widget') return null;

        let toEntryIdx;
        if (toPath.destinationIndex !== undefined) {
            toEntryIdx = toPath.destinationIndex;
        } else if (toPath.direction === 'up') {
            toEntryIdx = Math.max(0, fromEntryIdx - 1);
        } else if (toPath.direction === 'down') {
            toEntryIdx = fromEntryIdx + 1;
        } else {
            toEntryIdx = fromEntryIdx;
        }

        const [entry] = fromGroup.entries.splice(fromEntryIdx, 1);

        rebuildGroupRawLines(fromGroup);

        // Reindent if crossing groups
        if (fromGroupIdx !== toGroupIdx) {
            const fromEntryIndent = getEffectiveIndent(fromGroup.rawLines[0]) + 4;
            const toEntryIndent = getEffectiveIndent(toGroup.rawLines[0]) + 4;
            entry.rawLines = reindentLines(entry.rawLines, toEntryIndent);
        }

        toGroup.entries.splice(toEntryIdx, 0, entry);
        rebuildGroupRawLines(toGroup);

        return serializeDocument(chunks);
    }

    function removeChunk(chunks, path) {
        if (!path.entryName) {
            const idx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
            if (idx < 0) return null;
            chunks.splice(idx, 1);
            return serializeDocument(chunks);
        }
        const groupIdx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
        if (groupIdx < 0) return null;
        const group = chunks[groupIdx];
        if (!group.entries) return null;
        const entryIdx = findChunkIndexByName(group.entries, path.entryName, path.entryIndex || 0);
        if (entryIdx < 0) return null;
        group.entries.splice(entryIdx, 1);
        rebuildGroupRawLines(group);
        return serializeDocument(chunks);
    }

    function duplicateChunk(chunks, path) {
        if (!path.entryName) {
            // Duplicate group
            const idx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
            if (idx < 0) return null;
            const chunk = chunks[idx];
            const cloned = JSON.parse(JSON.stringify(chunk));
            cloned.name = cloned.name + ' (cloned)';
            // Rename header in both rawLines and entries
            cloned.rawLines[0] = cloned.rawLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${cloned.name}:`);
            if (cloned.entries) {
                cloned.entries.forEach((e) => {
                    if (e.kind === 'service') {
                        e.kind = 'commented-service';
                        e.rawLines = toggleComment(e.rawLines);
                    } else if (e.kind === 'commented-service') {
                        // Already commented — just rename
                        e.rawLines[0] = e.rawLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${e.name}:`);
                    } else if (e.kind === 'nested-group') {
                        e.kind = 'commented-nested-group';
                        e.rawLines = toggleComment(e.rawLines);
                    } else if (e.kind === 'commented-nested-group') {
                        e.rawLines[0] = e.rawLines[0].replace(/(-\s+)(.+?):\s*$/, `$1${e.name}:`);
                    }
                });
                rebuildGroupRawLines(cloned);
            }
            chunks.splice(idx + 1, 0, cloned);
            return serializeDocument(chunks);
        }
        const groupIdx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
        if (groupIdx < 0) return null;
        const group = chunks[groupIdx];
        if (!group.entries) return null;
        const entryIdx = findChunkIndexByName(group.entries, path.entryName, path.entryIndex || 0);
        if (entryIdx < 0) return null;
        const entry = group.entries[entryIdx];
        const cloned = JSON.parse(JSON.stringify(entry));
        cloned.name = cloned.name + ' (cloned)';
        cloned.rawLines = cloned.rawLines.map((line, i) => {
            if (i === 0) {
                return line.replace(/(-\s+)(.+?):\s*$/, `$1${cloned.name}:`);
            }
            return line;
        });
        group.entries.splice(entryIdx + 1, 0, cloned);
        rebuildGroupRawLines(group);
        return serializeDocument(chunks);
    }

    // ── Edit operations ──

    function editServiceData(rawLines, newName, newData, { commentedKeys = [] } = {}) {
        // Serialize newData to YAML, indent properly, replace rawLines
        const baseIndent = getYamlIndent(rawLines[0]);
        const uncommentedFirstLine = rawLines[0].replace(/^\s*#\s?/, '');
        const isListItem = uncommentedFirstLine.trimStart().startsWith('- ');
        const entryIndent = baseIndent;
        const fieldIndent = isListItem ? entryIndent + 4 : entryIndent + 2;
        const lines = isListItem
            ? [' '.repeat(entryIndent) + '- ' + newName + ':']
            : [' '.repeat(entryIndent) + newName + ':'];
        const yamlText = jsyaml.dump(newData, { indent: 2, noRefs: true, lineWidth: -1 });
        const dumpedLines = yamlText.split('\n').filter((l) => l.trim() !== '');
        dumpedLines.forEach((l) => {
            lines.push(' '.repeat(fieldIndent) + l.trimStart());
        });

        // Apply per-field commenting for active items
        if (commentedKeys.length > 0) {
            const commentSet = new Set(commentedKeys);
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                const keyMatch = trimmed.match(/^(\S[\S\s]*?):/);
                if (keyMatch && commentSet.has(keyMatch[1])) {
                    const lineIndent = getYamlIndent(line);
                    lines[i] = line.slice(0, lineIndent) + '# ' + line.slice(lineIndent);
                    // Comment all following indented lines (nested block)
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextIndent = getYamlIndent(lines[j]);
                        if (nextIndent <= lineIndent) break;
                        lines[j] = lines[j].slice(0, nextIndent) + '# ' + lines[j].slice(nextIndent);
                    }
                }
            }
        }

        const isCommented = rawLines.every((l) => isBlankLine(l) || l.trim().startsWith('#'));
        if (isCommented) {
            return lines.map((l) => {
                if (isBlankLine(l)) return l;
                return l.slice(0, baseIndent) + '# ' + l.slice(baseIndent);
            });
        }
        return lines;
    }

    function editGroupName(rawLines, newName) {
        return rawLines.map((line, i) => {
            if (i === 0) {
                return line.replace(/^(\s*(?:#\s*)?(?:-\s+)?)(.+?):\s*$/, `$1${newName}:`);
            }
            return line;
        });
    }

    function editChunk(chunks, path, newName, newData, { commentedKeys = [] } = {}) {
        if (!path.entryName) {
            // Edit top-level chunk (group or widget)
            const idx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
            if (idx < 0) return null;
            const chunk = chunks[idx];
            chunk.name = newName;
            if (newData && typeof newData === 'object' && Object.keys(newData).length > 0) {
                // Full block replacement with new data (widget edit)
                chunk.rawLines = editServiceData(chunk.rawLines, newName, newData, { commentedKeys });
                chunk.data = newData;
            } else {
                // Rename only (group edit)
                chunk.rawLines = editGroupName(chunk.rawLines, newName);
            }
            return serializeDocument(chunks);
        }
        const groupIdx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
        if (groupIdx < 0) return null;
        const group = chunks[groupIdx];
        if (!group.entries) return null;
        const entryIdx = findChunkIndexByName(group.entries, path.entryName, path.entryIndex || 0);
        if (entryIdx < 0) return null;
        const entry = group.entries[entryIdx];
        entry.name = newName;
        entry.rawLines = editServiceData(entry.rawLines, newName, newData, { commentedKeys });
        entry.data = newData;
        rebuildGroupRawLines(group);
        return serializeDocument(chunks);
    }

    // ── Comment toggle ──

    function toggleComment(rawLines) {
        const isCommented = rawLines.every((l) => isBlankLine(l) || l.trim().startsWith('#'));
        if (isCommented) {
            // Uncomment: remove '# ' prefix
            return rawLines.map((l) => {
                if (isBlankLine(l)) return l;
                const trimmed = l.trimStart();
                if (trimmed.startsWith('# ')) {
                    return l.slice(0, l.indexOf('#')) + trimmed.slice(2);
                }
                if (trimmed.startsWith('#')) {
                    return l.slice(0, l.indexOf('#')) + trimmed.slice(1);
                }
                return l;
            });
        }
        // Comment: add '# ' prefix
        const baseIndent = getYamlIndent(rawLines[0]);
        return rawLines.map((l) => {
            if (isBlankLine(l)) return l;
            return l.slice(0, baseIndent) + '# ' + l.slice(baseIndent);
        });
    }

    function toggleChunkComment(chunks, path) {
        if (!path.entryName) {
            // Toggle top-level chunk (group or widget)
            const idx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
            if (idx < 0) return null;
            const chunk = chunks[idx];
            const wasCommented = chunk.kind === 'commented-group' || chunk.kind === 'commented-widget';
            // Toggle header line
            chunk.rawLines[0] = toggleComment([chunk.rawLines[0]])[0];
            if (chunk.entries) {
                chunk.entries.forEach((e) => {
                    e.rawLines = toggleComment(e.rawLines);
                    if (wasCommented) {
                        if (e.kind === 'commented-service') e.kind = 'service';
                        else if (e.kind === 'commented-widget') e.kind = 'widget';
                        else if (e.kind === 'commented-nested-group') e.kind = 'nested-group';
                    } else {
                        if (e.kind === 'service') e.kind = 'commented-service';
                        else if (e.kind === 'widget') e.kind = 'commented-widget';
                        else if (e.kind === 'nested-group') e.kind = 'commented-nested-group';
                    }
                });
                rebuildGroupRawLines(chunk);
            }
            if (chunk.kind === 'group' || chunk.kind === 'commented-group') {
                chunk.kind = wasCommented ? 'group' : 'commented-group';
            } else if (chunk.kind === 'widget' || chunk.kind === 'commented-widget') {
                chunk.kind = wasCommented ? 'widget' : 'commented-widget';
            }
            return serializeDocument(chunks);
        }
        const groupIdx = findChunkIndexByName(chunks, path.groupName, path.groupIndex || 0);
        if (groupIdx < 0) return null;
        const group = chunks[groupIdx];
        if (!group.entries) return null;
        const entryIdx = findChunkIndexByName(group.entries, path.entryName, path.entryIndex || 0);
        if (entryIdx < 0) return null;
        const entry = group.entries[entryIdx];
        entry.rawLines = toggleComment(entry.rawLines);
        if (entry.kind === 'commented-service') entry.kind = 'service';
        else if (entry.kind === 'service') entry.kind = 'commented-service';
        else if (entry.kind === 'commented-widget') entry.kind = 'widget';
        else if (entry.kind === 'widget') entry.kind = 'commented-widget';
        else if (entry.kind === 'commented-nested-group') entry.kind = 'nested-group';
        else if (entry.kind === 'nested-group') entry.kind = 'commented-nested-group';
        rebuildGroupRawLines(group);
        return serializeDocument(chunks);
    }

    // ── Export ──

    global.ChunkTree = {
        parseServicesDocument,
        parseBookmarksDocument,
        parseWidgetsDocument,
        serializeDocument,
        moveChunk,
        removeChunk,
        duplicateChunk,
        editChunk,
        toggleChunkComment,
        normalizeCommentedGroups,
        findChunkIndexByName,
        reindentLines,
        getYamlIndent,
        getYamlKeyFromLine
    };

})(typeof window !== 'undefined' ? window : global);
