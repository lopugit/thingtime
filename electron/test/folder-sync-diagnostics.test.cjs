'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordFolderSyncDiagnostic } = require('../lib/folder-sync-diagnostics.cjs');
test('bounded signer log rejects unknown categories and omits arbitrary metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-diagnostic-')), file = path.join(directory, 'folder-sync.log');
    try {
        recordFolderSyncDiagnostic(file, { phase: 'secret-path', code: 'http-rejected', status: 403 });
        recordFolderSyncDiagnostic(file, { phase: 'upload-sign', code: 'secret-message', status: 403 });
        assert.equal(fs.existsSync(file), false);
        recordFolderSyncDiagnostic(file, { phase: 'upload-sign', code: 'http-rejected', status: 403,
            url: 'https://private.invalid/?credential=secret', ownerId: 'secret-owner', error: Error('secret-message') });
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(Object.keys(value), ['time', 'phase', 'code', 'status']);
        assert.equal(value.status, 403); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        fs.appendFileSync(file, 'x'.repeat(128 * 1024));
        recordFolderSyncDiagnostic(file, { phase: 'upload-sign', code: 'response-invalid', status: 200 });
        assert.ok(fs.statSync(file).size < 1024); assert.ok(fs.existsSync(file + '.previous'));
        assert.ok(!/private|secret|credential/.test(fs.readFileSync(file, 'utf8')));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
