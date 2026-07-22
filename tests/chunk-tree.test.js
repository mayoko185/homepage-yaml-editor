const assert = require('node:assert/strict');
const test = require('node:test');
const jsyaml = require('js-yaml');

// Load chunk-tree.js in Node environment
global.jsyaml = jsyaml;
require('../public/chunk-tree.js');
const { parseServicesDocument, parseBookmarksDocument, parseWidgetsDocument, serializeDocument } = ChunkTree;

const servicesWithComments = `# top comment
# - Commented Group:
#     - Commented Service:
#         href: /commented
- Group A:
    - Active One:
        href: /one
    # - Commented One:
    #     href: /commented
    - Active Two:
        href: /two
- Group B:
    - Service B:
        href: /b
`;

const bookmarksWithComments = `# top
- Dev:
    - GitHub:
        - abbr: GH
          href: https://github.com
    # - Commented Bookmark:
    #     href: /commented
- Social:
    - Reddit:
        - abbr: RE
          href: https://reddit.com
`;

const widgetsWithComments = `# top
# - Commented Widget:
#     type: customapi
- Search:
    provider: google
- Resources:
    cpu: true
`;

test('services round-trip preserves all comments', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const output = serializeDocument(chunks);
    assert.equal(output, servicesWithComments, 'services round-trip must be byte-for-byte identical');
});

test('bookmarks round-trip preserves all comments', () => {
    const chunks = parseBookmarksDocument(bookmarksWithComments);
    const output = serializeDocument(chunks);
    assert.equal(output, bookmarksWithComments, 'bookmarks round-trip must be byte-for-byte identical');
});

test('widgets round-trip preserves all comments', () => {
    const chunks = parseWidgetsDocument(widgetsWithComments);
    const output = serializeDocument(chunks);
    assert.equal(output, widgetsWithComments, 'widgets round-trip must be byte-for-byte identical');
});

test('services parser produces correct chunk kinds', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    assert.equal(chunks[0].kind, 'comment');
    assert.equal(chunks[1].kind, 'commented-group');
    assert.equal(chunks[1].name, 'Commented Group');
    assert.equal(chunks[2].kind, 'group');
    assert.equal(chunks[2].name, 'Group A');
    assert.equal(chunks[2].entries.length, 3);
    assert.equal(chunks[2].entries[0].kind, 'service');
    assert.equal(chunks[2].entries[0].name, 'Active One');
    assert.equal(chunks[2].entries[1].kind, 'commented-service');
    assert.equal(chunks[2].entries[1].name, 'Commented One');
    assert.equal(chunks[2].entries[2].kind, 'service');
    assert.equal(chunks[2].entries[2].name, 'Active Two');
});

// ── Move tests ──

test('services move up within group swaps with previous entry', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active Two',
        entryIndex: 0
    }, {
        groupName: 'Group A',
        groupIndex: 0,
        direction: 'up'
    });
    const lines = result.split('\n');
    const commentedIdx = lines.findIndex((l) => l.includes('# - Commented One:'));
    const activeTwoIdx = lines.findIndex((l) => l.includes('- Active Two:'));
    assert.ok(activeTwoIdx < commentedIdx, 'Active Two should appear before Commented One after move up');
    assert.ok(activeTwoIdx > lines.findIndex((l) => l.includes('- Active One:')), 'Active Two should still be after Active One');
});

test('services move down within group swaps with next entry', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    }, {
        groupName: 'Group A',
        groupIndex: 0,
        direction: 'down'
    });
    const lines = result.split('\n');
    const commentedIdx = lines.findIndex((l) => l.includes('# - Commented One:'));
    const activeOneIdx = lines.findIndex((l) => l.includes('- Active One:'));
    assert.ok(activeOneIdx > commentedIdx, 'Active One should appear after Commented One after move down');
    assert.ok(activeOneIdx < lines.findIndex((l) => l.includes('- Active Two:')), 'Active One should still be before Active Two');
});

test('services cross-group move preserves comments in source group', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    }, {
        groupName: 'Group B',
        groupIndex: 0,
        destinationIndex: 0
    });
    assert.ok(result.includes('# - Commented One:'), 'commented service must be preserved in source group');
    assert.ok(result.includes('#     href: /commented'), 'commented service field must be preserved');
});

