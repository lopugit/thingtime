'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { LocalRuntime, assertFreePort, validateMongoUri } = require('../lib/local-runtime.cjs');
const key = crypto.randomBytes(32);
const storage = {
	isEncryptionAvailable: () => true,
	encryptString: (text) => {
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
		return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
	},
	decryptString: (data) => {
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
		decipher.setAuthTag(data.subarray(-16));
		return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString();
	}
};
async function fixture(fn) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-local-runtime-'));
	try {
		await fn(new LocalRuntime({ userData: root, safeStorage: storage }), root);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}
test('local runtime is opt-in and remote mode clears inherited server authority', () =>
	fixture(async (runtime) => {
		await runtime.initialize();
		assert.equal(runtime.snapshot().enabled, false);
		const env = {
			MONGODB_CONNECTION_STRING: 'mongodb://production',
			JWT_PRIVATE_KEY: 'production-secret',
			THINGTIME_USER_VAULT_KEY: 'production-vault',
			THINGTIME_API_FALLBACK_ORIGIN: 'https://example.test'
		};
		runtime.applyEnvironment(env);
		assert.deepEqual(env, { THINGTIME_DESKTOP_API_MODE: 'remote', THINGTIME_API_FALLBACK_ORIGIN: 'https://example.test' });
	}));
test('encrypted configuration persists keys and endpoints without publishing credentials', () =>
	fixture(async (runtime, root) => {
		await runtime.initialize();
		const uri = 'mongodb://local-user:test-password@example.test/thingtime';
		await runtime.configure({ enabled: true, databaseMode: 'external', mongoUri: uri, apiPort: 19881, databasePort: 19882 });
		const bytes = await fs.readFile(runtime.file);
		assert.ok(!bytes.includes(Buffer.from('test-password')));
		assert.ok(!bytes.includes(Buffer.from(runtime.state.jwtSecret)));
		assert.equal((await fs.stat(runtime.file)).mode & 0o777, 0o600);
		assert.ok(!JSON.stringify(runtime.snapshot()).includes('test-password'));
		const reopened = new LocalRuntime({ userData: root, safeStorage: storage });
		await reopened.initialize();
		const env = { THINGTIME_API_FALLBACK_ORIGIN: 'https://production.test' };
		reopened.applyEnvironment(env);
		assert.equal(env.JWT_SECRET, runtime.state.jwtSecret);
		assert.equal(env.MONGODB_CONNECTION_STRING, uri);
		assert.equal(env.THINGTIME_DESKTOP_API_MODE, 'local');
		assert.equal(env.THINGTIME_API_FALLBACK_ORIGIN, undefined);
		assert.equal(Buffer.from(env.THINGTIME_USER_VAULT_KEY, 'base64url').length, 32);
	}));
test('missing secure encryption and corrupt stored state fail closed', () =>
	fixture(async (runtime, root) => {
		await runtime.initialize();
		runtime.safeStorage = { ...storage, getSelectedStorageBackend: () => 'basic_text' };
		await assert.rejects(runtime.configure({ enabled: false, databaseMode: 'managed' }), /credential store/);
		runtime.safeStorage = storage;
		await runtime.configure({ enabled: false, databaseMode: 'managed' });
		await fs.writeFile(runtime.file, Buffer.from('corrupted'));
		await assert.rejects(new LocalRuntime({ userData: root, safeStorage: storage }).initialize(), /No remote fallback/);
	}));
test('configuration rejects conflicts and keeps initialized database port stable', () =>
	fixture(async (runtime) => {
		await runtime.initialize();
		await assert.rejects(runtime.configure({ enabled: true, databaseMode: 'external', mongoUri: 'https://example.test' }), /MongoDB/);
		await assert.rejects(runtime.configure({ enabled: false, databaseMode: 'managed', apiPort: 28632 }), /different ports/);
		await fs.mkdir(path.join(runtime.root, 'database'), { recursive: true });
		await fs.writeFile(path.join(runtime.root, 'database', 'WiredTiger'), 'fixture');
		await assert.rejects(runtime.configure({ enabled: false, databaseMode: 'managed', databasePort: 19882 }), /keeps its port/);
		assert.throws(() => validateMongoUri('mongodb://user:pass\n@host'), /valid/);
	}));
