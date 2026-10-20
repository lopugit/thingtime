'use strict';

const { uploadFolderPart, uploadRetry, retryableUploadFailure } = require('./folder-upload.cjs');
const { stageRangeMetadata } = require('./folder-stream.cjs');
const { normalizeEndpointUrl } = require('./desktop-settings.cjs');
const { randomUUID } = require('node:crypto');
const ACTIONS = new Set(['context', 'upload-part', 'list', 'choose', 'conditions', 'remove', 'scan', 'scan-stream', 'scan-stream-finish', 'scan-changes', 'scan-capture', 'scan-status', 'scan-cancel', 'scan-skips', 'scan-page', 'scan-discard', 'inspect', 'read', 'read-range', 'stage-begin', 'stage-append', 'stage-range', 'stage-finish', 'write-approve', 'write-check', 'publication-lookup', 'publish', 'trash', 'trash-lookup', 'trash-expected', 'trash-inspect', 'trash-restore', 'trash-list', 'trash-restore-reviewed', 'suspend']);
const supportsBatchPages = version => {
    const parts = typeof version === 'string' && version.length <= 32 && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version);
    return !!parts && parts[1] === '1' && Number.isSafeInteger(Number(parts[2])) && Number.isSafeInteger(Number(parts[3])) && Number(parts[2]) >= 10;
};
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const identifier = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 512 && !/[\p{Cc}\p{Cf}]/u.test(value);
const unavailable = () => new Error('Folder access changed. Reopen this device with the current account.');
const verificationRetry = () => new Error('[folder_identity_retry] Folder identity verification is temporarily unavailable. Retry after reconnecting.');
const shutdownWait = () => new Error('[folder_sync_shutdown] Thingtime is closing. Saved sync work can resume when reopened.');
const transportRetry = () => new Error('[folder_transport_retry] Folder service is temporarily unavailable. Retry after reconnecting.');
const nativeFailureCodes = new Set(['node_timeout', 'node_unavailable', 'node_protocol_error', 'folder_unavailable', 'folder_identity_retry', 'cancelled', 'unsupported_feature']);
const requestFailureCode = error => error?.name === 'ThingtimeNodeBridgeError' && nativeFailureCodes.has(error.code) ? error.code :
    error?.message === verificationRetry().message ? 'folder_identity_retry' : error?.message === unavailable().message ? 'host-refused' : 'unclassified';
const transientStatus = status => status === 408 || status === 429 || (status >= 500 && status <= 599);
async function verificationFetch(context, url, options) {
    try { return await context.window.webContents.session.fetch(url, options); }
    catch (error) {
        if (options.signal.aborted && options.signal.reason?.name === 'TimeoutError') throw verificationRetry();
        options.signal.throwIfAborted();
        // Chromium network failures use net::ERR_* messages. Certificate,
        // redirect and policy failures deliberately remain terminal.
        if (error instanceof Error && /net::ERR_(?:TIMED_OUT|CONNECTION_(?:RESET|CLOSED|FAILED|ABORTED)|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE)\b/.test(error.message)) throw verificationRetry();
        throw error;
    }
}

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
    const response = await verificationFetch(context, url, {
        credentials: 'include', cache: 'no-store', redirect: 'error', bypassCustomProtocolHandlers: true, signal,
        headers: { Accept: 'application/json', 'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': context.apiOrigin }
    });
    try {
        // Electron documents Response.url as unreliable. The literal host URL,
        // redirect:error and verified proxy-origin header pin this request.
        if (transientStatus(response.status) && !response.redirected) throw verificationRetry();
        if (response.status !== 200 || response.redirected ||
            (context.appOrigin !== context.apiOrigin && response.headers.get('x-thingtime-api-fallback') !== context.apiOrigin)) throw unavailable();
        const value = await boundedJson(response, signal, 64 * 1024);
        if (value?.user?.id !== context.ownerId || value?.user?.accountKind !== 'user') throw unavailable();
    } catch (error) {
        if (signal.aborted && signal.reason?.name === 'TimeoutError' &&
            (error === signal.reason || ['AbortError', 'TimeoutError'].includes(error?.name))) throw verificationRetry();
        throw error;
    } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}
