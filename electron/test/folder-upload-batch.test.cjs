'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { batchCanonicalBytes, uploadFolderBatch, requestBatchPhase } = require('../lib/folder-upload-batch.cjs');
const { DesktopFolderSync } = require('../lib/folder-sync.cjs');
const vectors = require('../../remix/app/fileSync/fixtures/uploadBatchDigest.v1.json');
const hex = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(count = 1) {
    const d = structuredClone(vectors.vectors[0].descriptor), payloads = Array.from({ length: count }, (_, i) => Buffer.from('payload-' + i));
    const prototype = d.members[0];
    d.members = payloads.map((bytes, ordinal) => {
        const member = structuredClone(prototype), source = member.write.operation.mutation.source;
        member.ordinal = ordinal; member.write.operation.id = randomUUID(); source.id = 'inode-' + ordinal;
        source.path = member.write.operation.mutation.path = 'Parent/file-' + ordinal; source.size = bytes.length;
        source.fingerprint.sha256 = hex(Buffer.from(hex(bytes), 'hex')); return member;
    });
    const digest = hex(batchCanonicalBytes(d)), phases = [], nativeFrames = [];
    const source = i => d.members[i].write.operation.mutation.source;
    const content = i => ({ ordinal: i, uploadId: 'upload-' + i, version: 'c'.repeat(64), size: source(i).size, fingerprint: source(i).fingerprint });
    const requestPhase = async body => {
        phases.push(body); assert.equal(body.digest, digest); assert.deepEqual(body.descriptor, d);
        const results = body.phase === 'prepare' ? d.members.map(({ ordinal }) => {
            const checksum = body.checksums.find(r => r.ordinal === ordinal);
            return checksum ? { ordinal, status: 'prepared', upload: { id: 'upload-' + ordinal, partCount: 1, partSizeBytes: 8388608 },
                part: { partNumber: 1, expiresAt: new Date(Date.now() + 600000).toISOString(),
                    url: `https://storage.test/part-${ordinal}?partNumber=1&uploadId=provider-${ordinal}&X-Amz-Signature=synthetic`,
                    headers: { 'x-amz-checksum-sha256': Buffer.from(checksum.sha256, 'hex').toString('base64') } } } : { ordinal, status: 'source-required' };
        }) : body.uploads.map(({ ordinal }) => ({ ordinal, status: 'verified', content: content(ordinal) }));
        return { ok: true, version: 1, batchId: d.batchId, digest, results };
    };
    const input = { action: 'upload-batch', requestId: randomUUID(), ownerId: d.scope.ownerId, deviceId: d.scope.deviceId,
        origin: d.scope.origin, rootId: d.configuration.configuration.localRootId, batch: { descriptor: d, digest } };
    const context = { apiOrigin: d.scope.origin, appOrigin: 'http://127.0.0.1:54000', ownerId: d.scope.ownerId };
    // Synthetic native producer only. Real local source/XPC coverage is in the
    // Swift batch and duplex tests; this checks production Electron orchestration.
    const native = async (request, options) => {
        const exchange = async frame => { nativeFrames.push(frame); const reply = await options.onBatchFrame(frame, options.signal); nativeFrames.push(reply); return reply; };
        await exchange({ kind: 'prepare-ready', checksums: [] });
        await exchange({ kind: 'prepare-ready', checksums: payloads.map((bytes, ordinal) => ({ ordinal, sha256: hex(bytes) })) });
        const outcomes = new Array(count), payloadResults = new Array(count); let next = 0;
        await Promise.all(Array.from({ length: Math.min(16, count) }, async () => {
            while (next < count) {
                const i = next++, bytes = payloads[i];
                for (let offset = 0; offset < bytes.length; offset += 65536) assert.deepEqual(await exchange({ kind: 'chunk', ordinal: i, offset, data: bytes.subarray(offset, offset + 65536).toString('base64') }), { accepted: true });
                const ack = await exchange({ kind: 'put-ready', ordinal: i, sha256: hex(bytes) });
                payloadResults[i] = { ordinal: i, bytes: ack.status === 'accepted' ? bytes.length : ack.status === 'unknown' ? null : 0 };
                outcomes[i] = ack.status === 'failed' ? { ordinal: i, status: 'failed', statusCode: 503, code: ack.code, retryable: true } : null;
            }
        }));
        const uploads = outcomes.flatMap((row, ordinal) => row ? [] : [{ ordinal, uploadId: 'upload-' + ordinal }]);
        if (uploads.length) {
            const result = await exchange({ kind: 'verify-ready', uploads });
            for (const row of result.results) outcomes[row.ordinal] = row;
        }
        return { ...request, roots: [], uploadedBatch: { ok: true, version: 1, batchId: d.batchId, digest, results: outcomes, payloads: payloadResults } };
    };
    return { d, digest, payloads, phases, nativeFrames, requestPhase, input, context, native };
}
async function batchHost(f, options = {}) {
    const rows = [], mainFrame = { url: f.context.appOrigin }, contents = { mainFrame }, window = { webContents: contents, isDestroyed: () => false };
    contents.session = { fetch: async (_url, init) => Response.json(await f.requestPhase(JSON.parse(init.body)), {
        headers: { 'x-thingtime-api-fallback': f.context.apiOrigin } }) };
    const host = new DesktopFolderSync({ context: () => ({ ...f.context, enabled: true, window }),
        verifyAccount: options.verifyAccount ?? (async () => {}), requestNative: async (_method, request, nativeOptions) => {
            if (request.action === 'context') return { ...request, roots: [], capabilities: { fileAccessVersion: '1.13.0', fileUploadBatchVersion: '1.0.0' } };
            if (request.action === 'suspend') return {};
            return (options.native ?? f.native)(request, nativeOptions);
        }, capabilities: async () => ({ schemaVersion: 1, origin: f.context.apiOrigin, features: {
            'api.devices-node-identity': { version: '1.0.0' }, 'api.file-sync-batches': { version: '1.0.0' } } }),
        fetchUpload: options.fetchUpload ?? (async () => new Response(null, { status: 200 })), diagnostic: row => rows.push(row) });
    const event = { sender: contents, senderFrame: mainFrame };
    await host.request(event, { ...f.input, action: 'context', batch: undefined });
    return { rows, run: () => host.request(event, f.input), cancel: () => host.cancel() };
}
const batchTiming = rows => rows.find(row => row.phase === 'folder-timing' && row.action === 'upload-batch');
const batchCounts = row => Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith('batch') && !key.startsWith('batchFailure')));
test('Electron matches both shared canonical digest vectors and rejects changed members', () => {
    for (const v of vectors.vectors) {
        const bytes = batchCanonicalBytes(v.descriptor); assert.equal(bytes.length, v.canonicalBytes); assert.equal(bytes.toString('base64'), v.canonicalBase64); assert.equal(hex(bytes), v.digest);
    }
    const f = fixture(); f.d.members.push(structuredClone(f.d.members[0])); assert.throws(() => batchCanonicalBytes(f.d));
});
test('production DesktopFolderSync handles256 members with one native operation and only two fresh account checks', async () => {
    const f = fixture(256), rows = []; let accounts = 0, nativeCalls = 0, active = 0, maximum = 0, puts = 0;
    const mainFrame = { url: f.context.appOrigin }, contents = { mainFrame }, window = { webContents: contents, isDestroyed: () => false };
    const event = { sender: contents, senderFrame: mainFrame };
    contents.session = { fetch: async (url, options) => {
        assert.equal(new URL(url).pathname, '/api/v1/files/batches'); assert.equal(options.credentials, 'include');
        assert.equal(options.headers.Origin, f.context.appOrigin);
        const body = JSON.parse(options.body), response = await f.requestPhase(body);
        return Response.json(response, { headers: { 'x-thingtime-api-fallback': f.context.apiOrigin } });
    } };
    const host = new DesktopFolderSync({ context: () => ({ ...f.context, enabled: true, window }),
        verifyAccount: async () => { accounts++; }, requestNative: async (_method, request, options) => {
            nativeCalls++;
            if (request.action === 'context') return { ...request, roots: [], capabilities: { fileAccessVersion: '1.13.0', fileUploadBatchVersion: '1.0.0' } };
            return f.native(request, options);
        }, capabilities: async () => ({ schemaVersion: 1, origin: f.context.apiOrigin, features: {
            'api.devices-node-identity': { version: '1.0.0' }, 'api.file-sync-batches': { version: '1.0.0' } } }),
        fetchUpload: async (url, options) => {
            active++; maximum = Math.max(maximum, active); puts++;
            try {
                assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
                assert.equal(new URL(url).searchParams.get('partNumber'), '1');
                assert.deepEqual(Object.keys(options.headers), ['x-amz-checksum-sha256']);
                assert.equal(options.headers['x-amz-checksum-sha256'], createHash('sha256').update(options.body).digest('base64'));
                await new Promise(setImmediate); return new Response(null, { status: 200 });
            } finally { active--; }
        }, diagnostic: row => rows.push(row) });
    await host.request(event, { ...f.input, action: 'context', batch: undefined }); accounts = 0; nativeCalls = 0;
    const result = await host.request(event, f.input);
    assert.equal(result.uploadedBatch.results.length, 256); assert.ok(result.uploadedBatch.results.every(r => r.status === 'verified'));
    assert.equal(accounts, 2); assert.equal(nativeCalls, 1); assert.equal(puts, 256); assert.equal(maximum, 16);
    assert.deepEqual(f.phases.map(p => p.phase), ['prepare', 'prepare', 'verify']);
    assert.ok(!/storage\.test|X-Amz-Signature|cookie/i.test(JSON.stringify(f.nativeFrames)));
    const timing = rows.filter(r => r.phase === 'folder-timing' && r.action === 'upload-batch');
    assert.equal(timing.length, 1); assert.equal(timing[0].accountCount, 2); assert.equal(timing[0].nativeCount, 1);
    assert.deepEqual(batchCounts(timing[0]), { batchMemberCount: 256, batchVerifiedCount: 256, batchReceiptCount: 0, batchFailedCount: 0,
        batchPayloadAcknowledgedCount: 256, batchPayloadUnknownCount: 0, batchPayloadAcknowledgedBytes: f.payloads.reduce((sum, b) => sum + b.length, 0) });
});
test('lost PUT responses remain unknown and retain original upload IDs through stored verification', async () => {
    const f = fixture(); let puts = 0;
    const h = await batchHost(f, { fetchUpload: async () => { puts++; throw Object.assign(Error('redacted'), { code: 'ECONNRESET' }); } });
    const result = await h.run();
    assert.deepEqual(batchCounts(batchTiming(h.rows)), { batchMemberCount: 1, batchVerifiedCount: 1, batchReceiptCount: 0, batchFailedCount: 0, batchPayloadAcknowledgedCount: 0, batchPayloadUnknownCount: 1, batchPayloadAcknowledgedBytes: 0 });
    assert.equal(puts, 1); assert.deepEqual(result.uploadedBatch.payloads, [{ ordinal: 0, bytes: null }]);
    assert.equal(result.uploadedBatch.results[0].content.uploadId, 'upload-0');
});
test('dispatch deadline and navigation cancellation refuse PUT without weakening source bounds', async () => {
    const f = fixture(); let clock = 0, puts = 0;
    const result = await uploadFolderBatch({ ...f, signal: new AbortController().signal, assertCurrent: () => {},
        requestNative: async (request, options) => f.native(request, { ...options, onBatchFrame: async (...args) => {
            if (args[0].kind === 'put-ready') clock = 30001; return options.onBatchFrame(...args);
        } }), now: () => clock, fetchUpload: async () => { puts++; return new Response(null); } });
    assert.equal(puts, 0); assert.equal(result.uploadedBatch.results[0].code, 'deadline');
    await assert.rejects(uploadFolderBatch({ ...fixture(), signal: new AbortController().signal, assertCurrent: () => { throw Error('navigation'); },
        requestNative: f.native, fetchUpload: async () => { puts++; } }), /navigation/); assert.equal(puts, 0);
});

