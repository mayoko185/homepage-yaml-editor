const assert = require('node:assert/strict');
const test = require('node:test');
const YAML = require('yaml');
const { transformPreviewYaml } = require('../yaml-transform');

const services = `# keep this services comment
- First Group:
    - First Service:
        href: https://one.example
        description: Original
        widget:
          type: customapi
          key: keep-me
    - Second Service:
        href: https://two.example

- Second Group:
    - Third Service:
        icon: third.png
`;

const settings = `title: Test
# keep this settings comment
layout:
  First Group:
    tab: Main
  Second Group:
    tab: Other
`;

const bookmarks = `# keep this bookmarks comment
- Developer:
    - Github:
        - abbr: GH
          href: https://github.com
          icon: github
    - Docs:
        - href: https://docs.example

- Social:
    - Reddit:
        - abbr: RE
          href: https://reddit.com
`;

function transform(operation, currentFiles = { services, settings }) {
  return transformPreviewYaml({ files: currentFiles, operation }).files;
}

test('edits, adds, moves and removes services without losing advanced fields or comments', () => {
  let files = transform({
    type: 'service.edit',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'First Service', serviceIndex: 0 },
    values: { name: 'Renamed Service', href: 'https://updated.example', description: '', icon: 'updated.png' }
  });
  let parsed = YAML.parse(files.services);
  assert.match(files.services, /keep this services comment/);
  assert.equal(parsed[0]['First Group'][0]['Renamed Service'].href, 'https://updated.example');
  assert.equal(parsed[0]['First Group'][0]['Renamed Service'].description, undefined);
  assert.equal(parsed[0]['First Group'][0]['Renamed Service'].icon, 'updated.png');
  assert.equal(parsed[0]['First Group'][0]['Renamed Service'].widget.key, 'keep-me');

  files = transform({
    type: 'service.add',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: { name: 'Added Service', href: 'https://added.example', description: 'Added', icon: '' }
  }, files);
  parsed = YAML.parse(files.services);
  assert.equal(parsed[0]['First Group'][2]['Added Service'].description, 'Added');

  files = transform({
    type: 'service.move',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'Added Service', serviceIndex: 0 },
    direction: 'up'
  }, files);
  parsed = YAML.parse(files.services);
  assert.equal(Object.keys(parsed[0]['First Group'][1])[0], 'Added Service');

  files = transform({
    type: 'service.move',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'Added Service', serviceIndex: 0 },
    destinationIndex: 0
  }, files);
  parsed = YAML.parse(files.services);
  assert.equal(Object.keys(parsed[0]['First Group'][0])[0], 'Added Service');

  files = transform({
    type: 'service.move',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'Added Service', serviceIndex: 0 },
    destinationIndex: 1
  }, files);

  files = transform({
    type: 'service.remove',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'Second Service', serviceIndex: 0 }
  }, files);
  parsed = YAML.parse(files.services);
  assert.deepEqual(parsed[0]['First Group'].map((item) => Object.keys(item)[0]), ['Renamed Service', 'Added Service']);

  files = transform({
    type: 'service.move',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'Added Service', serviceIndex: 0 },
    destinationTarget: { groupName: 'Second Group', groupIndex: 0 },
    destinationIndex: 0
  }, files);
  parsed = YAML.parse(files.services);
  assert.deepEqual(parsed[0]['First Group'].map((item) => Object.keys(item)[0]), ['Renamed Service']);
  assert.deepEqual(parsed[1]['Second Group'].map((item) => Object.keys(item)[0]), ['Added Service', 'Third Service']);
  assert.match(files.services, /keep this services comment/);

  files = transform({
    type: 'service.edit',
    target: { groupName: 'Second Group', groupIndex: 0, serviceName: 'Added Service', serviceIndex: 0 },
    destinationTarget: { groupName: 'First Group', groupIndex: 0 },
    values: {
      name: 'Moved Service',
      fields: [
        { key: 'href', value: 'https://moved.example' },
        { key: 'description', value: 'Moved from the edit panel' }
      ]
    }
  }, files);
  parsed = YAML.parse(files.services);
  assert.deepEqual(parsed[0]['First Group'].map((item) => Object.keys(item)[0]), ['Renamed Service', 'Moved Service']);
  assert.deepEqual(parsed[1]['Second Group'].map((item) => Object.keys(item)[0]), ['Third Service']);
  assert.equal(parsed[0]['First Group'][1]['Moved Service'].href, 'https://moved.example');
  assert.match(files.services, /keep this services comment/);
});

