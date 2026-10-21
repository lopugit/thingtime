'use strict';
const { governorFor } = require('./folder-resource-governor.cjs');
const { governedFetch, governedHash } = require('./folder-transfer-process.cjs');
const invalid = () => new Error('The pinned upload part could not be verified.');
const uploadRetry = () => new Error('[folder_upload_retry] Folder upload is temporarily unavailable. Retry after reconnecting.');
const retryableUploadFailure = error => {
    const codes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH',
        'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
    return error?.name === 'TimeoutError' || codes.has(error?.code) || codes.has(error?.cause?.code);
};
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

// Reuse the mobile part contract; the host obtains the destination itself.
// A renderer can select an owned upload, never an arbitrary outgoing URL.
async function uploadFolderPart({ input, context, signal, authorize, requestNative, signPart, fetchUpload }) {
    const governor = governorFor(input, context);
    const upload = input.upload, source = upload?.source, mib = 1024 * 1024;
    if (!source || source.kind !== 'file' || !id(upload.uploadId) || !id(upload.requestId) ||
        !Number.isSafeInteger(source.size) || source.size <= 0 || typeof source.path !== 'string' ||
        typeof source.version !== 'string' || !source.version || typeof input.rootId !== 'string') throw invalid();
    const partSize = Math.ceil(Math.max(8 * mib, Math.ceil(source.size / 10_000)) / mib) * mib;
    if (!Number.isSafeInteger(upload.partNumber) || upload.partNumber < 1 ||
        upload.partNumber > Math.ceil(source.size / partSize) || upload.offset !== (upload.partNumber - 1) * partSize ||
        upload.length !== Math.min(partSize, source.size - upload.offset) || upload.length > 32 * mib) throw invalid();
    const binding = { requestId: input.requestId, ownerId: context.ownerId, deviceId: input.deviceId,
        origin: context.apiOrigin, rootId: input.rootId, path: source.path, version: source.version };
    const read = async (range) => {
        await authorize(); signal.throwIfAborted();
        // A positive-length read at EOF returns no bytes while the native
        // reader still reopens the path and validates version/size. Zero-length
        // requests are invalid in the shared native reader contract.
        const value = await requestNative({ ...binding, action: range ? 'read-range' : 'read',
            offset: range ? upload.offset : source.size, length: range ? upload.length : 1 });
        signal.throwIfAborted(); await authorize();
        const chunk = value?.chunk;
        if (!value || value.requestId !== binding.requestId || value.ownerId !== binding.ownerId ||
            value.deviceId !== binding.deviceId || value.origin !== binding.origin || value.rootId !== binding.rootId ||
            value.path !== source.path || chunk?.version !== source.version || chunk.size !== source.size ||
            (range ? !(chunk.bytes instanceof Uint8Array) || chunk.bytes.length !== upload.length ||
                chunk.offset !== upload.offset || chunk.length !== upload.length : chunk.offset !== source.size || chunk.data !== '')) throw invalid();
        return range ? chunk.bytes : value.roots;
    };
    const bytes = await read(true), digest = Buffer.from(await governedHash(governor, bytes, signal), 'hex'), checksum = digest.toString('base64');
    const signed = await signPart({ uploadId: upload.uploadId, parts: [{ partNumber: upload.partNumber, checksumSha256: checksum }] });
    signal.throwIfAborted();
    const part = signed?.parts?.[0];
    if (!Array.isArray(signed?.parts) || signed.parts.length !== 1 || part.partNumber !== upload.partNumber ||
        typeof part.url !== 'string' || !part.headers || typeof part.headers !== 'object' || Array.isArray(part.headers) ||
        Object.keys(part.headers).length !== 1 || part.headers['x-amz-checksum-sha256'] !== checksum) throw invalid();
    let target;
    try { target = new URL(part.url, context.apiOrigin); } catch { throw invalid(); }
    if (target.username || target.password || target.hash || (target.protocol !== 'https:' && target.origin !== context.apiOrigin)) throw invalid();
    await read(false); await authorize(); signal.throwIfAborted();
    let response;
    const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    try { response = await governedFetch(governor, fetchUpload, target, { method: 'PUT', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'x-amz-checksum-sha256': checksum }, body: bytes,
        signal: uploadSignal }, authorize); }
    catch (error) { signal.throwIfAborted();
        if ((uploadSignal.aborted && uploadSignal.reason?.name === 'TimeoutError') || retryableUploadFailure(error)) throw uploadRetry();
        throw invalid(); }
    try {
        if (response.redirected) throw invalid();
        if (response.status === 408 || response.status === 429 || (response.status >= 500 && response.status <= 599)) throw uploadRetry();
        if (!response.ok) throw invalid();
    }
    finally { await response.body?.cancel().catch(() => {}); }
    const roots = await read(false); signal.throwIfAborted();
    if (!Array.isArray(roots)) throw invalid();
    return { ...binding, roots, ...(governor ? { resources: governor.snapshot() } : {}), uploadedPart: { uploadId: upload.uploadId, requestId: upload.requestId,
        partNumber: upload.partNumber, offset: upload.offset, length: upload.length,
        version: source.version, size: source.size, sha256: digest.toString('hex'), payloadBytes: bytes.length } };
}
module.exports = { uploadFolderPart, uploadRetry, retryableUploadFailure };