test('V1 and V2 without ignore rules match the shared vector canonical policy', () => {
    const d = structuredClone(vectors.vectors[0].descriptor); delete d.configuration.configuration.ignoreRules;
    const expected = Buffer.from(Buffer.from(vectors.vectors[0].canonicalBase64, 'base64').toString('utf8').replace('1:2', '1:1').replace('6:*.tmp\n', '0:'));
    for (const version of [1, 2]) {
        d.configuration.configuration.configurationVersion = version;
        assert.deepEqual(batchCanonicalBytes(d), expected);
    }
    d.configuration.configuration.configurationVersion = 1; d.configuration.configuration.ignoreRules = '*.tmp';
    assert.throws(() => batchCanonicalBytes(d));
});

test('mixed receipt, ready, failed source and PUT outcomes verify only the selected ordinal', async () => {
    const f = fixture(4), confirmedFile = { id: f.d.members[0].write.operation.id, name: 'file-0' };
    const content = ordinal => ({ ordinal, uploadId: 'upload-' + ordinal, version: 'c'.repeat(64), size: f.payloads[ordinal].length,
        fingerprint: f.d.members[ordinal].write.operation.mutation.source.fingerprint });
    const failure = { ordinal: 2, status: 'failed', statusCode: 409, code: 'source-changed', retryable: false };
    const base = [{ ordinal: 0, status: 'confirmed', file: confirmedFile, replayed: true },
        { ordinal: 1, status: 'verified', content: content(1) }, failure];
    const requestPhase = async body => {
        if (body.phase === 'verify') {
            assert.deepEqual(body.uploads, [{ ordinal: 3, uploadId: 'upload-3' }]);
            return { ok: true, version: 1, batchId: f.d.batchId, digest: f.digest, results: [{ ordinal: 3, status: 'verified', content: content(3) }] };
        }
        const ordinary = await f.requestPhase(body);
        return { ...ordinary, results: [...base, ordinary.results[3]] };
    };
    const native = async (request, options) => {
        const exchange = frame => options.onBatchFrame(frame, options.signal);
        const first = await exchange({ kind: 'prepare-ready', checksums: [] });
        assert.deepEqual(first.results.map(r => r.status), ['confirmed', 'verified', 'failed', 'source-required']);
        await exchange({ kind: 'prepare-ready', checksums: [{ ordinal: 3, sha256: hex(f.payloads[3]) }] });
        await exchange({ kind: 'chunk', ordinal: 3, offset: 0, data: f.payloads[3].toString('base64') });
        assert.deepEqual(await exchange({ kind: 'put-ready', ordinal: 3, sha256: hex(f.payloads[3]) }), { status: 'accepted', payloadBytes: f.payloads[3].length });
        const final = await exchange({ kind: 'verify-ready', uploads: [{ ordinal: 3, uploadId: 'upload-3' }] });
        return { ...request, roots: [], uploadedBatch: { ok: true, version: 1, batchId: f.d.batchId, digest: f.digest,
            results: [{ ordinal: 0, status: 'confirmed' }, first.results[1], failure, final.results[0]],
            payloads: f.payloads.map((b, ordinal) => ({ ordinal, bytes: ordinal === 3 ? b.length : 0 })) } };
    };
    let puts = 0;
    const h = await batchHost({ ...f, requestPhase }, { native, fetchUpload: async () => { puts++; return new Response(null, { status: 200 }); } });
    const result = await h.run();
    assert.deepEqual(batchCounts(batchTiming(h.rows)), { batchMemberCount: 4, batchVerifiedCount: 2, batchReceiptCount: 1, batchFailedCount: 1,
        batchPayloadAcknowledgedCount: 1, batchPayloadUnknownCount: 0, batchPayloadAcknowledgedBytes: f.payloads[3].length });
    assert.equal(puts, 1); assert.deepEqual(result.uploadedBatch.results[0].file, confirmedFile);
    assert.deepEqual(result.uploadedBatch.results.map(r => r.status), ['confirmed', 'verified', 'failed', 'verified']);
});


