'use strict';
const { governorFor } = require('./folder-resource-governor.cjs');
const { governedDownload } = require('./folder-transfer-process.cjs');
const { retryableUploadFailure: isTransientNetworkFailure } = require('./folder-upload.cjs');
const downloadRetry = () => Object.assign(new Error('[folder_download_retry] Folder download is temporarily unavailable. Retry after reconnecting.'), { code: 'SYNC_DOWNLOAD_RETRY' });
const temporaryStatus = status => status === 408 || status === 429 || (status >= 500 && status <= 599);
const invalid = () => new Error('The pinned cloud download could not be verified.');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fingerprint = (a, b) => a?.algorithm === 'sha256-parts-v1' && a.algorithm === b?.algorithm && a.partSizeBytes === b.partSizeBytes && a.partCount === b.partCount && a.sha256 === b.sha256 && hex(a.sha256);
async function authenticatedJson(context, path, signal) {
    const lifetime = signal;
    signal = AbortSignal.any([lifetime, AbortSignal.timeout(20000)]);
    try {
        const response = await context.window.webContents.session.fetch(new URL(path, context.appOrigin).href, {
            credentials: 'include', redirect: 'error', cache: 'no-store', bypassCustomProtocolHandlers: true, signal,
            headers: { Accept: 'application/json', 'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': context.apiOrigin }
        });
        try {
            const fallback = response.headers.get('x-thingtime-api-fallback');
            if (response.redirected || (context.appOrigin !== context.apiOrigin && fallback !== null && fallback !== context.apiOrigin)) throw invalid();
            // A local proxy cooldown can produce a temporary response before it
            // attaches the verified upstream origin. Successful reads still need it.
            if (temporaryStatus(response.status)) throw downloadRetry();
            if (!response.ok || (context.appOrigin !== context.apiOrigin && fallback !== context.apiOrigin) || !response.body) throw invalid();
            const reader = response.body.getReader(); let total = 0; const chunks = [];
            try {
                for (;;) { const part = await reader.read(); signal.throwIfAborted(); if (part.done) break; total += part.value.length; if (total > 65536) throw invalid(); chunks.push(Buffer.from(part.value)); }
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        } finally { await response.body?.cancel().catch(() => {}); }
    } catch (error) {
        lifetime.throwIfAborted();
        if (signal.reason?.name === 'TimeoutError' || isTransientNetworkFailure(error) ||
            (error instanceof Error && /net::ERR_(?:TIMED_OUT|CONNECTION_(?:RESET|CLOSED|FAILED|ABORTED)|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE)\b/.test(error.message)))
            throw downloadRetry();
        throw error;
    }
}
async function stageFolderDownload({ input, context, signal, authorize, assertCurrent, requestNative,
    json = (path, active) => authenticatedJson(context, path, active), download = governedDownload, diagnostic = () => {} }) {
    const at = async (step, work) => {
        try { return await work(); }
        catch (error) {
            if (!signal.aborted) {
                try { Promise.resolve(diagnostic({ phase: 'download-stage', step, code: error?.code === 'SYNC_DOWNLOAD_RETRY' ? 'temporary' : 'rejected' })).catch(() => {}); }
                catch { /* Diagnostic IO cannot change a transfer result. */ }
            }
            throw error;
        }
    };
    const file = input.cloudFile, transfer = input.transfer, source = transfer?.operation?.mutation?.source;
    if (!file || !id(file.id) || !id(file.revision) || !id(file.content?.attachmentId) || !hex(file.content.version) || file.trashed !== false ||
        !Number.isSafeInteger(file.content.size) || file.content.size <= 0 || !Number.isSafeInteger(input.offset) || input.offset < 0 ||
        !Number.isSafeInteger(input.length) || input.length <= 0 || input.length > 2097152 || input.offset + input.length > file.content.size ||
        transfer.rootId !== input.rootId || (input.resourceScope !== undefined && transfer.scope?.rootId !== input.resourceScope) || transfer.scope.origin !== context.apiOrigin || transfer.scope.ownerId !== context.ownerId ||
        transfer.scope.deviceId !== input.deviceId || transfer.scope.dataPlane !== 'home' || source?.kind !== 'file' || source.id !== file.id || source.version !== file.revision ||
        source.size !== file.content.size || !fingerprint(source.fingerprint, file.content.fingerprint)) throw invalid();
    const governor = governorFor(input, context, true);
    const check = async () => { signal.throwIfAborted(); assertCurrent(); await authorize(); signal.throwIfAborted(); assertCurrent(); };
    const binding = { requestId: input.requestId, ownerId: context.ownerId, deviceId: input.deviceId, origin: context.apiOrigin,
        rootId: input.rootId, transfer, ...(input.resourceLimits ? { resourceLimits: input.resourceLimits, resourceScope: input.resourceScope } : {}) };
    const validReply = value => value && ['requestId','ownerId','deviceId','origin','rootId'].every(key => value[key] === binding[key]);
    await check();
    // Existing idempotent staging lookup precedes network/source IO. Original
    // accepted ranges remain recoverable after an uncertain reply.
    const old = await at('staging-lookup', async () => {
        const reply = await requestNative({ ...binding, action: 'stage-begin' }); await check();
        if (!validReply(reply) || ![input.offset, input.offset + input.length].includes(reply.staging?.received)) throw invalid();
        return reply;
    });
    if (old.staging.received === input.offset + input.length) return { ...old, resources: governor.snapshot() };
    const checkCloud = () => at('cloud-source', async () => {
        await check(); const result = await json('/api/v1/files?' + new URLSearchParams({ id: file.id }), signal); await check();
        const current = result.file;
        if (result.ok !== true || !current || current.id !== file.id || current.revision !== file.revision || current.name !== file.name || current.folderId !== file.folderId || current.trashed !== false ||
            current.content?.attachmentId !== file.content.attachmentId || current.content.version !== file.content.version || current.content.size !== file.content.size || !fingerprint(current.content.fingerprint, file.content.fingerprint)) throw invalid();
    });
    await checkCloud();
    const resolveTarget = () => at('sign-target', async () => {
        // Renderer hints never select an outgoing URL. Resolve the authoritative
        // target through the captured host session and fixed canonical endpoint.
        const query = new URLSearchParams({ id: file.content.attachmentId, target: '1', range: '1', version: file.content.version, offset: String(input.offset), length: String(input.length) });
        const resolved = await json('/api/v1/attachments/content?' + query, signal); await check();
        const target = resolved?.target;
        if (resolved?.ok !== true || target?.version !== 1 || target.ownerId !== context.ownerId || target.attachmentId !== file.content.attachmentId || target.contentVersion !== file.content.version ||
        target.size !== file.content.size || target.offset !== input.offset || target.length !== input.length || !fingerprint(target.fingerprint, file.content.fingerprint) ||
        !equal(Object.keys(target.headers ?? {}), ['Range']) || target.headers.Range !== `bytes=${input.offset}-${input.offset + input.length - 1}` ||
        !(Date.parse(target.expiresAt) > Date.now()) || Date.parse(target.expiresAt) > Date.now() + 60000) throw invalid();
        let url; try { url = new URL(target.url); } catch { throw invalid(); }
        if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && url.origin === context.apiOrigin))) throw invalid();
        return target;
    });
    const target = await resolveTarget();
    const result = await at('transport', async () => {
        try {
            return await download(governor, target, signal, () => { signal.throwIfAborted(); assertCurrent(); }, async () => { await checkCloud(); return resolveTarget(); });
        } catch (error) {
            signal.throwIfAborted();
            if (error?.code === 'SYNC_DOWNLOAD_RETRY' || isTransientNetworkFailure(error)) throw downloadRetry();
            throw error;
        }
    });
    try {
        if (!(result.bytes instanceof Uint8Array) || result.bytes.length !== input.length || !hex(result.sha256)) throw invalid();
        await checkCloud();
        return await at('native-append', async () => {
            const reply = await requestNative({ ...binding, action: 'stage-range', offset: input.offset, bytes: result.bytes }); await check();
            if (!validReply(reply) || reply.staging?.received !== input.offset + input.length) throw invalid();
            if (reply.resources) governor.observeNative(reply.resources);
            return { ...reply, resources: governor.snapshot() };
        });
    } finally { result.bytes?.fill(0); }
}
module.exports = { stageFolderDownload };
