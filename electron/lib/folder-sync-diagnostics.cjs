'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const codes = new Set(['transport-retry', 'transport-refused', 'response-origin', 'http-retry', 'http-rejected', 'response-invalid']);
const actions = new Set(['context', 'upload-part', 'list', 'choose', 'conditions', 'remove', 'scan', 'scan-stream', 'scan-stream-finish', 'scan-changes', 'scan-capture', 'scan-status', 'scan-cancel', 'scan-skips', 'scan-page', 'scan-discard', 'inspect', 'read', 'read-range', 'stage-begin', 'stage-append', 'stage-range', 'stage-finish', 'write-approve', 'write-check', 'publication-lookup', 'publish', 'trash', 'trash-lookup', 'trash-expected', 'trash-inspect', 'trash-restore', 'trash-list', 'trash-restore-reviewed']);
const steps = new Set(['capture', 'admission', 'account-verification', 'capability-verification', 'native-request', 'reply-verification']);
const failureCodes = new Set(['node_timeout', 'node_unavailable', 'node_protocol_error', 'folder_unavailable', 'folder_identity_retry', 'cancelled', 'unsupported_feature', 'host-refused', 'unclassified']);
const milliseconds = ['totalMs', 'queueMs', 'accountMs', 'capabilityMs', 'nativeMs', 'replyMs'];
const counts = ['accountCount', 'capabilityCount', 'nativeCount'];
const scalar = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
// Own data scalars only: getters/proxies, arbitrary errors and caller metadata
// cannot enter the log. Invalid diagnostics never affect a folder request.
function closedRow(value) {
    try {
        if (!value || typeof value !== 'object') return null;
        const phase = scalar(value, 'phase'), code = scalar(value, 'code'), action = scalar(value, 'action');
        if (phase === 'upload-sign' && codes.has(code)) {
            const status = scalar(value, 'status');
            return Number.isInteger(status) && (status === 0 || (status >= 100 && status <= 599)) ? { phase, code, status } : null;
        }
        if (!actions.has(action)) return null;
        if (phase === 'folder-request') {
            const step = scalar(value, 'step');
            return steps.has(step) && failureCodes.has(code) ? { phase, action, step, code } : null;
        }
        if (phase !== 'folder-timing') return null;
        const outcome = scalar(value, 'outcome');
        if (!['ok', 'failed', 'cancelled'].includes(outcome)) return null;
        const row = { phase, action, outcome };
        for (const name of [...milliseconds, ...counts]) {
            const n = scalar(value, name), maximum = counts.includes(name) ? 128 : 600_000;
            if (!Number.isSafeInteger(n) || n < 0 || n > maximum) return null;
            row[name] = n;
        }
        return row;
    } catch { return null; }
}
// Bounded, serial asynchronous IO: a stalled disk drops later diagnostics at
// capacity; transfers never wait for the log queue. One rotated previous file.
let pending = 0, tail = Promise.resolve();
function recordFolderSyncDiagnostic(file, value) {
    const row = closedRow(value);
    if (!row || pending >= 128) return Promise.resolve();
    const encoded = JSON.stringify({ time: new Date().toISOString(), ...row }) + '\n';
    pending++;
    tail = tail.then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const stat = await fs.stat(file).catch(() => null);
        if (stat && stat.size >= 128 * 1024) await fs.rename(file, file + '.previous');
        await fs.appendFile(file, encoded, { mode: 0o600 });
    }).catch(() => { /* No diagnostic IO error reaches a transfer. */ }).finally(() => { pending--; });
    return tail;
}
module.exports = { recordFolderSyncDiagnostic };
