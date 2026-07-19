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
  assert.equal(parsedSettings.layout['Renamed Inner'].icon, 'updated.png');
  assert.equal(parsedSettings.layout['Renamed Inner'].columns, 3);
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

test('converts a flat service group into a nested group and adjusts the sub-group count', () => {
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

  let files = transform({
    type: 'group.convert-to-nested',
    target: { groupName: 'Flat Group', groupIndex: 0 }
  }, { services: flatServices, settings: flatSettings });
  let parsed = YAML.parse(files.services);
  const entries = parsed[0]['Flat Group'];
  assert.equal(entries.length, 1);
  assert.equal(Object.keys(entries[0])[0], '1');
  const subGroup = entries[0]['1'];
  assert.equal(subGroup.length, 3);
  assert.equal(Object.keys(subGroup[0])[0], 'Service A');
  assert.equal(Object.keys(subGroup[2])[0], 'Service C');

  files = transform({
    type: 'group.set-nested-count',
    target: { groupName: 'Flat Group', groupIndex: 0 },
    values: { count: 3 }
  }, files);
  parsed = YAML.parse(files.services);
  const afterExpand = parsed[0]['Flat Group'];
  assert.equal(afterExpand.length, 3);
  assert.deepEqual(afterExpand.map((entry) => Object.keys(entry)[0]), ['1', '2', '3']);
  assert.equal(afterExpand[0]['1'].length, 3);
  assert.equal(afterExpand[1]['2'].length, 0);
  assert.equal(afterExpand[2]['3'].length, 0);

  files = transform({
    type: 'group.set-nested-count',
    target: { groupName: 'Flat Group', groupIndex: 0 },
    values: { count: 1 }
  }, { services: files.services, settings: flatSettings });
  parsed = YAML.parse(files.services);
  const merged = parsed[0]['Flat Group'];
  assert.equal(merged.length, 1);
  assert.equal(Object.keys(merged[0])[0], '1');
});

test('set-nested-count merges services from removed sub-groups into the last kept one', () => {
  const services = `- Top:
    - "1":
        - A:
            href: https://a.example
    - "2":
        - B:
            href: https://b.example
    - "3":
        - C:
            href: https://c.example
`;
  const files = transform({
    type: 'group.set-nested-count',
    target: { groupName: 'Top', groupIndex: 0 },
    values: { count: 1 }
  }, { services, settings: 'title: T\n' });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.equal(entries.length, 1);
  const subGroup = entries[0]['1'];
  assert.deepEqual(subGroup.map((service) => Object.keys(service)[0]), ['A', 'B', 'C']);
});

test('set-nested-count renames existing sub-groups to numbered names', () => {
  const services = `- Top:
    - Alpha:
        - A:
            href: https://a.example
    - Beta:
        - B:
            href: https://b.example
`;
  const files = transform({
    type: 'group.set-nested-count',
    target: { groupName: 'Top', groupIndex: 0 },
    values: { count: 2 }
  }, { services, settings: 'title: T\n' });
  const parsed = YAML.parse(files.services);
  const entries = parsed[0]['Top'];
  assert.deepEqual(entries.map((entry) => Object.keys(entry)[0]), ['1', '2']);
  assert.equal(entries[0]['1'][0]['A'].href, 'https://a.example');
  assert.equal(entries[1]['2'][0]['B'].href, 'https://b.example');
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
