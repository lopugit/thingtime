#!/usr/bin/env node
// Run from remix after NITRO_PRESET=node-server npm run build:server.
// Actual Nitro and Vite, clean environment, OS-enforced network isolation.
// No permissive fallback if sandbox preflight fails.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('..', import.meta.url));
const { ports } = require('./worktree-ports.cjs').resolveDevContext(cwd);
if (process.platform !== 'darwin') throw new Error('Requires macOS sandbox-exec; other hosts must provide an isolated network namespace.');
await readFile(join(cwd, '.output/server/index.mjs'));
const dir = await mkdtemp(join(tmpdir(), 'tt-local-api-safety-'));
const processes = [];
let trapHits = 0;
const trap = createServer((req, res) => { trapHits++; res.writeHead(307, { Location: 'http://1.1.1.1:80/' }); res.end(); });
await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
const trapPort = trap.address().port;
const policyPath = join(dir, 'network.sb');
await writeFile(policyPath, `(version 1)(allow default)(deny network*)
(allow network-inbound (local ip "localhost:${ports.api}") (local ip "localhost:${ports.web}") (local ip "localhost:${ports.hmr}"))
(allow network-outbound (remote ip "localhost:${ports.api}") (remote ip "localhost:${trapPort}"))`);
const cleanEnv = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr),
  THINGTIME_API_FALLBACK_ORIGIN: 'https://thingtime.com', THINGTIME_DATA_ENV: 'development' };
const start = (args, env = cleanEnv) => {
  const child = spawn('/usr/bin/sandbox-exec', ['-f', policyPath, process.execPath, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  processes.push(child); return { child, output: () => output };
};
const probe = async code => {
  const running = start(['--input-type=module', '-e', code]);
  const [status] = await once(running.child, 'exit'); assert.equal(status, 0, running.output());
};
const waitFor = async (url, running) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (running.child.exitCode !== null) throw new Error(running.output());
    try { if ((await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local server did not start: ${running.output()}`);
};
try {
  // Refuse occupied ports; never attach to another task's backend.
  for (const port of [ports.api, ports.web, ports.hmr]) {
    const socket = createServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => socket.close(resolve));
  }
  await probe(`async function blocked(url) { try { await fetch(url, {signal:AbortSignal.timeout(2000)}); throw new Error('NETWORK_BOUNDARY_FAILED'); } catch(e) { if(e.message==='NETWORK_BOUNDARY_FAILED' || e.name==='TimeoutError' || e.cause?.code!=='EPERM') throw e; } }
    await blocked('http://1.1.1.1:80/'); await blocked('http://127.0.0.1:${trapPort}/redirect');`);
  assert.equal(trapHits, 1);
  const server = start(['.output/server/index.mjs']);
  await waitFor(`http://127.0.0.1:${ports.api}/.well-known/thingtime-capabilities.json`, server);
  const vite = start(['--input-type=module', '-e', `import {createServer} from 'vite'; const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}}); await server.listen();`], { ...cleanEnv, NODE_ENV: 'development' });
  await waitFor(`http://127.0.0.1:${ports.web}/.well-known/thingtime-capabilities.json`, vite);
  for (const port of [ports.api, ports.web]) {
    const origin = `http://127.0.0.1:${port}`;
    const manifest = await (await fetch(`${origin}/.well-known/thingtime-capabilities.json`)).json();
    assert.equal(manifest.origin, origin); assert.equal(manifest.features['api.admin-migrations-run'].version, '1.4.0');
    for (const [path, method] of [['v1/auth/register', 'POST'], ['v1/things', 'POST'], ['v1/admin/migrations/run', 'POST'], ['root-data', 'GET']]) {
      const response = await fetch(`${origin}/api/${path}`, { method, redirect: 'error', ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{"username":"isolated-no-create","password":"synthetic-not-a-real-credential"}' } : {}) });
      assert.equal(response.status, 503, `${port} ${path}`); assert.equal((await response.json()).code, 'LOCAL_API_NOT_CONFIGURED');
      assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('x-thingtime-api-fallback'), null);
    }
  }
  assert.equal(trapHits, 1);
  console.log(JSON.stringify({ ok: true, ports, directIpBlocked: true, redirectBlocked: true, nitroAndViteFailClosed: true, cookiesIssued: 0, productionAccess: false }));
} finally {
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(processes.filter(child => child.exitCode === null).map(child => once(child, 'exit')));
  await new Promise(resolve => trap.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