async function readCapabilities(context, signal) {
    // Public negotiation must describe the selected server, not the bundled UI.
    // This fixed host-owned URL cannot read arbitrary network resources.
    const response = await verificationFetch(context,
        new URL('/.well-known/thingtime-capabilities.json', context.apiOrigin).href,
        { credentials: 'omit', redirect: 'error', cache: 'no-store', bypassCustomProtocolHandlers: true,
          headers: { Accept: 'application/json' }, signal }
    );
    try {
        if (transientStatus(response.status) && !response.redirected) throw verificationRetry();
        if (response.status !== 200 || response.redirected) throw unavailable();
        const manifest = await boundedJson(response, signal, 1024 * 1024);
        if (manifest?.schemaVersion !== 1 || manifest.origin !== context.apiOrigin ||
            !manifest.features || typeof manifest.features !== 'object' || Array.isArray(manifest.features)) throw unavailable();
        // Only sync requirements are exposed. Never return arbitrary upstream data.
        const features = {};
        for (const key of ['api.devices-node-identity', 'api.things', 'api.files', 'api.attachment-uploads', 'api.attachment-upload-parts',
            'api.attachment-upload-complete', 'api.attachment-content', 'api.actions-run', 'api.mongodb-endpoint']) {
            const version = manifest.features[key]?.version;
            if (typeof version === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) && version.length <= 32) features[key] = { version };
        }
        return { schemaVersion: 1, origin: context.apiOrigin, features };
    } catch (error) {
        if (signal.aborted && signal.reason?.name === 'TimeoutError' &&
            (error === signal.reason || ['AbortError', 'TimeoutError'].includes(error?.name))) throw verificationRetry();
        throw error;
    } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}

/** Only the bundled main frame may request local files. Its current account is
 * read by the host's own network stack; renderer identity is only an expectation. */
async function signDesktopUploadPart(context, body, signal, timeoutMs = 20_000, diagnostic = () => {}) {
    const report = (code, status = 0) => diagnostic({ phase: 'upload-sign', code, status });
    const partSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let response;
    try {
        response = await verificationFetch(context, new URL('/api/v1/attachments/uploads/parts', context.appOrigin).href, {
            method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', bypassCustomProtocolHandlers: true,
            signal: partSignal, headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                // The local expected-actor proxy requires same-origin mutation
                // proof. Only the captured trusted window may supply it.
                Origin: context.appOrigin,
                'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home',
                'X-Thingtime-Expected-Api-Origin': context.apiOrigin }, body: JSON.stringify(body)
        });
    } catch (error) {
        signal.throwIfAborted();
        if (retryableUploadFailure(error)) { report('transport-retry'); throw uploadRetry(); }
        if (error instanceof Error && error.message === verificationRetry().message) { report('transport-retry'); throw error; }
        report('transport-refused');
        throw unavailable();
    }
    try {
        const fallback = response.headers.get('x-thingtime-api-fallback');
        if (response.redirected || (context.appOrigin !== context.apiOrigin && fallback !== null && fallback !== context.apiOrigin)) {
            report('response-origin', response.status); throw unavailable();
        }
        // As with account verification, an upstream cooldown/outage remains a
        // recoverable wait even when the proxy could not add its origin header.
        if (transientStatus(response.status)) { report('http-retry', response.status); throw uploadRetry(); }
        if (response.status !== 200 ||
            (context.appOrigin !== context.apiOrigin && response.headers.get('x-thingtime-api-fallback') !== context.apiOrigin)) {
            report('http-rejected', response.status); throw unavailable();
        }
        try { return await boundedJson(response, partSignal, 64 * 1024); }
        catch (error) {
            signal.throwIfAborted();
            if ((partSignal.aborted && partSignal.reason?.name === 'TimeoutError') || retryableUploadFailure(error)) {
                report('transport-retry'); throw uploadRetry();
            }
            report('response-invalid', response.status);
            throw unavailable();
        }
    } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}

