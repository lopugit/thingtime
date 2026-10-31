import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSyncClient, negotiateRemoteSourcePaths } from './remoteSyncClient.client';

const storage = () => {
	const data = new Map<string, string>();
	return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, data };
};
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const base = () => ({ ownerId: 'owner', deviceId: 'device', origin: 'https://thingtime.test', signal: new AbortController().signal,
	assertCurrent() {}, requireCapability: async () => {}, pollMilliseconds: 1, storage: storage() });

test('remote sync polls the same authenticated request without replaying commands', async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	const client = createRemoteSyncClient({ ...base(), fetch: async (url, init) => {
		calls.push({ url: String(url), init });
		return reply(calls.length === 1 ? { ok: true, status: 'pending' } : { ok: true, status: 'complete', result: { accepted: true } });
	} });
	assert.deepEqual(await client.send({ action: 'pause', connectionId: 'connection' }), { accepted: true });
	assert.equal(calls.length, 2);
	const body = JSON.parse(calls[0].init.body as string);
	assert.equal(body.deviceId, 'device'); assert.equal(body.action, 'enqueue');
	assert.equal(new URL(calls[1].url).searchParams.get('requestId'), body.requestId);
	assert.equal(calls[1].init.method, 'GET');
	assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.redirect, 'error');
	assert.equal((calls[0].init.headers as any)['X-Thingtime-Expected-Actor'], 'owner');
});

test('uncertain mutations recover their original receipt across a new client', async () => {
	const input = base(); let sentId = '', posts = 0;
	const fetcher: typeof fetch = async (url, init) => {
		if (init.method === 'POST') { posts++; sentId = JSON.parse(init.body as string).requestId; throw Error('Network reply lost'); }
		assert.equal(new URL(String(url)).searchParams.get('requestId'), sentId);
		return reply({ ok: true, status: 'complete', result: { accepted: true } });
	};
	await assert.rejects(createRemoteSyncClient({ ...input, fetch: fetcher }).send({ action: 'folders', request: { action: 'choose' } }), /same saved request/);
	assert.equal(input.storage.data.size, 1);
	assert.deepEqual(await createRemoteSyncClient({ ...input, fetch: fetcher }).send({ action: 'folders', request: { action: 'choose' } }), { accepted: true });
	assert.equal(posts, 1); assert.equal(input.storage.data.size, 0);
});

test('a newer mutation waits for an unresolved earlier mutation', async () => {
	const input = base(); let posts = 0;
	const fetcher: typeof fetch = async (_url, init) => {
		if (init.method === 'POST') { posts++; throw Error('Reply lost'); }
		return reply({ ok: true, status: 'processing' });
	};
	const client = createRemoteSyncClient({ ...input, fetch: fetcher });
	await assert.rejects(client.send({ action: 'folders', request: { action: 'choose' } }));
	await assert.rejects(client.send({ action: 'folders', request: { action: 'remove', rootId: 'root' } }), /earlier device request/);
	assert.equal(posts, 1);
});

test('expired missing receipts do not permanently block later actions', async () => {
	const input = base(); let oldId = '';
	const first = createRemoteSyncClient({ ...input, fetch: async (_url, init) => { oldId = JSON.parse(init.body as string).requestId; throw Error('Reply lost'); } });
	await assert.rejects(first.send({ action: 'folders', request: { action: 'choose' } }));
	for (const [key, raw] of input.storage.data) input.storage.setItem(key, JSON.stringify({ ...JSON.parse(raw), createdAt: Date.now() - 600_000 }));
	let posts = 0;
	const next = createRemoteSyncClient({ ...input, fetch: async (url, init) => {
		if (init.method === 'GET') { assert.equal(new URL(String(url)).searchParams.get('requestId'), oldId); return reply({ ok: false, error: 'Missing request' }, 404); }
		posts++; return reply({ ok: true, status: 'complete', result: { accepted: true } });
	} });
	await next.send({ action: 'folders', request: { action: 'remove', rootId: 'root' } }); assert.equal(posts, 1); assert.equal(input.storage.data.size, 0);
});

test('pause remains available when an earlier start reply was lost', async () => {
	const input = base(), commands: string[] = [];
	const client = createRemoteSyncClient({ ...input, fetch: async (_url, init) => {
		assert.equal(init.method, 'POST');
		const { command } = JSON.parse(init.body as string); commands.push(command.action);
		if (command.action === 'start') throw Error('Start acknowledgement lost');
		return reply({ ok: true, status: 'complete', result: { accepted: true } });
	} });
	await assert.rejects(client.send({ action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00.000Z' }));
	await client.send({ action: 'pause', connectionId: 'connection' });
	assert.deepEqual(commands, ['start', 'pause']);
});

test('incompatible server and identity changes stop dispatch or stale replies', async () => {
	let calls = 0;
	const incompatible = createRemoteSyncClient({ ...base(), requireCapability: async () => { throw Error('Incompatible'); }, fetch: async () => { calls++; return reply({}); } });
	await assert.rejects(incompatible.send({ action: 'status' }), /updated, reachable Thingtime server/); assert.equal(calls, 0);
	let current = true;
	const client = createRemoteSyncClient({ ...base(), assertCurrent() { if (!current) throw Error('Account changed'); }, fetch: async () => { current = false; return reply({ ok: true, status: 'complete', result: { roots: [] } }); } });
	await assert.rejects(client.send({ action: 'status' }), /Account changed/);
});


test('optional source locations negotiate separately while older origins retain ordinary control', async () => {
 let dispatched = false;
 const minimums: string[] = [];
 const oldOrigin = async (_feature: string, version: string) => { minimums.push(version); if (version !== '1.0.0') throw Error('unsupported'); };
 assert.equal(await negotiateRemoteSourcePaths(oldOrigin), false);
 const client = createRemoteSyncClient({ ...base(), requireCapability: oldOrigin,
  fetch: async () => { dispatched = true; return reply({ ok: true, status: 'complete', result: { roots: [] } }); } });
 assert.deepEqual(await client.send({ action: 'status' }), { roots: [] });
 assert.equal(dispatched, true);
 assert.deepEqual(minimums, ['1.1.0', '1.0.0']);
 assert.equal(await negotiateRemoteSourcePaths(async (feature, version) => {
  assert.equal(feature, 'api.devices-sync-control'); assert.equal(version, '1.1.0');
 }), true);
});
