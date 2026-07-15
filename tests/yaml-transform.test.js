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

  files = transform({ type: 'group.add', values: { name: 'Added Group' } }, files);
  parsedServices = YAML.parse(files.services);
  assert.deepEqual(parsedServices.map((group) => Object.keys(group)[0]), ['Second Group', 'Added Group']);
});

test('rejects invalid YAML and invalid movement', () => {
  assert.throws(() => transformPreviewYaml({
    files: { services: '- broken: [', settings },
    operation: { type: 'group.add', values: { name: 'New' } }
  }), /services\.yaml is invalid/);

  assert.throws(() => transform({
    type: 'group.move',
    target: { groupName: 'First Group', groupIndex: 0 },
    direction: 'up'
  }), /cannot be moved/);
});