class DesktopFolderSync {
    constructor({ context, requestNative, verifyAccount = readAccount, capabilities = readCapabilities, fetchUpload = globalThis.fetch, timeoutMs = 300_000, diagnostic = () => {} }) {
        this.context = context; this.requestNative = requestNative; this.fetchUpload = fetchUpload; this.verifyAccount = verifyAccount;
        this.capabilities = capabilities; this.timeoutMs = timeoutMs; this.diagnostic = diagnostic; this.generation = 0; this.active = null; this.streamWaiter = null; this.ordinaryQueue = []; this.quitting = false;
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
        if (Object.prototype.hasOwnProperty.call(input, 'pageSize') &&
            (!['scan-page', 'scan-skips', 'scan-changes', 'scan-stream-finish'].includes(input.action) || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 4096)) throw unavailable();
        if (this.quitting) throw shutdownWait();
        return { ...context, apiOrigin, ownerId: input.ownerId, event, generation: this.generation };
    }
    assertCurrent(state) {
        state.abort.signal.throwIfAborted();
        const current = this.capture(state.context.event, state.input);
        if (current.generation !== state.context.generation || current.window !== state.context.window ||
            current.apiOrigin !== state.context.apiOrigin || current.appOrigin !== state.context.appOrigin) throw unavailable();
    }
    cancel(state = this.active, reason) {
        if (!state || (this[state.lane ?? 'active'] !== state && !this.ordinaryQueue.some(item => item.state === state)) || state.abort.signal.aborted) return;
        state.abort.abort(reason);
        // Cancel the native request with its original binding, including after an
        // account/endpoint switch. Never retarget it using the new renderer input.
        if (state.dispatched) void this.requestNative('folder-sync.request', {
            requestId: state.input.requestId, ownerId: state.context.ownerId, deviceId: state.input.deviceId,
            origin: state.context.apiOrigin, action: 'suspend'
        }).catch(() => {});
    }
    invalidate() { this.generation += 1; this.nativePageCapability = null; this.cancel(); this.cancel(this.streamWaiter); for (const item of [...this.ordinaryQueue]) this.cancel(item.state); }
    // before-quit can precede renderer pagehide while local services drain.
    // Preserve admission through that interval, but permit no further IO.
    quit() { this.quitting = true; this.generation += 1; this.nativePageCapability = null; this.cancel(this.active, shutdownWait()); this.cancel(this.streamWaiter, shutdownWait()); for (const item of [...this.ordinaryQueue]) this.cancel(item.state, shutdownWait()); }
    samePageCapability(context, input) {
        const cached = this.nativePageCapability;
        return cached && cached.window === context.window && cached.generation === context.generation &&
            cached.appOrigin === context.appOrigin && cached.apiOrigin === context.apiOrigin &&
            cached.ownerId === input.ownerId && cached.deviceId === input.deviceId ? cached : null;
    }
    rememberPageCapability(context, input, value) {
        this.nativePageCapability = { window: context.window, generation: context.generation, appOrigin: context.appOrigin,
            apiOrigin: context.apiOrigin, ownerId: input.ownerId, deviceId: input.deviceId,
            supported: supportsBatchPages(value?.capabilities?.fileAccessVersion),
            // Public feature negotiation belongs to this exact live binding,
            // never to an authorization TTL or an account/device grant.
            apiCapabilities: value?.apiCapabilities ? structuredClone(value.apiCapabilities) : this.samePageCapability(context, input)?.apiCapabilities };
    }
    admit(state) {
        if (state.lane === 'streamWaiter') {
            if (this.streamWaiter) throw new Error('Another streaming wait is running.');
            this.streamWaiter = state; return Promise.resolve();
        }
        if (!this.active) { this.active = state; return Promise.resolve(); }
        if (this.active.input.action === 'choose' || state.input.action === 'choose') throw new Error('Another folder request is running.');
        // Resource backpressure bounds pending RPCs, independent of file count.
        if (this.ordinaryQueue.length >= 128) throw new Error('Folder requests are busy. Retry after pending work settles.');
        return new Promise((resolve, reject) => {
            const item = { state, resolve, reject, abort: null };
            item.abort = () => {
                const index = this.ordinaryQueue.indexOf(item);
                if (index >= 0) this.ordinaryQueue.splice(index, 1);
                reject(state.abort.signal.reason);
            };
            state.abort.signal.addEventListener('abort', item.abort, { once: true });
            this.ordinaryQueue.push(item);
        });
    }
    release(state) {
        if (this[state.lane] !== state) return;
        this[state.lane] = null;
        if (state.lane !== 'active') return;
        const next = this.ordinaryQueue.shift();
        if (next) {
            next.state.abort.signal.removeEventListener('abort', next.abort);
            this.active = next.state; next.resolve();
        }
    }
    reportFailure(action, step, error) {
        if (!ACTIONS.has(action)) return;
        try { this.diagnostic({ phase: 'folder-request', action, step, code: requestFailureCode(error) }); } catch {}
    }
    async request(event, input) {
        let context;
        try { context = this.capture(event, input); }
        catch (error) { this.reportFailure(input?.action, 'capture', error); throw error; }
        if (input.action === 'suspend') {
            const state = [this.active, this.streamWaiter, ...this.ordinaryQueue.map(item => item.state)].find(value => value && value.context.event.senderFrame === event.senderFrame &&
                value.input.requestId === input.requestId && value.input.ownerId === input.ownerId && value.input.deviceId === input.deviceId);
            if (state) this.cancel(state);
            return {};
        }
        const lane = input.action === 'scan-changes' ? 'streamWaiter' : 'active';
        const state = { context, input: structuredClone(input), abort: new AbortController(), dispatched: false, lane, phase: 'admission' };
        const timer = setTimeout(() => this.cancel(state), this.timeoutMs); timer.unref?.();
        const verify = async () => {
            const previousPhase = state.phase;
            state.phase = 'account-verification';
            this.assertCurrent(state);
            const signal = AbortSignal.any([state.abort.signal, AbortSignal.timeout(20_000)]);
            await this.verifyAccount(context, signal); this.assertCurrent(state);
            state.phase = previousPhase;
        };
        try {
            await this.admit(state);
            await verify();
            let apiCapabilities;
            if (state.input.action === 'context') {
                state.phase = 'capability-verification';
                apiCapabilities = this.samePageCapability(context, state.input)?.apiCapabilities;
                if (!apiCapabilities) {
                    apiCapabilities = await this.capabilities(context, AbortSignal.any([state.abort.signal, AbortSignal.timeout(20_000)]));
                    await verify();
                }
                if (!/^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(apiCapabilities?.features?.['api.devices-node-identity']?.version ?? '')) {
                    throw new Error('The selected server does not support this version of folder sync.');
                }
            }
            if (state.input.pageSize !== undefined && state.input.action !== 'scan-changes') {
                if (!this.samePageCapability(context, state.input)) {
                    const negotiation = { requestId: randomUUID(), ownerId: context.ownerId, deviceId: state.input.deviceId,
                        origin: context.apiOrigin, action: 'context' };
                    state.phase = 'native-request';
                    const nativeContext = await this.requestNative('folder-sync.request', negotiation, { signal: state.abort.signal });
                    await verify();
                    if (!nativeContext || nativeContext.requestId !== negotiation.requestId || nativeContext.ownerId !== negotiation.ownerId ||
                        nativeContext.deviceId !== negotiation.deviceId || nativeContext.origin !== negotiation.origin ||
                        Buffer.byteLength(JSON.stringify(nativeContext)) > 900_000) throw unavailable();
                    this.rememberPageCapability(context, state.input, nativeContext);
                }
                if (!this.samePageCapability(context, state.input)?.supported)
                    throw new Error('This native host does not support larger inventory pages. Update Thingtime and reconnect.');
            }
            if (state.input.action === 'upload-part') {
                state.phase = 'capability-verification';
                let manifest = this.samePageCapability(context, state.input)?.apiCapabilities;
                if (!manifest) {
                    manifest = await this.capabilities(context, AbortSignal.any([state.abort.signal, AbortSignal.timeout(20_000)]));
                    await verify();
                }
                if (!/^1\.([1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(manifest?.features?.['api.attachment-upload-parts']?.version ?? ''))
                    throw new Error('The selected server does not support this version of folder sync.');
            }
            state.phase = 'native-request';
            state.dispatched = true;
            const value = state.input.action === 'upload-part' ? await uploadFolderPart({ input: state.input, context,
                signal: state.abort.signal, authorize: verify, fetchUpload: this.fetchUpload,
                requestNative: request => this.requestNative('folder-sync.request', request, { signal: state.abort.signal }),
                signPart: async body => { await verify(); return signDesktopUploadPart(context, body, state.abort.signal, 20_000, this.diagnostic); }
            }) : await this.requestNative('folder-sync.request', { ...state.input, origin: context.apiOrigin }, { signal: state.abort.signal });
            state.phase = 'reply-verification';
            if (!value || typeof value !== 'object') throw unavailable();
            if (state.input.action === 'context') {
                this.assertCurrent(state);
                value.apiCapabilities = apiCapabilities;
                if (/^1\.([2-9]|[1-9][0-9]+)\.(0|[1-9][0-9]*)$/.test(value.capabilities?.fileAccessVersion ?? ''))
                    value.capabilities = { ...value.capabilities, fileUploadVersion: '1.0.1' };
            }
            await verify();
            if (!value || typeof value !== 'object' || value.requestId !== input.requestId || value.ownerId !== input.ownerId ||
                value.deviceId !== input.deviceId || value.origin !== context.apiOrigin) throw unavailable();
            if (state.input.action === 'context') this.rememberPageCapability(context, state.input, value);
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
        } catch (error) {
            if (!state.abort.signal.aborted) {
                try { this.assertCurrent(state); }
                catch (authorityError) { this.reportFailure(input.action, 'reply-verification', authorityError); throw authorityError; }
                this.reportFailure(input.action, state.phase, error);
                // Only fixed, trusted native transport codes may retry. Source,
                // account, capability and protocol refusals remain terminal.
                if (state.phase === 'native-request' && error?.name === 'ThingtimeNodeBridgeError' &&
                    ['node_timeout', 'node_unavailable'].includes(error.code)) throw transportRetry();
                // Electron serializes Error.name in its rejection text. Normalize
                // this exact native marker to the renderer's existing contract.
                if (error?.name === 'ThingtimeNodeBridgeError' && error.code === 'folder_identity_retry' &&
                    error.message === verificationRetry().message) throw verificationRetry();
            }
            // The native bridge reports cancellation with its own fixed code.
            // A genuine authority/protocol refusal still keeps its diagnosis.
            if (this.quitting && state.abort.signal.aborted &&
                (error === state.abort.signal.reason || error?.name === 'AbortError' ||
                    (error?.name === 'ThingtimeNodeBridgeError' && error.code === 'cancelled')))
                throw state.abort.signal.reason;
            throw error;
        } finally { clearTimeout(timer); this.release(state); }
    }
}
module.exports = { DesktopFolderSync, readAccount, readCapabilities, signDesktopUploadPart };
