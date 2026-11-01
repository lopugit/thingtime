'use strict';
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const children = new WeakMap();
function transferProcess(governor) {
    let state = children.get(governor);
    if (state) { state.child.send({ kind: 'policy', policy: governor.policy }); return state; }
    // Electron's executable supports Node mode; use a minimal environment and
    // private IPC. No owner cookies or app tokens are copied into the child.
    const child = fork(path.join(__dirname, 'folder-transfer-worker.cjs'), [], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced'
    });
    state = { child, pending: new Map(), idle: null }; children.set(governor, state);
    child.on('message', async message => {
        if (message.kind === 'authority') {
            let accepted = false, target;
            try { const pending = state.pending.get(message.id); if (pending) { target = await pending.check(message.phase); accepted = state.pending.has(message.id); } } catch { }
            if (child.connected) child.send({ kind: 'authority-reply', ticket: message.ticket, accepted, ...(target ? { target } : {}) });
            return;
        }
        if (message.kind === 'resources') {
            governor.transport = message.resources;
            governor.sample('transport-process', message.resources.cpuPercent);
            return;
        }
        if (message.kind === 'reply') state.pending.get(message.id)?.(message);
    });
    child.on('exit', () => { children.delete(governor); clearTimeout(state.idle); for (const finish of [...state.pending.values()]) finish({ error: 'transport' }); });
    child.send({ kind: 'policy', policy: governor.policy }); return state;
}
async function governedFetch(governor, fetchUpload, target, options, check = () => {}) {
    if (!governor) {
        const fresh = await options.refreshTarget?.();
        const { refreshTarget, ...request } = options;
        return fetchUpload(fresh?.url ?? target, { ...request, ...(fresh?.headers ? { headers: fresh.headers } : {}) });
    }
    // Injected fetches are for fixtures; they exercise the same byte pacing and
    // admission, but cannot supply process-attributed measurements.
    if (fetchUpload !== globalThis.fetch) {
        const release = await governor.acquire(options.signal, check);
        try {
            const fresh = await options.refreshTarget?.(); const { refreshTarget, ...request } = options;
            return await fetchUpload(fresh?.url ?? target, { ...request, ...(fresh?.headers ? { headers: fresh.headers } : {}), body: governor.body(options.body, options.signal, check), duplex: 'half' });
        }
        finally { release(); }
    }
    await check(); options.signal.throwIfAborted();
    governor.pending = (governor.pending ?? 0) + 1;
    let state;
    try { state = transferProcess(governor); } catch (error) { governor.pending--; throw error; }
    const id = randomUUID(); clearTimeout(state.idle);
    return new Promise((resolve, reject) => {
        const cancel = () => { if (state.child.connected) state.child.send({ kind: 'cancel', id }); finish({ error: 'cancelled' }); };
        const finish = message => {
            if (!state.pending.has(id)) return;
            state.pending.delete(id); governor.pending--; options.signal.removeEventListener('abort', cancel);
            if (!state.pending.size) { state.idle = setTimeout(() => state.child.kill(), 1000); state.idle.unref(); }
            if (options.signal.aborted) { reject(options.signal.reason); return; }
            if (message.error) { const error = new Error('Sync transport unavailable.'); error.code = message.code ?? 'ECONNRESET'; reject(error); return; }
            if (message.bytes) { resolve({ bytes: message.bytes, sha256: message.sha256 }); return; }
            if (message.digest) { resolve(message.digest); return; }
            resolve({ ok: message.status >= 200 && message.status < 300, status: message.status, redirected: message.redirected, body: null });
        };
        finish.check = async phase => { options.signal.throwIfAborted(); await check(); const target = phase === 'dispatch' ? await options.refreshTarget?.() : undefined; options.signal.throwIfAborted(); return target; };
        state.pending.set(id, finish); options.signal.addEventListener('abort', cancel, { once: true });
        state.child.send({ kind: options._hash ? 'hash' : options._get ? 'get' : 'put', id, url: String(target), headers: options.headers, bytes: options.body, ...(options._get ?? {}) }, error => { if (error) finish({ error: 'transport' }); });
        if (options.signal.aborted) cancel();
    });
}
async function governedHash(governor, bytes, signal) {
    if (!governor) return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    return governedFetch(governor, globalThis.fetch, '', { signal, headers: {}, body: bytes, _hash: true });
}
async function governedDownload(governor, target, signal, check, refreshTarget) {
    if (!governor) throw new Error('Native cloud download requires its task resource governor.');
    return governedFetch(governor, globalThis.fetch, target.url, { signal, headers: target.headers,
        refreshTarget, _get: { offset: target.offset, length: target.length, size: target.size, expiresAt: target.expiresAt } }, check);
}
module.exports = { governedFetch, governedHash, governedDownload };