test('services same-group drag-drop to end uses destinationIndex as insert position', () => {
    const input = `- Group:
    - A:
        href: /a
    - B:
        href: /b
    - C:
        href: /c
`;
    const chunks = parseServicesDocument(input);
    // Frontend already adjusts the visual destination for the removed item, so it passes destinationIndex=2
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group',
        groupIndex: 0,
        entryName: 'A',
        entryIndex: 0
    }, {
        groupName: 'Group',
        groupIndex: 0,
        destinationIndex: 2
    });
    const parsed = jsyaml.load(result);
    assert.deepEqual(parsed[0]['Group'].map((entry) => Object.keys(entry)[0]), ['B', 'C', 'A']);
});

test('services same-group drag-drop to middle uses destinationIndex as insert position', () => {
    const input = `- Group:
    - A:
        href: /a
    - B:
        href: /b
    - C:
        href: /c
`;
    const chunks = parseServicesDocument(input);
    // Dropping A after B: visual destinationIndex is 2, frontend adjusts to 1
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group',
        groupIndex: 0,
        entryName: 'A',
        entryIndex: 0
    }, {
        groupName: 'Group',
        groupIndex: 0,
        destinationIndex: 1
    });
    const parsed = jsyaml.load(result);
    assert.deepEqual(parsed[0]['Group'].map((entry) => Object.keys(entry)[0]), ['B', 'A', 'C']);
});

test('group move up swaps group order', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group B',
        groupIndex: 0
    }, {
        groupName: 'Group B',
        groupIndex: 0,
        direction: 'up'
    });
    const lines = result.split('\n');
    const groupAIdx = lines.findIndex((l) => l.includes('- Group A:'));
    const groupBIdx = lines.findIndex((l) => l.includes('- Group B:'));
    assert.ok(groupBIdx < groupAIdx, 'Group B should appear before Group A after move up');
});

test('group move down swaps group order', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0
    }, {
        groupName: 'Group A',
        groupIndex: 0,
        direction: 'down'
    });
    const lines = result.split('\n');
    const groupAIdx = lines.findIndex((l) => l.includes('- Group A:'));
    const groupBIdx = lines.findIndex((l) => l.includes('- Group B:'));
    assert.ok(groupAIdx > groupBIdx, 'Group A should appear after Group B after move down');
});

// ── Remove tests ──

test('services remove preserves adjacent comments', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.removeChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    });
    assert.ok(result.includes('# - Commented One:'), 'commented service must be preserved');
    assert.ok(result.includes('#     href: /commented'), 'commented service field must be preserved');
    assert.doesNotMatch(result, /^    - Active One:/m, 'Active One must be removed');
});

test('group remove preserves other groups and comments', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.removeChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0
    });
    assert.doesNotMatch(result, /^- Group A:/m, 'Group A must be removed');
    assert.ok(result.includes('- Group B:'), 'Group B must be preserved');
    assert.ok(result.includes('# - Commented Group:'), 'commented group must be preserved');
});

// ── Duplicate tests ──

test('service duplicate inserts cloned entry after original', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.duplicateChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    });
    const matches = result.match(/- Active One \(cloned\):/g);
    assert.equal(matches ? matches.length : 0, 1, 'cloned service must appear exactly once');
    const lines = result.split('\n');
    const originalIdx = lines.findIndex((l) => l.includes('- Active One:'));
    const clonedIdx = lines.findIndex((l) => l.includes('- Active One (cloned):'));
    assert.ok(clonedIdx > originalIdx, 'cloned service must appear after original');
});

test('group duplicate inserts cloned group after original', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.duplicateChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0
    });
    const matches = result.match(/- Group A \(cloned\):/g);
    assert.equal(matches ? matches.length : 0, 1, 'cloned group must appear exactly once');
    const lines = result.split('\n');
    const originalIdx = lines.findIndex((l) => l.includes('- Group A:'));
    const clonedIdx = lines.findIndex((l) => l.includes('- Group A (cloned):'));
    assert.ok(clonedIdx > originalIdx, 'cloned group must appear after original');
});

// ── Edit tests ──

test('service edit renames and updates data', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.editChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    }, 'Active One Renamed', { href: '/renamed', icon: 'renamed.png' });
    assert.ok(result.includes('- Active One Renamed:'), 'service must be renamed');
    assert.ok(result.includes('href: /renamed'), 'href must be updated');
    assert.ok(result.includes('icon: renamed.png'), 'icon must be added');
    assert.doesNotMatch(result, /^    - Active One:/m, 'old service name must be gone');
});

test('group edit renames group', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.editChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0
    }, 'Group A Renamed');
    assert.ok(result.includes('- Group A Renamed:'), 'group must be renamed');
    assert.doesNotMatch(result, /^- Group A:/m, 'old group name must be gone');
});

// ── Toggle comment tests ──

