'use strict';

const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const { readAccount, readCapabilities, signDesktopUploadPart } = require('./folder-sync.cjs');

const CHUNK_BYTES = 256 * 1024;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const ATTACHMENT = /^(?:att_[a-f0-9]{64}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/iu;
const STORAGE_HOST = /^[a-z0-9][a-z0-9.-]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/u;
const unavailable = () => Error('File upload could not be verified. Check your connection and retry.');

function signedTarget(signed, input) {
    const part = signed?.parts?.[0];
    if (!Array.isArray(signed?.parts) || signed.parts.length !== 1 || part?.partNumber !== input.partNumber ||
        typeof part.url !== 'string' || !part.headers || Object.keys(part.headers).length !== 1 ||
        part.headers['x-amz-checksum-sha256'] !== input.checksum) throw unavailable();
    const url = new URL(part.url);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
        !STORAGE_HOST.test(url.hostname) || url.pathname !== '/objects/' + input.uploadId ||
        url.searchParams.get('partNumber') !== String(input.partNumber) || !url.searchParams.get('uploadId') ||
        url.searchParams.get('x-id') !== 'UploadPart' ||
        url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
        !url.searchParams.get('X-Amz-Signature') ||
        !['content-length', 'host', 'x-amz-checksum-sha256'].every(header =>
            url.searchParams.get('X-Amz-SignedHeaders')?.split(';').includes(header))) throw unavailable();
    return url;
}

class DesktopAttachmentUpload {
    constructor({ context, verifyAccount = readAccount, capabilities = readCapabilities, signPart = signDesktopUploadPart,
        put = globalThis.fetch, timeoutMs = 9 * 60_000 }) {
        Object.assign(this, { context, verifyAccount, capabilities, signPart, put, timeoutMs });
        this.active = new Map();
    }

    capture(event, input) {
        const context = this.context();
        const sender = context.window?.webContents;
        if (!context.enabled || !sender || context.window.isDestroyed() || event.sender !== sender ||
            !event.senderFrame || event.senderFrame !== sender.mainFrame || !context.appOrigin ||
            new URL(event.senderFrame.url).origin !== context.appOrigin ||
            !context.apiOrigin || new URL(context.apiOrigin).protocol !== 'https:' ||
            context.apiOrigin === context.appOrigin || input?.version !== '1.0.0' || !UUID.test(input.requestId ?? '')) throw unavailable();
        return { ...context, sender, frame: event.senderFrame };
    }

    current(event, input, state) {
        const context = this.capture(event, input);
        if (this.active.get(input.requestId) !== state || context.sender !== state.context.sender ||
            context.frame !== state.context.frame || context.apiOrigin !== state.context.apiOrigin ||
            context.appOrigin !== state.context.appOrigin) throw unavailable();
        state.signal.throwIfAborted();
    }

    invalidate() {
        for (const state of this.active.values()) state.controller.abort();
    }

    async request(event, input) {
        try {
            const context = this.capture(event, input);
            if (input.action === 'open') return await this.open(event, input, context);
            const state = this.active.get(input.requestId);
            if (!state) {
                if (input.action === 'cancel') return;
                throw unavailable();
            }
            this.current(event, input, state);
            if (input.action === 'cancel') {
                state.controller.abort();
                return;
            }
            if (!state.finished || state.finishing || state.writing) throw unavailable();
            if (input.action === 'chunk') {
                if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > CHUNK_BYTES ||
                    input.offset !== state.bytes || state.bytes + input.bytes.length > state.length) {
                    state.controller.abort();
                    throw unavailable();
                }
                state.writing = true;
                try {
                    state.hash.update(input.bytes);
                    state.bytes += input.bytes.length;
                    if (state.bytes === state.length && state.hash.digest('base64') !== state.checksum) {
                        state.controller.abort();
                        throw unavailable();
                    }
                    if (!state.stream.write(input.bytes)) await once(state.stream, 'drain', { signal: state.signal });
                    this.current(event, input, state);
                } finally {
                    state.writing = false;
                }
                return;
            }
            if (input.action !== 'finish' || state.bytes !== state.length) {
                state.controller.abort();
                throw unavailable();
            }
            state.finishing = true;
            state.stream.end();
            await state.finished;
            this.current(event, input, state);
            await this.verifyAccount(state.context, state.signal);
            this.current(event, input, state);
            this.close(input.requestId, state);
        } catch {
            // Neither signer URLs nor transport details cross the bridge.
            throw unavailable();
        }
    }

    close(requestId, state) {
        if (this.active.get(requestId) !== state) return;
        this.active.delete(requestId);
        state.stream.destroy();
    }

    async open(event, input, context) {
        if (input.origin !== context.apiOrigin || typeof input.ownerId !== 'string' ||
            !input.ownerId || input.ownerId.length > 512 || /[\p{Cc}\p{Cf}]/u.test(input.ownerId) ||
            typeof input.uploadId !== 'string' || !ATTACHMENT.test(input.uploadId) ||
            !Number.isSafeInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000 ||
            !Number.isSafeInteger(input.length) || input.length < 1 ||
            typeof input.checksum !== 'string' || !/^[A-Za-z0-9+/]{43}=$/u.test(input.checksum) ||
            this.active.size >= 3 || this.active.has(input.requestId) ||
            [...this.active.values()].some(part => part.uploadId === input.uploadId && part.partNumber === input.partNumber)) throw unavailable();
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]);
        const state = {
            context: { ...context, ownerId: input.ownerId }, controller, signal, bytes: 0, length: input.length,
            uploadId: input.uploadId, partNumber: input.partNumber, checksum: input.checksum,
            stream: new PassThrough({ highWaterMark: CHUNK_BYTES }), hash: createHash('sha256')
        };
        this.active.set(input.requestId, state);
        signal.addEventListener('abort', () => this.close(input.requestId, state), { once: true });
        try {
            await this.verifyAccount(state.context, signal);
            const manifest = await this.capabilities(state.context, signal);
            if (!/^1\.[1-9][0-9]*\.(?:0|[1-9][0-9]*)$/u.test(manifest?.features?.['api.attachment-upload-parts']?.version ?? '')) throw unavailable();
            this.current(event, input, state);
            const signed = await this.signPart(state.context, { uploadId: input.uploadId, parts: [
                { partNumber: input.partNumber, checksumSha256: input.checksum }
            ] }, signal);
            const target = signedTarget(signed, input);
            this.current(event, input, state);
            state.finished = this.transfer(state, target);
            void state.finished.catch(() => controller.abort());
        } catch (error) {
            controller.abort();
            throw error;
        }
    }

    async transfer(state, target) {
        const response = await this.put(target, {
            method: 'PUT', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
            signal: state.signal, duplex: 'half', body: state.stream,
            headers: { 'Content-Length': String(state.length), 'x-amz-checksum-sha256': state.checksum }
        });
        try {
            if (!state.finishing || response.redirected || !response.ok) throw unavailable();
        } finally {
            await response.body?.cancel().catch(() => {});
        }
    }
}

module.exports = { DesktopAttachmentUpload };
