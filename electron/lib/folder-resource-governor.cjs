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
        this.factor = 1; this.samples = new Map(); this.lastAdapt = -Infinity; this.setLimits(policy);
    }
    setLimits(policy) { this.policy = limits(policy); }
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
        this.sample('indexer-process', resources.indexingCpuPercent ?? null);
        this.sample('source-thread', resources.sourceCpuPercent ?? null);
        if (Number.isSafeInteger(resources.effectiveTransferConcurrency) && resources.effectiveTransferConcurrency > 0) this.nativeTransfer = resources.effectiveTransferConcurrency;
        if (Number.isSafeInteger(resources.effectiveIndexingConcurrency) && resources.effectiveIndexingConcurrency > 0) this.indexing = resources.effectiveIndexingConcurrency;
    }
    cpu() { const fresh = [...this.samples.values()].filter(x => this.clock() - x.at < 2000); return fresh.length ? Math.min(100, fresh.reduce((s, x) => s + x.percent, 0)) : null; }
    concurrency() { return Math.max(1, Math.floor(Math.min(16, this.policy.transferConcurrency ?? 16) * this.factor)); }
    clearIdleReservations() {
        for (const direction of ['upload', 'download']) {
            // Pace is charged before emission. A completed ticket has therefore
            // paid its entire byte cost; once no ticket remains, only unused
            // cancelled reservations can lie in the future. Never reset a lane
            // with a live waiter, even if another transfer released its permit.
            if (this.pacing[direction] === 0 && this.next[direction] > this.clock()) this.next[direction] = this.clock();
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
        this.pacing[direction]++;
        try {
            const configured = this.policy[direction + 'BytesPerSecond'];
            // CPU pressure also paces unlimited connections; this adaptive duty
            // delay is independent of the optional user byte ceiling.
            const rate = configured ? configured * this.factor : undefined;
            if (rate) {
                const start = Math.max(this.clock(), this.next[direction]);
                const end = start + count / rate * 1000; this.next[direction] = end;
                while (this.clock() < end) { signal.throwIfAborted(); await this.wait(Math.min(100, end - this.clock()), signal); await check(); }
            } else if (this.factor < 1) { await this.wait(Math.min(250, (1 / this.factor - 1) * 10), signal); await check(); }
            signal.throwIfAborted(); await check(); signal.throwIfAborted();
        } finally {
            this.pacing[direction]--;
            this.clearIdleReservations();
        }
    }
    quantum(direction) {
        const rate = this.policy[direction + 'BytesPerSecond'];
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
        return { version: 1, cpuPercent: cpu, cpuStatus: cpu === null ? 'unavailable' : 'measured',
            cpuScopes: [...this.samples.entries()].filter(([, value]) => this.clock() - value.at < 2000).map(([key]) => key), effectiveTransferConcurrency: Math.min(this.concurrency(), this.nativeTransfer ?? 16, this.transport?.effectiveTransferConcurrency ?? 16),
            effectiveIndexingConcurrency: this.indexing ?? Math.max(1, Math.min(this.policy.indexingConcurrency ?? 4, 64)),
            ...(this.policy.cpuPercent ? { scopeCpuBudgetPercent: this.policy.cpuPercent / 3 } : {}),
            ...(this.policy.uploadBytesPerSecond ? { uploadBytesPerSecond: (this.transport?.uploadBytesPerSecond ?? this.policy.uploadBytesPerSecond * this.factor) } : {}),
            ...(this.policy.downloadBytesPerSecond ? { downloadBytesPerSecond: this.policy.downloadBytesPerSecond * this.factor } : {}) };
    }
}
const governors = new Map();
function governorFor(input, context, force = false) {
    const policy = limits(input.resourceLimits ?? input.batch?.descriptor?.configuration?.configuration?.resourceLimits);
    if (!Object.keys(policy).length && !force) return null;
    const scope = input.resourceScope ?? input.batch?.descriptor?.scope?.rootId ?? input.transfer?.scope?.rootId;
    if (typeof scope !== 'string' || !scope || scope.length > 512) throw new Error('A resource-limited sync requires its connection scope.');
    // Lazy TTL cleanup avoids timers or retaining abandoned connection scopes.
    const now = performance.now();
    for (const [key, saved] of governors) if (!saved.active && !saved.pending && now - (saved.lastUsed ?? now) > 300000) governors.delete(key);
    const key = JSON.stringify([context.apiOrigin, context.ownerId, input.deviceId, input.rootId, scope]);
    let governor = governors.get(key);
    if (!governor) { governor = new ResourceGovernor(policy); governors.set(key, governor); }
    else governor.setLimits(policy);
    governor.lastUsed = now;
    clearTimeout(governor.cleanupTimer);
    const expire = () => {
        if (governor.active || governor.pending) { governor.cleanupTimer = setTimeout(expire, 300000); governor.cleanupTimer.unref(); }
        else if (governors.get(key) === governor) governors.delete(key);
    };
    governor.cleanupTimer = setTimeout(expire, 300000); governor.cleanupTimer.unref();
    return governor;
}
module.exports = { ResourceGovernor, governorFor, limits };
