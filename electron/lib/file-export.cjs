'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { normalizeEndpointUrl } = require('./desktop-settings.cjs');
const { readAccount, readCapabilities } = require('./folder-sync.cjs');
const RANGE_BYTES = 2 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const HEX = /^[a-f0-9]{64}$/u;
const unavailable = () => Error('Saving could not be verified. Check the selected folder before trying again.');
const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const stamp = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
function validName(name) {
    return typeof name === 'string' && name.trim().length > 0 && Buffer.byteLength(name) <= 255 &&
        !/[\p{Cc}\p{Cf}\/\\:]/u.test(name) && name !== '.' && name !== '..';
}
function validateContent(content) {
    const c = content, f = c?.fingerprint;
    if (!c || typeof c.attachmentId !== 'string' || typeof c.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(c.attachmentId) || !HEX.test(c.version) ||
        !Number.isSafeInteger(c.size) || c.size <= 0 || !f) throw unavailable();
    const partSize = Math.ceil(Math.max(8 * 1024 * 1024, Math.ceil(c.size / 10000)) / (1024 * 1024)) * 1024 * 1024;
    if (partSize > 5 * 1024 * 1024 * 1024 || f.algorithm !== 'sha256-parts-v1' || f.partSizeBytes !== partSize ||
        f.partCount !== Math.ceil(c.size / partSize) || !HEX.test(f.sha256)) throw unavailable();
}
async function body(response, limit, check) {
    if (!response.body) throw unavailable();
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
        for (;;) {
            const next = await reader.read(); check(); if (next.done) break;
            length += next.value.length; if (length > limit) throw unavailable();
            chunks.push(Buffer.from(next.value));
        }
        return Buffer.concat(chunks, length);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function verifyFile(file, content, check, links = 1n) {
    const before = await file.stat({ bigint: true }); check();
    if (!before.isFile() || before.size !== BigInt(content.size) || before.nlink !== links) throw unavailable();
    const aggregate = createHash('sha256'), buffer = Buffer.alloc(RANGE_BYTES);
    for (let offset = 0; offset < content.size;) {
        const hash = createHash('sha256'), end = Math.min(content.size, offset + content.fingerprint.partSizeBytes);
        while (offset < end) {
            check();
            const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, end - offset), offset);
            if (!bytesRead) throw unavailable();
            hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
        }
        aggregate.update(hash.digest());
    }
    check();
    if (aggregate.digest('hex') !== content.fingerprint.sha256 || stamp(before) !== stamp(await file.stat({ bigint: true }))) throw unavailable();
}

/** Save one retained version using the current renderer's cookie session. Paths,
 * credentials and file bytes never cross the preload bridge. No persistent grant. */
