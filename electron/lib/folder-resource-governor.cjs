'use strict';
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');
const LIMIT_KEYS = ['uploadBytesPerSecond', 'downloadBytesPerSecond', 'transferConcurrency', 'indexingConcurrency', 'cpuPercent'];
function limits(value) {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !LIMIT_KEYS.includes(k))) throw new Error('Invalid sync resource limits.');
    for (const [k, v] of Object.entries(value)) if (!Number.isFinite(v) || v <= 0 ||
        (k.endsWith('Concurrency') && !Number.isSafeInteger(v)) || (k === 'cpuPercent' && (!Number.isInteger(v) || v < 1 || v > 100))) throw new Error('Invalid sync resource limits.');
    return { ...value };
}
// One governor is shared by ALL transfers for the same authorized connection.
// Configuration replacement mutates the governor, never resets its reserved bytes.
class ResourceGovernor {
    constructor(policy = {}, clock = () => performance.now(), wait = (ms, signal) => sleep(ms, undefined, { signal })) {
        this.clock = clock; this.wait = wait; this.next = { upload: 0, download: 0 }; this.pacing = { upload: 0, download: 0 }; this.active = 0;
        this.totalBytesPerSecond = null; this.byteSamples = []; this.transferred = { upload: 0, download: 0 }; this.factor = 1; this.samples = new Map(); this.lastAdapt = -Infinity; this.setLimits(policy);
    }
    setLimits(policy) {
        const next = limits(policy);
        // A queued connection must not raise an in-flight connection's stricter
        // ceilings. Idle admission may replace them for the next connection.
        if (this.policy && (this.active || this.pending || this.pacing.upload || this.pacing.download)) {
            for (const key of LIMIT_KEYS) if (this.policy[key] !== undefined) next[key] = Math.min(this.policy[key], next[key] ?? Infinity);
        }
        this.policy = next;
    }
    sample(scope, percent) {
        if (!['transport-process', 'indexer-process', 'source-thread'].includes(scope)) throw new Error('Invalid CPU scope.');
        if (percent === null) { this.samples.delete(scope); return; }
        else if (Number.isFinite(percent) && percent >= 0 && percent <= 100) this.samples.set(scope, { percent, at: this.clock() });
        const cpu = this.cpu();
        if (this.clock() - this.lastAdapt < 250) return;
        this.lastAdapt = this.clock();
        if (this.policy.cpuPercent && cpu !== null) {
            if (cpu > this.policy.cpuPercent / (this.cpuBudgetShares ?? 1)) this.factor = Math.max(0.01, this.factor * 0.7);
            else if (cpu < this.policy.cpuPercent / (this.cpuBudgetShares ?? 1) * 0.8) this.factor = Math.min(1, this.factor + 0.025);
        }
    }
    observeNative(resources) {
        if (resources?.version !== 1) return;
        if (Number.isFinite(resources.measuredAt) && resources.measuredAt < this.nativeResources?.measuredAt) return;
        this.nativeResources = resources;
        this.sample('indexer-process', resources.indexingCpuPercent ?? null);
        this.sample('source-thread', resources.sourceCpuPercent ?? null);
        if (Number.isSafeInteger(resources.effectiveTransferConcurrency) && resources.effectiveTransferConcurrency > 0) this.nativeTransfer = resources.effectiveTransferConcurrency;
        if (Number.isSafeInteger(resources.effectiveIndexingConcurrency) && resources.effectiveIndexingConcurrency > 0) this.indexing = resources.effectiveIndexingConcurrency;
    }
    observeTransport(resources) {
        this.transport = resources; this.transportAt = this.clock();
        this.sample('transport-process', resources.cpuPercent);
    }
    clearTransport() {
        this.transport = undefined; this.transportAt = undefined;
        this.sample('transport-process', null);
    }
    cpu() { const fresh = [...this.samples.values()].filter(x => this.clock() - x.at < 2000); return fresh.length ? Math.min(100, fresh.reduce((s, x) => s + x.percent, 0)) : null; }
    concurrency() { return Math.max(1, Math.floor(Math.min(16, this.policy.transferConcurrency ?? 16) * this.factor)); }
    clearIdleReservations() {
        for (const lane of ['upload', 'download']) {
            // Pace is charged before emission. A completed ticket has therefore
            // paid its entire byte cost; once no ticket remains, only unused
            // cancelled reservations can lie in the future. Never reset a lane
            // with a live waiter, even if another transfer released its permit.
            if (this.pacing[lane] === 0 && this.next[lane] > this.clock()) this.next[lane] = this.clock();
        }
    }
    async acquire(signal, check = () => {}) {
        while (this.active >= this.concurrency()) { signal.throwIfAborted(); await this.wait(25, signal); await check(); }
        signal.throwIfAborted(); await check(); signal.throwIfAborted();
        // check may await; another caller may have admitted while it did.
        if (this.active >= this.concurrency()) return this.acquire(signal, check);
        this.active++; let released = false;
        return () => { if (!released) { released = true; this.active--; this.clearIdleReservations(); } };
    }
    async pace(direction, count, signal, check = () => {}) {
        const lane = this.totalBytesPerSecond ? 'upload' : direction;
        if (!['upload', 'download'].includes(direction) || !Number.isSafeInteger(count) || count < 0) throw Error('Invalid transfer byte count.');
        this.pacing[lane]++;
        try {
            const configured = this.totalBytesPerSecond ? Math.min(this.totalBytesPerSecond, this.policy[direction + 'BytesPerSecond'] ?? Infinity) : this.policy[direction + 'BytesPerSecond'];
            // CPU pressure also paces unlimited connections; this adaptive duty
            // delay is independent of the optional user byte ceiling.
            const rate = configured ? configured * this.factor : undefined;
            if (rate) {
                const start = Math.max(this.clock(), this.next[lane]);
                const end = start + count / rate * 1000; this.next[lane] = end;
                while (this.clock() < end) { signal.throwIfAborted(); await this.wait(Math.min(100, end - this.clock()), signal); await check(); }
            } else if (this.factor < 1) { await this.wait(Math.min(250, (1 / this.factor - 1) * 10), signal); await check(); }
            signal.throwIfAborted(); await check(); signal.throwIfAborted();
            this.transferred[direction] += count;
            this.byteSamples.push({ at: this.clock(), ...this.transferred });
            while (this.byteSamples.length > 2 && this.byteSamples[1].at < this.clock() - 1000) this.byteSamples.shift();
        } finally {
            this.pacing[lane]--;
            this.clearIdleReservations();
        }
    }
    quantum(direction) {
        const rate = this.totalBytesPerSecond ? Math.min(this.totalBytesPerSecond, this.policy[direction + 'BytesPerSecond'] ?? Infinity) : this.policy[direction + 'BytesPerSecond'];
        return rate ? Math.max(1, Math.min(65536, Math.floor(rate * this.factor / 10))) : 65536;
    }
    body(bytes, signal, check) {
        let offset = 0; const governor = this;
        return new ReadableStream({
            async pull(controller) {
                try {
                    if (offset === bytes.length) { controller.close(); return; }
                    const end = Math.min(bytes.length, offset + governor.quantum('upload')), chunk = bytes.subarray(offset, end);
                    await governor.pace('upload', chunk.length, signal, check); offset = end; controller.enqueue(chunk);
                } catch (error) { controller.error(error); }
            }
        }, { highWaterMark: 0 });
    }
    snapshot() {
        const cpu = this.cpu();
        const transport = this.transport && this.clock() - this.transportAt < 2000 ? this.transport : undefined;
        const first = this.byteSamples[0], last = this.byteSamples.at(-1), elapsed = first && last ? (last.at - first.at) / 1000 : 0;
        const current = elapsed >= .25 && elapsed <= 2 && this.clock() - last.at < 2000;
        const measuredAt = Date.now();
        const nativeAge = measuredAt - this.nativeResources?.measuredAt;
        const native = nativeAge >= 0 && nativeAge < 2000 ? this.nativeResources : undefined;
        return { ...native, version: 1, cpuPercent: cpu,
            measuredAt,
            currentUploadBytesPerSecond: transport?.currentUploadBytesPerSecond ?? (current ? (last.upload - first.upload) / elapsed : null),
            currentDownloadBytesPerSecond: transport?.currentDownloadBytesPerSecond ?? (current ? (last.download - first.download) / elapsed : null),
            transferBytesPerSecond: this.totalBytesPerSecond, cpuStatus: cpu === null ? 'unavailable' : 'measured',
            cpuScopes: [...this.samples.entries()].filter(([, value]) => this.clock() - value.at < 2000).map(([key]) => key), effectiveTransferConcurrency: Math.min(this.concurrency(), this.nativeTransfer ?? 16, transport?.effectiveTransferConcurrency ?? 16),
            effectiveIndexingConcurrency: this.indexing ?? Math.max(1, Math.min(this.policy.indexingConcurrency ?? 4, 64)),
            ...(this.policy.cpuPercent ? { scopeCpuBudgetPercent: this.policy.cpuPercent / 3 } : {}),
            ...(this.policy.uploadBytesPerSecond ? { uploadBytesPerSecond: (transport?.uploadBytesPerSecond ?? this.policy.uploadBytesPerSecond * this.factor) } : {}),
            ...(this.policy.downloadBytesPerSecond ? { downloadBytesPerSecond: this.policy.downloadBytesPerSecond * this.factor } : {}) };
    }
}
const governors = new Map();
function governorFor(input, context, force = false) {
    const key = JSON.stringify([context.apiOrigin, context.ownerId, input.deviceId]);
    // Reading telemetry shares the active governor but must never initialize it
    // or reset an admitted connection's resource ceilings.
    if (input.action === 'resources' && !input.deviceResourceLimits) return governors.get(key) ?? null;
    const configured = limits(input.resourceLimits ?? input.batch?.descriptor?.configuration?.configuration?.resourceLimits);
    const device = deviceLimits(input.deviceResourceLimits);
    const policy = { ...configured, cpuPercent: Math.min(configured.cpuPercent ?? 100, device.cpuPercent) };
    if (!input.rootId && !input.batch && !input.transfer && !(input.action === 'resources' && input.deviceResourceLimits)) return null;
    const scope = input.resourceScope ?? input.batch?.descriptor?.scope?.rootId ?? input.transfer?.scope?.rootId;
    if (Object.keys(configured).length && (typeof scope !== 'string' || !scope || scope.length > 512)) throw new Error('A resource-limited sync requires its connection scope.');
    // Lazy TTL cleanup avoids timers or retaining abandoned connection scopes.
    const now = performance.now();
    for (const [key, saved] of governors) if (!saved.active && !saved.pending && now - (saved.lastUsed ?? now) > 300000) governors.delete(key);
    let governor = governors.get(key);
    if (!governor) { governor = new ResourceGovernor(policy); governors.set(key, governor); }
    else governor.setLimits(policy);
    governor.totalBytesPerSecond = device.transferBytesPerSecond; governor.deviceResourceLimits = device;
    governor.onPolicyChange?.();
    governor.lastUsed = now;
    clearTimeout(governor.cleanupTimer);
    const expire = () => {
        if (governor.active || governor.pending) { governor.cleanupTimer = setTimeout(expire, 300000); governor.cleanupTimer.unref(); }
        else if (governors.get(key) === governor) governors.delete(key);
    };
    governor.cleanupTimer = setTimeout(expire, 300000); governor.cleanupTimer.unref();
    return governor;
}
function deviceLimits(value) {
    const p = value ?? { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 };
    if (!p || Object.keys(p).some(k => !['transferBytesPerSecond', 'scanBytesPerSecond', 'cpuPercent'].includes(k)) || ![p.transferBytesPerSecond, p.scanBytesPerSecond].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(p.cpuPercent) || p.cpuPercent < 1 || p.cpuPercent > 100) throw Error('Invalid device sync resources.');
    return { ...p };
}
module.exports = { ResourceGovernor, governorFor, limits, deviceLimits };
