'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordFolderSyncDiagnostic } = require('../lib/folder-sync-diagnostics.cjs');
test('bounded signer log rejects unknown categories and omits arbitrary metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-diagnostic-')), file = path.join(directory, 'folder-sync.log');
    try {
        await recordFolderSyncDiagnostic(file, { phase: 'secret-path', code: 'http-rejected', status: 403 });
        await recordFolderSyncDiagnostic(file, { phase: 'upload-sign', code: 'secret-message', status: 403 });
        assert.equal(fs.existsSync(file), false);
        await recordFolderSyncDiagnostic(file, { phase: 'upload-sign', code: 'http-rejected', status: 403,
            url: 'https://private.invalid/?credential=secret', ownerId: 'secret-owner', error: Error('secret-message') });
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(Object.keys(value), ['time', 'phase', 'code', 'status']);
        assert.equal(value.status, 403); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        fs.appendFileSync(file, 'x'.repeat(128 * 1024));
        await recordFolderSyncDiagnostic(file, { phase: 'upload-sign', code: 'response-invalid', status: 200 });
        assert.ok(fs.statSync(file).size < 1024); assert.ok(fs.existsSync(file + '.previous'));
        assert.ok(!/private|secret|credential/.test(fs.readFileSync(file, 'utf8')));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('request failures persist only closed action, step and native code, never error text or bindings', async () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'folder-request-diagnostic-')), file=path.join(directory,'folder-sync.log');
    try {
        for(const patch of [{action:'/private/secret'}, {step:'private-secret'}, {code:'private-secret'}])
            await recordFolderSyncDiagnostic(file,{phase:'folder-request',action:'inspect',step:'native-request',code:'node_unavailable',...patch});
        assert.equal(fs.existsSync(file),false);
        await recordFolderSyncDiagnostic(file,{phase:'folder-request',action:'inspect',step:'native-request',code:'node_unavailable',
            path:'/private/secret',ownerId:'private-owner',error:Error('private-secret')});
        const row=JSON.parse(fs.readFileSync(file,'utf8'));
        assert.deepEqual(Object.keys(row),['time','phase','action','step','code']);
        assert.equal(row.code,'node_unavailable');assert.doesNotMatch(JSON.stringify(row),/private|secret|owner/);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('timing rows contain only bounded own scalars, rotate, and drop malformed diagnostics without throwing', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-timing-')), file = path.join(directory, 'folder-sync.log');
    const row = { phase: 'folder-timing', action: 'inspect', outcome: 'ok', totalMs: 42, queueMs: 7,
        accountMs: 12, accountCount: 3, capabilityMs: 5, capabilityCount: 1, nativeMs: 18, nativeCount: 1, replyMs: 4 };
    try {
        for (const patch of [{ action: '/private' }, { outcome: 'secret' }, { totalMs: 600001 }, { queueMs: -1 },
            { accountMs: NaN }, { replyMs: Infinity }, { nativeMs: 1.5 }, { nativeCount: 129 }, { capabilityCount: undefined }])
            await recordFolderSyncDiagnostic(file, { ...row, ...patch });
        await recordFolderSyncDiagnostic(file, new Proxy({}, { getOwnPropertyDescriptor() { throw Error('secret'); } }));
        await recordFolderSyncDiagnostic(file, { ...row, get totalMs() { throw Error('secret'); } });
        assert.equal(fs.existsSync(file), false);
        await recordFolderSyncDiagnostic(file, { ...row, path: '/private/source', url: 'https://private', ownerId: 'secret', error: Error('secret') });
        const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
        delete actual.time; assert.deepEqual(actual, row);
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /private|secret|owner|error|url/);
        fs.appendFileSync(file, 'x'.repeat(128 * 1024));
        await recordFolderSyncDiagnostic(file, row);
        assert.ok(fs.statSync(file).size < 1024); assert.ok(fs.existsSync(file + '.previous'));
        const writes = Array.from({ length: 130 }, () => recordFolderSyncDiagnostic(file, row));
        await Promise.all(writes);
        assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 129, 'Only 128 queued writes admitted');
        await recordFolderSyncDiagnostic(path.join(file, 'cannot-write'), row);
        await recordFolderSyncDiagnostic(file, { ...row, action: 'upload-batch', signedUrl: 'private-secret' });
        const batch = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1));
        assert.equal(batch.action, 'upload-batch'); assert.doesNotMatch(JSON.stringify(batch), /private|secret|signedUrl/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('optional batch timing counters are closed, bounded, atomic and absent on legacy rows', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-batch-diagnostic-')), file = path.join(directory, 'folder-sync.log');
    const base = { phase: 'folder-timing', action: 'upload-batch', outcome: 'ok', totalMs: 20, queueMs: 0,
        accountMs: 2, accountCount: 2, capabilityMs: 0, capabilityCount: 0, nativeMs: 15, nativeCount: 1, replyMs: 3 };
    const counts = { batchMemberCount: 4, batchVerifiedCount: 2, batchReceiptCount: 1, batchFailedCount: 1,
        batchPayloadAcknowledgedCount: 1, batchPayloadUnknownCount: 1, batchPayloadAcknowledgedBytes: 7 };
    try {
        for (const patch of [{ batchMemberCount: 0 }, { batchMemberCount: 257 }, { batchVerifiedCount: 3 }, { batchFailedCount: -1 },
            { batchReceiptCount: 0.5 }, { batchPayloadUnknownCount: 5 }, { batchPayloadAcknowledgedBytes: 33_554_433 },
            { batchPayloadAcknowledgedBytes: NaN }, { batchPayloadAcknowledgedCount: 0 }, { outcome: 'failed' }, { outcome: 'cancelled' }, { action: 'inspect' }])
            await recordFolderSyncDiagnostic(file, { ...base, ...counts, ...patch });
        const incomplete = { ...base, ...counts }; delete incomplete.batchReceiptCount;
        await recordFolderSyncDiagnostic(file, incomplete);
        let getterCalls = 0;
        await recordFolderSyncDiagnostic(file, { ...base, ...counts, get batchMemberCount() { getterCalls++; throw Error('secret'); } });
        assert.equal(getterCalls, 0); assert.equal(fs.existsSync(file), false);
        await recordFolderSyncDiagnostic(file, base);
        const legacy = JSON.parse(fs.readFileSync(file, 'utf8')); delete legacy.time; assert.deepEqual(legacy, base);
        await recordFolderSyncDiagnostic(file, { ...base, ...counts, path: 'private-path', signedUrl: 'private-secret', ownerId: 'private-owner' });
        const row = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1)); delete row.time;
        assert.deepEqual(row, { ...base, ...counts }); assert.doesNotMatch(JSON.stringify(row), /private|secret|owner|signedUrl|path/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