test('port preflight refuses an existing loopback server', async () => {
	const server = net.createServer();
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		await assert.rejects(assertFreePort(server.address().port), /already in use/);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
test('parallel development uses distinct stable ports', () => {
	const runtime = new LocalRuntime({ userData: '/tmp/thingtime-test-only', safeStorage: storage, parallelDev: true });
	assert.equal(runtime.snapshot().apiPort, 28641);
	assert.equal(runtime.snapshot().databasePort, 28642);
});

test('API origins and database identities get stable separate browser sessions', () => {
	const { endpointPartition } = require('../lib/local-runtime.cjs');
	assert.equal(endpointPartition('https://one.test/'), endpointPartition('https://one.test'));
	assert.notEqual(endpointPartition('https://one.test'), endpointPartition('https://two.test'));
	assert.notEqual(endpointPartition('http://127.0.0.1:28631', 'database-a'), endpointPartition('http://127.0.0.1:28631', 'database-b'));
});

test('saved database configuration cannot change the active backend session before restart', () =>
	fixture(async (runtime, root) => {
		const { endpointPartition } = require('../lib/local-runtime.cjs');
		await runtime.initialize();
		await runtime.configure({ enabled: true, databaseMode: 'external', mongoUri: 'mongodb://database-a.test/thingtime' });
		const env = {};
		runtime.applyEnvironment(env);
		const partition = endpointPartition(runtime.snapshot().origin, runtime.runningDatabaseIdentity);
		await runtime.configure({ enabled: true, databaseMode: 'external', mongoUri: 'mongodb://database-b.test/thingtime' });
		assert.equal(env.MONGODB_CONNECTION_STRING, 'mongodb://database-a.test/thingtime');
		assert.equal(endpointPartition(runtime.snapshot().origin, runtime.runningDatabaseIdentity), partition);
		const restarted = new LocalRuntime({ userData: root, safeStorage: storage });
		await restarted.initialize();
		restarted.applyEnvironment({});
		assert.notEqual(endpointPartition(restarted.snapshot().origin, restarted.runningDatabaseIdentity), partition);
	}));

test('termination signals use the normal app quit path', () => {
	const { EventEmitter } = require('node:events');
	const { attachQuitSignals } = require('../lib/local-runtime.cjs');
	const signals = new EventEmitter();
	let quits = 0;
	const detach = attachQuitSignals({ quit: () => quits++ }, signals);
	signals.emit('SIGINT');
	signals.emit('SIGTERM');
	assert.equal(quits, 2);
	detach();
	signals.emit('SIGTERM');
	assert.equal(quits, 2);
});

test('development cleanup terminates a stubborn owned process group before returning', { skip: process.platform === 'win32' }, async () => {
	const { spawn } = require('node:child_process');
	const { stopOwnedProcessGroup } = require('../lib/local-runtime.cjs');
	const child = spawn(process.execPath, ['-e', "const child=require('node:child_process').spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)\"],{stdio:['ignore','pipe','ignore']});process.on('SIGTERM',()=>{});child.stdout.once('data',()=>process.stdout.write('ready'));setInterval(()=>{},1000)"], {
		detached: true,
		stdio: ['ignore', 'pipe', 'ignore']
	});
	const exited = new Promise((resolve) => child.once('exit', resolve));
	try {
		await new Promise((resolve, reject) => {
			child.stdout.once('data', resolve);
			child.once('error', reject);
		});
		await stopOwnedProcessGroup(child.pid, { graceMs: 100, killMs: 1500 });
		await exited;
		assert.throws(
			() => process.kill(-child.pid, 0),
			(error) => error.code === 'ESRCH'
		);
	} finally {
		if (child.pid && child.exitCode === null && child.signalCode === null) {
			try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
		}
	}
});

test('fresh local setup prefers bundled MongoDB while saved executable and database are preserved', () =>
 fixture(async (_runtime, root) => {
  const bundled = path.join(root, 'bundled', 'mongod');
  const selected = path.join(root, 'existing', 'mongod');
  for (const file of [bundled, selected]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); }
  const fresh = new LocalRuntime({ userData: root, safeStorage: storage, bundledMongodPath: bundled });
  await fresh.initialize();
  assert.equal(fresh.snapshot().mongodPath, bundled);
  assert.equal(fresh.snapshot().bundledMongoSelected, true);
  await fresh.chooseMongod(selected);
  await fs.mkdir(path.join(fresh.root, 'database'), { recursive: true });
  await fs.writeFile(path.join(fresh.root, 'database', 'WiredTiger'), 'existing database');
  const reopened = new LocalRuntime({ userData: root, safeStorage: storage, bundledMongodPath: bundled });
  await reopened.initialize();
  assert.equal(reopened.snapshot().mongodPath, selected);
  assert.equal(reopened.snapshot().bundledMongoSelected, false);
  assert.equal(await fs.readFile(path.join(fresh.root, 'database', 'WiredTiger'), 'utf8'), 'existing database');
 }));

test('bundled MongoDB cannot silently adopt a database whose executable selection is missing', () =>
 fixture(async (runtime, root) => {
  const bundled = path.join(root, 'mongod');
  await fs.writeFile(bundled, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.mkdir(path.join(runtime.root, 'database'), { recursive: true });
  await fs.writeFile(path.join(runtime.root, 'database', 'WiredTiger'), 'existing database');
  const reopened = new LocalRuntime({ userData: root, safeStorage: storage, bundledMongodPath: bundled });
  await reopened.initialize();
  assert.notEqual(reopened.snapshot().mongodPath, bundled);
 }));

test('macOS 13 remote mode remains available while bundled local MongoDB requires macOS 14', () =>
 fixture(async (_runtime, root) => {
  const bundled = path.join(root, 'mongod');
  await fs.writeFile(bundled, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const runtime = new LocalRuntime({ userData: root, safeStorage: storage, bundledMongodPath: bundled, platform: 'darwin', hostRelease: '22.6.0' });
  await runtime.initialize();
  assert.equal(runtime.snapshot().enabled, false);
  assert.equal(runtime.snapshot().bundledMongoSupported, false);
  await runtime.start();
  await assert.rejects(runtime.configure({ enabled: true, databaseMode: 'managed' }), /macOS 14/);
  assert.equal(runtime.snapshot().enabled, false);
  await runtime.configure({ enabled: true, databaseMode: 'external', mongoUri: 'mongodb://fixture.test/thingtime' });
  assert.equal(runtime.snapshot().enabled, true);
  assert.equal(new LocalRuntime({ userData: root, safeStorage: storage, bundledMongodPath: bundled, platform: 'darwin', hostRelease: '23.0.0' }).bundledMongoSupported, true);
 }));


test('new database identities are keyed, stable and never publish a password digest', () =>
 fixture(async (runtime, root) => {
  await runtime.initialize();
  const uri = 'mongodb://fixture:password123@database.example/thingtime';
  await runtime.configure({ enabled: true, databaseMode: 'external', mongoUri: uri });
  const env = {};
  runtime.applyEnvironment(env);
  const expected = crypto.createHmac('sha256', runtime.state.vaultKey)
   .update('thingtime-desktop-database-identity-v1\0').update(uri).digest('hex');
  const unkeyed = crypto.createHash('sha256').update(uri).digest('hex');
  assert.equal(runtime.runningDatabaseIdentity, expected);
  assert.equal(env.THINGTIME_FEDERATION_ID, 'desktop-' + expected.slice(0, 24));
  assert.equal(env.THINGTIME_DATA_ENV, 'custom:' + env.THINGTIME_FEDERATION_ID);
  assert.notEqual(env.THINGTIME_FEDERATION_ID, 'desktop-' + unkeyed.slice(0, 24));
  assert.equal(runtime.state.legacyRendererIdentity, null);
  const restarted = new LocalRuntime({ userData: root, safeStorage: storage });
  await restarted.initialize(); const again = {}; restarted.applyEnvironment(again);
  assert.equal(restarted.runningDatabaseIdentity, expected);
  assert.equal(again.THINGTIME_FEDERATION_ID, env.THINGTIME_FEDERATION_ID);
  const otherProfile = new LocalRuntime({ userData: path.join(root, 'other'), safeStorage: storage });
  await otherProfile.initialize();
  await otherProfile.configure({ enabled: true, databaseMode: 'external', mongoUri: uri });
  const other = {}; otherProfile.applyEnvironment(other);
  assert.notEqual(other.THINGTIME_FEDERATION_ID, env.THINGTIME_FEDERATION_ID);
 }));

test('pre-upgrade database retains only its encrypted renderer alias across switch and return', () =>
 fixture(async (runtime, root) => {
  const { endpointPartition } = require('../lib/local-runtime.cjs');
  const originalUri = 'mongodb://fixture:password123@original.example/thingtime';
  const nextUri = 'mongodb://fixture:password123@next.example/thingtime';
  const oldState = { ...runtime.state, enabled: true, databaseMode: 'external', mongoUri: originalUri };
  delete oldState.databaseIdentityVersion; delete oldState.legacyRendererIdentity;
  await runtime.persist(oldState);
  const originalIdentity = crypto.createHash('sha256').update(originalUri).digest('hex');
  const originalPartition = endpointPartition(runtime.snapshot().origin, originalIdentity);
  const migrated = new LocalRuntime({ userData: root, safeStorage: storage });
  await migrated.initialize(); const env = {}; migrated.applyEnvironment(env);
  assert.equal(migrated.state.databaseIdentityVersion, 1);
  assert.equal(migrated.runningDatabaseIdentity, originalIdentity);
  assert.equal(endpointPartition(migrated.snapshot().origin, migrated.runningDatabaseIdentity), originalPartition);
  assert.notEqual(env.THINGTIME_FEDERATION_ID, 'desktop-' + originalIdentity.slice(0, 24));
  const alias = structuredClone(migrated.state.legacyRendererIdentity);
  const stored = await fs.readFile(migrated.file);
  assert.ok(!stored.includes(Buffer.from(originalIdentity)));
  assert.ok(!JSON.stringify(migrated.snapshot()).includes(originalIdentity));
  assert.deepEqual(JSON.parse(storage.decryptString(stored)).legacyRendererIdentity, alias);
  await migrated.configure({ enabled: true, databaseMode: 'external', mongoUri: nextUri });
  assert.equal(migrated.runningDatabaseIdentity, originalIdentity, 'running renderer remains pinned before restart');
  const switched = new LocalRuntime({ userData: root, safeStorage: storage });
  await switched.initialize(); switched.applyEnvironment({});
  assert.equal(switched.runningDatabaseIdentity, switched.databaseIdentity());
  assert.notEqual(switched.runningDatabaseIdentity, crypto.createHash('sha256').update(nextUri).digest('hex'));
  assert.deepEqual(switched.state.legacyRendererIdentity, alias, 'no aliases for arbitrary new database passwords');
  await switched.configure({ enabled: true, databaseMode: 'external', mongoUri: originalUri });
  const returned = new LocalRuntime({ userData: root, safeStorage: storage });
  await returned.initialize(); const returnedEnv = {}; returned.applyEnvironment(returnedEnv);
  assert.equal(endpointPartition(returned.snapshot().origin, returned.runningDatabaseIdentity), originalPartition);
  assert.equal(returnedEnv.THINGTIME_FEDERATION_ID, env.THINGTIME_FEDERATION_ID);
  assert.deepEqual(returned.state.legacyRendererIdentity, alias);
 }));

test('identity migration persists before use and rejects corrupt identity metadata', () =>
 fixture(async (runtime, root) => {
  const legacy = { ...runtime.state };
  delete legacy.databaseIdentityVersion; delete legacy.legacyRendererIdentity;
  await runtime.persist(legacy);
  const previous = await fs.readFile(runtime.file);
  const failed = new LocalRuntime({ userData: root, safeStorage: storage });
  failed.persist = async () => { throw new Error('synthetic persistence failure'); };
  await assert.rejects(failed.initialize(), /persistence failure/);
  assert.deepEqual(await fs.readFile(runtime.file), previous);
  for (const metadata of [
   { databaseIdentityVersion: 2, legacyRendererIdentity: null },
   { databaseIdentityVersion: 1, legacyRendererIdentity: { keyedIdentity: 'bad', rendererIdentity: 'bad' } },
   { databaseIdentityVersion: 1 },
   { legacyRendererIdentity: { keyedIdentity: 'a'.repeat(64), rendererIdentity: 'b'.repeat(64) } }
  ]) {
   await runtime.persist({ ...legacy, ...metadata });
   await assert.rejects(new LocalRuntime({ userData: root, safeStorage: storage }).initialize(), /No remote fallback/);
  }
 }));
