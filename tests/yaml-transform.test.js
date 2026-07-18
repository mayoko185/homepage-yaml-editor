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
    type: 'service.remove',
    target: { groupName: 'First Group', groupIndex: 0, serviceName: 'Second Service', serviceIndex: 0 }
  }, files);
  parsed = YAML.parse(files.services);
  assert.deepEqual(parsed[0]['First Group'].map((item) => Object.keys(item)[0]), ['Renamed Service', 'Added Service']);
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
    type: 'group.rename',
    target: { groupName: 'First Group', groupIndex: 0 },
    values: { name: 'Renamed Group' }
  });
  let parsedServices = YAML.parse(files.services);
  let parsedSettings = YAML.parse(files.settings);
  assert.equal(Object.keys(parsedServices[0])[0], 'Renamed Group');
  assert.equal(parsedSettings.layout['Renamed Group'].tab, 'Main');
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
