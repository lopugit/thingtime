'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const DOWNLOAD_URL = 'https://www.mongodb.com/try/download/community';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = (value, fallback) => {
	const result = value === undefined ? fallback : Number(value);
	if (!Number.isInteger(result) || result < 1024 || result > 65535) throw new Error('Choose a port from 1024 to 65535.');
	return result;
};
function validateMongoUri(value) {
	if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f]/u.test(value) || !/^mongodb(?:\+srv)?:\/\/[^/]+/u.test(value))
		throw new Error('Enter a valid MongoDB connection URI.');
	return value;
}
async function assertFreePort(value) {
	await new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', () => reject(new Error(`Local port ${value} is already in use. Choose another port in desktop settings.`)));
		server.listen(value, '127.0.0.1', () => server.close(resolve));
	});
}
async function executable(file) {
	if (!file || !path.isAbsolute(file) || /[\x00-\x1f]/u.test(file)) return false;
	try {
		await fs.access(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
		return (await fs.stat(file)).isFile();
	} catch {
		return false;
	}
}
async function discoverMongod() {
	for (const file of ['/opt/homebrew/bin/mongod', '/usr/local/bin/mongod', '/usr/bin/mongod']) if (await executable(file)) return file;
	return null;
}
function defaultState(parallelDev) {
	return {
		version: 1,
		databaseIdentityVersion: 1,
		legacyRendererIdentity: null,
		enabled: false,
		databaseMode: 'managed',
		apiPort: parallelDev ? 28641 : 28631,
		databasePort: parallelDev ? 28642 : 28632,
		mongodPath: null,
		mongoUri: null,
		jwtSecret: crypto.randomBytes(32).toString('base64url'),
		vaultKey: crypto.randomBytes(32).toString('base64url'),
		mongoPassword: crypto.randomBytes(32).toString('base64url'),
		replicaKey: crypto.randomBytes(48).toString('base64')
	};
}
function validateState(value) {
	if (!value || value.version !== 1 || typeof value.enabled !== 'boolean' || !['managed', 'external'].includes(value.databaseMode))
		throw new Error('Local runtime settings are invalid.');
	for (const key of ['jwtSecret', 'vaultKey', 'mongoPassword', 'replicaKey'])
		if (typeof value[key] !== 'string' || value[key].length < 32) throw new Error('Local runtime secrets are invalid.');
	if (value.databaseIdentityVersion !== undefined && value.databaseIdentityVersion !== 1)
		throw new Error('Local database identity settings are invalid.');
	const legacy = value.legacyRendererIdentity;
	if (value.databaseIdentityVersion === undefined ? legacy !== undefined :
		legacy !== null && (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) ||
			!['keyedIdentity', 'rendererIdentity'].every(key => typeof legacy[key] === 'string' && /^[a-f0-9]{64}$/.test(legacy[key]))))
		throw new Error('Local database identity settings are invalid.');
	value.apiPort = port(value.apiPort);
	value.databasePort = port(value.databasePort);
	if (value.apiPort === value.databasePort) throw new Error('The API and database must use different ports.');
	if (value.mongoUri) validateMongoUri(value.mongoUri);
	if (value.mongodPath !== null && (typeof value.mongodPath !== 'string' || !path.isAbsolute(value.mongodPath)))
		throw new Error('Choose an absolute mongod executable path.');
	return value;
}
class LocalRuntime {
	constructor({ userData, safeStorage, parallelDev = false, createMongoClient, spawnProcess = spawn, bundledMongodPath = null, platform = process.platform, hostRelease = os.release() }) {
		if (!path.isAbsolute(userData)) throw new Error('Local runtime requires an absolute app data directory.');
		this.root = path.join(userData, 'local-runtime');
		this.file = path.join(this.root, 'settings.enc');
		this.safeStorage = safeStorage;
		this.bundledMongodPath = bundledMongodPath;
		this.bundledMongoSupported = platform !== 'darwin' || Number(hostRelease.split('.')[0]) >= 23;
		this.createMongoClient = createMongoClient;
		this.spawnProcess = spawnProcess;
		this.state = defaultState(parallelDev);
		this.runningEnabled = false;
		this.runningDatabaseIdentity = '';
		this.child = null;
		this.error = null;
		this.pending = Promise.resolve();
	}
	encryptionReady() {
		return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
	}
	async initialize() {
		let existingSettings = false;
		try {
			const stat = await fs.lstat(this.file);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid local runtime settings file.');
			if (!this.encryptionReady()) throw new Error('Unlock the system credential store to read local runtime settings.');
			this.state = validateState(JSON.parse(this.safeStorage.decryptString(await fs.readFile(this.file))));
			existingSettings = true;
		} catch (error) {
			if (error.code !== 'ENOENT') throw new Error('Local runtime settings could not be unlocked. No remote fallback was enabled.');
		}
		if (existingSettings && this.state.databaseIdentityVersion === undefined) {
			const uri = this.mongoUri();
			const migrated = { ...this.state, databaseIdentityVersion: 1, legacyRendererIdentity: null };
			if (typeof uri === 'string' && uri) {
				// Compatibility only: derive the already-existing renderer directory once
				// from this pre-upgrade database. This is not password verification. Keep
				// the alias encrypted, never publish it, and never derive it for new URIs.
				migrated.legacyRendererIdentity = {
					keyedIdentity: this.databaseIdentity(uri),
					rendererIdentity: crypto.createHash('sha256').update(uri).digest('hex')
				};
			}
			await this.persist(migrated);
			this.state = migrated;
		}
		if (!this.state.mongodPath) {
			// Only fresh installations adopt the bundled version automatically. Existing
			// installations keep their chosen executable and database compatibility.
			let existingDatabase = false;
			try { await fs.access(path.join(this.root, 'database', 'WiredTiger')); existingDatabase = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
			this.state.mongodPath = !existingSettings && !existingDatabase && await executable(this.bundledMongodPath)
				? this.bundledMongodPath : await discoverMongod();
		}
		return this.snapshot();
	}
	snapshot() {
		return {
			enabled: this.state.enabled,
			active: this.runningEnabled,
			restartRequired: this.restartRequired || false,
			databaseMode: this.state.databaseMode,
			apiPort: this.state.apiPort,
			databasePort: this.state.databasePort,
			mongodPath: this.state.mongodPath,
			bundledMongoSelected: Boolean(this.bundledMongodPath && this.state.mongodPath === this.bundledMongodPath),
			bundledMongoSupported: this.bundledMongoSupported,
			externalDatabaseConfigured: Boolean(this.state.mongoUri),
			encryptionAvailable: this.encryptionReady(),
			origin: `http://127.0.0.1:${this.state.apiPort}`,
			error: this.error,
			downloadUrl: DOWNLOAD_URL
		};
	}
	assertManagedBinarySupported(state = this.state) {
		if (state.mongodPath === this.bundledMongodPath && this.bundledMongodPath && !this.bundledMongoSupported)
			throw new Error('The included MongoDB requires macOS 14 or later. Upgrade macOS, choose a compatible MongoDB executable, or use an existing MongoDB connection.');
	}
	async persist(state) {
		if (!this.encryptionReady()) throw new Error('Unlock the system credential store before configuring the local runtime.');
		await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
		const temporary = path.join(this.root, `settings-${crypto.randomUUID()}.tmp`);
		try {
			await fs.writeFile(temporary, this.safeStorage.encryptString(JSON.stringify(state)), { flag: 'wx', mode: 0o600 });
			await fs.rename(temporary, this.file);
		} finally {
			await fs.rm(temporary, { force: true });
		}
	}
	configure(request, beforeCommit) {
		const next = this.pending.then(async () => {
			if (!request || typeof request.enabled !== 'boolean' || !['managed', 'external'].includes(request.databaseMode))
				throw new Error('Choose a local runtime and database mode.');
			const state = validateState({
				...this.state,
				enabled: request.enabled,
				databaseMode: request.databaseMode,
				apiPort: port(request.apiPort, this.state.apiPort),
				databasePort: port(request.databasePort, this.state.databasePort),
				...(request.mongoUri ? { mongoUri: validateMongoUri(request.mongoUri) } : {})
			});
			if (state.enabled && state.databaseMode === 'external' && !state.mongoUri) throw new Error('Enter the MongoDB URI for this local API.');
			if (state.enabled && state.databaseMode === 'managed') this.assertManagedBinarySupported(state);
			if (state.enabled && state.databaseMode === 'managed' && !(await executable(state.mongodPath)))
				throw new Error('MongoDB is unavailable in this build. Choose a MongoDB Community Server executable or use an existing MongoDB connection.');
			// A replica-set member address is persisted in MongoDB. Changing its port
			// needs an explicit database migration rather than silently creating a new DB.
			if (state.databasePort !== this.state.databasePort) {
				try {
					await fs.access(path.join(this.root, 'database', 'WiredTiger'));
					throw new Error('An initialized local database keeps its port. Move the database explicitly before changing it.');
				} catch (error) {
					if (error.code !== 'ENOENT') throw error;
				}
			}
			await beforeCommit?.();
			await this.persist(state);
			this.state = state;
			this.restartRequired = true;
			return this.snapshot();
		});
		this.pending = next.catch(() => {});
		return next;
	}
	async chooseMongod(file) {
		if (!(await executable(file)) || !/^mongod(?:\.exe)?$/iu.test(path.basename(file)))
			throw new Error('Choose the MongoDB Server mongod executable.');
		const state = { ...this.state, mongodPath: file };
		await this.persist(state);
		this.state = state;
		return this.snapshot();
	}
	mongoUri() {
		return this.state.databaseMode === 'external'
			? this.state.mongoUri
			: `mongodb://thingtime:${this.state.mongoPassword}@127.0.0.1:${this.state.databasePort}/thingtime?authSource=admin&replicaSet=thingtime-local`;
	}
	databaseIdentity(uri = this.mongoUri()) {
		// This public identifier must not provide an offline guess oracle for a
		// user-chosen MongoDB password. The domain separates it from vault uses.
		return crypto.createHmac('sha256', this.state.vaultKey)
			.update('thingtime-desktop-database-identity-v1\0').update(uri).digest('hex');
	}
	applyEnvironment(env) {
		// Never inherit development/production credentials into the desktop runtime.
		for (const name of [
			'MONGODB_CONNECTION_STRING',
			'MONGO_PASS',
			'JWT_SECRET',
			'JWT_PRIVATE_KEY',
			'JWT_PUBLIC_KEY',
			'THINGTIME_USER_VAULT_KEY',
			'THINGTIME_ADMIN_VAULT_KEY',
			'THINGTIME_CHATGPT_PLAN_DIR',
			'THINGTIME_CHATGPT_PLAN_STORAGE',
			'THINGTIME_CHATGPT_PLAN_ALLOW_LOOPBACK_AUTHORIZATION',
			'THINGTIME_DATA_ENV',
			'THINGTIME_FEDERATION_ID',
			'THINGTIME_DATA_AUTHORITY_ORIGIN'
		])
			delete env[name];
		env.THINGTIME_DESKTOP_API_MODE = this.state.enabled ? 'local' : 'remote';
		this.runningEnabled = this.state.enabled;
		const databaseIdentity = this.state.enabled ? this.databaseIdentity() : '';
		const legacy = this.state.legacyRendererIdentity;
		this.runningDatabaseIdentity = this.state.enabled && legacy?.keyedIdentity === databaseIdentity
			? legacy.rendererIdentity : databaseIdentity;
		if (!this.state.enabled) return;
		delete env.THINGTIME_API_FALLBACK_ORIGIN;
		env.MONGODB_CONNECTION_STRING = this.mongoUri();
		env.JWT_SECRET = this.state.jwtSecret;
		env.THINGTIME_USER_VAULT_KEY = this.state.vaultKey;
		env.THINGTIME_CHATGPT_PLAN_DIR = path.join(this.root, 'chatgpt-plan');
		env.THINGTIME_CHATGPT_PLAN_STORAGE = 'mongodb';
		env.THINGTIME_CHATGPT_PLAN_ALLOW_LOOPBACK_AUTHORIZATION = '1';
		const identity = 'desktop-' + databaseIdentity.slice(0, 24);
		env.THINGTIME_DATA_ENV = 'custom:' + identity;
		env.THINGTIME_FEDERATION_ID = identity;
		env.THINGTIME_DATA_AUTHORITY_ORIGIN = this.snapshot().origin;
	}
	async start() {
		if (!this.state.enabled) return;
		await this.persist(this.state);
		await assertFreePort(this.state.apiPort);
		if (this.state.databaseMode === 'external') return;
		this.assertManagedBinarySupported();
		if (!(await executable(this.state.mongodPath)))
			throw new Error('The selected mongod executable is unavailable. Choose it again in desktop settings.');
		await assertFreePort(this.state.databasePort);
		const dbpath = path.join(this.root, 'database');
		const keyFile = path.join(this.root, 'replica.key');
		await fs.mkdir(dbpath, { recursive: true, mode: 0o700 });
		await fs.writeFile(keyFile, this.state.replicaKey, { mode: 0o600 });
		await fs.chmod(keyFile, 0o600);
		this.child = this.spawnProcess(
			this.state.mongodPath,
			[
				'--dbpath',
				dbpath,
				'--bind_ip',
				'127.0.0.1',
				'--port',
				String(this.state.databasePort),
				'--auth',
				'--keyFile',
				keyFile,
				'--replSet',
				'thingtime-local',
				'--nounixsocket',
				'--quiet'
			],
			{ stdio: 'ignore', env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' } }
		);
		this.child.once('error', () => {
			this.error = 'MongoDB could not start. Check the selected executable.';
		});
		this.child.once('exit', () => {
			if (this.child) this.error = 'The local database stopped. Restart Thingtime to reconnect.';
		});
		try {
			await this.bootstrap();
		} catch {
			await this.stop();
			throw new Error('The local database could not be initialized securely. Check its executable and available disk space.');
		}
	}
	async bootstrap() {
		const options = { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000, directConnection: true };
		const client = this.createMongoClient(`mongodb://127.0.0.1:${this.state.databasePort}/`, options);
		try {
			let connected = false;
			for (let n = 0; n < 40; n++) {
				if (this.child?.exitCode !== null || this.error) throw new Error('Database exited.');
				try {
					await client.connect();
					connected = true;
					break;
				} catch {
					await sleep(250);
				}
			}
			if (!connected) throw new Error('Database did not become ready.');
			const admin = client.db('admin');
			try {
				await admin.command({ replSetInitiate: { _id: 'thingtime-local', members: [{ _id: 0, host: `127.0.0.1:${this.state.databasePort}` }] } });
			} catch (error) {
				if (![13, 23].includes(error.code)) throw error;
			}
			let primary = false;
			for (let n = 0; n < 80; n++) {
				if ((await admin.command({ hello: 1 })).isWritablePrimary) {
					primary = true;
					break;
				}
				await sleep(250);
			}
			if (!primary) throw new Error('Database did not elect a primary.');
			try {
				await admin.command({ createUser: 'thingtime', pwd: this.state.mongoPassword, roles: [{ role: 'root', db: 'admin' }] });
			} catch (error) {
				if (![13, 51003].includes(error.code)) throw error;
			}
		} finally {
			await client.close();
		}
		const authenticated = this.createMongoClient(this.mongoUri(), options);
		try {
			await authenticated.connect();
			await authenticated.db('admin').command({ connectionStatus: 1 });
		} finally {
			await authenticated.close();
		}
	}
	async stop() {
		const child = this.child;
		this.child = null;
		if (!child || child.exitCode !== null || !child.pid) return;
		await new Promise((resolve) => {
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
			}, 5000);
			const deadline = setTimeout(resolve, 7000);
			child.once('exit', () => {
				clearTimeout(timer);
				clearTimeout(deadline);
				resolve();
			});
			child.kill('SIGTERM');
		});
		await fs.rm(path.join(this.root, 'replica.key'), { force: true });
	}
}
function endpointPartition(origin, databaseIdentity = '') {
	return (
		'persist:thingtime-api-' +
		crypto
			.createHash('sha256')
			.update(JSON.stringify([new URL(origin).origin, databaseIdentity]))
			.digest('hex')
			.slice(0, 32)
	);
}
function attachQuitSignals(app, source = process) {
	const quit = () => app.quit();
	source.on('SIGINT', quit);
	source.on('SIGTERM', quit);
	return () => {
		source.off('SIGINT', quit);
		source.off('SIGTERM', quit);
	};
}
// Only call for a process spawned with detached:true by this supervisor.
// Normal shutdown signals the Electron leader first, leaving MongoDB alive
// until the app has released its persisted account-runtime authority.
async function stopOwnedProcessGroup(pid, { graceMs = 5000, killMs = 3000 } = {}) {
	if (!pid) return;
	if (!Number.isInteger(pid) || pid <= 1 || process.platform === 'win32') throw new Error('Cannot verify the development process group is stopped.');
	const alive = () => {
		try {
			process.kill(-pid, 0);
			return true;
		} catch (error) {
			if (error.code === 'ESRCH') return false;
			throw error;
		}
	};
	const signal = (name) => {
		try {
			process.kill(-pid, name);
		} catch (error) {
			if (error.code !== 'ESRCH') throw error;
		}
	};
	const wait = async (timeout) => {
		const deadline = Date.now() + timeout;
		while (alive() && Date.now() < deadline) await sleep(50);
		return !alive();
	};
	if (!alive()) return;
	signal('SIGTERM');
	if (await wait(graceMs)) return;
	signal('SIGKILL');
	if (!(await wait(killMs))) throw new Error('Development processes are still running; temporary data has been preserved.');
}
module.exports = {
	attachQuitSignals,
	stopOwnedProcessGroup,
	endpointPartition,
	LocalRuntime,
	assertFreePort,
	validateMongoUri,
	discoverMongod,
	DOWNLOAD_URL
};
