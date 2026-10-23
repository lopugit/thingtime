import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { newFileSyncConfiguration } from './configuration';

const scope = { ownerId: 'owner', deviceId: 'device', origin: 'https://sync.test', dataPlane: 'home', rootId: 'connection' };
let snapshot: any = null, paused: any = null, started: any = null, nativeAbort: AbortController | undefined;
const host: any = { origin: () => scope.origin, assertCurrent() {}, authorizeDevice: async () => {}, requireCapability: async () => {},
	capabilities: { platform: 'macos', fileAccessVersion: '1.16.0' }, request: async () => ({ roots: [{ id: 'local', name: 'Documents' }] }) };
const configuration = { ...newFileSyncConfiguration({ name: 'Documents', deviceId: 'device', localRootId: 'local', remoteFolderId: 'cloud' }), paused: false };
const saved = { id: 'connection', updatedAt: '2026-10-23T00:00:00.000Z', crystal: configuration, author: { id: 'owner' }, acl: ['tt:user'], thingtime: ['file-sync'] };
host.fetch = async () => Response.json({ thing: saved });
const adapter: any = { platform: 'macos', bridge: { nodeGetStatus: async () => ({ pairingStatus: 'paired', deviceIds: ['device'] }) } };
await (mock as any).module(new URL('./nativeSyncTasks.client.ts', import.meta.url).href, { namedExports: {
	nativeSyncTasks: { read: () => snapshot },
	startNativeSyncTask: (value: any, binding: any, _generation: number, _resume: any, interval: any) => {
		started = { value, binding, interval }; snapshot = { scope: binding, active: true, progress: { stage: 'checking', confirmed: 0, total: 0 } };
		return new Promise(() => {});
	},
	pauseNativeSyncJob: async (binding: any) => { paused = binding; nativeAbort?.abort(); snapshot = null; }
} });
await (mock as any).module(new URL('./nativeSyncHost.client.ts', import.meta.url).href, { namedExports: {
	getNativeSyncAdapter: () => adapter, isNativeSyncAdapterCurrent: () => true, createNativeSyncHost: async () => host
} });
await (mock as any).module(new URL('./desktopSyncWindow.client.ts', import.meta.url).href, { namedExports: { holdDesktopSyncWindow: async () => async () => {} } });
await (mock as any).module(new URL('./journal.client.ts', import.meta.url).href, { namedExports: {
	openSyncJournal: async () => ({ close() {}, jobs: () => ({ list: async () => ({ jobs: [], next: null }) }) })
} });
const { executeRemoteSyncCommand, startRemoteSyncWorker } = await import('./remoteSyncWorker.client');
const context: any = { ...scope, host, generation: 0, signal: new AbortController().signal, check() {}, scope: (rootId: string) => ({ ...scope, rootId }) };
const session: any = { host, roots: [{ id: 'local', name: 'Documents' }], rootsReady: true };

test('remote start returns before the device transfer finishes and checks saved revision', async () => {
	snapshot = null; started = null;
	await assert.rejects(executeRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-22T00:00:00Z' }, context, session), /connection changed/);
	assert.equal(started, null);
	const result = await executeRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: saved.updatedAt, intervalMs: 300000 }, context, session);
	assert.deepEqual(result, { accepted: true });
	assert.deepEqual(started.binding, scope);
	assert.equal(started.interval, 300000);
	assert.equal(snapshot.active, true);
});

test('recovery cannot borrow another device scope', async () => {
	snapshot = null;
	await assert.rejects(executeRemoteSyncCommand({ action: 'folders', request: { action: 'trash-inspect', rootId: 'local',
		trash: { scope: { ...scope, deviceId: 'foreign' } } as any } }, context, session), /different account or device/);
});

test('status pages retain every approved folder without a browser-only root limit', async () => {
	snapshot = null;
	const roots = Array.from({ length: 97 }, (_, index) => ({ id: `root-${String(index).padStart(3, '0')}`, name: `Folder ${index}` }));
	const all: string[] = [];
	let cursor: string | undefined;
	do {
		const page: any = await executeRemoteSyncCommand({ action: 'status', ...(cursor ? { cursor } : {}) }, context, { ...session, roots });
		assert.ok(page.roots.length <= 32);
		all.push(...page.roots.map((root: any) => root.id));
		cursor = page.nextCursor;
	} while (cursor);
	assert.deepEqual(all, roots.map(root => root.id));
});

test('a conflict finish cannot approve choices changed since the browser displayed them', async () => {
	let finished = false;
	const controller = { getSnapshot: () => ({ page: { progress: { revision: 8 } } }), finish: async () => { finished = true; } };
	snapshot = { scope, active: true, progress: { stage: 'reviewing', confirmed: 0, total: 1 }, pagedReview: controller };
	const status: any = await executeRemoteSyncCommand({ action: 'status' }, context, session);
	await assert.rejects(executeRemoteSyncCommand({ action: 'review', connectionId: 'connection', reviewId: status.task.review.id,
		operation: 'finish', resolution: 'resolve', revision: 7 }, context, session), /choices changed/);
	assert.equal(finished, false);
});

test('remote Pause acknowledges through an independent transport after aborting its borrowed native host', async () => {
	nativeAbort = new AbortController(); paused = null;
	const activeHost = { ...host, assertCurrent: () => nativeAbort!.signal.throwIfAborted(),
		fetch: async () => { nativeAbort!.signal.throwIfAborted(); throw Error('A borrowed task transport must not carry mailbox requests.'); } };
	snapshot = { scope, active: true, host: activeHost, progress: { stage: 'transferring', confirmed: 0, total: 1 } };
	const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const completed: any[] = [];
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin }, fetch: async (_url: unknown, init: any) => {
		const body = JSON.parse(init.body);
		if (body.action === 'poll') return Response.json({ ok: true, command: { id: 'request', leaseId: 'lease', expiresAt: new Date(Date.now() + 10000).toISOString(), command: { action: 'pause', connectionId: 'connection' } } });
		completed.push(body); return Response.json({ ok: true, status: 'complete' });
	} } });
	const abort = new AbortController(), stop = startRemoteSyncWorker('owner', 0, abort.signal);
	try {
		const deadline = Date.now() + 2000;
		while (!completed.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
		assert.deepEqual(paused, scope);
		assert.equal(nativeAbort.signal.aborted, true);
		assert.deepEqual(completed[0]?.result, { accepted: true });
		assert.equal(completed[0]?.leaseId, 'lease');
	} finally { abort.abort(); stop(); if (original) Object.defineProperty(globalThis, 'window', original); else delete (globalThis as any).window; nativeAbort = undefined; }
});
