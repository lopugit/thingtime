import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { MongoClient } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { MongoChatGPTPlanStorage } from './chatgptPlanStorage';
import { ChatGPTPlanRuntime } from './chatgptPlanRuntime';
import { SCOPES } from './chatgptPlanProtocol';

// Opt-in binary, task-owned temporary replica set and database: never uses configured application DBs.
test(
	'Mongo replica-set transaction moves authority atomically and rejects stale writer',
	{ skip: !process.env.THINGTIME_TEST_MONGOD || !process.env.THINGTIME_TEST_MONGO_PORT, timeout: 60_000 },
	async (t) => {
		const port = Number(process.env.THINGTIME_TEST_MONGO_PORT);
		assert.ok(Number.isInteger(port) && port > 1024 && port < 65534);
		// Fail closed unless the OS denies both a different local service and a direct Internet IP.
		for (const target of [
			{ host: '127.0.0.1', port: port + 1 },
			{ host: '1.1.1.1', port: 443 }
		]) {
			const code = await new Promise<string>((resolve) => {
				const socket = createConnection(target);
				socket.setTimeout(1000);
				socket.once('connect', () => {
					socket.destroy();
					resolve('CONNECTED');
				});
				socket.once('timeout', () => {
					socket.destroy();
					resolve('TIMEOUT');
				});
				socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'UNKNOWN'));
			});
			assert.equal(code, 'EPERM', 'Run this test inside an OS network sandbox allowing only the exact test Mongo port.');
		}
		const directory = await mkdtemp(join(tmpdir(), 'thingtime-chatgpt-mongo-test-'));
		const runtimes: ChatGPTPlanRuntime[] = [];
		const socket = createServer();
		await new Promise<void>((resolve) => socket.listen(port, '127.0.0.1', resolve));
		await new Promise<void>((resolve) => socket.close(() => resolve()));
		const processHandle = spawn(
			process.env.THINGTIME_TEST_MONGOD!,
			[
				'--dbpath',
				directory,
				'--port',
				String(port),
				'--bind_ip',
				'127.0.0.1',
				'--replSet',
				'chatgpt-test',
				'--quiet',
				'--nounixsocket',
				'--logpath',
				join(directory, 'mongod.log')
			],
			{ stdio: ['ignore', 'ignore', 'ignore'] }
		);
		const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500 });
		const oldKey = process.env.THINGTIME_USER_VAULT_KEY;
		process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
		t.after(async () => {
			for (const runtime of runtimes) await runtime.close().catch(() => undefined);
			await client.close();
			processHandle.kill('SIGTERM');
			await new Promise<void>((resolve) => {
				if (processHandle.exitCode !== null) resolve();
				else processHandle.once('exit', () => resolve());
			});
			await rm(directory, { recursive: true, force: true });
			if (oldKey === undefined) delete process.env.THINGTIME_USER_VAULT_KEY;
			else process.env.THINGTIME_USER_VAULT_KEY = oldKey;
		});
		for (let attempt = 0; ; attempt++) {
			try {
				await client.connect();
				break;
			} catch (error) {
				if (attempt > 30 || processHandle.exitCode !== null)
					throw new Error(`Isolated Mongo startup failed: ${await readFile(join(directory, 'mongod.log'), 'utf8').catch(() => String(error))}`);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		await client.db('admin').command({ replSetInitiate: { _id: 'chatgpt-test', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
		for (let attempt = 0; ; attempt++) {
			const status = await client.db('admin').command({ hello: 1 });
			if (status.isWritablePrimary) break;
			if (attempt > 100) throw new Error('Test replica set did not elect a primary.');
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const collection = client.db('thingtime_chatgpt_test').collection(physicalCollectionName('settings'));
		await collection.createIndex({ key: 1 }, { unique: true });
		const deps = {
			collection: async () => collection,
			transaction: async <T>(work: (session: any) => Promise<T>) => {
				const session = client.startSession();
				try {
					return (await session.withTransaction(() => work(session))) as T;
				} finally {
					await session.endSession();
				}
			}
		};
		const first = new MongoChatGPTPlanStorage(deps);
		await first.load('urn:uuid:isolated-test');
		await first.save([{ type: 'account', id: 'one', scope: 'owner-origin', value: { token: 'private-test-refresh' } }]);
		assert.equal(JSON.stringify(await collection.find({}).toArray()).includes('private-test-refresh'), false);
		const second = new MongoChatGPTPlanStorage(deps);
		await assert.rejects(second.load('urn:uuid:isolated-test'), /Another runtime/);
		await first.close();
		await second.load('urn:uuid:isolated-test');
		await assert.rejects(first.save([]), /authority was lost/);
		await second.save([{ type: 'outbound', id: 'move', scope: 'owner-origin', value: { ciphertext: 'sealed' } }]);
		await second.close();
		const reopened = new MongoChatGPTPlanStorage(deps);
		const rows = await reopened.load('urn:uuid:isolated-test');
		assert.deepEqual(
			rows.map((row) => row.type),
			['outbound']
		);
		await reopened.close();
		const sourceScope = { ownerId: 'source-user', origin: 'http://127.0.0.1:19101', sessionId: 'source-session' };
		const targetScope = { ownerId: 'target-user', origin: 'https://personal.example.test', sessionId: 'target-session' };
		const sourceDirectory = join(directory, 'source-runtime');
		const targetDirectory = join(directory, 'target-runtime');
		const options = () => ({
			storage: new MongoChatGPTPlanStorage(deps),
			models: async () => [{ slug: 'fixture-model', displayName: 'Fixture model' }],
			identity: async () => ({ issuer: 'https://auth.openai.com', subject: 'fixture-subject', email: 'test@example.test' })
		});
		const makeRuntime = (directory: string) => {
			const runtime = new ChatGPTPlanRuntime(directory, options());
			runtimes.push(runtime);
			return runtime;
		};
		let source = makeRuntime(sourceDirectory);
		let target = makeRuntime(targetDirectory);
		await source.list(sourceScope);
		await source.close();
		const sourceIdentity = JSON.parse(await readFile(join(sourceDirectory, 'identity.json'), 'utf8'));
		const fixtureStore = new MongoChatGPTPlanStorage(deps);
		await fixtureStore.load(sourceIdentity.hostId);
		const scope = createHash('sha256')
			.update(JSON.stringify([sourceScope.ownerId, sourceScope.origin]))
			.digest('hex');
		const accountId = 'chatgpt-plan-10000000-0000-4000-8000-000000000001';
		await fixtureStore.save([
			{
				type: 'account',
				id: accountId,
				scope,
				value: {
					id: accountId,
					scope,
					clientId: 'oaiapp_fixture',
					subject: 'fixture-subject',
					models: [{ slug: 'fixture-model', displayName: 'Fixture model' }],
					model: 'fixture-model',
					credentials: {
						clientId: 'oaiapp_fixture',
						hostId: sourceIdentity.hostId,
						issuer: 'https://auth.openai.com',
						subject: 'fixture-subject',
						idToken: 'fixture-identity',
						accessToken: 'private-fixture-access',
						refreshToken: 'private-fixture-refresh',
						tokenType: 'Bearer',
						scopes: [...SCOPES],
						expiresAt: Date.now() + 3600_000
					}
				}
			}
		]);
		await fixtureStore.close();
		source = makeRuntime(sourceDirectory);
		const descriptor = await target.prepareImport(targetScope);
		const bundle = await source.moveAccount(sourceScope, accountId, descriptor);
		await assert.rejects(source.resolveProvider(sourceScope, accountId));
		await source.close();
		source = makeRuntime(sourceDirectory);
		assert.deepEqual(await source.moveAccount(sourceScope, accountId, descriptor), bundle);
		const imported = await target.importAccount(targetScope, bundle);
		await target.close();
		target = makeRuntime(targetDirectory);
		assert.equal((await target.importAccount(targetScope, bundle)).id, imported.id);
		assert.equal((await target.resolveProvider(targetScope, imported.id)).token, 'private-fixture-access');
		assert.equal(JSON.stringify(await collection.find({}).toArray()).includes('private-fixture'), false);
		await source.close();
		await target.close();
	}
);
