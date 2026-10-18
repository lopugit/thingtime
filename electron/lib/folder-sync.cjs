'use strict';

const { stageRangeMetadata } = require('./folder-stream.cjs');
const { normalizeEndpointUrl } = require('./desktop-settings.cjs');
const ACTIONS = new Set(['context', 'list', 'choose', 'conditions', 'remove', 'scan', 'scan-capture', 'scan-page', 'scan-discard', 'inspect', 'read', 'read-range', 'stage-begin', 'stage-append', 'stage-range', 'stage-finish', 'write-approve', 'publication-lookup', 'publish', 'trash', 'trash-lookup', 'trash-expected', 'trash-inspect', 'trash-restore', 'trash-list', 'trash-restore-reviewed', 'suspend']);
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const identifier = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 512 && !/[\p{Cc}\p{Cf}]/u.test(value);
const unavailable = () => new Error('Folder access changed. Reopen this device with the current account.');

async function boundedJson(response, signal, limit) {
    if (!response.body) throw unavailable();
    const reader = response.body.getReader();
    try {
        let total = 0; const chunks = [];
        for (;;) {
            const part = await reader.read(); signal.throwIfAborted();
            if (part.done) break;
            total += part.value.length; if (total > limit) throw unavailable();
            chunks.push(Buffer.from(part.value));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function readAccount(context, signal) {
    const url = new URL('/api/v1/auth/me', context.appOrigin).href;
    const response = await context.window.webContents.session.fetch(url, {
        credentials: 'include', cache: 'no-store', redirect: 'error', bypassCustomProtocolHandlers: true, signal,
        headers: { Accept: 'application/json', 'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': context.apiOrigin }
    });
    try {
        // Electron documents Response.url as unreliable. The literal host URL,
        // redirect:error and verified proxy-origin header pin this request.
        if (response.status !== 200 || response.redirected ||
            (context.appOrigin !== context.apiOrigin && response.headers.get('x-thingtime-api-fallback') !== context.apiOrigin)) throw unavailable();
        const value = await boundedJson(response, signal, 64 * 1024);
        if (value?.user?.id !== context.ownerId || value?.user?.accountKind !== 'user') throw unavailable();
    } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}
async function readCapabilities(context, signal) {
    // Public negotiation must describe the selected server, not the bundled UI.
    // This fixed host-owned URL cannot read arbitrary network resources.
    const response = await context.window.webContents.session.fetch(
        new URL('/.well-known/thingtime-capabilities.json', context.apiOrigin).href,
        { credentials: 'omit', redirect: 'error', cache: 'no-store', bypassCustomProtocolHandlers: true,
          headers: { Accept: 'application/json' }, signal }
    );
    try {
        if (response.status !== 200 || response.redirected) throw unavailable();
        const manifest = await boundedJson(response, signal, 1024 * 1024);
        if (manifest?.schemaVersion !== 1 || manifest.origin !== context.apiOrigin ||
            !manifest.features || typeof manifest.features !== 'object' || Array.isArray(manifest.features)) throw unavailable();
        // Only sync requirements are exposed. Never return arbitrary upstream data.
        const features = {};
        for (const key of ['api.devices-node-identity', 'api.files', 'api.attachment-uploads', 'api.attachment-upload-parts',
            'api.attachment-upload-complete', 'api.attachment-content', 'api.actions-run', 'api.mongodb-endpoint']) {
            const version = manifest.features[key]?.version;
            if (typeof version === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) && version.length <= 32) features[key] = { version };
        }
        return { schemaVersion: 1, origin: context.apiOrigin, features };
    } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}

/** Only the bundled main frame may request local files. Its current account is
 * read by the host's own network stack; renderer identity is only an expectation. */
class DesktopFolderSync {
    constructor({ context, requestNative, verifyAccount = readAccount, capabilities = readCapabilities, timeoutMs = 300_000 }) {
        this.context = context; this.requestNative = requestNative; this.verifyAccount = verifyAccount;
        this.capabilities = capabilities; this.timeoutMs = timeoutMs; this.generation = 0; this.active = null;
    }
    capture(event, input) {
        const context = this.context(), window = context.window;
        if (!context.enabled || !window || window.isDestroyed() || event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame || !context.appOrigin ||
            new URL(event.senderFrame.url).origin !== context.appOrigin) throw unavailable();
        const apiOrigin = new URL(normalizeEndpointUrl(context.apiOrigin)).origin;
        if (!input || typeof input !== 'object' || Array.isArray(input) || !UUID.test(input.requestId) ||
            !identifier(input.ownerId) || !identifier(input.deviceId) || !ACTIONS.has(input.action) ||
            (input.action !== 'context' && !(input.action === 'suspend' && input.origin === undefined) && input.origin !== apiOrigin) || Buffer.byteLength(JSON.stringify(stageRangeMetadata(input))) > 131_072) throw unavailable();
        return { ...context, apiOrigin, ownerId: input.ownerId, event, generation: this.generation };
    }
    assertCurrent(state) {
        state.abort.signal.throwIfAborted();
        const current = this.capture(state.context.event, state.input);
        if (current.generation !== state.context.generation || current.window !== state.context.window ||
            current.apiOrigin !== state.context.apiOrigin || current.appOrigin !== state.context.appOrigin) throw unavailable();
    }
    cancel(state = this.active) {
        if (!state || this.active !== state || state.abort.signal.aborted) return;
        state.abort.abort();
        // Cancel the native request with its original binding, including after an
        // account/endpoint switch. Never retarget it using the new renderer input.
        if (state.dispatched) void this.requestNative('folder-sync.request', {
            requestId: state.input.requestId, ownerId: state.context.ownerId, deviceId: state.input.deviceId,
            origin: state.context.apiOrigin, action: 'suspend'
        }).catch(() => {});
    }
    invalidate() { this.generation += 1; this.cancel(); }
    async request(event, input) {
        const context = this.capture(event, input);
        if (input.action === 'suspend') {
            const state = this.active;
            if (state && state.context.event.senderFrame === event.senderFrame && state.input.requestId === input.requestId &&
                state.input.ownerId === input.ownerId && state.input.deviceId === input.deviceId) this.cancel(state);
            return {};
        }
        if (this.active) throw new Error('Another folder request is running.');
        const state = { context, input: structuredClone(input), abort: new AbortController(), dispatched: false };
        this.active = state;
        const timer = setTimeout(() => this.cancel(state), this.timeoutMs); timer.unref?.();
        const verify = async () => {
            this.assertCurrent(state);
            const signal = AbortSignal.any([state.abort.signal, AbortSignal.timeout(20_000)]);
            await this.verifyAccount(context, signal); this.assertCurrent(state);
        };
        try {
            await verify();
            let apiCapabilities;
            if (state.input.action === 'context') {
                apiCapabilities = await this.capabilities(context, AbortSignal.any([state.abort.signal, AbortSignal.timeout(20_000)]));
                await verify();
                if (!/^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(apiCapabilities?.features?.['api.devices-node-identity']?.version ?? '')) {
                    throw new Error('The selected server does not support this version of folder sync.');
                }
            }
            state.dispatched = true;
            const value = await this.requestNative('folder-sync.request', { ...state.input, origin: context.apiOrigin }, { signal: state.abort.signal });
            if (!value || typeof value !== 'object') throw unavailable();
            if (state.input.action === 'context') {
                this.assertCurrent(state);
                value.apiCapabilities = apiCapabilities;
            }
            await verify();
            if (!value || typeof value !== 'object' || value.requestId !== input.requestId || value.ownerId !== input.ownerId ||
                value.deviceId !== input.deviceId || value.origin !== context.apiOrigin) throw unavailable();
            if (input.action === 'read-range') {
                const c = value.chunk;
                if (!Number.isSafeInteger(input.length) || input.length <= 0 || input.length > 32 * 1024 * 1024 ||
                    !(c?.bytes instanceof Uint8Array) || c.bytes.byteLength !== input.length || c.length !== input.length ||
                    c.offset !== input.offset || c.version !== input.version || value.rootId !== input.rootId || value.path !== input.path) throw unavailable();
                // Binary bytes cross Electron IPC; never stringify tens of MiB.
                const metadata = { ...value, chunk: { ...c, bytes: undefined } };
                if (Buffer.byteLength(JSON.stringify(metadata)) > 900_000) throw unavailable();
            } else if (Buffer.byteLength(JSON.stringify(value)) > 900_000) throw unavailable();
            return value;
        } finally { clearTimeout(timer); if (this.active === state) this.active = null; }
    }
}
module.exports = { DesktopFolderSync, readAccount, readCapabilities };