test('edits, adds, moves and removes bookmark groups and links without losing comments', () => {
  let files = transform({
    type: 'bookmark-group.edit',
    target: { groupName: 'Developer', groupIndex: 0 },
    values: { name: 'Engineering', fields: [] }
  }, { services, settings, bookmarks });
  let parsed = YAML.parse(files.bookmarks);
  assert.match(files.bookmarks, /keep this bookmarks comment/);
  assert.deepEqual(parsed.map((group) => Object.keys(group)[0]), ['Engineering', 'Social']);

  files = transform({
    type: 'bookmark.edit',
    target: { groupName: 'Engineering', groupIndex: 0, bookmarkName: 'Github', bookmarkIndex: 0 },
    values: {
      name: 'GitHub',
      fields: [
        { key: 'abbr', value: 'GHX' },
        { key: 'href', value: 'https://github.example' },
        { key: 'icon', value: 'github' }
      ]
    }
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.equal(parsed[0].Engineering[0].GitHub[0].href, 'https://github.example');
  assert.deepEqual(Object.keys(parsed[0].Engineering[0].GitHub[0]), ['abbr', 'href', 'icon']);

  files = transform({
    type: 'bookmark.add',
    target: { groupName: 'Engineering', groupIndex: 0 },
    values: {
      name: 'Example',
      fields: [
        { key: 'href', value: 'https://example.com' },
        { key: 'abbr', value: 'EX' }
      ]
    }
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.equal(parsed[0].Engineering[2].Example[0].abbr, 'EX');

  files = transform({
    type: 'bookmark.move',
    target: { groupName: 'Engineering', groupIndex: 0, bookmarkName: 'Example', bookmarkIndex: 0 },
    direction: 'up'
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.deepEqual(parsed[0].Engineering.map((item) => Object.keys(item)[0]), ['GitHub', 'Example', 'Docs']);

  files = transform({
    type: 'bookmark.remove',
    target: { groupName: 'Engineering', groupIndex: 0, bookmarkName: 'Docs', bookmarkIndex: 0 }
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.deepEqual(parsed[0].Engineering.map((item) => Object.keys(item)[0]), ['GitHub', 'Example']);

  files = transform({
    type: 'bookmark.move',
    target: { groupName: 'Engineering', groupIndex: 0, bookmarkName: 'GitHub', bookmarkIndex: 0 },
    destinationTarget: { groupName: 'Social', groupIndex: 0 },
    destinationIndex: 0
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.deepEqual(parsed[0].Engineering.map((item) => Object.keys(item)[0]), ['Example']);
  assert.deepEqual(parsed[1].Social.map((item) => Object.keys(item)[0]), ['GitHub', 'Reddit']);
  assert.match(files.bookmarks, /keep this bookmarks comment/);

  files = transform({
    type: 'bookmark-group.add',
    values: { name: 'Reference', fields: [] }
  }, files);
  files = transform({
    type: 'bookmark-group.move',
    target: { groupName: 'Reference', groupIndex: 0 },
    direction: 'up'
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.deepEqual(parsed.map((group) => Object.keys(group)[0]), ['Engineering', 'Reference', 'Social']);

  files = transform({
    type: 'bookmark-group.remove',
    target: { groupName: 'Reference', groupIndex: 0 }
  }, files);
  parsed = YAML.parse(files.bookmarks);
  assert.deepEqual(parsed.map((group) => Object.keys(group)[0]), ['Engineering', 'Social']);

  const filesWithEmptyBookmarks = transformPreviewYaml({
    files: { services, settings, bookmarks: '' },
    operation: { type: 'bookmark-group.add', values: { name: 'First bookmark group' } }
  }).files;
  assert.deepEqual(YAML.parse(filesWithEmptyBookmarks.bookmarks), [{ 'First bookmark group': [] }]);
});

test('edits ordered service and group options from the Preview editor', () => {
  let files = transform({
    type: 'service.edit',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'First Service', serviceIndex: 0 },
    values: {
      name: 'First Service',
      fields: [
        { key: 'description', value: 'Updated description' },
        { key: 'href', value: 'https://updated.example' },
        { key: 'ping', value: 'https://status.example' },
        {
          key: 'widget',
          fields: [
            { key: 'type', value: 'customapi' },
            { key: 'key', value: 'kept-and-edited' },
            { key: 'options', value: '["movies", "series", "episodes"]' }
          ]
        }
      ]
    }
  });
  let parsedServices = YAML.parse(files.services);
  let service = parsedServices[0]['First Group'][0]['First Service'];
  assert.deepEqual(Object.keys(service), ['description', 'href', 'ping', 'widget']);
  assert.equal(service.widget.key, 'kept-and-edited');
  assert.deepEqual(service.widget.options, ['movies', 'series', 'episodes']);
  assert.equal(service.icon, undefined);

  files = transform({
    type: 'group.edit',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: {
      name: 'Renamed Group',
      fields: [
        { key: 'style', value: 'row' },
        { key: 'tab', value: 'Operations' },
        { key: 'columns', value: '4' }
      ]
    }
  }, files);
  parsedServices = YAML.parse(files.services);
  const parsedSettings = YAML.parse(files.settings);
  assert.equal(Object.keys(parsedServices[0])[0], 'Renamed Group');
  assert.deepEqual(Object.keys(parsedSettings.layout['Renamed Group']), ['style', 'tab', 'columns']);
  assert.equal(parsedSettings.layout['Renamed Group'].tab, 'Operations');
  assert.equal(parsedSettings.layout['First Group'], undefined);
});

test('writes select choices as text and explicit blank choices without quoted markers', () => {
  const files = transform({
    type: 'service.add',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: {
      name: 'Select Service',
      fields: [
        { key: 'mode', value: 'true', textValue: true },
        { key: 'label', value: 'another thing', textValue: true },
        { key: 'optional', value: '', blankValue: true }
      ]
    }
  });
  const service = YAML.parse(files.services)[0]['First Group'][2]['Select Service'];
  assert.equal(service.mode, 'true');
  assert.equal(service.label, 'another thing');
  assert.equal(service.optional, null);
  assert.match(files.services, /mode: "true"/);
  assert.match(files.services, /label: another thing/);
  assert.match(files.services, /optional:\n/);
  assert.doesNotMatch(files.services, /optional: ["']{2}/);
});

test('removes deleted option types from every applicable YAML target', () => {
  const files = transform({
    type: 'option-types.remove',
    options: [
      { name: 'description', appliesTo: ['service'] },
      { name: 'key', appliesTo: ['widget'] },
      { name: 'tab', appliesTo: ['group'] },
      { name: 'abbr', appliesTo: ['bookmark'] }
    ]
  }, { services, settings, bookmarks });
  const parsedServices = YAML.parse(files.services);
  const parsedSettings = YAML.parse(files.settings);
  const parsedBookmarks = YAML.parse(files.bookmarks);
  const firstService = parsedServices[0]['First Group'][0]['First Service'];
  const github = parsedBookmarks[0].Developer[0].Github[0];
  assert.equal(firstService.description, undefined);
  assert.equal(firstService.widget.key, undefined);
  assert.equal(firstService.widget.type, 'customapi');
  assert.equal(firstService.href, 'https://one.example');
  assert.equal(parsedSettings.layout['First Group'].tab, undefined);
  assert.equal(parsedSettings.title, 'Test');
  assert.equal(github.abbr, undefined);
  assert.equal(github.href, 'https://github.com');
  assert.match(files.services, /keep this services comment/);
  assert.match(files.settings, /keep this settings comment/);
  assert.match(files.bookmarks, /keep this bookmarks comment/);
});

test('group changes keep matching layout entries synchronized', () => {
  let files = transform({
    type: 'group.edit',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: { name: 'First Group', fields: [{ key: 'tab', value: 'Other' }] }
  });
  let parsedServices = YAML.parse(files.services);
  let parsedSettings = YAML.parse(files.settings);
  assert.equal(parsedSettings.layout['First Group'].tab, 'Other');
  assert.deepEqual(parsedServices[0]['First Group'], YAML.parse(services)[0]['First Group']);
  assert.match(files.services, /keep this services comment/);

  files = transform({
    type: 'group.rename',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: { name: 'Renamed Group' }
  }, files);
  parsedServices = YAML.parse(files.services);
  parsedSettings = YAML.parse(files.settings);
  assert.equal(Object.keys(parsedServices[0])[0], 'Renamed Group');
  assert.equal(parsedSettings.layout['Renamed Group'].tab, 'Other');
  assert.equal(parsedSettings.layout['First Group'], undefined);
  assert.match(files.settings, /keep this settings comment/);

  files = transform({
    type: 'group.move',
    target: { groupName: 'Renamed Group', groupIndex: 0 },
    direction: 'down'
  }, files);
  parsedServices = YAML.parse(files.services);
  parsedSettings = YAML.parse(files.settings);
  assert.deepEqual(parsedServices.map((group) => Object.keys(group)[0]), ['Second Group', 'Renamed Group']);
  assert.deepEqual(Object.keys(parsedSettings.layout), ['Second Group', 'Renamed Group']);

  files = transform({
    type: 'group.remove',
    target: { groupName: 'Renamed Group', groupIndex: 0 }
  }, files);
  parsedServices = YAML.parse(files.services);
  parsedSettings = YAML.parse(files.settings);
  assert.deepEqual(parsedServices.map((group) => Object.keys(group)[0]), ['Second Group']);
  assert.equal(parsedSettings.layout['Renamed Group'], undefined);

  files = transform({
    type: 'group.add',
    values: {
      name: 'Added Group',
      fields: [
        { key: 'tab', value: 'Other' },
        { key: 'style', value: 'row' },
        { key: 'columns', value: '3' },
        { key: 'header', value: 'true' },
        { key: 'icon', value: 'mdi-server' }
      ]
    }
  }, files);
  parsedServices = YAML.parse(files.services);
  parsedSettings = YAML.parse(files.settings);
  assert.deepEqual(parsedServices.map((group) => Object.keys(group)[0]), ['Second Group', 'Added Group']);
  assert.deepEqual(parsedSettings.layout['Added Group'], {
    tab: 'Other', style: 'row', columns: 3, header: true, icon: 'mdi-server'
  });
});

test('rejects duplicate service group names before creating invalid YAML', () => {
  assert.throws(() => transform({
    type: 'group.add',
    values: { name: 'First Group' }
  }), /Group "First Group" already exists/);

  assert.throws(() => transform({
    type: 'group.rename',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: { name: 'Second Group' }
  }), /Group "Second Group" already exists/);

  assert.throws(() => transform({
    type: 'group.edit',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: { name: 'Second Group', fields: [] }
  }), /Group "Second Group" already exists/);
});

test('manages Homepage layout tabs and can create an initial service group', () => {
  let files = transform({
    type: 'tab.rename',
    target: { name: 'Other' },
    values: { name: 'Operations' }
  });
  let parsedSettings = YAML.parse(files.settings);
  assert.equal(parsedSettings.layout['First Group'].tab, 'Main');
  assert.equal(parsedSettings.layout['Second Group'].tab, 'Operations');
  assert.match(files.settings, /keep this settings comment/);

  assert.throws(() => transform({
    type: 'tab.rename',
    target: { name: 'Main' },
    values: { name: 'Other' }
  }), /Preview tab "Other" already exists/);

  files = transform({
    type: 'tab.add',
    values: { name: 'Archive', groupName: 'Second Group' }
  });
  parsedSettings = YAML.parse(files.settings);
  assert.equal(files.services, services);
  assert.equal(parsedSettings.layout['Second Group'].tab, 'Archive');
  assert.match(files.settings, /keep this settings comment/);

  files = transform({
    type: 'tab.move',
    target: { name: 'Archive' },
    direction: 'up'
  }, files);
  parsedSettings = YAML.parse(files.settings);
  assert.deepEqual(Object.keys(parsedSettings.layout), ['Second Group', 'First Group']);

  files = transform({
    type: 'tab.remove',
    target: { name: 'Archive' }
  }, files);
  parsedSettings = YAML.parse(files.settings);
  assert.equal(parsedSettings.layout['Second Group'].tab, undefined);
  assert.equal(parsedSettings.layout['First Group'].tab, 'Main');

  assert.throws(() => transform({
    type: 'tab.add',
    values: { name: 'Missing', groupName: 'Unknown Group' }
  }), /Initial group "Unknown Group" was not found\. Choose an existing group or create a new one/);

  const filesWithoutLayout = transformPreviewYaml({
    files: { services, settings: 'title: Test\n' },
    operation: {
      type: 'tab.add',
      values: { name: 'First Tab', groupName: 'First Group' }
    }
  }).files;
  assert.equal(YAML.parse(filesWithoutLayout.settings).layout['First Group'].tab, 'First Tab');

  const filesWithNewGroup = transformPreviewYaml({
    files: { services, settings: 'title: Test\n' },
    operation: {
      type: 'tab.add',
      values: { name: 'New Tab', groupName: 'New Group', createGroup: true }
    }
  }).files;
  assert.deepEqual(
    YAML.parse(filesWithNewGroup.services).map((group) => Object.keys(group)[0]),
    ['First Group', 'Second Group', 'New Group']
  );
  assert.deepEqual(YAML.parse(filesWithNewGroup.services)[2]['New Group'], []);
  assert.equal(YAML.parse(filesWithNewGroup.settings).layout['New Group'].tab, 'New Tab');

  assert.throws(() => transformPreviewYaml({
    files: { services, settings },
    operation: {
      type: 'tab.add',
      values: { name: 'Duplicate Group Tab', groupName: 'First Group', createGroup: true }
    }
  }), /already exists/);

  // S4.1: new group with afterTab='Main' inserts right after the anchor pair
  const s41Files = transform({
    type: 'tab.add',
    values: { name: 'Archive', groupName: 'New Group', createGroup: true, afterTab: 'Main' }
  });
  let s41Settings = YAML.parse(s41Files.settings);
  assert.equal(s41Settings.layout['New Group'].tab, 'Archive');
  assert.deepEqual(Object.keys(s41Settings.layout), ['First Group', 'New Group', 'Second Group']);
  assert.deepEqual(
    YAML.parse(s41Files.services).map((group) => Object.keys(group)[0]),
    ['First Group', 'Second Group', 'New Group']
  );
  assert.match(s41Files.settings, /keep this settings comment/);
  assert.match(s41Files.services, /keep this services comment/);

  // S4.2: no afterTab preserves append-at-end semantics (backward compatible)
  const s42Files = transform({
    type: 'tab.add',
    values: { name: 'Archive', groupName: 'Second Group' }
  });
  let s42Settings = YAML.parse(s42Files.settings);
  assert.equal(s42Settings.layout['Second Group'].tab, 'Archive');
  assert.deepEqual(Object.keys(s42Settings.layout), ['First Group', 'Second Group']);

  const s42CleanFiles = transformPreviewYaml({
    files: { services, settings: 'title: Test\n' },
    operation: {
      type: 'tab.add',
      values: { name: 'Solo', groupName: 'Solo Group', createGroup: true }
    }
  }).files;
  assert.deepEqual(Object.keys(YAML.parse(s42CleanFiles.settings).layout), ['Solo Group']);

  // S4.3: existing group with afterTab only updates the tab field, pair is not relocated
  const s43Files = transform({
    type: 'tab.add',
    values: { name: 'Reused Tab', groupName: 'Second Group', afterTab: 'Main' }
  });
  let s43Settings = YAML.parse(s43Files.settings);
  assert.equal(s43Settings.layout['Second Group'].tab, 'Reused Tab');
  assert.deepEqual(Object.keys(s43Settings.layout), ['First Group', 'Second Group']);

  const s43ChainedFiles = transform({
    type: 'tab.add',
    values: { name: 'Another', groupName: 'First Group', afterTab: 'Reused Tab' }
  }, s43Files);
  let s43ChainedSettings = YAML.parse(s43ChainedFiles.settings);
  assert.equal(s43ChainedSettings.layout['First Group'].tab, 'Another');
  assert.deepEqual(Object.keys(s43ChainedSettings.layout), ['First Group', 'Second Group']);
});

test('rejects invalid YAML and invalid movement', () => {
  assert.throws(() => transformPreviewYaml({
    files: { services: '- broken: [', settings },
    operation: { type: 'group.add', values: { name: 'New' } }
  }), /services\.yaml is invalid/);

  const duplicateSettings = `layout:
  First Group:
    tab: Main
  First Group:
    tab: Other
`;
  assert.throws(() => transformPreviewYaml({
    files: { services, settings: duplicateSettings },
    operation: {
      type: 'group.rename',
      target: { groupName: 'First Group', groupIndex: 0 },
      values: { name: 'Renamed Group' }
    }
  }), /settings\.yaml is invalid: Duplicate mapping key.*at line 4, column 3/);

  assert.throws(() => transform({
    type: 'group.move',
    target: { groupName: 'First Group', groupIndex: 0 },
    direction: 'up'
  }), /cannot be moved/);
});

const nestedServices = `# nested services comment
- Top Group:
    - Direct Service:
        href: https://direct.example
    - Inner Group:
        - Inner Service A:
            href: https://a.example
        - Inner Service B:
            href: https://b.example
    - After Nested:
        href: https://after.example
`;

const nestedSettings = `title: Nested
layout:
  Top Group:
    tab: Main
  Inner Group:
    icon: inner.png
    columns: 2
`;

const nestedPath = [{ name: 'Inner Group', index: 0 }];

test('adds, edits, moves and removes services inside nested groups', () => {
  let files = transform({
    type: 'service.add',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath },
    values: { name: 'Added Inner', href: 'https://added.example', description: 'Added' }
  }, { services: nestedServices, settings: nestedSettings });
  let parsed = YAML.parse(files.services);
  const inner = parsed[0]['Top Group'].find((entry) => Object.keys(entry)[0] === 'Inner Group')['Inner Group'];
  assert.equal(inner[2]['Added Inner'].description, 'Added');
  assert.match(files.services, /nested services comment/);

  files = transform({
    type: 'service.edit',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath, serviceName: 'Inner Service A', serviceIndex: 0 },
    values: { name: 'Renamed Inner A', href: 'https://a-updated.example' }
  }, files);
  parsed = YAML.parse(files.services);
  const innerAfter = parsed[0]['Top Group'].find((entry) => Object.keys(entry)[0] === 'Inner Group')['Inner Group'];
  assert.equal(innerAfter[0]['Renamed Inner A'].href, 'https://a-updated.example');
  assert.equal(innerAfter[0]['Renamed Inner A'].description, undefined);

  files = transform({
    type: 'service.move',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath, serviceName: 'Renamed Inner A', serviceIndex: 0 },
    direction: 'down'
  }, files);
  parsed = YAML.parse(files.services);
  const innerMoved = parsed[0]['Top Group'].find((entry) => Object.keys(entry)[0] === 'Inner Group')['Inner Group'];
  assert.equal(Object.keys(innerMoved[0])[0], 'Inner Service B');
  assert.equal(Object.keys(innerMoved[1])[0], 'Renamed Inner A');

  files = transform({
    type: 'service.remove',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath, serviceName: 'Inner Service B', serviceIndex: 0 }
  }, files);
  parsed = YAML.parse(files.services);
  const innerRemoved = parsed[0]['Top Group'].find((entry) => Object.keys(entry)[0] === 'Inner Group')['Inner Group'];
  assert.equal(innerRemoved.length, 2);
  assert.equal(Object.keys(innerRemoved[0])[0], 'Renamed Inner A');
});

test('moves a service from a nested group to a top-level group', () => {
  let files = transform({
    type: 'service.move',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath, serviceName: 'Inner Service A', serviceIndex: 0 },
    destinationTarget: { groupName: 'Top Group', groupIndex: 0 },
    destinationIndex: 0
  }, { services: nestedServices, settings: nestedSettings });
  const parsed = YAML.parse(files.services);
  const topEntries = parsed[0]['Top Group'];
  assert.equal(Object.keys(topEntries[0])[0], 'Inner Service A');
  const inner = topEntries.find((entry) => Object.keys(entry)[0] === 'Inner Group')['Inner Group'];
  assert.equal(inner.length, 1);
  assert.equal(Object.keys(inner[0])[0], 'Inner Service B');
});

test('edits, moves and removes nested service groups while keeping layout in sync', () => {
  let files = transform({
    type: 'group.edit',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath },
    values: {
      name: 'Renamed Inner',
      fields: [
        { key: 'icon', value: 'updated.png' },
        { key: 'columns', value: '3' }
      ]
    }
  }, { services: nestedServices, settings: nestedSettings });
  let parsedServices = YAML.parse(files.services);
  let parsedSettings = YAML.parse(files.settings);
  const topEntries = parsedServices[0]['Top Group'];
  assert.ok(topEntries.some((entry) => Object.keys(entry)[0] === 'Renamed Inner'));
  assert.equal(parsedSettings.layout['Top Group']['Renamed Inner'].icon, 'updated.png');
  assert.equal(parsedSettings.layout['Top Group']['Renamed Inner'].columns, 3);
  assert.equal(parsedSettings.layout['Inner Group'], undefined);
  assert.match(files.services, /nested services comment/);

  files = transform({
    type: 'group.move',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Renamed Inner', index: 0 }] },
    direction: 'up'
  }, files);
  parsedServices = YAML.parse(files.services);
  const movedEntries = parsedServices[0]['Top Group'];
  assert.equal(Object.keys(movedEntries[0])[0], 'Renamed Inner');
  assert.equal(Object.keys(movedEntries[1])[0], 'Direct Service');

  files = transform({
    type: 'group.remove',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Renamed Inner', index: 0 }] }
  }, files);
  parsedServices = YAML.parse(files.services);
  parsedSettings = YAML.parse(files.settings);
  const remaining = parsedServices[0]['Top Group'].map((entry) => Object.keys(entry)[0]);
  assert.deepEqual(remaining, ['Direct Service', 'After Nested']);
  assert.equal(parsedSettings.layout['Renamed Inner'], undefined);
  assert.equal(parsedSettings.layout['Top Group'].tab, 'Main');
});

test('removing a nested group does not delete a top-level group layout with the same name', () => {
  const sameNameServices = `- Top Group:
    - Inner:
        href: https://inner.example
    - Inner Group:
        - Service A:
            href: https://a.example
- Inner Group:
    href: https://top-inner.example
`;
  const sameNameSettings = `title: Same Name
layout:
  Top Group:
    tab: Main
    Inner:
      icon: inner.png
    Inner Group:
      icon: nested.png
  Inner Group:
    tab: Other
    columns: 2
`;
  const files = transform({
    type: 'group.remove',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Inner Group', index: 0 }] }
  }, { services: sameNameServices, settings: sameNameSettings });
  const parsedSettings = YAML.parse(files.settings);
  // The top-level group "Inner Group" must keep its layout entry
  assert.ok(parsedSettings.layout['Inner Group'], 'top-level group layout must survive');
  assert.equal(parsedSettings.layout['Inner Group'].tab, 'Other');
  assert.equal(parsedSettings.layout['Inner Group'].columns, 2);
  // The nested group's layout under the parent must be gone
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'], undefined);
  // A direct service's layout entry under the parent must survive
  assert.deepEqual(parsedSettings.layout['Top Group']['Inner'], { icon: 'inner.png' });
});

test('rejects duplicate nested group names within the same parent', () => {
  assert.throws(() => transform({
    type: 'group.edit',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath },
    values: { name: 'Direct Service', fields: [] }
  }, { services: nestedServices, settings: nestedSettings }), /Group "Direct Service" already exists/);

  assert.throws(() => transform({
    type: 'group.rename',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: nestedPath },
    values: { name: 'Top Group' }
  }, { services: nestedServices, settings: nestedSettings }), /Group "Top Group" already exists/);
});

test('rejects moves that would push a nested group outside its parent list', () => {
  const boundaryServices = `- Top Group:
    - Inner Group:
        - Inner Service A:
            href: https://a.example
    - Trailing Service:
        href: https://trailing.example
`;
  assert.throws(() => transform({
    type: 'group.move',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Inner Group', index: 0 }] },
    direction: 'up'
  }, { services: boundaryServices, settings: nestedSettings }), /cannot be moved/);

  const trailingNestedServices = `- Top Group:
    - Leading Service:
        href: https://leading.example
    - Inner Group:
        - Inner Service A:
            href: https://a.example
`;
  assert.throws(() => transform({
    type: 'group.move',
    target: { groupName: 'Top Group', groupIndex: 0, nestedGroupPath: [{ name: 'Inner Group', index: 0 }] },
    direction: 'down'
  }, { services: trailingNestedServices, settings: nestedSettings }), /cannot be moved/);
});

test('converts a flat service group into a nested group', () => {
  const flatServices = `- Flat Group:
    - Service A:
        href: https://a.example
    - Service B:
        href: https://b.example
    - Service C:
        href: https://c.example
`;
  const flatSettings = `title: Flat
layout:
  Flat Group:
    columns: 3
`;

  const files = transform({
    type: 'group.convert-to-nested',
    target: { groupName: 'Flat Group', groupIndex: 0 }
  }, { services: flatServices, settings: flatSettings });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Flat Group'];
  assert.equal(entries.length, 1);
  assert.equal(Object.keys(entries[0])[0], '1');
  const subGroup = entries[0]['1'];
  assert.equal(subGroup.length, 3);
  assert.equal(Object.keys(subGroup[0])[0], 'Service A');
  assert.equal(Object.keys(subGroup[2])[0], 'Service C');
});

test('group.add with nested path adds a sub-group inside the parent', () => {
  const services = `- Top:
    - "1":
        - A:
            href: https://a.example
`;
  const files = transform({
    type: 'group.add',
    target: { groupName: 'Top', groupIndex: 0, nestedGroupPath: [] },
    values: { name: 'New Sub', fields: [] }
  }, { services, settings: 'title: T\n' });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.equal(entries.length, 2);
  assert.equal(Object.keys(entries[0])[0], '1');
  assert.equal(Object.keys(entries[1])[0], 'New Sub');
  assert.deepEqual(entries[1]['New Sub'], []);
});

test('group.add with nested path rejects duplicate name within the same parent', () => {
  const services = `- Top:
    - "1":
        - A:
            href: https://a.example
`;
  assert.throws(() => transform({
    type: 'group.add',
    target: { groupName: 'Top', groupIndex: 0, nestedGroupPath: [] },
    values: { name: '1', fields: [] }
  }, { services, settings: 'title: T\n' }), /already exists/);
});

test('convert-to-nested preserves direct services alongside existing nested sub-groups', () => {
  const services = `- Top:
    - Existing Nested:
        - Inner A:
            href: https://inner-a.example
    - Direct Service:
        href: https://direct.example
`;
  const files = transform({
    type: 'group.convert-to-nested',
    target: { groupName: 'Top', groupIndex: 0 }
  }, { services, settings: 'title: T\n' });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.equal(entries.length, 2);
  assert.equal(Object.keys(entries[0])[0], 'Existing Nested');
  assert.equal(Object.keys(entries[1])[0], '1');
  assert.equal(entries[1]['1'][0]['Direct Service'].href, 'https://direct.example');
});

test('convert-from-nested flattens nested sub-groups back into direct services', () => {
  const services = `- Top:
    - "1":
        - Service A:
            href: https://a.example
        - Service B:
            href: https://b.example
    - "2":
        - Service C:
            href: https://c.example
    - Direct Service:
        href: https://direct.example
`;
  const files = transform({
    type: 'group.convert-from-nested',
    target: { groupName: 'Top', groupIndex: 0 }
  }, { services, settings: 'title: T\n' });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((entry) => Object.keys(entry)[0]), ['Service A', 'Service B', 'Service C', 'Direct Service']);
  assert.equal(entries[0]['Service A'].href, 'https://a.example');
  assert.equal(entries[2]['Service C'].href, 'https://c.example');
  assert.equal(entries[3]['Direct Service'].href, 'https://direct.example');
});

test('convert-from-nested on a group with empty nested sub-groups drops them', () => {
  const services = `- Top:
    - "1":
        - Service A:
            href: https://a.example
    - "2": []
`;
  const files = transform({
    type: 'group.convert-from-nested',
    target: { groupName: 'Top', groupIndex: 0 }
  }, { services, settings: 'title: T\n' });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.equal(entries.length, 1);
  assert.equal(Object.keys(entries[0])[0], 'Service A');
});

test('round-trip convert to nested and back restores the original flat structure', () => {
  const originalServices = `- Top:
    - Service A:
        href: https://a.example
    - Service B:
        href: https://b.example
`;
  let files = transform({
    type: 'group.convert-to-nested',
    target: { groupName: 'Top', groupIndex: 0 }
  }, { services: originalServices, settings: 'title: T\n' });
  files = transform({
    type: 'group.convert-from-nested',
    target: { groupName: 'Top', groupIndex: 0 }
  }, files);
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => Object.keys(entry)[0]), ['Service A', 'Service B']);
  assert.equal(entries[0]['Service A'].href, 'https://a.example');
  assert.equal(entries[1]['Service B'].href, 'https://b.example');
});

// ── Serialization-formatting tests (service move vs group move) ──

test('preserves service indentation after cross-group service move', () => {
  const services = `# top comment
- Group A:
    - Service One:
        href: https://one.example
        description: First
- Group B:
    - Service Two:
        href: https://two.example
`;

  const files = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Service One', serviceIndex: 0 },
    destinationTarget: { groupName: 'Group B', groupIndex: 0 },
    destinationIndex: 1
  }, { services });

  const parsed = YAML.parse(files.services);
  assert.deepEqual(
    parsed[0]['Group A'].map((entry) => Object.keys(entry)[0]),
    []
  );
  assert.deepEqual(
    parsed[1]['Group B'].map((entry) => Object.keys(entry)[0]),
    ['Service Two', 'Service One']
  );

  // Top-level comment preserved
  assert.match(files.services, /^# top comment\n/m);

  // Service list items at correct indent (4 spaces for "- Service..." inside a group)
  assert.match(files.services, /^    - Service One:$/m);
  assert.match(files.services, /^    - Service Two:$/m);

  // Service fields at correct indent (8 spaces for field keys inside a service)
  // Service One's fields must remain at 8-space indent
  assert.match(files.services, /^        href: https:\/\/one\.example$/m);
  assert.match(files.services, /^        description: First$/m);

  // Service Two's fields must remain at 8-space indent
  assert.match(files.services, /^        href: https:\/\/two\.example$/m);

  // Must NOT regress to 2-space or 4-space field indentation
  const fieldLines = files.services.split('\n').filter((line) => line.startsWith('        href:') || line.startsWith('        description:'));
  assert.equal(fieldLines.length, 3, 'Expected 3 field lines at 8-space indent');
});

test('preserves service indentation after same-group service move', () => {
  const services = `# top
- My Group:
    - First:
        href: https://first.example
    - Second:
        href: https://second.example
    - Third:
        href: https://third.example
`;

  // Move "Third" up one position
  let files = transform({
    type: 'service.move',
    target: { groupName: 'My Group', groupIndex: 0, serviceName: 'Third', serviceIndex: 0 },
    direction: 'up'
  }, { services });

  let parsed = YAML.parse(files.services);
  assert.deepEqual(
    parsed[0]['My Group'].map((entry) => Object.keys(entry)[0]),
    ['First', 'Third', 'Second']
  );

  // Indentation must be preserved
  assert.match(files.services, /^    - First:$/m);
  assert.match(files.services, /^    - Third:$/m);
  assert.match(files.services, /^    - Second:$/m);
  assert.match(files.services, /^        href: https:\/\/first\.example$/m);
  assert.match(files.services, /^        href: https:\/\/third\.example$/m);
  assert.match(files.services, /^        href: https:\/\/second\.example$/m);

  // Move "Third" to position 0 via destinationIndex via drag-drop path (same group)
  files = transform({
    type: 'service.move',
    target: { groupName: 'My Group', groupIndex: 0, serviceName: 'Third', serviceIndex: 0 },
    destinationIndex: 0,
    destinationTarget: { groupName: 'My Group', groupIndex: 0 }
  }, { services });

  parsed = YAML.parse(files.services);
  assert.deepEqual(
    parsed[0]['My Group'].map((entry) => Object.keys(entry)[0]),
    ['Third', 'First', 'Second']
  );

  // Indentation must still be correct
  assert.match(files.services, /^        href: https:\/\/first\.example$/m);
  assert.match(files.services, /^        href: https:\/\/third\.example$/m);
  assert.match(files.services, /^        href: https:\/\/second\.example$/m);
});

test('preserves group indentation after group move (control)', () => {
  const services = `# comment
- Group A:
    - Svc A:
        href: https://a.example
- Group B:
    - Svc B:
        href: https://b.example
`;

  const files = transform({
    type: 'group.move',
    target: { groupName: 'Group B', groupIndex: 0 },
    direction: 'up'
  }, { services });

  const parsed = YAML.parse(files.services);
  assert.deepEqual(
    parsed.map((group) => Object.keys(group)[0]),
    ['Group B', 'Group A']
  );

  // Groups at indent 0, services at indent 4, fields at indent 8
  assert.match(files.services, /^- Group B:$/m);
  assert.match(files.services, /^- Group A:$/m);
  assert.match(files.services, /^    - Svc A:$/m);
  assert.match(files.services, /^    - Svc B:$/m);
  assert.match(files.services, /^        href: https:\/\/a\.example$/m);
  assert.match(files.services, /^        href: https:\/\/b\.example$/m);
});

test('preserves comments around moved services', () => {
  const services = `# file comment
- Group A:
    # before Svc One
    - Service One:
        href: https://one.example
    # after Svc One
- Group B:
    # before Svc Two
    - Service Two:
        href: https://two.example
    # after Svc Two
`;

  const files = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Service One', serviceIndex: 0 },
    destinationTarget: { groupName: 'Group B', groupIndex: 0 },
    destinationIndex: 1
  }, { services });

  // Top comment preserved
  assert.match(files.services, /^# file comment$/m);

  // Comments in Group A that were attached to Service One may or may not move —
  // the key assertion is that Group B still has its comments
  assert.match(files.services, /# before Svc Two/);
  assert.match(files.services, /# after Svc Two/);

  // Data integrity
  const parsed = YAML.parse(files.services);
  assert.equal(Object.keys(parsed[0]['Group A']).length, 0, 'Group A should be empty');
  assert.deepEqual(
    parsed[1]['Group B'].map((entry) => Object.keys(entry)[0]),
    ['Service Two', 'Service One']
  );
});

test('preserves service indentation with widget sub-maps and inline comments', () => {
  const services = `# top
- Group A:
    - Svc One:
        href: https://one
        widget:
          type: customapi
          url: https://api.one
          # inline widget comment
- Group B:
    - Svc Two:
        href: https://two
`;

  const files = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Svc One', serviceIndex: 0 },
    destinationTarget: { groupName: 'Group B', groupIndex: 0 },
    destinationIndex: 1
  }, { services });

  const parsed = YAML.parse(files.services);
  assert.deepEqual(
    parsed[1]['Group B'].map((entry) => Object.keys(entry)[0]),
    ['Svc Two', 'Svc One']
  );
  assert.equal(parsed[1]['Group B'][1]['Svc One'].href, 'https://one');
  assert.equal(parsed[1]['Group B'][1]['Svc One'].widget.type, 'customapi');
  assert.equal(parsed[1]['Group B'][1]['Svc One'].widget.url, 'https://api.one');

  // Widget fields at 10-space indent
  assert.match(files.services, /^          type: customapi$/m);
  assert.match(files.services, /^          url: https:\/\/api\.one$/m);

  // Inline widget comment preserved
  assert.match(files.services, /# inline widget comment/);

  // Top-level structure
  assert.match(files.services, /^    - Svc One:$/m);
  assert.match(files.services, /^    - Svc Two:$/m);
  assert.match(files.services, /^        href: https:\/\/one$/m);
  assert.match(files.services, /^        widget:$/m);
});

test('diagnostic: dump serialized output for cross-group, same-group, and drag-drop moves', () => {
  const input = `# comment
- Group A:
    - Svc 1:
        href: https://1
        description: One
    - Svc 2:
        href: https://2
- Group B:
    - Svc 3:
        href: https://3
`;

  // Cross-group (drag-drop path): move Svc 1 from Group A to Group B, position 1
  const cross = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Svc 1', serviceIndex: 0 },
    destinationTarget: { groupName: 'Group B', groupIndex: 0 },
    destinationIndex: 1
  }, { services: input });

  // Same-group via direction (button): move Svc 1 down
  const sameDir = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Svc 1', serviceIndex: 0 },
    direction: 'down'
  }, { services: input });

  // Same-group via destinationIndex with destinationTarget (drag-drop within same group)
  const sameDrag = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Svc 1', serviceIndex: 0 },
    destinationTarget: { groupName: 'Group A', groupIndex: 0 },
    destinationIndex: 1
  }, { services: input });

  // Group move (control): swap groups
  const groupMove = transform({
    type: 'group.move',
    target: { groupName: 'Group B', groupIndex: 0 },
    direction: 'up'
  }, { services: input });

  // All must parse
  assert.doesNotThrow(() => YAML.parse(cross.services));
  assert.doesNotThrow(() => YAML.parse(sameDir.services));
  assert.doesNotThrow(() => YAML.parse(sameDrag.services));
  assert.doesNotThrow(() => YAML.parse(groupMove.services));

  // All must preserve the top comment
  for (const name of ['cross-group', 'same-group direction', 'same-group drag', 'group move']) {
    const result = name === 'cross-group' ? cross.services
      : name === 'same-group direction' ? sameDir.services
      : name === 'same-group drag' ? sameDrag.services
      : groupMove.services;
    assert.match(result, /^# comment$/m, `${name}: top comment preserved`);
  }

  // Structural assertions
  const crossParsed = YAML.parse(cross.services);
  assert.deepEqual(crossParsed[1]['Group B'].map((e) => Object.keys(e)[0]), ['Svc 3', 'Svc 1'], 'cross-group');
  assert.deepEqual(crossParsed[0]['Group A'].map((e) => Object.keys(e)[0]), ['Svc 2'], 'cross-group source');

  const sameDirParsed = YAML.parse(sameDir.services);
  assert.deepEqual(sameDirParsed[0]['Group A'].map((e) => Object.keys(e)[0]), ['Svc 2', 'Svc 1'], 'same-group dir');

  const sameDragParsed = YAML.parse(sameDrag.services);
  assert.deepEqual(sameDragParsed[0]['Group A'].map((e) => Object.keys(e)[0]), ['Svc 2', 'Svc 1'], 'same-group drag');

  const groupMoveParsed = YAML.parse(groupMove.services);
  assert.deepEqual(groupMoveParsed.map((g) => Object.keys(g)[0]), ['Group B', 'Group A'], 'group move');
});