test('toggle service comment comments out an active service', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.toggleChunkComment(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    });
    assert.ok(result.includes('    # - Active One:'), 'active service must become commented');
    assert.ok(result.includes('    #     href: /one'), 'service fields must become commented');
});

test('toggle group comment comments out an active group and its entries', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.toggleChunkComment(chunks, {
        groupName: 'Group A',
        groupIndex: 0
    });
    assert.ok(result.includes('# - Group A:'), 'group header must be commented');
    assert.ok(result.includes('    # - Active One:'), 'group entries must be commented');
    assert.ok(result.includes('    # - Active Two:'), 'group entries must be commented');
});

test('toggle commented group uncomment restores active group and entries', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.toggleChunkComment(chunks, {
        groupName: 'Commented Group',
        groupIndex: 0
    });
    assert.ok(result.includes('- Commented Group:'), 'commented group header must become active');
    assert.ok(result.includes('    - Commented Service:'), 'commented group entries must become active');
});

// ── Edit commented-item tests ──

test('edit commented service keeps it commented', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.editChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Commented One',
        entryIndex: 0
    }, 'Commented One Renamed', { href: '/renamed' });
    assert.ok(result.includes('    # - Commented One Renamed:'), 'commented service must be renamed and stay commented');
    assert.ok(result.includes('    #     href: /renamed'), 'commented service data must be updated');
    assert.doesNotMatch(result, /^    - Commented One Renamed:/m, 'renamed service must not become uncommented');
});

test('edit commented group keeps it commented', () => {
    const chunks = parseServicesDocument(servicesWithComments);
    const result = ChunkTree.editChunk(chunks, {
        groupName: 'Commented Group',
        groupIndex: 0
    }, 'Commented Group Renamed');
    assert.ok(result.includes('# - Commented Group Renamed:'), 'commented group must be renamed and stay commented');
    assert.doesNotMatch(result, /^- Commented Group Renamed:/m, 'renamed group must not become uncommented');
    assert.ok(result.includes('#     - Commented Service:'), 'inner commented entries must remain commented');
});

// ── Group duplication test ──

const activeGroupWithServices = `# top
- Group A:
    - Active One:
        href: /one
    - Active Two:
        href: /two
- Group B:
    - Service B:
        href: /b
`;

// ── Normalization tests ──

test('normalizeCommentedGroups comments every active line inside a commented group', () => {
    const input = `- Active Group:
    - Service A:
        href: /a
# - Commented Group:
    - Service B:
        href: /b
`;
    const chunks = parseServicesDocument(input);
    ChunkTree.normalizeCommentedGroups(chunks);
    const result = ChunkTree.serializeDocument(chunks);
    // The commented group header must remain commented
    assert.ok(result.includes('# - Commented Group:'), 'commented group header must stay commented');
    // Service B and its field must now be commented
    assert.ok(result.includes('    # - Service B:'), 'Service B must be commented after normalization');
    assert.ok(result.includes('    #     href: /b'), 'Service B field must be commented after normalization');
    // Active group must remain unchanged
    assert.ok(result.includes('- Active Group:'), 'active group must remain unchanged');
    assert.ok(result.includes('    - Service A:'), 'active service must remain unchanged');
    // Result must be valid YAML
    jsyaml.load(result);
});

test('normalizeCommentedGroups handles nested commented groups', () => {
    const input = `- Active:
    - Active One:
        href: /one
# - Commented:
    - Nested:
        - Inner:
            href: /inner
`;
    const chunks = parseServicesDocument(input);
    ChunkTree.normalizeCommentedGroups(chunks);
    const result = ChunkTree.serializeDocument(chunks);
    assert.ok(result.includes('# - Commented:'), 'commented group header must stay commented');
    assert.ok(result.includes('    # - Nested:'), 'nested group must be commented');
    assert.ok(result.includes('    #     - Inner:'), 'inner service must be commented');
    assert.ok(result.includes('    #         href: /inner'), 'inner field must be commented');
    jsyaml.load(result);
});

test('normalizeCommentedGroups does not modify already-correct commented groups', () => {
    const input = `- Active:
    - Service:
        href: /a
# - Commented:
#     - Service:
#         href: /b
`;
    const chunks = parseServicesDocument(input);
    ChunkTree.normalizeCommentedGroups(chunks);
    const result = ChunkTree.serializeDocument(chunks);
    assert.equal(result, input, 'already-correct commented groups must not change');
});

// ── Rejected movement tests ──

