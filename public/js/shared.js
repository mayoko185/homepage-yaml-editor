// Shared module-level variables assigned during DOMContentLoaded
// Both app.js and preview.js import from here to avoid circular dependencies.
export let yamlCodeEditor = null;
export let previewAddTabModal = null;
export let saveStatusElement = null;

export function setYamlCodeEditor(editor) { yamlCodeEditor = editor; }
export function setPreviewAddTabModal(el) { previewAddTabModal = el; }
export function setSaveStatusElement(el) { saveStatusElement = el; }