test('cross-group service move preserves block style for services with widgets', () => {
  const embyYaml = `# comment
- Media:
    - Emby:
        icon: emby.png
        href: https://emby.mayoko.page
        siteMonitor: https://emby.mayoko.page
        statusStyle: basic
        description: Movie/TV Show Media Server
        widget:
          type: emby
          fields:
            - movies
            - series
            - episodes
          url: https://emby.lan.mayoko.page
          key: removed
          enableBlocks: true
- Other:
    - Service:
        href: https://other
`;
  const files = transform({
    type: 'service.move',
    target: { groupName: 'Media', groupIndex: 0, serviceName: 'Emby', serviceIndex: 0 },
    destinationTarget: { groupName: 'Other', groupIndex: 0 },
    destinationIndex: 1
  }, { services: embyYaml });

  // Structural integrity
  const parsed = YAML.parse(files.services);
  assert.equal(Object.keys(parsed[0]['Media']).length, 0, 'source group must be empty');
  assert.equal(parsed[1]['Other'][1].Emby.href, 'https://emby.mayoko.page');
  assert.equal(parsed[1]['Other'][1].Emby.widget.type, 'emby');
  assert.deepEqual(parsed[1]['Other'][1].Emby.widget.fields, ['movies', 'series', 'episodes']);

  // Block style assertions — the service must NOT be rendered as flow maps/sequences
  // The service name must be a block mapping key: "- Emby:", not "- { Emby:"
  assert.match(files.services, /^    - Emby:$/m, 'service name must be block-style YAML key');
  assert.doesNotMatch(files.services, /Emby: \{/, 'must NOT become flow-style map');

  // The widget sub-map must stay block-style (key: value on own line)
  assert.match(files.services, /^        widget:$/m, 'widget key must be block-style');
  assert.doesNotMatch(files.services, /widget: \{/, 'widget must NOT be flow-style map');

  // The widget fields sequence must stay block-style
  assert.match(files.services, /^            - movies$/m, 'field list items must be block-style');
  assert.match(files.services, /^            - episodes$/m, 'field list items must be block-style');
  assert.doesNotMatch(files.services, /fields: \[/, 'fields must NOT be flow-style sequence');

  // Regular fields must stay block-style
  assert.match(files.services, /^        icon: emby\.png$/m, 'simple fields must be block-style');
  assert.doesNotMatch(files.services, /icon: emby\.png,/, 'simple fields must NOT be inline flow-style');

  // Top comment preserved
  assert.match(files.services, /^# comment$/m, 'top comment preserved');

  // The destination group's existing service should not be affected
  assert.match(files.services, /^    - Service:$/m, 'existing service in destination group preserved');
});

test('preserves commented-out services when moving an active service', () => {
  const services = `# top
- Group A:
    - Active One:
        href: /one
    # - Commented One:
    #     href: /commented
    - Active Two:
        href: /two
`;

  // Move Active Two up one position (before Commented One)
  const files = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Active Two', serviceIndex: 0 },
    direction: 'up'
  }, { services });

  // Both commented-out services must still be present
  assert.match(files.services, /# - Commented One:/);
  assert.match(files.services, /#     href: \/commented/);

  // Active Two must have moved before the comment
  assert.match(files.services, /^    - Active Two:\s*$/m);
  assert.match(files.services, /^    - Active One:\s*$/m);
});

test('preserves commented-out services when moving an active service across groups', () => {
  const services = `# top
- Group A:
    - Active One:
        href: /one
    # - Commented One:
    #     href: /commented
- Group B:
    - Active Two:
        href: /two
`;

  // Move Active One from Group A to Group B
  const files = transform({
    type: 'service.move',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Active One', serviceIndex: 0 },
    destinationTarget: { groupName: 'Group B', groupIndex: 0 },
    destinationIndex: 0
  }, { services });

  // Commented service must stay in Group A
  assert.match(files.services, /# - Commented One:/);
  assert.match(files.services, /#     href: \/commented/);

  // Active One must be in Group B
  assert.match(files.services, /^    - Active One:\s*$/m);
});

test('preserves commented-out services when removing an active service', () => {
  const services = `# top
- Group A:
    - Active One:
        href: /one
    # - Commented One:
    #     href: /commented
    - Active Two:
        href: /two
`;

  const files = transform({
    type: 'service.remove',
    target: { groupName: 'Group A', groupIndex: 0, serviceName: 'Active Two', serviceIndex: 0 }
  }, { services });

  assert.match(files.services, /# - Commented One:/);
  assert.match(files.services, /#     href: \/commented/);
  assert.doesNotMatch(files.services, /^    - Active Two:\s*$/m);
});

test('preserves commented-out groups when moving an active group', () => {
  const services = `# top
# - Commented Group:
#     - Service:
#         href: /
- Active Group:
    - Service One:
        href: /one
- Other Group:
    - Service Two:
        href: /two
`;

  const files = transform({
    type: 'group.move',
    target: { groupName: 'Active Group', groupIndex: 0 },
    direction: 'down'
  }, { services });

  assert.match(files.services, /# - Commented Group:/);
  assert.match(files.services, /#     - Service:/);
});

test('removes group option types from nested layout entries', () => {
  const services = `- Top Group:
    - Direct Service:
        href: https://direct.example
    - Inner Group:
        - Inner Service A:
            href: https://a.example
`;
  const settings = `# keep this settings comment
title: Nested
layout:
  Top Group:
    tab: Main
    customMapping:
      columns: 2
    Inner Group:
      icon: inner.png
      columns: 2
      customMapping:
        columns: 3
  Other Group:
    tab: Other
`;
  const files = transform({
    type: 'option-types.remove',
    options: [
      { name: 'icon', appliesTo: ['group'] },
      { name: 'columns', appliesTo: ['group'] }
    ],
    allOptionNames: ['icon', 'columns', 'customMapping']
  }, { services, settings });
  const parsedSettings = YAML.parse(files.settings);
  // Top-level group options must be removed
  assert.equal(parsedSettings.layout['Top Group'].tab, 'Main');
  assert.equal(parsedSettings.layout['Top Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Top Group'].columns, undefined);
  assert.equal(parsedSettings.layout['Top Group'].customMapping.columns, 2);
  // Nested group options must also be removed
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'].columns, undefined);
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'].customMapping.columns, 3);
  // Unrelated group must keep its non-removed options
  assert.equal(parsedSettings.layout['Other Group'].tab, 'Other');
  assert.match(files.settings, /keep this settings comment/);
});

test('removes group option types from nested layout entries when parent group is absent from services', () => {
  // The parent group "Top Group" is commented out in services, so the
  // services sequence has no entry for it. The fallback must still identify
  // its nested layout while preserving a retained mapping option.
  const services = `# - Top Group:
  #     - Direct Service:
  #         href: https://direct.example
  #     - Inner Group:
  #         - Inner Service A:
  #             href: https://a.example
- Other Group:
    - Service:
        href: https://other.example
`;
  const settings = `# keep this settings comment
title: Nested
layout:
  Top Group:
    tab: Main
    Inner Group:
      icon: inner.png
      customMapping:
        columns: 2
        label: keep
  Other Group:
    tab: Other
`;
  const files = transform({
    type: 'option-types.remove',
    options: [
      { name: 'icon', appliesTo: ['group'] },
      { name: 'columns', appliesTo: ['group'] }
    ],
    allOptionNames: ['icon', 'columns', 'customMapping']
  }, { services, settings });
  const parsedSettings = YAML.parse(files.settings);
  // Top-level group options on the absent parent must still be removed
  assert.equal(parsedSettings.layout['Top Group'].tab, 'Main');
  assert.equal(parsedSettings.layout['Top Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Top Group'].columns, undefined);
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'].icon, undefined);
  assert.deepEqual(parsedSettings.layout['Top Group']['Inner Group'].customMapping, {
    columns: 2,
    label: 'keep'
  });
  // Unrelated group must keep its non-removed options
  assert.equal(parsedSettings.layout['Other Group'].tab, 'Other');
  assert.match(files.settings, /keep this settings comment/);
});

test('removes group option types from a top-level group that is commented out in services', () => {
  // "Inner Group" is commented out in services but has a top-level layout
  // entry. The top-level cleanup (removeMapOptions on the layout pair value)
  // must still remove its options.
  const services = `- Top Group:
    - Direct Service:
        href: https://direct.example
    # - Inner Group:
    #     - Inner Service A:
    #         href: https://a.example
`;
  const settings = `# keep this settings comment
title: Nested
layout:
  Top Group:
    tab: Main
  Inner Group:
    icon: inner.png
    columns: 2
  Other Group:
    tab: Other
`;
  const files = transform({
    type: 'option-types.remove',
    options: [
      { name: 'icon', appliesTo: ['group'] },
      { name: 'columns', appliesTo: ['group'] }
    ]
  }, { services, settings });
  const parsedSettings = YAML.parse(files.settings);
  // Active top-level group options must be removed
  assert.equal(parsedSettings.layout['Top Group'].tab, 'Main');
  assert.equal(parsedSettings.layout['Top Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Top Group'].columns, undefined);
  // Commented-out top-level group's layout options must also be removed
  assert.equal(parsedSettings.layout['Inner Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Inner Group'].columns, undefined);
  // Unrelated group must keep its non-removed options
  assert.equal(parsedSettings.layout['Other Group'].tab, 'Other');
  assert.match(files.settings, /keep this settings comment/);
});

test('removes group option types from nested layout entries when the nested group is commented out in services', () => {
  // The parent "Top Group" is active, but "Inner Group" is commented out
  // in the services sequence. The layout entry for "Inner Group" nested
  // under "Top Group" must still have its options cleaned up.
  const services = `- Top Group:
    - Direct Service:
        href: https://direct.example
    # - Inner Group:
    #     - Inner Service A:
    #         href: https://a.example
`;
  const settings = `# keep this settings comment
title: Nested
layout:
  Top Group:
    tab: Main
    Inner Group:
      icon: inner.png
      columns: 2
  Other Group:
    tab: Other
`;
  const files = transform({
    type: 'option-types.remove',
    options: [
      { name: 'icon', appliesTo: ['group'] },
      { name: 'columns', appliesTo: ['group'] }
    ]
  }, { services, settings });
  const parsedSettings = YAML.parse(files.settings);
  // Top-level group options on the active parent must be removed
  assert.equal(parsedSettings.layout['Top Group'].tab, 'Main');
  assert.equal(parsedSettings.layout['Top Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Top Group'].columns, undefined);
  // Commented-out nested group's layout options must also be removed
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'].icon, undefined);
  assert.equal(parsedSettings.layout['Top Group']['Inner Group'].columns, undefined);
  // Unrelated group must keep its non-removed options
  assert.equal(parsedSettings.layout['Other Group'].tab, 'Other');
  assert.match(files.settings, /keep this settings comment/);
});
