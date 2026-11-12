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
const { pathToFileURL } = require('node:url');
const { LocalRuntime, assertFreePort } = require('../lib/local-runtime.cjs');
const { verifyBundledMongo } = require('../lib/bundled-mongodb.cjs');
const { startRendererServer } = require('../lib/renderer-server.cjs');
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
  // Desktop ships node_middleware, not a self-listening Node server. Exercise
  // its real socket owner in a fresh process for each start/restart.
  env.TT_BUNDLED_RUNTIME_API = '1'; env.TT_BUNDLED_RUNTIME_ROOT = directory;
  server = spawn(process.execPath, [__filename], { env, cwd: path.join(root, 'remix'), stdio: ['ignore', 'ignore', 'ignore'] });
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
  const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
  assert.equal(manifest.origin, origin, 'Capabilities must belong to the isolated local origin.');
  const thingsVersion = manifest.features?.['api.things']?.version?.split('.').map(Number);
  assert.ok(thingsVersion?.[0] === 1 && thingsVersion[1] >= 65, 'Private content requires the combined canonical Things contract.');
  const flatResponse = await fetch(origin + '/api/v1/capabilities');
  assert.equal(flatResponse.status, 200, 'The flat capability manifest must be served by the built API.');
  const flatManifest = await flatResponse.json();
  assert.equal(flatManifest.features?.['api.things'], manifest.features['api.things'].version, 'Both built manifests must publish the same Things contract.');
  assert.equal(manifest.features?.['api.builder-workspaces']?.version, '1.2.0', 'The built API must publish the workspace contract without the record ceiling.');
  assert.equal(flatManifest.features?.['api.builder-workspaces'], '1.2.0', 'Both built manifests must agree on workspace compatibility.');
  if (Object.hasOwn(flatManifest, 'origin')) assert.equal(flatManifest.origin, origin);
  const registration = await fetch(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bundled-mongo-synthetic', password: crypto.randomBytes(24).toString('base64url'), email: 'fixture@example.invalid' }) });
  assert.equal(registration.status, 200, 'Normal registration did not succeed.');
  const registered = await registration.json(); assert.equal(registered.ok, true); assert.ok(registered.user?.id);
  const cookie = registration.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  const readUser = async () => { const response = await fetch(origin + '/api/v1/auth/me', { headers: { Cookie: cookie } }); assert.equal(response.status, 200); return response.json(); };
  assert.equal((await readUser()).user.id, registered.user.id);
  const api = async (method, route, body, actorCookie = cookie) => {
   const response = await fetch(origin + route, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(actorCookie ? { Cookie: actorCookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
   return { status: response.status, body: await response.json() };
  };
  const privateContent = { name: 'Offline managed Mongo fixture', text: 'Editable local content\nwith preserved line breaks.', nested: { count: 1 } };
  const created = await api('POST', '/api/v1/things', { thingtime: ['data'], crystal: privateContent, visibility: 'private' });
  assert.equal(created.status, 200, 'Normal private Thing creation must succeed without cloud access.');
  assert.equal(created.body.ok, true);
  const thing = created.body.thing;
  assert.ok(thing?.id && thing.updatedAt, 'Only API-minted identity and revision may be used.');
  assert.equal(thing.visibility, 'private');
  const readPath = '/api/v1/things?id=' + encodeURIComponent(thing.id);
  assert.deepEqual((await api('GET', readPath)).body.thing?.crystal, privateContent);
  const otherRegistration = await fetch(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bundled-mongo-other', password: crypto.randomBytes(24).toString('base64url'), email: 'other@example.invalid' }) });
  assert.equal(otherRegistration.status, 200);
  const otherRegistered = await otherRegistration.json();
  assert.equal(otherRegistered.ok, true);
  assert.notEqual(otherRegistered.user.id, registered.user.id);
  const otherCookie = otherRegistration.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(otherCookie);
  const assertPrivate = async () => {
   const otherIdentity = await api('GET', '/api/v1/auth/me', undefined, otherCookie);
   assert.equal(otherIdentity.status, 200);
   assert.equal(otherIdentity.body.user?.id, otherRegistered.user.id, 'ACL refusal must use the independently authenticated second account.');
   for (const actorCookie of ['', otherCookie]) {
    const refused = await api('GET', readPath, undefined, actorCookie);
    assert.ok([401, 403, 404].includes(refused.status), 'Anonymous and unrelated accounts cannot read private local content.');
    assert.equal(refused.body.thing, undefined);
   }
   const refusedEdit = await api('PATCH', '/api/v1/things', { id: thing.id, crystal: { text: 'unauthorized' } }, otherCookie);
   assert.ok([403, 404].includes(refusedEdit.status), 'A different local account cannot edit private content.');
  };
  await assertPrivate();
  // Keep the normal Mongo folder ancestry/drain path covered while its shared
  // services acquire native persistence. A projection omission once made every
  // existing destination look like a cycle.
  const createFolder = async (name, folderId) => {
   const result = await api('POST', '/api/v1/things', { thingtime: ['folder'], crystal: { name }, visibility: 'private', ...(folderId ? { folderId } : {}) });
   assert.equal(result.status, 200, 'Canonical folder creation must succeed.');
   assert.equal(result.body.ok, true); return result.body.thing;
  };
  const folderA = await createFolder('First parent'), folderB = await createFolder('Second parent');
  const nestedFolder = await createFolder('Nested child', folderA.id);
  const folderItem = await api('POST', '/api/v1/things', { thingtime: ['data'], crystal: { text: 'Keep this editable child' }, visibility: 'private', folderId: nestedFolder.id });
  assert.equal(folderItem.status, 200); assert.equal(folderItem.body.ok, true);
  const movedFolder = await api('PATCH', '/api/v1/things', { id: nestedFolder.id, folderId: folderB.id, expectedUpdatedAt: nestedFolder.updatedAt });
  assert.equal(movedFolder.status, 200, 'Moving a folder into an existing valid destination must succeed.');
  assert.equal(movedFolder.body.thing.folderId, folderB.id);
  const cycle = await api('PATCH', '/api/v1/things', { id: folderB.id, folderId: nestedFolder.id, expectedUpdatedAt: folderB.updatedAt });
  assert.ok([400, 409].includes(cycle.status), 'A folder cannot move into its own descendant.');
  const removedFolder = await api('DELETE', '/api/v1/things', { id: nestedFolder.id, expectedUpdatedAt: movedFolder.body.thing.updatedAt });
  assert.equal(removedFolder.status, 200); assert.equal(removedFolder.body.ok, true);
  const folderItemPath = '/api/v1/things?id=' + encodeURIComponent(folderItem.body.thing.id);
  const reparented = await api('GET', folderItemPath);
  assert.equal(reparented.body.thing.folderId, folderB.id);
  assert.equal(reparented.body.thing.crystal.text, 'Keep this editable child');
  const changedContent = { ...privateContent, text: 'Saved before restart\nand retained offline.', nested: { count: 2 } };
  const changed = await api('PATCH', '/api/v1/things', { id: thing.id, crystal: changedContent, expectedUpdatedAt: thing.updatedAt });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.ok, true);
  assert.deepEqual((await api('GET', readPath)).body.thing?.crystal, changedContent);
  const anonymous = new MongoClient(`mongodb://127.0.0.1:${ports.database}/`, { directConnection: true, serverSelectionTimeoutMS: 2000 });
  try { await anonymous.connect(); await assert.rejects(anonymous.db('thingtime').command({ listCollections: 1 }), error => error.code === 13); } finally { await anonymous.close(); }
  await stopServer(); await runtime.stop();
  runtime = create(); await runtime.initialize();
  assert.equal(runtime.snapshot().bundledMongoSelected, true);
  await start();
  assert.equal((await readUser()).user.id, registered.user.id, 'Normal API session and account must survive managed database restart.');
  const retained = await api('GET', readPath);
  assert.equal(retained.status, 200);
  assert.equal(retained.body.thing?.id, thing.id);
  assert.equal(retained.body.thing?.visibility, 'private');
  assert.deepEqual(retained.body.thing?.crystal, changedContent, 'Canonical API edits must survive server and database restart.');
  const retainedFolderItem = await api('GET', folderItemPath);
  assert.equal(retainedFolderItem.status, 200);
  assert.equal(retainedFolderItem.body.thing.folderId, folderB.id, 'Folder drain placement must survive managed restart.');
  assert.equal(retainedFolderItem.body.thing.crystal.text, 'Keep this editable child');
  assert.equal((await api('GET', '/api/v1/things?id=' + encodeURIComponent(nestedFolder.id))).status, 404);
  await assertPrivate();
  const stale = await api('PATCH', '/api/v1/things', { id: thing.id, crystal: { text: 'stale overwrite' }, expectedUpdatedAt: thing.updatedAt });
  assert.equal(stale.status, 409, 'Restart must preserve revision conflict detection.');
  assert.deepEqual((await api('GET', readPath)).body.thing?.crystal, changedContent);
  const deleted = await api('DELETE', '/api/v1/things', { id: thing.id, expectedUpdatedAt: retained.body.thing.updatedAt });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal((await api('GET', readPath)).status, 404);
  for (const id of [folderItem.body.thing.id, folderA.id, folderB.id]) {
   const current = await api('GET', '/api/v1/things?id=' + encodeURIComponent(id)); assert.equal(current.status, 200);
   assert.equal((await api('DELETE', '/api/v1/things', { id, expectedUpdatedAt: current.body.thing.updatedAt })).status, 200);
  }
  console.log('PASS bundled MongoDB default bootstrap, authenticated replica, normal API registration/private CRUD/session retention across restart, valid folder moves/cycle refusal/child-preserving deletion and restart, cross-account ACL and stale-revision refusal, denied anonymous DB reads, and deliberate offline network boundary.');
 } finally { await stopServer(); await runtime.stop(); }
}
async function run() {
 if (process.env.TT_BUNDLED_RUNTIME_API === '1') {
  const renderer = await startRendererServer({ profilePath: process.env.TT_BUNDLED_RUNTIME_ROOT, selectedPort: ports.api,
   loadApplication: () => import(pathToFileURL(path.join(root, 'remix/.output/server/index.mjs')).href) });
  process.once('SIGTERM', () => { void renderer.close().finally(() => process.exit(0)); });
  return;
 }
 if (process.env.TT_BUNDLED_RUNTIME_FIXTURE === '1') return fixture(process.env.TT_BUNDLED_RUNTIME_ROOT);
 if (process.platform !== 'darwin') throw new Error('Requires macOS OS sandbox enforcement.');
 await fs.access(binary); await fs.access(path.join(root, 'remix/.output/server/index.mjs'));
 await verifyBundledMongo(path.dirname(path.dirname(binary)));
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
