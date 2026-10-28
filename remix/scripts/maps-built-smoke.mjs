#!/usr/bin/env node
// Built Nitro HTTP smoke with an isolated disposable replica set. Thing data
// is created only through the real API; Mongo access is used for rs.initiate.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'tt-maps-built-smoke-'));
const taken = new Set();
const children = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
	for (;;) {
		const server = createServer();
		await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
		const port = server.address().port;
		await new Promise((resolve) => server.close(resolve));
		if (!taken.has(port)) { taken.add(port); return port; }
	}
}

function start(executable, args, env) {
	const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	let log = '';
	for (const pipe of [child.stdout, child.stderr]) pipe.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
	const running = { child, log: () => log };
	children.push(running);
	return running;
}

async function stop(running) {
	const signal = (name) => { try { process.kill(-running.child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
	const exit = running.child.exitCode !== null || running.child.signalCode !== null ? Promise.resolve() : once(running.child, 'exit');
	signal('SIGTERM');
	const forced = setTimeout(() => signal('SIGKILL'), 3000);
	await exit;
	clearTimeout(forced);
}

try {
	const ports = { api: await freePort(), db: await freePort() };
	const origin = `http://127.0.0.1:${ports.api}`;
	const uri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=maps_smoke`;
	const env = {
		PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary,
		NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
		MONGODB_CONNECTION_STRING: uri, JWT_SECRET: randomBytes(48).toString('hex'),
		THINGTIME_DATA_ENV: 'development', TT_API_PORT: String(ports.api)
	};
	await mkdir(join(temporary, 'db'));
	const database = start(process.env.THINGTIME_TEST_MONGOD || '/opt/homebrew/bin/mongod',
		['--dbpath', join(temporary, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'maps_smoke', '--nounixsocket'], env);
	const client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
	try {
		let connected = false;
		for (let attempt = 0; attempt < 50; attempt++) {
			try { await client.connect(); connected = true; break; } catch { await delay(200); }
		}
		assert(connected, `Disposable MongoDB did not start: ${database.log()}`);
		await client.db('admin').command({ replSetInitiate: { _id: 'maps_smoke', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
		let primary = false;
		for (let attempt = 0; attempt < 100; attempt++) {
			if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) { primary = true; break; }
			await delay(200);
		}
		assert(primary, 'Disposable MongoDB replica did not become primary');
	} finally { await client.close(); }
	const app = start(process.execPath, ['.output/server/index.mjs'], env);
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (app.child.exitCode !== null) throw new Error(`Built Nitro exited: ${app.log()}`);
		try { if ((await fetch(`${origin}/.well-known/thingtime-capabilities.json`, { signal: AbortSignal.timeout(700) })).ok) { ready = true; break; } } catch {}
		await delay(200);
	}
	assert(ready, `Built Nitro did not start: ${app.log()}`);
	const request = async (path, { method = 'GET', body, cookie, status = 200 } = {}) => {
		const response = await fetch(origin + path, {
			method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
			...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
		});
		const data = await response.json();
		assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
		return { data, response };
	};
	const manifest = (await request('/.well-known/thingtime-capabilities.json')).data;
	assert.equal(manifest.origin, origin);
	assert.equal(manifest.features['api.maps'].version, '1.0.0');
	assert.equal(manifest.features['api.things'].version, '1.45.0');
	console.log('Built manifest: api.maps 1.0.0, api.things 1.45.0, exact origin');
	const anonymous = await request('/api/v1/maps', { method: 'POST', body: { operation: 'browser-config', vaultId: 'synthetic-vault' }, status: 401 });
	assert.equal(anonymous.response.headers.get('cache-control'), 'private, no-store');
	console.log('Anonymous maps request: 401, private/no-store');
	const handle = `maps-smoke-${randomUUID().slice(0, 8)}`;
	const registered = await request('/api/v1/auth/register', { method: 'POST', body: {
		username: handle, email: `${handle}@example.invalid`, password: randomBytes(24).toString('hex'), displayName: 'Disposable Maps Smoke'
	} });
	assert(registered.data.user?.id);
	const cookie = registered.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
	assert(cookie);
	const unconfigured = await request('/api/v1/maps', { method: 'POST', cookie, body: { operation: 'browser-config', vaultId: 'missing-vault' }, status: 409 });
	assert(!JSON.stringify(unconfigured.data).includes('pk.') && !JSON.stringify(unconfigured.data).includes('sk.'));
	console.log('Full account without Vault entry: 409, no credential disclosure');
	const create = async (kind, crystal, asCookie = cookie) => {
		const result = await request('/api/v1/things', { method: 'POST', cookie: asCookie, body: { thingtime: [kind], acl: ['tt:user'], crystal } });
		assert.equal(typeof result.data.thing?.id, 'string');
		return result.data.thing.id;
	};
	const schemaId = await create('schema', { name: 'Disposable Favorite Stops', fields: [{ name: 'title', type: 'string', required: true }] });
	const otherSchemaId = await create('schema', { name: 'Disposable Other Stops', fields: [{ name: 'title', type: 'string', required: true }] });
	const favoriteId = await create('data', { schemaId, title: 'Favorite stop', favorite: true });
	await create('data', { schemaId: otherSchemaId, title: 'Other stop', favorite: false });
	const listing = await request(`/api/v1/things?thingtime=data&schemaId=${encodeURIComponent(schemaId)}`, { cookie });
	assert.deepEqual(listing.data.things.map((thing) => thing.id), [favoriteId]);
	assert.equal(listing.data.things[0].crystal.schemaId, schemaId);
	const invalid = await request('/api/v1/things?thingtime=data&schemaId=%24ne', { cookie, status: 400 });
	assert.equal(invalid.data.ok, false);
	console.log('Authenticated schemaId list: exact favorite Thing only; operator-shaped ID refused');
	const parentA = await create('data', { title: 'Route group A' });
	const parentB = await create('data', { title: 'Route group B' });
	const groupA = [];
	for (let index = 0; index < 3; index++) groupA.push(await create('data', { schemaId, parentId: parentA, title: `Group A stop ${index}`, favorite: true }));
	const groupB = [];
	for (let index = 0; index < 2; index++) groupB.push(await create('data', { schemaId, parentId: parentB, title: `Group B stop ${index}`, favorite: true }));
	const rawData = await create('data', { parentId: parentA, title: 'Schema-free data', favorite: true });
	const secondHandle = `maps-other-${randomUUID().slice(0, 8)}`;
	const second = await request('/api/v1/auth/register', { method: 'POST', body: {
		username: secondHandle, email: `${secondHandle}@example.invalid`, password: randomBytes(24).toString('hex'), displayName: 'Other Disposable Account'
	} });
	const secondCookie = second.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
	assert(secondCookie);
	const foreign = await create('data', { parentId: parentA, title: 'Other owner stop' }, secondCookie);
	const scopedPath = `/api/v1/things?thingtime=data&schemaId=${encodeURIComponent(schemaId)}&parentId=${encodeURIComponent(parentA)}`;
	const scopedIds = [];
	let cursor = null;
	for (let page = 0; page < 4; page++) {
		const result = await request(`${scopedPath}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cookie });
		assert(result.data.things.length <= 2, 'Server must apply page size after parent/schema filtering');
		for (const thing of result.data.things) {
			assert.equal(thing.crystal.schemaId, schemaId);
			assert.equal(thing.crystal.parentId, parentA);
			scopedIds.push(thing.id);
		}
		cursor = result.data.nextCursor;
		if (!cursor) break;
		assert(page < 3, 'Parent/schema listing did not terminate');
	}
	assert.deepEqual(new Set(scopedIds), new Set(groupA));
	assert.equal(scopedIds.length, groupA.length, 'Paged listing must not duplicate or skip a stop');
	const groupBList = await request(`/api/v1/things?thingtime=data&schemaId=${encodeURIComponent(schemaId)}&parentId=${encodeURIComponent(parentB)}`, { cookie });
	assert.deepEqual(new Set(groupBList.data.things.map((thing) => thing.id)), new Set(groupB));
	const rawList = await request(`/api/v1/things?thingtime=data&parentId=${encodeURIComponent(parentA)}`, { cookie });
	assert.deepEqual(new Set(rawList.data.things.map((thing) => thing.id)), new Set([...groupA, rawData]));
	assert(!rawList.data.things.some((thing) => thing.id === foreign));
	const foreignView = await request(`/api/v1/things?thingtime=data&parentId=${encodeURIComponent(parentA)}`, { cookie: secondCookie });
	assert.deepEqual(foreignView.data.things.map((thing) => thing.id), [foreign]);
	const invalidParent = await request('/api/v1/things?thingtime=data&parentId=%24ne', { cookie, status: 400 });
	assert.equal(invalidParent.data.ok, false);
	console.log('Parent groups: exact intersection, two-page cursor, schema-free data, owner isolation, operator-shaped ID refusal');
	const makeApp = async (name, asCookie = cookie) => {
		const result = await request('/api/v1/things', { method: 'POST', cookie: asCookie, body: { thingtime: ['folder'], folderId: null, acl: ['tt:user'], crystal: { name, description: `${name} workspace`, builderApp: true, metadata: { owner: name } } } });
		return result.data.thing.id;
	};
	const appA = await makeApp('Maps app A');
	const appB = await makeApp('Maps app B');
	await create('folder', { name: 'Ordinary folder' });
	const otherApp = await makeApp('Other owner app', secondCookie);
	const appIds = [];
	let appCursor = null;
	for (let page = 0; page < 4; page++) {
		const result = await request(`/api/v1/things?folder=root&builderApp=true&limit=1${appCursor ? `&cursor=${encodeURIComponent(appCursor)}` : ''}`, { cookie });
		appIds.push(...result.data.things.map((thing) => thing.id));
		assert(result.data.things.every((thing) => thing.crystal.builderApp === true && thing.folderId == null));
		appCursor = result.data.nextCursor;
		if (!appCursor) break;
		assert(page < 3, 'Builder app listing did not terminate');
	}
	assert.deepEqual(new Set(appIds), new Set([appA, appB]));
	assert.equal(appIds.length, 2);
	assert(!(await request('/api/v1/things?folder=root&builderApp=true', { cookie: secondCookie })).data.things.some((thing) => appIds.includes(thing.id)));
	assert.deepEqual((await request('/api/v1/things?folder=root&builderApp=true', { cookie: secondCookie })).data.things.map((thing) => thing.id), [otherApp]);
	await request('/api/v1/things?folder=root&builderApp=true', { status: 401 });
	await request('/api/v1/things?builderApp=true', { cookie, status: 400 });
	await request(`/api/v1/things?id=${encodeURIComponent(appA)}&builderApp=true`, { cookie, status: 400 });
	const child = await request('/api/v1/things', { method: 'POST', cookie, body: { thingtime: ['data'], folderId: appA, acl: ['tt:user'], crystal: { title: 'Private app child' } } });
	assert.equal(child.data.thing.folderId, appA);
	await request(`/api/v1/things?id=${encodeURIComponent(child.data.thing.id)}`, { cookie: secondCookie, status: 404 });
	await request('/api/v1/things', { method: 'POST', cookie, body: { thingtime: ['folder'], folderId: appA, acl: ['tt:user'], crystal: { name: 'Invalid nested app', builderApp: true } }, status: 400 });
	console.log('Builder app folders: owner-only pre-page filter, cursor, ungrouped visibility, independent child ACL, top-level fence');
	console.log('PASS maps built HTTP smoke (disposable account and replica set)');
} finally {
	for (const child of children.reverse()) await stop(child).catch(() => {});
	await rm(temporary, { recursive: true, force: true });
}