test('batch timing omits result counters after final account refusal or invalid response binding', async () => {
    for (const mode of ['post-account', 'binding', 'cancelled']) {
        const f = fixture(); let finished = false; let h;
        h = await batchHost(f, { verifyAccount: async () => { if (finished && mode === 'post-account') throw Error('authority-refused'); },
            native: async (request, options) => {
                const result = await f.native(request, options); finished = true;
                if (mode === 'binding') result.ownerId = 'wrong-owner';
                if (mode === 'cancelled') { h.cancel(); options.signal.throwIfAborted(); }
                return result;
            } });
        await assert.rejects(h.run());
        const row = batchTiming(h.rows); assert.ok(row); assert.equal(row.outcome, mode === 'cancelled' ? 'cancelled' : 'failed'); assert.deepEqual(batchCounts(row), {});
    }
});


test('validated upload batch diagnostics count actual closed failure codes, not status or paths', async () => {
    const { BATCH_FAILURE_FIELDS } = require('../lib/folder-sync-diagnostics.cjs');
    const codes = [...Object.keys(BATCH_FAILURE_FIELDS).filter(code => code !== 'authority-changed'), 'source-changed', 'source-changed'];
    const f = fixture(codes.length);
    const h = await batchHost(f, { native: async (request, options) => {
        const value = await f.native(request, options);
        value.uploadedBatch.results = codes.map((code, ordinal) => ({ ordinal, status: 'failed', statusCode: 409, code, retryable: false }));
        return value;
    } });
    const reply = await h.run();
    assert.deepEqual(reply.uploadedBatch.results.map(r => r.code), codes, 'logging never changes member results');
    const row = batchTiming(h.rows);
    assert.equal(row.batchFailedCount, codes.length);
    for (const [code, field] of Object.entries(BATCH_FAILURE_FIELDS)) assert.equal(row[field], codes.filter(c => c === code).length);
    assert.equal(Object.keys(row).filter(k => k.startsWith('batchFailure')).length, 7);
    assert.doesNotMatch(JSON.stringify(row), /uploadId|signed|https:|inode-|Parent|operationId/);
    const allGood = await batchHost(fixture()); await allGood.run();
    for (const field of Object.values(BATCH_FAILURE_FIELDS)) assert.equal(batchTiming(allGood.rows)[field], 0);
    const deniedFixture = fixture();
    const denied = await batchHost(deniedFixture, { native: async (request, options) => {
        const value = await deniedFixture.native(request, options);
        value.uploadedBatch.results = [{ ordinal: 0, status: 'failed', statusCode: 403, code: 'authority-changed', retryable: false }];
        return value;
    } });
    await assert.rejects(denied.run(), /could not be verified/);
    assert.equal(Object.keys(batchTiming(denied.rows)).some(k => k.startsWith('batch')), false, 'whole authority refusal has no accepted member histogram');
});
