// CodeMirror editor wrapper functions
// Requires init(yamlCodeEditor) to be called before use.

let editor = null;

export function init(yamlCodeEditor) {
    editor = yamlCodeEditor;
}

export function getEditorValue() {
    return editor.getValue();
}

export function setEditorValue(value) {
    editor.setValue(String(value || ''));
    editor.clearHistory();
}

export function getSelectedLineNumbers(editorInstance) {
    const lineNumbers = new Set();
    (editorInstance || editor).listSelections().forEach(({ anchor, head }) => {
        const from = CodeMirror.cmpPos(anchor, head) <= 0 ? anchor : head;
        const to = CodeMirror.cmpPos(anchor, head) <= 0 ? head : anchor;
        const endLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
        for (let line = from.line; line <= endLine; line++) {
            lineNumbers.add(line);
        }
    });
    return Array.from(lineNumbers).sort((left, right) => left - right);
}

export function toggleSelectedComments(editorInstance) {
    const ed = editorInstance || editor;
    const lineNumbers = getSelectedLineNumbers(ed);
    const lines = lineNumbers.map((lineNumber) => ed.getLine(lineNumber) || '');
    const nonBlankLines = lines.filter((line) => line.trim().length > 0);
    const shouldUncomment = nonBlankLines.length > 0
        && nonBlankLines.every((line) => /^\s*#/.test(line));

    ed.operation(() => {
        lineNumbers.forEach((lineNumber, index) => {
            const currentLine = lines[index];
            const nextLine = shouldUncomment
                ? currentLine.replace(/^(\s*)# ?/, '$1')
                : currentLine.replace(/^(\s*)/, '$1# ');
            if (nextLine !== currentLine) {
                ed.replaceRange(
                    nextLine,
                    { line: lineNumber, ch: 0 },
                    { line: lineNumber, ch: currentLine.length },
                    '+toggleComment'
                );
            }
        });
    });
    ed.focus();
}

export function toggleLineRangeComments(editorInstance, startLine, endLine, forceUncomment) {
    const ed = editorInstance || editor;
    const lines = [];
    for (let i = startLine; i <= endLine; i++) {
        lines.push(ed.getLine(i) || '');
    }
    const nonBlankLines = lines.filter((line) => line.trim().length > 0);
    const shouldUncomment = forceUncomment || (nonBlankLines.length > 0 && nonBlankLines.every((line) => /^\s*#/.test(line)));

    ed.operation(() => {
        lines.forEach((currentLine, offset) => {
            const lineNumber = startLine + offset;
            const nextLine = shouldUncomment
                ? currentLine.replace(/^(\s*)# ?/, '$1')
                : currentLine.replace(/^(\s*)/, '$1# ');
            if (nextLine !== currentLine) {
                ed.replaceRange(
                    nextLine,
                    { line: lineNumber, ch: 0 },
                    { line: lineNumber, ch: currentLine.length },
                    '+toggleCommentBlock'
                );
            }
        });
    });
}
