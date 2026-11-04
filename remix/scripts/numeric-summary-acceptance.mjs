#!/usr/bin/env node
// Run against a node-server Nitro build. Synthetic data uses the actual HTTP API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const serverFile = fileURLToPath(new URL('../.output/server/index.mjs', import.meta.url));
await access(serverFile);
const dir = await mkdtemp(join(tmpdir(), 'tt-numeric-summary-'));
const children = [];
const listeners = [];
let mongo;

async function reservePort() {
	const listener = createServer().listen(0, '127.0.0.1');
	listeners.push(listener);
	await once(listener, 'listening');
	return listener.address().port;
}

function start(executable, args, env) {
	const child = spawn(executable, args, { cwd: dir, env, stdio: 'ignore' });
	child.on('error', () => {});
	children.push(child);
	return child;
}

async function stop(child) {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill('SIGTERM');
	const force = setTimeout(() => child.kill('SIGKILL'), 3000);
	try { await exited; } finally { clearTimeout(force); }
}

async function waitFor(label, probe) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await probe().catch(() => false)) return;
		await delay(200);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

try {
	const [apiPort, dbPort] = await Promise.all([reservePort(), reservePort()]);
	await Promise.all(listeners.map((listener) => new Promise((resolve) => listener.close(resolve))));
	const host = '127.0.0.1';
	const origin = `http://${host}:${apiPort}`;
	const replica = 'numeric_summary';
	const env = {
		PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: host, PORT: String(apiPort),
		MONGODB_CONNECTION_STRING: `mongodb://${host}:${dbPort}/thingtime?replicaSet=${replica}`,
		JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
		THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(dir, 'attachments')
	};
	const dbPath = join(dir, 'db');
	await mkdir(dbPath);
	start(process.env.THINGTIME_TEST_MONGOD || 'mongod', ['--dbpath', dbPath, '--port', String(dbPort), '--bind_ip', host, '--replSet', replica, '--nounixsocket'], env);
	mongo = new MongoClient(`mongodb://${host}:${dbPort}/?directConnection=true`, { serverSelectionTimeoutMS: 600 });
	await waitFor('replica startup', async () => { await mongo.connect(); return true; });
	const admin = mongo.db('admin');
	await admin.command({ replSetInitiate: { _id: replica, members: [{ _id: 0, host: `${host}:${dbPort}` }] } });
	await waitFor('replica primary', async () => (await admin.command({ hello: 1 })).isWritablePrimary);
	await mongo.close();
	mongo = null;

	start(process.execPath, [serverFile], env);
	const manifestPath = '/.well-known/thingtime-capabilities.json';
	await waitFor('built Nitro handler', async () => (await fetch(origin + manifestPath, { signal: AbortSignal.timeout(700) })).ok);
	async function request(path, { body, cookie, token, status = 200, label = path.split('?')[0] } = {}) {
		const method = body ? 'POST' : 'GET';
		const response = await fetch(origin + path, {
			method, signal: AbortSignal.timeout(30000), headers: {
				Origin: origin, 'Content-Type': 'application/json',
				...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {})
			}, ...(body ? { body: JSON.stringify(body) } : {})
		});
		assert.equal(response.status, status, `${method} ${label} HTTP status`);
		assert.match(response.headers.get('content-type') || '', /^application\/json\b/, `${method} ${label} returns JSON`);
		return {
			data: await response.json(), headers: response.headers,
			cookie: response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ')
		};
	}

	const { data: manifest } = await request(manifestPath);
	assert.equal(manifest.origin, origin);
	assert.equal(manifest.features['api.things'].version, '1.47.0');
	assert(manifest.operations.some((entry) => entry.feature === 'api.things' && entry.path === '/api/v1/things' && entry.methods.includes('GET')));
	console.log('PASS origin-scoped manifest and registered built Things handler');

	async function register(username) {
		const result = await request('/api/v1/auth/register', { body: { username, email: `${username}@example.invalid`, password: randomBytes(24).toString('hex') } });
		assert(result.cookie, 'Disposable registration issued a session');
		return result.cookie;
	}
	async function create(cookie, kind, crystal, { shareId, acl = ['tt:user'] } = {}) {
		const { data } = await request('/api/v1/things', { cookie, body: { thingtime: [kind], crystal, shareId, acl }, label: `create ${kind}` });
		assert.equal(typeof data.thing?.id, 'string', 'Saved Thing response');
		return data.thing.id;
	}
	const owner = await register('numeric-summary-owner');
	const other = await register('numeric-summary-other');
	const schema = { name: 'Numeric summary stops', fields: [{ name: 'rank', type: 'number' }] };
	const schemaId = await create(owner, 'schema', schema, { acl: ['tt:all'] });
	const otherSchemaId = await create(owner, 'schema', { ...schema, name: 'Unrelated stops' });
	const parentId = await create(owner, 'data', { name: 'Route for summary' });
	const otherParentId = await create(owner, 'data', { name: 'Negative ranks route' });
	const main = { schemaId, parentId };
	const boundaryId = 'summary_stop_boundary';
	for (let i = 0; i < 52; i++) {
		const rank = i === 0 ? 81 : i === 1 ? 71 : i === 50 ? '900' : i === 51 ? 99 : 0;
		await create(owner, 'data', { ...main, rank, ...(i === 51 ? { archived: true } : {}) }, {
			shareId: i === 2 ? boundaryId : undefined, ...(i === 1 ? { acl: ['tt:all'] } : {})
		});
	}
	await create(owner, 'data', { ...main, schemaId: otherSchemaId, rank: 900 });
	await create(owner, 'data', { ...main, parentId: otherParentId, rank: -4 });
	await create(owner, 'data', { ...main, parentId: otherParentId, rank: 0, archived: true });
	await create(other, 'data', { ...main, rank: 800 });

	const endpoint = (query) => '/api/v1/things?' + new URLSearchParams({ thingtime: 'data', ...main, ...query });
	const ordinaryPage = (await request(endpoint({ limit: '50' }), { cookie: owner })).data;
	assert.equal(ordinaryPage.things.length, 50);
	assert.equal(ordinaryPage.things.at(-1).id, boundaryId, 'An underscore ID is the real first-page boundary');
	assert(ordinaryPage.things.every((thing) => thing.crystal.rank !== 81), 'Maximum lies outside the first page');

	async function summary(expected, options, overrides = {}) {
		const { data, headers } = await request(endpoint({ maxCrystalField: 'rank', excludeArchived: 'true', ...overrides }), options);
		assert.deepEqual(data, { ok: true, summary: { max: expected } });
		assert.equal(headers.get('cache-control'), 'private, no-store');
		assert.equal(headers.get('vary'), 'Cookie, Authorization');
	}
	await summary(81, { cookie: owner });
	await summary(99, { cookie: owner }, { excludeArchived: 'false' });
	await summary(-4, { cookie: owner }, { parentId: otherParentId });
	await summary(0, { cookie: owner }, { parentId: otherParentId, excludeArchived: 'false' });
	await summary(null, { cookie: owner }, { parentId: 'empty-route' });
	await summary(800, { cookie: other });
	console.log('PASS real second-page maximum, underscore cursor, archive filter, numeric types, empty route and owner boundaries');

	async function mint(scopes, visibility) {
		const { data } = await request('/api/v1/tokens', { cookie: owner, status: 201, body: { name: 'Disposable summary token', scopes, visibility } });
		assert.equal(typeof data.token, 'string', 'Token endpoint returned a token');
		return data.token;
	}
	await summary(81, { token: await mint(['things.read'], 'private') });
	await summary(71, { token: await mint(['things.read'], 'public') });
	const summaryPath = endpoint({ maxCrystalField: 'rank', excludeArchived: 'true' });
	await request(summaryPath, { token: await mint(['things.create'], 'all'), status: 403 });
	await request(summaryPath, { status: 401 });
	for (const path of [summaryPath + '&limit=1', summaryPath + '&maxCrystalField=other', endpoint({ maxCrystalField: 'nested.rank' })]) {
		await request(path, { cookie: owner, status: 400 });
	}
	console.log('PASS private/public read-only PAT boundaries, missing scope, anonymous and invalid queries');
} finally {
	await mongo?.close();
	for (const child of children.reverse()) await stop(child);
	await Promise.all(listeners.filter((listener) => listener.listening).map((listener) => new Promise((resolve) => listener.close(resolve))));
	await rm(dir, { recursive: true, force: true });
}
