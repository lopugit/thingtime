'use strict';
const fs = require('node:fs');
const path = require('node:path');
const codes = new Set(['transport-retry', 'transport-refused', 'response-origin', 'http-retry', 'http-rejected', 'response-invalid']);
const actions = new Set(['context', 'upload-part', 'list', 'choose', 'conditions', 'remove', 'scan', 'scan-stream', 'scan-stream-finish', 'scan-changes', 'scan-capture', 'scan-status', 'scan-cancel', 'scan-skips', 'scan-page', 'scan-discard', 'inspect', 'read', 'read-range', 'stage-begin', 'stage-append', 'stage-range', 'stage-finish', 'write-approve', 'write-check', 'publication-lookup', 'publish', 'trash', 'trash-lookup', 'trash-expected', 'trash-inspect', 'trash-restore', 'trash-list', 'trash-restore-reviewed']);
const steps = new Set(['capture', 'admission', 'account-verification', 'capability-verification', 'native-request', 'reply-verification']);
const failureCodes = new Set(['node_timeout', 'node_unavailable', 'node_protocol_error', 'folder_unavailable', 'folder_identity_retry', 'cancelled', 'unsupported_feature', 'host-refused', 'unclassified']);
// Only closed signer and folder-request classifications are recorded. Never serialize an Error,
// request, response, URL, path, owner identity or caller-provided extra fields.
function recordFolderSyncDiagnostic(file, value) {
    const row = value?.phase === 'upload-sign' && codes.has(value.code) && Number.isInteger(value.status) &&
        (value.status === 0 || (value.status >= 100 && value.status <= 599)) ? { phase: 'upload-sign', code: value.code, status: value.status } :
        value?.phase === 'folder-request' && actions.has(value.action) && steps.has(value.step) && failureCodes.has(value.code) ?
            { phase: 'folder-request', action: value.action, step: value.step, code: value.code } : null;
    if (!row) return;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && fs.statSync(file).size >= 128 * 1024) fs.renameSync(file, file + '.previous');
        fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...row }) + '\n', { mode: 0o600 });
    } catch { /* Diagnostics cannot affect a transfer or disclose an I/O error. */ }
}
module.exports = { recordFolderSyncDiagnostic };
