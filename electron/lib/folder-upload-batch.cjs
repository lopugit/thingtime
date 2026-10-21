'use strict';
const { governorFor } = require('./folder-resource-governor.cjs');
const { governedFetch, governedHash } = require('./folder-transfer-process.cjs');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { uploadRetry, retryableUploadFailure } = require('./folder-upload.cjs');
const invalid = () => new Error('The pinned upload batch could not be verified.');
const failureCodes = new Set(['conflict', 'temporarily-unavailable', 'authority-changed', 'invalid-member', 'source-changed', 'cancelled', 'deadline']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const text = value => { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 16384) throw invalid(); return value; };
const closed = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw invalid(); return value; };
const pathKey = value => { text(value); if (value.length > 4096 || /[\\\p{Cc}\p{Cf}]/u.test(value) || value.split('/').some(x => !x || x === '.' || x === '..')) throw invalid(); return value.normalize('NFC').toLowerCase(); };
const fingerprint = (value, source) => value?.algorithm === 'sha256-parts-v1' && value.partSizeBytes === 8388608 && value.partCount === 1 && sha(value.sha256) && (!source || value.sha256 === source.fingerprint.sha256);
function batchCanonicalBytes(d) {
    closed(d, ['version', 'batchId', 'scope', 'configuration', 'members']);
    const s = closed(d.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']);
    const saved = closed(d.configuration, ['id', 'updatedAt', 'configuration']);
    const c = closed(saved.configuration, ['configurationVersion', 'name', 'deviceId', 'localRootId', 'sourceKind', 'remoteFolderId', 'mode', 'paused', 'propagateDeletes', 'network', 'chargingOnly', 'excludedPaths', 'ignoreRules', 'resourceLimits']);
    if (d.version !== 1 || !uuid(d.batchId) || s.dataPlane !== 'home' || saved.id !== s.rootId || c.deviceId !== s.deviceId ||
        ![1, 2, 3].includes(c.configurationVersion) || !['backup', 'upload'].includes(c.mode) || c.paused !== false || c.propagateDeletes !== false ||
        (c.sourceKind !== undefined && c.sourceKind !== 'folder') || !Array.isArray(c.excludedPaths) || c.excludedPaths.length > 100 ||
        typeof c.chargingOnly !== 'boolean' || (c.ignoreRules !== undefined && typeof c.ignoreRules !== 'string') ||
        !Array.isArray(d.members) || !d.members.length || d.members.length > 256 || Buffer.byteLength(JSON.stringify(d)) > 327680) throw invalid();
    const ignoreRules = (c.ignoreRules ?? '').replace(/\r\n/g, '\n');
    if (ignoreRules && c.configurationVersion === 1) throw invalid();
    const resourceKeys = ['uploadBytesPerSecond', 'downloadBytesPerSecond', 'transferConcurrency', 'indexingConcurrency', 'cpuPercent'];
    const limits = c.resourceLimits === undefined ? undefined : closed(c.resourceLimits, resourceKeys);
    const limitFields = resourceKeys.map(key => {
        const n = limits?.[key]; if (n === undefined) return '';
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || (['transferConcurrency', 'indexingConcurrency'].includes(key) && !Number.isSafeInteger(n)) || (key === 'cpuPercent' && (!Number.isInteger(n) || n < 1 || n > 100))) throw invalid();
        const bytes = Buffer.alloc(8); bytes.writeDoubleBE(n); return bytes.toString('hex');
    });
    const hasLimits = limitFields.some(Boolean);
    if ((hasLimits && c.configurationVersion !== 3) || (!hasLimits && c.configurationVersion === 3)) throw invalid();
    const fields = [hasLimits ? 'thingtime-upload-batch-v2' : 'thingtime-upload-batch-v1', d.batchId, s.origin, s.ownerId, s.dataPlane, s.rootId, s.deviceId,
        saved.id, saved.updatedAt, hasLimits ? '3' : ignoreRules ? '2' : '1', c.name.trim(), c.deviceId, c.localRootId, c.sourceKind ?? 'folder', c.remoteFolderId,
        c.mode, '0', '0', c.network, c.chargingOnly ? '1' : '0', String(c.excludedPaths.length), ...c.excludedPaths, ignoreRules, ...(hasLimits ? limitFields : []), String(d.members.length)];
    let total = 0; const paths = new Set(), ids = new Set(), inodes = new Set(), destinations = new Set();
    for (const [index, member] of d.members.entries()) {
        closed(member, ['ordinal', 'write']); const w = closed(member.write, ['operation', 'scope', 'folderId', 'before', 'cloudRootId']);
        const op = closed(w.operation, ['id', 'mutation', 'confirmed']), m = closed(op.mutation, ['kind', 'from', 'path', 'source', 'expectedTarget']);
        const e = closed(m.source, ['path', 'id', 'version', 'kind', 'size', 'sha256', 'fingerprint']);
        closed(e.fingerprint, ['algorithm', 'partSizeBytes', 'partCount', 'sha256']); closed(w.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']);
        const key = pathKey(m.path), destination = JSON.stringify([w.folderId, pathKey(m.path.split('/').at(-1))]);
        if (member.ordinal !== index || !uuid(op.id) || op.confirmed !== false || m.kind !== 'copy' || m.from !== 'local' || m.expectedTarget !== null ||
            e.path !== m.path || e.kind !== 'file' || !Number.isSafeInteger(e.size) || e.size < 1 || e.size > 262144 || e.sha256 !== null || !fingerprint(e.fingerprint) ||
            w.before !== null || w.cloudRootId !== c.remoteFolderId || Object.keys(s).some(k => w.scope[k] !== s[k]) ||
            paths.has(key) || ids.has(op.id) || inodes.has(e.id) || destinations.has(destination)) throw invalid();
        paths.add(key); ids.add(op.id); inodes.add(e.id); destinations.add(destination); total += e.size;
        fields.push(String(index), op.id, w.cloudRootId, w.folderId, m.path, e.id, e.version, String(e.size), '', e.fingerprint.algorithm,
            String(e.fingerprint.partSizeBytes), String(e.fingerprint.partCount), e.fingerprint.sha256);
    }
    if (total > 33554432) throw invalid();
    // Empty ignore text/raw hash are intentional; all other fields are strings.
    if (fields.some(f => typeof f !== 'string')) throw invalid();
    return Buffer.from(fields.map(f => `${Buffer.byteLength(f)}:${f}`).join(''));
}
async function requestBatchPhase(context, body, signal) {
    const phaseSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    let response;
    try {
        response = await context.window.webContents.session.fetch(new URL('/api/v1/files/batches', context.appOrigin).href, {
            method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', bypassCustomProtocolHandlers: true, signal: phaseSignal,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: context.appOrigin,
                'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': context.apiOrigin }, body: JSON.stringify(body)
        });
        if (response.redirected) throw invalid();
        if ([408, 429].includes(response.status) || response.status >= 500) throw uploadRetry();
        if (response.status !== 200 || (context.appOrigin !== context.apiOrigin && response.headers.get('x-thingtime-api-fallback') !== context.apiOrigin)) throw invalid();
        if (!response.body) throw invalid();
        const reader = response.body.getReader(); let size = 0; const chunks = [];
        try {
            for (;;) { const { value, done } = await reader.read(); phaseSignal.throwIfAborted(); if (done) break;
                size += value.length; if (size > 2097152) throw invalid(); chunks.push(Buffer.from(value)); }
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
        signal.throwIfAborted(); if (phaseSignal.reason?.name === 'TimeoutError' || retryableUploadFailure(error)) throw uploadRetry();
        throw error;
    } finally { if (!response?.body?.locked) await response?.body?.cancel().catch(() => {}); }
}
async function uploadFolderBatch({ input, context, signal, assertCurrent, requestNative, fetchUpload,
    requestPhase = (body, phaseSignal) => requestBatchPhase(context, body, phaseSignal), now = () => performance.now() }) {
    const descriptor = structuredClone(input.batch?.descriptor), digest = input.batch?.digest;
    if (!sha(digest) || createHash('sha256').update(batchCanonicalBytes(descriptor)).digest('hex') !== digest ||
        descriptor.scope.origin !== context.apiOrigin || descriptor.scope.ownerId !== context.ownerId || descriptor.scope.deviceId !== input.deviceId ||
        descriptor.configuration.configuration.localRootId !== input.rootId) throw invalid();
    const governor = governorFor(input, context);
    const started = now(), deadline = started + 30000, lifetime = new AbortController();
    const combined = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(180000)]);
    const states = descriptor.members.map(member => ({ member, prepared: null, confirmed: null, content: null, bytes: null, received: 0, put: 'none', payload: 0, checksum: null }));
    let prepareRounds = 0, verified = false, active = 0;
    const check = extra => { combined.throwIfAborted(); extra?.throwIfAborted(); assertCurrent(); if (now() - started >= 180000) throw invalid(); };
    const phase = async (body, callbackSignal) => {
        check(callbackSignal); const phaseSignal = callbackSignal ? AbortSignal.any([combined, callbackSignal]) : combined;
        const reply = await requestPhase({ ...body, descriptor, digest }, phaseSignal); check(callbackSignal);
        if (reply?.ok !== true || reply.version !== 1 || reply.batchId !== descriptor.batchId || reply.digest !== digest || !Array.isArray(reply.results)) throw invalid();
        return reply.results;
    };
    const content = (value, ordinal, uploadId) => {
        const e = states[ordinal].member.write.operation.mutation.source;
        if (!value || value.ordinal !== ordinal || (uploadId && value.uploadId !== uploadId) || !text(value.uploadId) || !sha(value.version) ||
            value.size !== e.size || !fingerprint(value.fingerprint, e)) throw invalid();
        return structuredClone(value);
    };
    const failed = row => {
        if (!failureCodes.has(row.code) || !Number.isSafeInteger(row.statusCode) || row.statusCode < 400 || row.statusCode > 599 || typeof row.retryable !== 'boolean') throw invalid();
        if (row.code === 'authority-changed') throw invalid();
        return { ordinal: row.ordinal, status: 'failed', statusCode: row.statusCode, code: row.code, retryable: row.retryable };
    };
    const exchange = async (frame, callbackSignal) => {
        check(callbackSignal);
        if (frame.kind === 'prepare-ready') {
            closed(frame, ['kind', 'checksums']);
            if (++prepareRounds > 2 || !Array.isArray(frame.checksums) || frame.checksums.length > states.length ||
                (prepareRounds === 1 && frame.checksums.length)) throw invalid();
            let previous = -1;
            for (const row of frame.checksums) {
                closed(row, ['ordinal', 'sha256']); const s = states[row.ordinal];
                if (!s || row.ordinal <= previous || !sha(row.sha256) ||
                    createHash('sha256').update(Buffer.from(row.sha256, 'hex')).digest('hex') !== s.member.write.operation.mutation.source.fingerprint.sha256) throw invalid();
                previous = row.ordinal; s.checksum = row.sha256;
            }
            const rows = await phase({ phase: 'prepare', checksums: frame.checksums }, callbackSignal);
            if (rows.length !== states.length) throw invalid();
            return { results: rows.map((row, ordinal) => {
                if (row.ordinal !== ordinal) throw invalid(); const s = states[ordinal];
                if (row.status === 'confirmed') {
                    if (!row.file || typeof row.replayed !== 'boolean') throw invalid(); s.confirmed = structuredClone(row);
                    return { ordinal, status: 'confirmed' };
                }
                if (row.status === 'verified') { s.content = content(row.content, ordinal); return { ordinal, status: 'verified', content: s.content }; }
                if (row.status === 'source-required') { if (s.checksum) throw invalid(); return { ordinal, status: 'source-required' }; }
                if (row.status === 'failed') return failed(row);
                if (row.status !== 'prepared' || !s.checksum || row.upload?.partCount !== 1 || row.upload.partSizeBytes !== 8388608 ||
                    !text(row.upload.id) || row.part?.partNumber !== 1 || !row.part.headers || Object.keys(row.part.headers).length !== 1 ||
                    row.part.headers['x-amz-checksum-sha256'] !== Buffer.from(s.checksum, 'hex').toString('base64')) throw invalid();
                const target = new URL(row.part.url);
                if (target.username || target.password || target.hash || (target.protocol !== 'https:' && target.origin !== context.apiOrigin) ||
                    target.searchParams.get('partNumber') !== '1' || !target.searchParams.get('uploadId') || !(Date.parse(row.part.expiresAt) > Date.now())) throw invalid();
                s.prepared = { id: row.upload.id, target, headers: row.part.headers };
                return { ordinal, status: 'prepared', uploadId: row.upload.id };
            }) };
        }
        const s = states[frame.ordinal];
        if (frame.kind === 'chunk') {
            closed(frame, ['kind', 'ordinal', 'offset', 'data']);
            if (!s?.prepared || s.put !== 'none' || frame.offset !== s.received || typeof frame.data !== 'string' || frame.data.length > 87384 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw invalid();
            const bytes = Buffer.from(frame.data, 'base64'), size = s.member.write.operation.mutation.source.size;
            if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== frame.data || s.received + bytes.length > size) throw invalid();
            s.bytes ??= Buffer.alloc(size); bytes.copy(s.bytes, s.received); s.received += bytes.length; return { accepted: true };
        }
        if (frame.kind === 'put-ready') {
            closed(frame, ['kind', 'ordinal', 'sha256']);
            if (!s?.prepared || s.put !== 'none' || frame.sha256 !== s.checksum || !s.bytes || s.received !== s.bytes.length ||
                await governedHash(governor, s.bytes, combined) !== s.checksum || active >= 16 || verified) throw invalid();
            if (now() >= deadline) { s.bytes.fill(0); s.bytes = null; s.put = 'deadline'; return { status: 'failed', code: 'deadline' }; }
            check(callbackSignal); s.put = 'pending'; active++;
            const putSignal = AbortSignal.any([combined, callbackSignal, AbortSignal.timeout(60000)]); let response;
            try {
                response = await governedFetch(governor, fetchUpload, s.prepared.target, { method: 'PUT', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
                    signal: putSignal, headers: s.prepared.headers, body: s.bytes }, () => check(callbackSignal));
                check(callbackSignal);
                if (response.redirected) throw invalid();
                if (!response.ok) { s.put = 'failed'; return { status: 'failed', code: [408, 429].includes(response.status) || response.status >= 500 ? 'temporarily-unavailable' : 'invalid-member' }; }
                s.put = 'accepted'; s.payload = s.received; return { status: 'accepted', payloadBytes: s.payload };
            } catch (error) {
                check(callbackSignal);
                if (putSignal.reason?.name === 'TimeoutError' || retryableUploadFailure(error)) { s.put = 'unknown'; s.payload = null; return { status: 'unknown' }; }
                throw invalid();
            } finally { active--; s.bytes?.fill(0); s.bytes = null; await response?.body?.cancel().catch(() => {}); }
        }
        if (frame.kind === 'verify-ready') {
            closed(frame, ['kind', 'uploads']);
            if (verified || active || !Array.isArray(frame.uploads)) throw invalid(); verified = true;
            const expected = states.filter(s => ['accepted', 'unknown'].includes(s.put));
            if (frame.uploads.length !== expected.length || frame.uploads.some((row, index) => row.ordinal !== expected[index].member.ordinal || row.uploadId !== expected[index].prepared.id)) throw invalid();
            const rows = await phase({ phase: 'verify', uploads: frame.uploads }, callbackSignal);
            if (rows.length !== expected.length) throw invalid();
            return { results: rows.map((row, index) => {
                const s = expected[index], ordinal = s.member.ordinal;
                if (row.ordinal !== ordinal) throw invalid();
                if (row.status === 'failed') return failed(row);
                if (row.status !== 'verified') throw invalid();
                s.content = content(row.content, ordinal, s.prepared.id); return { ordinal, status: 'verified', content: s.content };
            }) };
        }
        throw invalid();
    };
    try {
        const reply = await requestNative({ ...input, batch: { descriptor, digest }, origin: context.apiOrigin }, { onBatchFrame: exchange, signal: combined });
        check(); const result = reply?.uploadedBatch;
        if (!result || result.ok !== true || result.version !== 1 || result.batchId !== descriptor.batchId || result.digest !== digest ||
            !Array.isArray(result.results) || result.results.length !== states.length || !Array.isArray(result.payloads) || result.payloads.length !== states.length) throw invalid();
        const results = result.results.map((row, ordinal) => {
            const s = states[ordinal]; if (row.ordinal !== ordinal) throw invalid();
            if (row.status === 'confirmed') { if (!s.confirmed) throw invalid(); return s.confirmed; }
            if (row.status === 'failed') return failed(row);
            if (row.status !== 'verified' || !s.content || ['ordinal', 'uploadId', 'version', 'size'].some(key => row.content?.[key] !== s.content[key]) || !fingerprint(row.content?.fingerprint, s.member.write.operation.mutation.source)) throw invalid();
            return { ordinal, status: 'verified', content: s.content };
        });
        for (const [ordinal, row] of result.payloads.entries()) if (row.ordinal !== ordinal || row.bytes !== states[ordinal].payload) throw invalid();
        return { ...reply, ...(governor ? { resources: governor.snapshot() } : {}), uploadedBatch: { ...result, results } };
    } finally { lifetime.abort(); states.forEach(s => { s.bytes?.fill(0); s.bytes = null; s.prepared = null; }); }
}
module.exports = { batchCanonicalBytes, requestBatchPhase, uploadFolderBatch };
