import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mcpRequire = createRequire(path.resolve(electronDir, '../MCP/package.json'));
const { build } = mcpRequire('esbuild');
const electron = require('electron');
const electronEnv = { ...process.env };
delete electronEnv.ELECTRON_RUN_AS_NODE;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'thingtime-restart-verification-'));
const profile = path.join(temporary, 'profile'), bundle = path.join(temporary, 'fixture.js');
let occupied;
async function launch(stage) {
    const result = path.join(temporary, `${stage}.json`);
    await new Promise((resolve, reject) => {
        const child = spawn(electron, [path.join(electronDir, 'test/fixtures/renderer-restart.cjs'), profile, bundle, stage, result],
            { stdio: ['ignore', 'ignore', 'inherit'], env: electronEnv });
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`Electron ${stage} timed out`)); }, 60000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`Electron ${stage} failed: ${code ?? signal}`)); });
    });
    return JSON.parse(await readFile(result, 'utf8'));
}
try {
    await build({ entryPoints: [path.join(electronDir, 'test/fixtures/renderer-restart.client.ts')], bundle: true, platform: 'browser', outfile: bundle });
    const seeded = await launch('seed');
    const stateFile = path.join(profile, 'renderer-origin.json'), original = await readFile(stateFile, 'utf8');
    let requests = 0;
    occupied = http.createServer((_request, response) => { requests++; response.end('untrusted'); });
    await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(JSON.parse(original).port, '127.0.0.1', resolve); });
    assert.deepEqual(await launch('collision'), { stage: 'collision', refused: true });
    assert.equal(requests, 0); assert.equal(await readFile(stateFile, 'utf8'), original);
    await new Promise(resolve => occupied.close(resolve)); occupied = null;
    const recovered = await launch('recover'), verified = await launch('verify');
    for (const result of [recovered, verified]) {
        assert.equal(result.origin, seeded.origin); assert.equal(result.runId, seeded.runId);
        assert.deepEqual(result.operationIds, seeded.operationIds); assert.equal(result.draftId, seeded.draftId);
    }
    console.log(JSON.stringify({ ok: true, launches: 4, checks: ['bundled-Nitro-middleware', 'bundled-startup-JavaScript-and-CSS', 'stable-origin', 'IndexedDB-pending-run', 'confirmed-operation-skip',
        'lost-reply-receipt-recovery', 'completion-checkpoint', 'pending-editor-draft', 'scope-isolation', 'occupied-port-refusal-and-recovery'], nativeDispatch: 'none', receipts: 'synthetic' }));
} finally {
    if (occupied) await new Promise(resolve => occupied.close(resolve));
    await rm(temporary, { recursive: true, force: true });
}
