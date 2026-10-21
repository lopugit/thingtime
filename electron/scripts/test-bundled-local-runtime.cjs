'use strict';
// Fresh authenticated MongoDB is populated only through the normal account API.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { LocalRuntime, assertFreePort } = require('../lib/local-runtime.cjs');
const root = path.resolve(__dirname, '../..');
const ports = { api: 19881, database: 19882 };
const origin = `http://127.0.0.1:${ports.api}`;
const binary = path.join(root, 'electron/dist/database/mongodb/bin/mongod');
async function blocked(url) {
 try { await fetch(url, { signal: AbortSignal.timeout(2000) }); throw new Error('Network boundary failed.'); }
 catch (error) { assert.equal(error.cause?.code, 'EPERM', 'Network request was not denied by the OS sandbox.'); }
}
async function fixture(directory) {
 const { MongoClient } = require('../dist/database/driver.cjs');
 const key = crypto.randomBytes(32);
 const safeStorage = { isEncryptionAvailable: () => true,
  encryptString(text) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
  decryptString(data) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0,12)); decipher.setAuthTag(data.subarray(-16)); return Buffer.concat([decipher.update(data.subarray(12,-16)), decipher.final()]).toString(); }
 };
 const create = () => new LocalRuntime({ userData: directory, safeStorage, bundledMongodPath: binary, createMongoClient: (...args) => new MongoClient(...args) });
 let runtime = create(), server;
 async function stopServer() {
  if (server && server.exitCode === null && server.signalCode === null) {
   const child = server, exited = once(child, 'exit');
   child.kill('SIGTERM');
   const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
   try { await exited; } finally { clearTimeout(timer); }
  }
  server = null;
 }
 async function start() {
  await runtime.start();
  const env = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api), THINGTIME_DESKTOP: '1' };
  runtime.applyEnvironment(env);
  server = spawn(process.execPath, [path.join(root, 'remix/.output/server/index.mjs')], { env, cwd: path.join(root, 'remix'), stdio: ['ignore', 'ignore', 'ignore'] });
  for (let n = 0; n < 160; n++) {
   if (server.exitCode !== null) throw new Error('Fixture API exited before readiness.');
   try { if ((await fetch(origin + '/.well-known/thingtime-capabilities.json')).ok) return; } catch {}
   await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Fixture API did not become ready.');
 }
 try {
  await assertFreePort(ports.api); await assertFreePort(ports.database);
  await blocked('http://1.1.1.1/'); await blocked('http://127.0.0.1:19883/');
  const redirect = http.createServer((_req, res) => { res.writeHead(307, { Location: 'http://1.1.1.1/' }); res.end(); });
  await new Promise(resolve => redirect.listen(ports.api, '127.0.0.1', resolve));
  try { await blocked(origin); } finally { await new Promise(resolve => redirect.close(resolve)); }
  await runtime.initialize();
  assert.equal(runtime.snapshot().bundledMongoSelected, true, 'Fresh default must select the bundled binary.');
  await runtime.configure({ enabled: true, databaseMode: 'managed', apiPort: ports.api, databasePort: ports.database });
  await start();
  const registration = await fetch(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bundled-mongo-synthetic', password: crypto.randomBytes(24).toString('base64url'), email: 'fixture@example.invalid' }) });
  assert.equal(registration.status, 200, 'Normal registration did not succeed.');
  const registered = await registration.json(); assert.equal(registered.ok, true); assert.ok(registered.user?.id);
  const cookie = registration.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  const readUser = async () => { const response = await fetch(origin + '/api/v1/auth/me', { headers: { Cookie: cookie } }); assert.equal(response.status, 200); return response.json(); };
  assert.equal((await readUser()).user.id, registered.user.id);
  const anonymous = new MongoClient(`mongodb://127.0.0.1:${ports.database}/`, { directConnection: true, serverSelectionTimeoutMS: 2000 });
  try { await anonymous.connect(); await assert.rejects(anonymous.db('thingtime').command({ listCollections: 1 }), error => error.code === 13); } finally { await anonymous.close(); }
  await stopServer(); await runtime.stop();
  runtime = create(); await runtime.initialize();
  assert.equal(runtime.snapshot().bundledMongoSelected, true);
  await start();
  assert.equal((await readUser()).user.id, registered.user.id, 'Normal API session and account must survive managed database restart.');
  console.log('PASS bundled MongoDB default bootstrap, authenticated replica, normal API registration/session retention across restart, denied anonymous DB reads, and OS network boundary.');
 } finally { await stopServer(); await runtime.stop(); }
}
async function run() {
 if (process.env.TT_BUNDLED_RUNTIME_FIXTURE === '1') return fixture(process.env.TT_BUNDLED_RUNTIME_ROOT);
 if (process.platform !== 'darwin') throw new Error('Requires macOS OS sandbox enforcement.');
 await fs.access(binary); await fs.access(path.join(root, 'remix/.output/server/index.mjs'));
 const directory = await fs.mkdtemp(path.join(tmpdir(), 'tt-bundled-runtime-'));
 try {
  const policy = path.join(directory, 'network.sb');
  const addresses = Object.values(ports).map(port => `(local ip "localhost:${port}")`).join(' ');
  const destinations = Object.values(ports).map(port => `(remote ip "localhost:${port}")`).join(' ');
  await fs.writeFile(policy, `(version 1)(allow default)(deny network*)(allow network-bind ${addresses})(allow network-inbound ${addresses})(allow network-outbound ${destinations})`);
  const result = spawnSync('/usr/bin/sandbox-exec', ['-f', policy, process.execPath, __filename], { env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, TT_BUNDLED_RUNTIME_FIXTURE: '1', TT_BUNDLED_RUNTIME_ROOT: directory }, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', detached: true });
  if (result.error || result.status !== 0) { try { process.kill(-result.pid, 'SIGKILL'); } catch {} }
  assert.equal(result.status, 0, result.stderr.slice(-1500));
  assert.match(result.stdout, /PASS bundled MongoDB default bootstrap/);
  process.stdout.write(result.stdout);
 } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
