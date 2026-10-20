'use strict';
const fs = require('node:fs');
const path = require('node:path');
const codes = new Set(['transport-retry', 'transport-refused', 'response-origin', 'http-retry', 'http-rejected', 'response-invalid']);
// Only fixed signer classifications are recorded. Never serialize an Error,
// request, response, URL, path, owner identity or caller-provided extra fields.
function recordFolderSyncDiagnostic(file, value) {
    if (value?.phase !== 'upload-sign' || !codes.has(value.code) || !Number.isInteger(value.status) ||
        (value.status !== 0 && (value.status < 100 || value.status > 599))) return;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && fs.statSync(file).size >= 128 * 1024) fs.renameSync(file, file + '.previous');
        fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), phase: 'upload-sign',
            code: value.code, status: value.status }) + '\n', { mode: 0o600 });
    } catch { /* Diagnostics cannot affect a transfer or disclose an I/O error. */ }
}
module.exports = { recordFolderSyncDiagnostic };
