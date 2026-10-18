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


test('authority transition clears native credentials before durable settings and fails closed', () =>
 fixture(async (runtime, root) => {
  await runtime.initialize();
  await runtime.configure({enabled:false,databaseMode:'managed'});
  const previous = await fs.readFile(runtime.file);
  const request = {enabled:true,databaseMode:'external',mongoUri:'mongodb://fixture:synthetic@127.0.0.1:19882/thingtime'};
  await assert.rejects(runtime.configure(request, async () => { throw new Error('native clear failed'); }), /native clear failed/);
  assert.deepEqual(await fs.readFile(runtime.file),previous);
  assert.equal(runtime.snapshot().enabled,false);
  let called = false;
  await runtime.configure(request, async () => {
   called=true; assert.deepEqual(await fs.readFile(runtime.file),previous);
  });
  assert.equal(called,true);
  assert.equal(runtime.snapshot().enabled,true);
  let invalidCallback=false;
  await assert.rejects(runtime.configure({...request,mongoUri:'https://invalid.test'},async()=>{invalidCallback=true;}));
  assert.equal(invalidCallback,false);
 }));