test('moveChunk rejects moving an entry from a commented group', () => {
    const input = `- Active Group:
    - Service B:
        href: /b
# - Commented Group:
    # - Service A:
    #     href: /a
`;
    const chunks = parseServicesDocument(input);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Commented Group',
        groupIndex: 0,
        entryName: 'Service A',
        entryIndex: 0
    }, {
        groupName: 'Active Group',
        groupIndex: 0,
        destinationIndex: 0
    });
    assert.equal(result, null, 'moveChunk must return null for commented-source moves');
});

test('moveChunk rejects moving an entry into a commented group', () => {
    const input = `- Active Group:
    - Service A:
        href: /a
# - Commented Group:
    # - Service B:
    #     href: /b
`;
    const chunks = parseServicesDocument(input);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Active Group',
        groupIndex: 0,
        entryName: 'Service A',
        entryIndex: 0
    }, {
        groupName: 'Commented Group',
        groupIndex: 0,
        destinationIndex: 0
    });
    assert.equal(result, null, 'moveChunk must return null for commented-destination moves');
});

test('moveChunk rejects moving a commented entry between active groups', () => {
    const input = `- Group A:
    - Active One:
        href: /one
    # - Commented One:
    #     href: /commented
- Group B:
    - Active Two:
        href: /two
`;
    const chunks = parseServicesDocument(input);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Commented One',
        entryIndex: 0
    }, {
        groupName: 'Group B',
        groupIndex: 0,
        destinationIndex: 0
    });
    assert.equal(result, null, 'moveChunk must return null for commented-entry moves');
});

test('moveChunk rejects moving a commented group', () => {
    const input = `- Active Group:
    - Service A:
        href: /a
# - Commented Group:
    # - Service B:
    #     href: /b
`;
    const chunks = parseServicesDocument(input);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Commented Group',
        groupIndex: 0
    }, {
        groupName: 'Commented Group',
        groupIndex: 0,
        direction: 'down'
    });
    assert.equal(result, null, 'moveChunk must return null for commented-group moves');
});

test('moveChunk still allows active service moves between active groups', () => {
    const input = `- Group A:
    - Active One:
        href: /one
- Group B:
    - Active Two:
        href: /two
`;
    const chunks = parseServicesDocument(input);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0,
        entryName: 'Active One',
        entryIndex: 0
    }, {
        groupName: 'Group B',
        groupIndex: 0,
        destinationIndex: 0
    });
    assert.ok(result, 'moveChunk must return a string for active moves');
    assert.ok(result.includes('    - Active One:'), 'Active One must be in destination');
    assert.ok(result.includes('    - Active Two:'), 'Active Two must still be present');
    jsyaml.load(result);
});

test('duplicate group comments out active services in clone', () => {
    const chunks = parseServicesDocument(activeGroupWithServices);
    const result = ChunkTree.duplicateChunk(chunks, {
        groupName: 'Group A',
        groupIndex: 0
    });
    assert.ok(result.includes('- Group A (cloned):'), 'cloned group must appear');
    assert.ok(result.includes('    # - Active One:'), 'cloned group services must be commented out');
    assert.ok(result.includes('    # - Active Two:'), 'cloned group services must be commented out');
    assert.ok(result.includes('    - Active One:'), 'original group services must remain active');
});

// ── Canonical commented-group regression tests ──

const canonicalCommentedGroup = `- Active Group:
    - Alpha:
        href: /alpha
# - Commented Group:
#     - Alpha:
#         href: /alpha
#     - Beta:
#         href: /beta
# ----------------------------------------
`;

test('canonical commented group parses into separate chunks', () => {
    const chunks = parseServicesDocument(canonicalCommentedGroup);
    const commentedGroup = chunks.find((c) => c.kind === 'commented-group');
    assert.ok(commentedGroup, 'commented group must be found');
    assert.equal(commentedGroup.entries.length, 3, 'must have 3 entries: Alpha, Beta, separator');
    assert.equal(commentedGroup.entries[0].kind, 'commented-service');
    assert.equal(commentedGroup.entries[0].name, 'Alpha');
    assert.equal(commentedGroup.entries[1].kind, 'commented-service');
    assert.equal(commentedGroup.entries[1].name, 'Beta');
    assert.equal(commentedGroup.entries[2].kind, 'comment', 'separator must be a comment chunk');
});

test('canonical commented group: move Alpha into active group is rejected', () => {
    const chunks = parseServicesDocument(canonicalCommentedGroup);
    const result = ChunkTree.moveChunk(chunks, {
        groupName: 'Commented Group',
        groupIndex: 0,
        entryName: 'Alpha',
        entryIndex: 0
    }, {
        groupName: 'Active Group',
        groupIndex: 0,
        destinationIndex: 0
    });
    assert.equal(result, null, 'moveChunk must return null for commented-source moves');
});
