import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSyncClient, negotiateRemoteSourcePaths } from './remoteSyncClient.client';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

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

test('queue-only enrollment negotiates the remote server contract before dispatch', async () => {
	const input = base();
	const command = { action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00.000Z', intervalMs: 300_000, queueOnly: true } as const;
	let dispatched = false;
	const client = createRemoteSyncClient({ ...input, requireCapability: async (feature, minimum) => {
		assert.equal(feature, 'api.devices-sync-control'); assert.equal(minimum, '1.5.0'); throw Error('Older server');
	}, fetch: async () => { dispatched = true; throw Error('Unexpected dispatch'); } });
	await assert.rejects(client.send(command), /updated, reachable Thingtime server/);
	assert.equal(dispatched, false);
	assert.equal(input.storage.data.size, 0);
});

test('saved-intent recovery requires compatible 1.6 control on the selected origin before dispatch', async () => {
 const command = { action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00.000Z', intervalMs: 300_000, recoverSavedIntent: true } as const;
 for (const offered of [undefined, '1.5.0', '2.0.0']) {
  const input = base(); let dispatched = 0;
  const client = createRemoteSyncClient({ ...input, requireCapability: async (feature, minimum) => {
   assert.equal(feature, 'api.devices-sync-control'); assert.equal(minimum, '1.6.0');
   if (!offered || !capabilitySatisfies(offered, minimum)) throw Error('Incompatible selected origin');
  }, fetch: async () => { dispatched++; throw Error('Unexpected dispatch'); } });
  await assert.rejects(client.send(command), /updated, reachable Thingtime server/);
  assert.equal(dispatched, 0); assert.equal(input.storage.data.size, 0);
 }
 const input = base(); let dispatched = 0;
 const client = createRemoteSyncClient({ ...input, requireCapability: async (feature, minimum) => {
  assert.equal(feature, 'api.devices-sync-control'); assert.equal(minimum, '1.6.0');
 }, fetch: async (url, init) => {
  assert.equal(String(url), `${input.origin}/api/v1/devices/sync-control`);
  assert.deepEqual(JSON.parse(init.body as string).command, command);
  dispatched++; return reply({ ok: true, status: 'complete', result: { accepted: true } });
 } });
 assert.deepEqual(await client.send(command), { accepted: true }); assert.equal(dispatched, 1);
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

test('resource saves require control 1.2 and recover the exact accepted command without replay', async () => {
 const input = base(), policy = { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 }; let posts = 0;
 const old = createRemoteSyncClient({ ...input, requireCapability: async (_feature, minimum) => { assert.equal(minimum, '1.2.0'); throw Error('old'); }, fetch: async () => { posts++; return reply({}); } });
 await assert.rejects(old.send({ action: 'resources', operation: 'save', deviceResourceLimits: policy })); assert.equal(posts, 0);
 const client = createRemoteSyncClient({ ...input, requireCapability: async (_feature, minimum) => { assert.equal(minimum, '1.2.0'); }, fetch: async (_url, init) => {
  if (init.method === 'POST') { posts++; throw Error('Lost accepted policy save'); }
  return reply({ ok: true, status: 'complete', result: { deviceResourceLimits: policy } });
 } });
 const command = { action: 'resources' as const, operation: 'save' as const, deviceResourceLimits: policy };
 await assert.rejects(client.send(command));
 assert.deepEqual(await client.send(command), { deviceResourceLimits: policy }); assert.equal(posts, 1); assert.equal(input.storage.data.size, 0);
});

test('history negotiates 1.4.0 before dispatch and cannot borrow a client for another device', async () => {
 const input = base();
 const range = { from: 1000, to: 5000, bucketCount: 2 };
 let posts = 0;
 const client = createRemoteSyncClient({ ...input, requireCapability: async (feature, minimum) => {
  assert.equal(feature, 'api.devices-sync-control'); assert.equal(minimum, '1.4.0'); throw Error('Older server');
 }, fetch: async () => { posts++; return reply({}); } });
 await assert.rejects(client.send({ action: 'history', range }), /updated, reachable/);
 assert.equal(posts, 0);
 client.assertHistoryScope({ origin: input.origin, ownerId: input.ownerId, deviceId: input.deviceId, dataPlane: 'home' });
 assert.throws(() => client.assertHistoryScope({ origin: input.origin, ownerId: input.ownerId, deviceId: 'other', dataPlane: 'home' }), /device changed/);
});

test('remote config activity negotiates 1.5.0 before sending and validates config-bound receipts', async () => {
 const { readRemoteSyncActivity } = await import('./remoteSyncClient.client');
 const input = base();
 let dispatches = 0;
 const older = createRemoteSyncClient({ ...input, requireCapability: async (_feature, minimum) => {
  assert.equal(minimum, '1.5.0'); throw Error('Old server');
 }, fetch: async () => { dispatches++; return reply({}); } });
 await assert.rejects(readRemoteSyncActivity(older, 'config'), /updated, reachable/);
 assert.equal(dispatches, 0);
 const record = { id: 'attempt', startedAt: 50, endedAt: 75, lastActivityAt: 75, status: 'complete', sentBytes: 0, receivedBytes: null };
 let connectionId = 'config';
 const client = createRemoteSyncClient({ ...input, requireCapability: async (_feature, minimum) => { assert.equal(minimum, '1.5.0'); },
  fetch: async (_url, init) => {
   dispatches++;
   assert.deepEqual(JSON.parse(init!.body as string).command, { action: 'connection-activity', connectionId: 'config', limit: 1 });
   return reply({ ok: true, status: 'complete', result: { connectionId, records: [record], next: null } });
  } });
 assert.deepEqual(await readRemoteSyncActivity(client, 'config', { limit: 1 }), { connectionId, records: [record], next: null });
 assert.equal(input.storage.data.size, 0, 'history is read-only and has no pending mutation receipt');
 connectionId = 'other';
 await assert.rejects(readRemoteSyncActivity(client, 'config', { limit: 1 }), /Invalid sync activity/);
 assert.equal(dispatches, 2);
});