class DesktopFileExport {
    constructor({ context, choose, verifyAccount = readAccount, capabilities = readCapabilities, timeoutMs = 30 * 60_000 }) {
        Object.assign(this, { context, choose, verifyAccount, capabilities, timeoutMs });
        this.generation = 0; this.active = null;
    }
    capture(event, input) {
        const c = this.context(), w = c.window;
        if (!c.enabled || !w || w.isDestroyed() || event.sender !== w.webContents ||
            event.senderFrame !== w.webContents.mainFrame || new URL(event.senderFrame.url).origin !== c.appOrigin ||
            !input || !UUID.test(input.requestId) || typeof input.ownerId !== 'string' || !input.ownerId ||
            Buffer.byteLength(input.ownerId) > 512 || /[\p{Cc}\p{Cf}]/u.test(input.ownerId) ||
            input.origin !== c.appOrigin || !['save', 'cancel'].includes(input.action) ||
            Buffer.byteLength(JSON.stringify(input)) > 8192) throw unavailable();
        return { ...c, apiOrigin: new URL(normalizeEndpointUrl(c.apiOrigin)).origin, ownerId: input.ownerId, generation: this.generation };
    }
    invalidate() { this.generation++; this.active?.abort.abort(); }
    async request(event, input) {
        const c = this.capture(event, input);
        if (input.action === 'cancel') {
            const s = this.active;
            if (s && s.event.senderFrame === event.senderFrame && s.input.requestId === input.requestId && s.input.ownerId === input.ownerId) s.abort.abort();
            return {};
        }
        if (this.active) throw Error('Another file is being saved. Finish or cancel it first.');
        if (!validName(input.name)) throw unavailable();
        validateContent(input.content);
        const s = { event, input: structuredClone(input), abort: new AbortController() };
        this.active = s;
        const timer = setTimeout(() => s.abort.abort(), this.timeoutMs); timer.unref?.();
        let directory, file, temporary, created, parent, parentInfo;
        const check = () => {
            s.abort.signal.throwIfAborted();
            const now = this.capture(event, s.input);
            if (now.generation !== c.generation || now.window !== c.window || now.apiOrigin !== c.apiOrigin || now.appOrigin !== c.appOrigin) throw unavailable();
        };
        const verify = async () => {
            check(); await this.verifyAccount(c, AbortSignal.any([s.abort.signal, AbortSignal.timeout(20000)])); check();
        };
        const currentParent = async () => {
            check();
            if (!sameNode(await fs.lstat(parent, { bigint: true }), parentInfo) || !sameNode(await directory.stat({ bigint: true }), parentInfo)) throw unavailable();
        };
        const content = s.input.content;
        const receipt = saved => ({ requestId: s.input.requestId, ownerId: c.ownerId, origin: c.appOrigin,
            attachmentId: content.attachmentId, version: content.version, size: content.size, saved });
        const fetchContent = async params => {
            check();
            const response = await c.window.webContents.session.fetch(new URL('/api/v1/attachments/content?' + new URLSearchParams({ id: content.attachmentId, version: content.version, ...params }), c.appOrigin).href, {
                credentials: 'include', cache: 'no-store', redirect: 'error', bypassCustomProtocolHandlers: true,
                signal: AbortSignal.any([s.abort.signal, AbortSignal.timeout(30000)]),
                headers: { 'X-Thingtime-Expected-Actor': c.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': c.apiOrigin }
            });
            try {
                check();
                if (response.redirected || (c.appOrigin !== c.apiOrigin && response.headers.get('x-thingtime-api-fallback') !== c.apiOrigin)) throw unavailable();
                return response;
            } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
        };
        try {
            await verify();
            const caps = await this.capabilities(c, AbortSignal.any([s.abort.signal, AbortSignal.timeout(20000)])); check();
            if (!/^1\.(?:1[4-9]|[2-9][0-9]|[1-9][0-9]{2,})\.\d+$/u.test(caps?.features?.['api.attachment-content']?.version ?? '')) throw unavailable();
            const selected = await this.choose(c.window, { title: 'Save this file version', defaultPath: s.input.name,
                buttonLabel: 'Save version', properties: ['createDirectory', 'dontAddToRecent'] });
            await verify();
            if (selected.canceled || !selected.filePath) return receipt(false);
            if (!path.isAbsolute(selected.filePath) || !validName(path.basename(selected.filePath))) throw unavailable();
            parent = await fs.realpath(path.dirname(selected.filePath));
            directory = await fs.open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            parentInfo = await directory.stat({ bigint: true }); await currentParent();
            const destination = path.join(parent, path.basename(selected.filePath));
            try { await fs.lstat(destination); throw unavailable(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            const metadata = await fetchContent({ fingerprint: '1' });
            if (metadata.status !== 200) { await metadata.body?.cancel(); throw unavailable(); }
            const info = JSON.parse((await body(metadata, 8192, check)).toString('utf8'));
            if (!info.ok || info.id !== content.attachmentId || info.version !== content.version || info.size !== content.size) throw unavailable();
            validateContent({ ...content, fingerprint: info.fingerprint });
            if (info.fingerprint.sha256 !== content.fingerprint.sha256) throw unavailable();
            await verify(); await currentParent();
            temporary = path.join(parent, '.thingtime-export-' + randomUUID());
            file = await fs.open(temporary, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            created = await file.stat({ bigint: true });
            for (let offset = 0; offset < content.size;) {
                await verify(); await currentParent();
                const length = Math.min(RANGE_BYTES, content.size - offset), response = await fetchContent({ range: '1', offset: String(offset), length: String(length) });
                let bytes;
                try {
                    if (response.status !== 206 || response.headers.get('etag') !== `"${content.version}"` ||
                        response.headers.get('content-range') !== `bytes ${offset}-${offset + length - 1}/${content.size}` ||
                        (response.headers.has('content-length') && response.headers.get('content-length') !== String(length)) ||
                        ![null, 'identity'].includes(response.headers.get('content-encoding'))) throw unavailable();
                    bytes = await body(response, length, check);
                    if (bytes.length !== length) throw unavailable();
                } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
                await verify(); await currentParent();
                for (let at = 0; at < bytes.length;) {
                    check(); const { bytesWritten } = await file.write(bytes, at, bytes.length - at, offset + at);
                    if (!bytesWritten) throw unavailable(); at += bytesWritten;
                }
                offset += length;
            }
            await file.sync(); await verifyFile(file, content, check);
            await verify(); await currentParent();
            if (!sameNode(await fs.lstat(temporary, { bigint: true }), created)) throw unavailable();
            // Exclusive same-volume publication. Even a destination created while
            // downloading is never replaced; keep the verified result on later error.
            await fs.link(temporary, destination);
            await directory.sync(); await currentParent();
            const saved = await fs.open(destination, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            let published;
            try {
                if (!sameNode(await saved.stat({ bigint: true }), created)) throw unavailable();
                await verifyFile(saved, content, check, 2n);
                published = await saved.stat({ bigint: true });
            } finally { await saved.close(); }
            await verify(); await currentParent();
            if (stamp(await fs.lstat(destination, { bigint: true })) !== stamp(published)) throw unavailable();
            check(); return receipt(true);
        } catch { throw unavailable(); }
        finally {
            clearTimeout(timer);
            // Clean only the inode created by this request, even after cancellation.
            if (temporary && created && parentInfo) {
                try {
                    if (sameNode(await fs.lstat(parent, { bigint: true }), parentInfo) && sameNode(await fs.lstat(temporary, { bigint: true }), created)) {
                        await fs.unlink(temporary); await directory.sync();
                    }
                } catch { /* Preserve uncertain files; never delete another writer's data. */ }
            }
            await file?.close().catch(() => {}); await directory?.close().catch(() => {});
            if (this.active === s) this.active = null;
        }
    }
}
module.exports = { DesktopFileExport, validateContent, verifyFile, RANGE_BYTES };
