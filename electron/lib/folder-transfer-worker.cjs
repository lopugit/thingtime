'use strict';
// This process performs only this connection's sync transport. Process CPU is
// consequently attributable; parent/UI and unrelated helpers are excluded.
const { setTimeout: sleep } = require('node:timers/promises');
const { createHash } = require('node:crypto');
const { availableParallelism } = require('node:os');
const { ResourceGovernor } = require('./folder-resource-governor.cjs');
const governor = new ResourceGovernor(); governor.cpuBudgetShares = 3;
const requests = new Map(), approvals = new Map(); let ticket = 0;
function authorize(id, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const key = ++ticket;
        const cancel = () => { approvals.delete(key); reject(signal.reason); };
        approvals.set(key, ok => { signal.removeEventListener('abort', cancel); approvals.delete(key); ok ? resolve() : reject(new Error('authority')); });
        signal.addEventListener('abort', cancel, { once: true });
        process.send?.({ kind: 'authority', id, ticket: key });
        if (signal.aborted) cancel();
    });
}
let lastCpu = process.cpuUsage(), lastWall = process.hrtime.bigint();
const beganCpu = { user: 0, system: 0 }, beganWall = process.hrtime.bigint() - BigInt(Math.floor(process.uptime() * 1e9));
async function cpuCheckpoint(signal) {
    if (!governor.policy.cpuPercent) return;
    while (true) {
        signal.throwIfAborted();
        const cpu = process.cpuUsage(beganCpu), elapsed = Number(process.hrtime.bigint() - beganWall) / 1e9;
        const debt = (cpu.user + cpu.system) / 1e6 / (availableParallelism() * governor.policy.cpuPercent / 300) - elapsed;
        if (debt <= 0) return;
        await sleep(Math.min(100, debt * 1000), undefined, { signal });
    }
}
const sample = () => {
    const wall = process.hrtime.bigint(), cpu = process.cpuUsage();
    const percent = Math.min(100, (cpu.user - lastCpu.user + cpu.system - lastCpu.system) * 100000 / Number(wall - lastWall) / availableParallelism());
    lastCpu = cpu; lastWall = wall;
    governor.sample('transport-process', percent);
    process.send?.({ kind: 'resources', resources: governor.snapshot() });
};
const timer = setInterval(() => { if (requests.size) sample(); }, 250); timer.unref();
process.on('disconnect', () => { requests.forEach(c => c.abort()); process.exit(0); });
process.on('message', async message => {
    if (message.kind === 'authority-reply') { approvals.get(message.ticket)?.(message.accepted === true); return; }
    if (message.kind === 'policy') { governor.setLimits(message.policy); return; }
    if (message.kind === 'sample') { governor.sample(message.scope, message.percent); return; }
    if (message.kind === 'cancel') { requests.get(message.id)?.abort(); return; }
    if (!['put', 'hash', 'get'].includes(message.kind)) return;
    const controller = new AbortController(); requests.set(message.id, controller);
    let release;
    try {
        release = await governor.acquire(controller.signal);
        const bytes = message.bytes ? Buffer.from(message.bytes) : null;
        if (message.kind === 'hash') {
            await cpuCheckpoint(controller.signal);
            const digest = createHash('sha256').update(bytes).digest('hex');
            await cpuCheckpoint(controller.signal);
            process.send?.({ kind: 'reply', id: message.id, digest }); return;
        }
        await authorize(message.id, controller.signal);
        if (message.kind === 'get') {
            if (!Number.isSafeInteger(message.offset) || !Number.isSafeInteger(message.length) || message.offset < 0 || message.length <= 0 || message.length > 2097152 || message.offset + message.length > message.size || !(Date.parse(message.expiresAt) > Date.now())) throw new Error('range');
            const response = await fetch(message.url, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: message.headers, signal: controller.signal });
            try {
                if (response.status !== 206 || response.redirected || ![null, 'identity'].includes(response.headers.get('content-encoding')) || response.headers.get('content-range') !== `bytes ${message.offset}-${message.offset + message.length - 1}/${message.size}` || !response.body || (response.headers.has('content-length') && response.headers.get('content-length') !== String(message.length))) throw new Error('range');
                const output = Buffer.alloc(message.length), reader = response.body.getReader(); let at = 0;
                try {
                    for (;;) {
                        const chunk = await reader.read(); controller.signal.throwIfAborted();
                        if (chunk.done) break;
                        if (at + chunk.value.length > output.length) throw new Error('range');
                        for (let start = 0; start < chunk.value.length; start += 65536) {
                            const part = chunk.value.subarray(start, Math.min(start + 65536, chunk.value.length));
                            await governor.pace('download', part.length, controller.signal, async () => { await cpuCheckpoint(controller.signal); await authorize(message.id, controller.signal); });
                            output.set(part, at); at += part.length;
                        }
                    }
                    if (at !== output.length) throw new Error('range');
                    const digest = createHash('sha256').update(output).digest('hex');
                    await cpuCheckpoint(controller.signal);
                    process.send?.({ kind: 'reply', id: message.id, bytes: output, sha256: digest });
                } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            } finally { await response.body?.cancel().catch(() => {}); }
            return;
        }
        const response = await fetch(message.url, { method: 'PUT', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
            headers: message.headers, body: governor.body(bytes, controller.signal, async () => { await cpuCheckpoint(controller.signal); await authorize(message.id, controller.signal); }), duplex: 'half', signal: controller.signal });
        await response.body?.cancel();
        process.send?.({ kind: 'reply', id: message.id, status: response.status, redirected: response.redirected });
    } catch (error) {
        // Only fixed categories cross IPC; no signed URLs or network error text.
        process.send?.({ kind: 'reply', id: message.id, error: controller.signal.aborted ? 'cancelled' : 'transport', code: error?.message === 'authority' ? 'EACCES' : (error?.cause?.code ?? error?.code) });
    } finally { release?.(); requests.delete(message.id); sample(); }
});
