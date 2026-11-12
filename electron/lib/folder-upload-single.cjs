'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const { governorFor } = require('./folder-resource-governor.cjs');
const { governedFetch, governedHash } = require('./folder-transfer-process.cjs');
const { uploadRetry, retryableUploadFailure } = require('./folder-upload.cjs');
// Matches MobileFolderBulkReader.maximumFileBytes: processing eligibility only.
const SINGLE_UPLOAD_BYTES = 262144;
const invalid = () => new Error('The pinned single upload could not be verified.');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const closed = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw invalid(); return value; };
function configuration(value) {
    const c = closed(value, ['configurationVersion', 'name', 'deviceId', 'localRootId', 'remoteFolderId', 'sourceKind', 'mode', 'paused', 'propagateDeletes', 'network', 'chargingOnly', 'excludedPaths', 'ignoreRules', 'resourceLimits']);
    if (![1, 2, 3].includes(c.configurationVersion) || typeof c.name !== 'string' || !c.name.trim() ||
        ![c.deviceId, c.localRootId, c.remoteFolderId].every(id) || c.paused !== false ||
        !['upload', 'two-way', 'backup'].includes(c.mode) || typeof c.propagateDeletes !== 'boolean' ||
        (c.mode === 'backup' && c.propagateDeletes) || !['any', 'wifi'].includes(c.network) || typeof c.chargingOnly !== 'boolean' ||
        !Array.isArray(c.excludedPaths) || c.excludedPaths.some(p => typeof p !== 'string') ||
        (c.sourceKind !== undefined && c.sourceKind !== 'folder') || (c.ignoreRules !== undefined && typeof c.ignoreRules !== 'string')) throw invalid();
    return { ...c, name: c.name.trim(), sourceKind: c.sourceKind ?? 'folder', ignoreRules: (c.ignoreRules ?? '').replace(/\r\n/g, '\n') };
}
async function singleJson(context, path, body, signal) {
    // Paths are generated only by this transport, never supplied by the renderer.
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    let response;
    try {
        response = await context.window.webContents.session.fetch(new URL(path, context.appOrigin).href, {
            method: body === undefined ? 'GET' : 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', bypassCustomProtocolHandlers: true, signal: bounded,
            headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: context.appOrigin }),
                'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': context.apiOrigin },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        if (response.redirected || (context.appOrigin !== context.apiOrigin && response.headers.get('x-thingtime-api-fallback') !== context.apiOrigin)) throw invalid();
        if ([408, 429].includes(response.status) || response.status >= 500) throw uploadRetry();
        if (![200, 409].includes(response.status) || !response.body) throw invalid();
        const reader = response.body.getReader(); let size = 0; const chunks = [];
        try { for (;;) { const { value, done } = await reader.read(); bounded.throwIfAborted(); if (done) break;
            size += value.length; if (size > (response.status === 409 ? 4096 : 1048576)) throw invalid(); chunks.push(Buffer.from(value)); }
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.status === 409) {
                if (['/api/v1/attachments/uploads', '/api/v1/attachments/uploads/complete'].includes(new URL(path, context.apiOrigin).pathname) &&
                    value?.ok === false && value.retryable === true && ['upload_initializing', 'finalization_in_progress', 'finalization_settling'].includes(value.code)) throw uploadRetry();
                throw invalid();
            }
            return value;
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) { signal.throwIfAborted(); if (bounded.reason?.name === 'TimeoutError' || retryableUploadFailure(error)) throw uploadRetry(); throw error; }
    finally { if (!response?.body?.locked) await response?.body?.cancel().catch(() => {}); }
}
async function uploadFolderSingle({ input, context, signal, authorize, assertCurrent, requestNative, fetchUpload, signPart,
    json = (path, body, active) => singleJson(context, path, body, active) }) {
    const upload = structuredClone(input.upload), source = upload?.source, approval = upload?.authorization;
    closed(upload, ['uploadId', 'requestId', 'source', 'authorization']);
    closed(approval, ['id', 'updatedAt', 'scope', 'configuration']);
    const scope = closed(approval.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']), c = configuration(approval.configuration);
    if (!id(upload.uploadId) || !id(upload.requestId) || !id(approval.id) || !Number.isFinite(Date.parse(approval.updatedAt)) ||
        scope.origin !== context.apiOrigin || scope.ownerId !== context.ownerId || scope.dataPlane !== 'home' || scope.rootId !== approval.id || scope.deviceId !== input.deviceId ||
        c.deviceId !== input.deviceId || c.localRootId !== input.rootId || !isDeepStrictEqual(c.resourceLimits, input.resourceLimits) ||
        !source || source.symbolicLink !== undefined || source.kind !== 'file' || !Number.isSafeInteger(source.size) || source.size < 1 || source.size > SINGLE_UPLOAD_BYTES ||
        source.fingerprint?.algorithm !== 'sha256-parts-v1' || source.fingerprint.partCount !== 1 || source.fingerprint.partSizeBytes !== 8388608 || !sha(source.fingerprint.sha256)) throw invalid();
    const governor = governorFor(input, context), lifetime = new AbortController(), active = AbortSignal.any([signal, lifetime.signal]);
    let bytes = null, received = 0, checksum, prepared = false, put = false, verified = null, payloadBytes = 0;
    const check = extra => { active.throwIfAborted(); extra?.throwIfAborted(); assertCurrent(); };
    const authority = async extra => {
        check(extra); const authoritySignal = extra ? AbortSignal.any([active, extra]) : active;
        await authorize(authoritySignal); check(extra);
        const response = await json('/api/v1/things?' + new URLSearchParams({ id: approval.id }), undefined, authoritySignal); check(extra);
        const row = response?.thing;
        if (response?.ok !== true || row?.id !== approval.id || row.updatedAt !== approval.updatedAt || row.author?.id !== context.ownerId ||
            row.appId != null || row.targetId != null || !isDeepStrictEqual(row.acl, ['tt:user']) || !isDeepStrictEqual(row.thingtime, ['file-sync']) ||
            !isDeepStrictEqual(configuration(row.crystal), c)) throw invalid();
    };
    const content = value => {
        if (value?.id !== upload.uploadId || value.size !== source.size || !sha(value.version) || !isDeepStrictEqual(value.fingerprint, source.fingerprint)) throw invalid();
        return { attachmentId: upload.uploadId, version: value.version, size: value.size, fingerprint: structuredClone(value.fingerprint) };
    };
    const exchange = async (frame, callbackSignal) => {
        check(callbackSignal);
        if (frame.kind === 'prepare-ready') {
            closed(frame, ['kind', 'checksums']);
            if (prepared || !Array.isArray(frame.checksums) || frame.checksums.length !== 1 || frame.checksums[0].ordinal !== 0 || !sha(frame.checksums[0].sha256) ||
                createHash('sha256').update(Buffer.from(frame.checksums[0].sha256, 'hex')).digest('hex') !== source.fingerprint.sha256) throw invalid();
            checksum = frame.checksums[0].sha256; prepared = true;
            await authority(callbackSignal);
            // Resume an already completed attachment before emitting any bytes.
            const started = await json('/api/v1/attachments/uploads', { requestId: upload.requestId, filename: source.path.split('/').at(-1), contentType: 'application/octet-stream', sizeBytes: source.size, purpose: 'file' }, active);
            check(callbackSignal);
            if (started?.upload?.id !== upload.uploadId || started.upload.partSizeBytes !== 8388608 || started.upload.partCount !== 1) throw invalid();
            if (started.upload.state === 'ready') { await authority(callbackSignal); verified = content(await json('/api/v1/attachments/content?' + new URLSearchParams({ id: upload.uploadId, fingerprint: '1' }), undefined, active)); return { ready: true, content: verified }; }
            return { ready: false };
        }
        if (frame.kind === 'chunk') {
            closed(frame, ['kind', 'ordinal', 'offset', 'data']);
            if (!prepared || verified || put || frame.ordinal !== 0 || frame.offset !== received || typeof frame.data !== 'string' || frame.data.length > 87384 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw invalid();
            const chunk = Buffer.from(frame.data, 'base64');
            if (!chunk.length || chunk.length > 65536 || chunk.toString('base64') !== frame.data || received + chunk.length > source.size) throw invalid();
            bytes ??= Buffer.alloc(source.size); chunk.copy(bytes, received); received += chunk.length; return { accepted: true };
        }
        if (frame.kind === 'put-ready') {
            closed(frame, ['kind', 'ordinal', 'sha256']);
            if (!prepared || verified || put || frame.ordinal !== 0 || frame.sha256 !== checksum || received !== source.size || !bytes || await governedHash(governor, bytes, active) !== checksum) throw invalid();
            await authority(callbackSignal);
            const signed = await signPart({ uploadId: upload.uploadId, parts: [{ partNumber: 1, checksumSha256: Buffer.from(checksum, 'hex').toString('base64') }] }); check(callbackSignal);
            const part = signed?.parts?.[0];
            if (!Array.isArray(signed?.parts) || signed.parts.length !== 1 || part.partNumber !== 1 || !part.headers || Object.keys(part.headers).length !== 1 || part.headers['x-amz-checksum-sha256'] !== Buffer.from(checksum, 'hex').toString('base64')) throw invalid();
            const target = new URL(part.url, context.apiOrigin);
            if (target.username || target.password || target.hash || (target.protocol !== 'https:' && target.origin !== context.apiOrigin)) throw invalid();
            await authority(callbackSignal); put = true;
            const monitorAbort = new AbortController();
            const monitorSignal = AbortSignal.any([active, monitorAbort.signal]);
            const monitor = (async () => {
                while (!monitorSignal.aborted) {
                    try { await delay(1000, undefined, { signal: monitorSignal }); await authority(AbortSignal.any([monitorSignal, ...(callbackSignal ? [callbackSignal] : [])])); }
                    catch (error) {
                        // Only cancellation belonging to this completed PUT is
                        // disposable. An observed authority refusal remains fatal.
                        const ownCancellation = monitorAbort.signal.aborted && (error === monitorAbort.signal.reason || (error?.code === 'ABORT_ERR' && error.cause === monitorAbort.signal.reason));
                        if (!ownCancellation) lifetime.abort(error);
                        return;
                    }
                }
            })();
            let response;
            try {
                response = await governedFetch(governor, fetchUpload, target, { method: 'PUT', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: part.headers, body: bytes, signal: active }, () => check(callbackSignal));
                check(callbackSignal); if (response.redirected) throw invalid();
                if (!response.ok) { if ([408, 429].includes(response.status) || response.status >= 500) throw uploadRetry(); throw invalid(); }
                payloadBytes = source.size; await authority(callbackSignal); return { status: 'accepted', payloadBytes };
            } catch (error) { check(callbackSignal); if (retryableUploadFailure(error)) { payloadBytes = null; return { status: 'unknown' }; } throw error; }
            finally { monitorAbort.abort(); await monitor; bytes?.fill(0); bytes = null; await response?.body?.cancel().catch(() => {}); }
        }
        if (frame.kind === 'verify-ready') {
            closed(frame, ['kind']); if (!put || verified) throw invalid();
            await authority(callbackSignal); const completed = await json('/api/v1/attachments/uploads/complete', { uploadId: upload.uploadId }, active);
            check(callbackSignal); if (completed?.ok !== true) throw invalid();
            await authority(callbackSignal); verified = content(await json('/api/v1/attachments/content?' + new URLSearchParams({ id: upload.uploadId, fingerprint: '1' }), undefined, active));
            check(callbackSignal); return { content: verified };
        }
        throw invalid();
    };
    try {
        await authority();
        const result = await requestNative({ ...input, upload, origin: context.apiOrigin }, { onBatchFrame: exchange, signal: active });
        await authority(); check();
        if (!verified || !isDeepStrictEqual(result?.uploadedSingle, verified)) throw invalid();
        return { ...result, uploadedSingle: { ...verified, payloadBytes } };
    } finally { lifetime.abort(); bytes?.fill(0); bytes = null; }
}
module.exports = { SINGLE_UPLOAD_BYTES, uploadFolderSingle, configuration, singleJson };
