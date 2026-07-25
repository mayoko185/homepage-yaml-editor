// API wrapper functions — no DOM dependencies
import { configTabNames, sampleConfigs } from './constants.js';

export function getSaveErrorSummary(error) {
    const message = error && error.message ? error.message : error;
    return String(message || 'The operation could not be completed').split('\n')[0].trim();
}

export function addErrorGuidance(error, guidance) {
    const summary = getSaveErrorSummary(error);
    return `${summary}${/[.!?]$/.test(summary) ? '' : '.'} ${guidance}`;
}

export function getApiErrorMessage(data, response, fallback) {
    const details = typeof data?.details === 'string' ? data.details.trim() : '';
    const errorMessage = typeof data?.error === 'string' ? data.error.trim() : '';
    if (details) return details;
    if (errorMessage) return errorMessage;
    const status = response && response.status ? ` (HTTP ${response.status})` : '';
    return `${fallback}${status}`;
}

export function formatYamlError(error) {
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

export function formatYamlErrorLocation(error) {
    if (!error.line) {
        return 'Line unavailable';
    }
    return `Line ${error.line}${error.column ? `, column ${error.column}` : ''}`;
}

export async function loadSampleConfigs() {
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

export async function loadOptionDefinitions() {
    const response = await fetch('/api/option-types', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not load option types'));
    }
    return data.options;
}

export async function saveOptionTypes(options) {
    const response = await fetch('/api/option-types', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not save option types'));
    }
    return data;
}

export async function requestDirectoryLoad(dirPath) {
    const response = await fetch('/api/directory/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not load the configuration directory'));
    }
    return data;
}

export async function saveConfigFile(tabName, content, fileName, revision) {
    const response = await fetch('/api/directory/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabName, content, fileName, revision })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not save configuration file'));
    }
    return data;
}

export async function loadPersistentAppSettings() {
    const response = await fetch('/api/app-settings', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not load editor settings'));
    }
    return data.settings || {};
}

export async function persistAppSettings(settings) {
    const response = await fetch('/api/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not save editor settings'));
    }
    return data;
}

export async function transformPreviewYaml(files, operation) {
    const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, operation })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error(getApiErrorMessage(data, response, 'Could not apply the edit'));
    }
    return data;
}

        export function createZipBlob(files) {
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

        // Directory loading via API calls to server (the only functional approach)

        export function getZipDateParts(date) {
            const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
            const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
            return { dosTime, dosDate };
        }


        export function writeUint32(bytes, value) {
            bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
        }


        export function writeUint16(bytes, value) {
            bytes.push(value & 0xff, (value >>> 8) & 0xff);
        }


        export function getCrc32(bytes) {
            let crc = 0xffffffff;
            for (const byte of bytes) {
                crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
            }
            return (crc ^ 0xffffffff) >>> 0;
        }


        export function makeCrc32Table() {
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

