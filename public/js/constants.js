// Application constants — no DOM dependencies, no side effects
export const configTabNames = Object.freeze([
    'services',
    'settings',
    'bookmarks',
    'widgets',
    'docker',
    'proxmox',
    'kubernetes'
]);

export const configTabLabels = Object.freeze({
    services: 'Services',
    settings: 'Settings',
    bookmarks: 'Bookmarks',
    widgets: 'Widgets',
    docker: 'Docker',
    proxmox: 'Proxmox',
    kubernetes: 'Kubernetes'
});

export const sampleConfigs = Object.fromEntries(
    configTabNames.map((tabName) => [tabName, ''])
);

export const createNewTabGroupValue = '__create_new_service_group__';
export const defaultPageTitle = 'Homepage YAML Editor';

export const fileToTabMapping = Object.freeze(
    Object.fromEntries(configTabNames.flatMap((tabName) => [
        [`${tabName}.yaml`, tabName],
        [`${tabName}.yml`, tabName]
    ]))
);

export const optionValueTypeChoices = ['text', 'textarea', 'boolean', 'tab', 'mapping', 'select'];
export const blankSelectControlValue = '__homepage_yaml_editor_blank_select__';
export const optionAppliesToChoices = Object.freeze([
    { value: 'service', label: 'S', tooltip: 'Services' },
    { value: 'group', label: 'G', tooltip: 'Service groups' },
    { value: 'bookmark', label: 'B', tooltip: 'Bookmarks' },
    { value: 'widget', label: 'W', tooltip: 'Service widgets' }
]);

export const settingsTabNames = Object.freeze(['appearance', 'misc', 'yaml']);
