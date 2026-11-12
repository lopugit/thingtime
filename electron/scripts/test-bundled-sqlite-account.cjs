'use strict';
// Opt-in actual compiled Nitro + SQLite account HTTP. No Mongo, mock API or
// replacement credential cipher. Test credentials remain in parent memory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { LocalRuntime, assertFreePort } = require('../lib/local-runtime.cjs');
const { publishNativeHomeHost } = require('../lib/native-home-profile.cjs');
const { startRendererServer } = require('../lib/renderer-server.cjs');
const sourceRoot = path.resolve(__dirname, '..');
const entry = path.join(sourceRoot, 'dist/web/.output/server/index.mjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const port = 19885, origin = 'http://127.0.0.1:' + port;
const STAGES = Object.freeze(['guard','build','profile','os-storage','configure','bootstrap','manifest','register','session','roster','root-data','unsupported','reopen','logout','login','close','cleanup']);
let stage = 'guard', lastHttpStatus = null, manifestInvariant = null;
const setStage = value => {
 if (!STAGES.includes(value)) throw Error('Unknown fixture stage'); stage = value;
 if (process.env.THINGTIME_SQLITE_FIXTURE_CHILD === '1' && process.connected)
  process.send?.({ type: 'stage', stage }, () => {});
};
const failureReceipt = () => ({ ok: false, stage, httpStatus: Number.isInteger(lastHttpStatus) ? lastHttpStatus : null, manifestInvariant });
const guard = () => {
 if (process.env.THINGTIME_RUN_BUNDLED_SQLITE_ACCOUNT_TEST !== '1') throw Error('Explicit SQLite account fixture opt-in is required.');
 if (process.platform !== 'darwin') throw Error('This protected-profile fixture requires real macOS Electron safeStorage.');
 if (!/^[a-f0-9]{64}$/.test(process.env.THINGTIME_SQLITE_EXPECTED_NITRO_SHA || '')) throw Error('An independently verified compiled Nitro SHA is required.');
};
async function verifyBuild() {
 setStage('build');
 const actual = sha(await fs.readFile(entry));
 assert.equal(actual, process.env.THINGTIME_SQLITE_EXPECTED_NITRO_SHA, 'Compiled payload changed before the fixture.');
 return actual;
}
async function child(directory) {
 guard(); await verifyBuild();
 setStage('profile');
 const stat = await fs.lstat(directory);
 if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
  !path.basename(directory).startsWith('thingtime-sqlite-account-')) throw Error('Invalid task-owned protected profile.');
 const marker = JSON.parse(await fs.readFile(path.join(directory, 'fixture.json'), 'utf8'));
 if (marker.format !== 1 || marker.nonce !== process.env.THINGTIME_SQLITE_FIXTURE_NONCE || !/^[a-f0-9-]{36}$/.test(marker.nonce)) throw Error('Task profile ownership did not match.');
 const { app, safeStorage } = require('electron');
 app.setName('Thingtime SQLite Account QA'); app.setPath('userData', directory);
 await app.whenReady();
 setStage('os-storage');
 if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw Error('Protected OS storage is unavailable.');
 const runtime = new LocalRuntime({ userData: directory, safeStorage, parallelDev: true,
  spawnProcess() { throw Error('SQLite must never start MongoDB.'); }, createMongoClient() { throw Error('SQLite must never connect MongoDB.'); } });
 await runtime.initialize();
 setStage('configure');
 if (process.env.THINGTIME_SQLITE_FIXTURE_FIRST === '1') {
  await runtime.configure({ enabled: false, databaseMode: 'managed', apiPort: port, databasePort: port + 1 });
  await runtime.configureNativeHomeProfile({ sqliteFile: path.join(runtime.root, 'home.sqlite') });
 }
 assert.equal(runtime.snapshot().storageProvider, 'sqlite'); assert.equal(runtime.snapshot().enabled, true);
 await runtime.start(); runtime.applyEnvironment(process.env);
 const host = runtime.nativeHomeHost(); publishNativeHomeHost(globalThis, host);
 process.env.THINGTIME_DESKTOP = '1'; process.env.NODE_ENV = 'production';
 setStage('bootstrap');
 const server = await startRendererServer({ profilePath: directory, selectedPort: port,
  loadApplication: () => import(pathToFileURL(entry).href) });
 // Host presence alone is not readiness: load the real composition via HTTP.
 const ready = await fetch(origin + '/api/v1/auth/me', { signal: AbortSignal.timeout(15000) });
 lastHttpStatus = ready.status; assert.equal(ready.status, 200, 'Native account composition did not initialize.');
 assert.equal((await ready.json()).user, null);
 process.send?.({ type: 'ready', osProtected: true, provider: 'sqlite', identity: sha(host.homePlaneId + '\0' + host.keyId),
  encryptedProfile: (await fs.stat(runtime.file)).size > 0 });
 let closing = false;
 process.on('message', async message => {
  if (message?.type !== 'close' || closing) return;
  closing = true;
  setStage('close');
  try {
   await server.close();
   const close = globalThis[Symbol.for('thingtime.native-home.close')];
   assert.equal(typeof close, 'function'); await close();
   await runtime.stop();
   await new Promise((resolve, reject) => process.send({ type: 'closed', socketClosed: true, runtimeClosed: true }, error => error ? reject(error) : resolve()));
   app.quit();
  }
  catch { process.send?.({ type: 'failed', ...failureReceipt() }); app.exit(1); }
 });
}
async function runFixture() {
 guard(); const nitroSha = await verifyBuild(); await assertFreePort(port);
 const directory = await fs.mkdtemp(path.join(tmpdir(), 'thingtime-sqlite-account-'));
 await fs.chmod(directory, 0o700);
 const nonce = crypto.randomUUID(), sourceHashes = {};
 for (const file of ['scripts/test-bundled-sqlite-account.cjs', 'lib/native-home-profile.cjs', 'lib/local-runtime.cjs', 'lib/renderer-server.cjs']) sourceHashes[file] = sha(await fs.readFile(path.join(sourceRoot, file)));
 await fs.writeFile(path.join(directory, 'fixture.json'), JSON.stringify({ format: 1, nonce }), { mode: 0o600, flag: 'wx' });
 let running;
 async function stop() {
  if (!running) return;
  const processChild = running; running = null;
  if (processChild.exitCode !== null || processChild.signalCode !== null) { assert.equal(processChild.exitCode, 0, 'Task API exited unsuccessfully.'); return; }
  const exited = once(processChild, 'exit'); let closed;
  const onClosed = message => { if (message?.type === 'closed') closed = message; };
  processChild.on('message', onClosed);
  let exceeded = false;
  const timer = setTimeout(() => { exceeded = true; processChild.kill('SIGKILL'); }, 15000);
  processChild.send({ type: 'close' });
  try {
   const [code] = await exited; assert.equal(exceeded, false, 'Canonical API shutdown exceeded its deadline.'); assert.equal(code, 0, 'Canonical API shutdown failed.');
   assert.equal(closed?.socketClosed, true, 'Socket close was not observed.'); assert.equal(closed?.runtimeClosed, true, 'Protected runtime close was not observed.');
  } finally { clearTimeout(timer); processChild.off('message', onClosed); }
 }
 async function start(first) {
  await assertFreePort(port);
  setStage('bootstrap');
  const electron = require('electron');
  // Keep OS safeStorage access on this host; select only the unique task profile.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir(),
   THINGTIME_RUN_BUNDLED_SQLITE_ACCOUNT_TEST: '1', THINGTIME_SQLITE_EXPECTED_NITRO_SHA: nitroSha,
   THINGTIME_SQLITE_FIXTURE_CHILD: '1', THINGTIME_SQLITE_FIXTURE_ROOT: directory,
   THINGTIME_SQLITE_FIXTURE_NONCE: nonce, THINGTIME_SQLITE_FIXTURE_FIRST: first ? '1' : '0' };
  running = spawn(electron, [__filename], { env, cwd: sourceRoot, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => finish(Error('Protected API bootstrap exceeded its deadline.')), 45000);
   const onExit = () => finish(Error('Protected API exited before readiness.'));
   const onError = () => finish(Error('Protected API failed to launch.'));
   const onMessage = message => {
    if (message?.type === 'stage' && STAGES.includes(message.stage)) setStage(message.stage);
    else if (message?.type === 'ready') finish(null, message);
    else if (message?.type === 'failed') {
     if (STAGES.includes(message.stage)) setStage(message.stage);
     lastHttpStatus = Number.isInteger(message.httpStatus) ? message.httpStatus : null;
     finish(Error('Protected API bootstrap failed.'));
    }
   };
   function finish(error, value) {
    clearTimeout(timer); running?.off('exit', onExit); running?.off('error', onError); running?.off('message', onMessage);
    error ? reject(error) : resolve(value);
   }
   running.once('exit', onExit); running.once('error', onError); running.on('message', onMessage);
  });
 }
 let cookies = new Map(), receipt;
 async function api(method, route, body, useCookies = true) {
  const response = await fetch(origin + '/api/' + route, { method, signal: AbortSignal.timeout(15000),
   headers: { Origin: origin, 'Content-Type': 'application/json', ...(useCookies ? { Cookie: [...cookies].map(([key,value]) => key + '=' + value).join('; ') } : {}) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  lastHttpStatus = response.status;
  if (useCookies) for (const cookie of response.headers.getSetCookie()) {
   const pair = cookie.split(';')[0], equals = pair.indexOf('='); cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  return { status: response.status, body: await response.json() };
 }
 try {
  const first = await start(true); assert.equal(first.osProtected, true); assert.equal(first.encryptedProfile, true);
  async function manifests() {
   setStage('manifest');
   for (const route of ['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']) {
    const response = await fetch(origin + route, { signal: AbortSignal.timeout(15000) }); lastHttpStatus = response.status;
    assert.equal(response.status, 200);
    assertNativeManifest(await response.json(), { kind: route.startsWith('/.well-known/') ? 'well-known' : 'flat', expectedOrigin: origin, responseUrl: response.url });
   }
  }
  async function rootData(expectedUser, expectedPlane) {
   setStage('root-data'); const result = await api('GET', 'root-data');
   assert.equal(result.status, 200); assert.equal(result.body.user?.id ?? null, expectedUser);
   assert.match(result.body.dataPlane, /^custom-[a-f0-9]{64}$/); assert.equal(result.body.dataEnvironment, null);
   assert.equal(result.body.titlePrefix, '[LC]');
   if (expectedPlane) assert.equal(result.body.dataPlane, expectedPlane);
   assert.equal(JSON.stringify(result.body).includes(directory), false);
   return result.body.dataPlane;
  }
  await manifests(); const publicPlane = await rootData(null); setStage('register');
  const username = 'sqlite-' + crypto.randomUUID().slice(0, 12), password = crypto.randomBytes(24).toString('base64url');
  const created = await api('POST', 'v1/auth/register', { username, email: username + '@example.invalid', password });
  assert.equal(created.status, 200, 'Canonical account registration failed.'); assert.equal(created.body.ok, true);
  assert.equal(created.body.verificationDelivery?.status, 'queued', 'Canonical protected outbox admission must be reported.');
  assert.equal(created.body.verificationDelivery?.delivered, false, 'No delivery worker/provider is claimed by this fixture.');
  const userId = created.body.user?.id; assert.equal(typeof userId, 'string');
  setStage('session');
  assert.equal((await api('GET', 'v1/auth/me')).body.user?.id, userId);
  setStage('roster'); assert.equal((await api('GET', 'v1/auth/accounts')).body.accounts?.some(account => account.user?.id === userId), true);
  setStage('unsupported');
  for (const route of ['v1/things', 'v1/passwords']) assert.equal((await api('GET', route)).status, 503, 'Unsupported storage operations cannot fall through to Mongo.');
  await rootData(userId, publicPlane);
  const wrongOrigin = await fetch(origin + '/api/v1/auth/me', { headers: { Origin: 'https://synthetic.invalid' }, signal: AbortSignal.timeout(10000) }); assert.equal(wrongOrigin.status, 403);
  setStage('close'); await stop(); setStage('reopen');
  const second = await start(false); assert.equal(second.identity, first.identity, 'Protected profile/key identity changed on reopen.');
  await manifests(); await rootData(userId, publicPlane); setStage('reopen');
  assert.equal((await api('GET', 'v1/auth/me')).body.user?.id, userId, 'Canonical session must persist across fresh Electron/API processes.');
  assert.equal((await api('GET', 'v1/auth/accounts')).body.accounts?.some(account => account.user?.id === userId), true);
  setStage('logout'); assert.equal((await api('POST', 'v1/auth/logout', {})).status, 200);
  assert.equal((await api('GET', 'v1/auth/me')).body.user, null);
  await rootData(null, publicPlane);
  setStage('login'); const wrong = await api('POST', 'v1/login', { username, password: 'synthetic wrong credential' }); assert.equal(wrong.status, 401);
  const login = await api('POST', 'v1/login', { username, password }); assert.equal(login.status, 200); assert.equal(login.body.user?.id, userId);
  assert.equal((await api('GET', 'v1/auth/me')).body.user?.id, userId);
  setStage('close'); await stop(); setStage('cleanup'); await assertFreePort(port);
  receipt = { ok: true, claim: 'compiled-Nitro SQLite account HTTP with real Electron safeStorage and fresh-process reopen',
   nitroSha, sourceHashes, osProtected: true, provider: 'sqlite', registered: true, sessionReopened: true, rosterReopened: true,
   logoutAndLogin: true, rootDataReopened: true, manifestsVerified: true, unsupportedRefused: true, externalMailDelivered: false, thingsSupported: false, socketClosed: true, runtimeClosed: true, cleanupVerified: true };
 } finally { try { await stop(); } finally { cookies.clear(); await fs.rm(directory, { recursive: true, force: true }); } }
 console.log(JSON.stringify(receipt));
}
function assertNativeManifest(manifest, { kind = 'well-known', expectedOrigin = origin, responseUrl = origin + '/.well-known/thingtime-capabilities.json' } = {}) {
 const check = (name, work) => { manifestInvariant = name; work(); manifestInvariant = null; };
 check('manifest-origin', () => {
  assert.ok(['well-known', 'flat'].includes(kind));
  const url = new URL(responseUrl); assert.equal(url.origin, expectedOrigin);
  assert.equal(url.pathname, kind === 'well-known' ? '/.well-known/thingtime-capabilities.json' : '/api/v1/capabilities');
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  if (kind === 'well-known' || Object.hasOwn(manifest, 'origin')) assert.equal(manifest.origin, expectedOrigin);
 });
 check('manifest-shape', () => { assert.equal(manifest.schemaVersion, 1); if (kind === 'flat') assert.equal(manifest.ok, true); });
 check('manifest-readiness', () => assert.deepEqual(manifest.runtime, { provider: 'sqlite', ready: true }));
 const version = value => typeof value === 'string' ? value : value?.version;
 check('manifest-availability', () => {
  assert.equal(version(manifest.features?.['api.auth-register']), '1.4.0');
  assert.equal(version(manifest.features?.['api.root-data']), '1.2.0');
  assert.match(version(manifest.features?.['api.login']) || '', /^1\./);
  assert.equal(Object.hasOwn(manifest.features || {}, 'api.things'), false);
  assert.ok(manifest.registeredFeatures?.['api.things']);
  assert.equal(version(manifest.registeredFeatures?.['api.builder-workspaces']), '1.2.0');
  assert.equal(Object.hasOwn(manifest.features || {}, 'api.builder-workspaces'), false, 'Partial native workspace services must not advertise the full HTTP contract.');
 });
 check('manifest-operations', () => { for (const [route, method, available] of [['/api/root-data', 'GET', true], ['/api/v1/auth/register', 'POST', true], ['/api/v1/login', 'POST', true], ['/api/v1/things', 'GET', false]]) {
  const operation = manifest.operations?.find(item => item.path === route && item.methods.includes(method));
  assert.ok(operation); assert.equal(operation.availableMethods.includes(method), available);
 } });
}
// Electron's main entry is loaded by its application bootstrap rather than
// Node's require.main. Keep imports inert while admitting the guarded task child.
function isFixtureEntry({ direct, electron, processType, childFlag }) {
 return direct === true || (electron === true && processType === 'browser' && childFlag === '1');
}
if (isFixtureEntry({ direct: require.main === module, electron: !!process.versions.electron, processType: process.type, childFlag: process.env.THINGTIME_SQLITE_FIXTURE_CHILD })) {
 const operation = process.env.THINGTIME_SQLITE_FIXTURE_CHILD === '1' ? child(process.env.THINGTIME_SQLITE_FIXTURE_ROOT) : runFixture();
 operation.catch(() => {
  process.send?.({ type: 'failed', ...failureReceipt() });
  console.error('Protected SQLite account fixture failed ' + JSON.stringify(failureReceipt()));
  if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1;
 });
}
module.exports = { guard, verifyBuild, assertNativeManifest, failureReceipt, isFixtureEntry };
