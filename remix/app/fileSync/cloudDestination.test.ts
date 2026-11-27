import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSyncCloudDestination, syncCloudDestinationSegments, type SyncCloudDestinationCreate, type SyncCloudDestinationTransport } from './cloudDestination';

const scope = { origin: 'https://thingtime.com', ownerId: 'owner', dataPlane: 'home', deviceId: 'device' };
const fresh = () => ({ baseUpdatedAt: null, remoteFolderId: '', source: { name: 'Music library', sourcePath: '/Volumes/Drive/Music library' } } as const);
function fixture() {
	const rows = new Map<string, any>(), writes: SyncCloudDestinationCreate[] = [];
	let active = true, lost = false;
	const api: SyncCloudDestinationTransport = {
		assertCurrent() { if (!active) throw Error('identity changed'); },
		async negotiate(requirements) { assert.equal(requirements['api.things'], '1.33.1'); },
		async get(id) { if (!rows.has(id)) throw Object.assign(Error('missing'), { status: 404 }); return rows.get(id); },
		async create(input) {
			writes.push(input);
			if (rows.has(input.shareId)) throw Object.assign(Error('conflict'), { status: 409 });
			rows.set(input.shareId, { id: input.shareId, author: { id: scope.ownerId }, ...input });
			if (lost) throw Error('lost reply');
		}
	};
	return { api, rows, writes, cancel: () => { active = false; }, lose: () => { lost = true; } };
}

test('source hierarchy uses actual selected metadata without hardcoded names or parent filesystem access', () => {
	assert.deepEqual(syncCloudDestinationSegments(fresh().source), ['Volumes', 'Drive', 'Music library']);
	assert.deepEqual(syncCloudDestinationSegments({ name: 'Selected folder' }), ['Selected folder']);
	assert.deepEqual(syncCloudDestinationSegments({ name: 'System volume', sourcePath: '/' }), ['System volume']);
	assert.deepEqual(syncCloudDestinationSegments({ name: 'Music\\library', sourcePath: '/Volumes/Music\\library' }), ['Volumes', 'Music\\library']);
	for (const sourcePath of ['/Volumes//Music library', '/Volumes/../Music library', 'Music library', '/Volumes/Music library/', '/Volumes/Other', '/Volumes/\u0000/Music library'])
		assert.throws(() => syncCloudDestinationSegments({ name: 'Music library', sourcePath }));
});

test('creates actual private parent relationships and retries the same leaf without new writes', async () => {
	const f = fixture();
	const leaf = await prepareSyncCloudDestination(fresh(), scope, f.api);
	assert.equal(f.writes.length, 3);
	assert.deepEqual(f.writes.map(row => [row.crystal.name, row.folderId]), [
		['Volumes', null], ['Drive', f.writes[0].shareId], ['Music library', f.writes[1].shareId]
	]);
	assert.ok(f.writes.every(row => JSON.stringify(row.acl) === '["tt:user"]'));
	assert.equal(leaf.id, f.writes[2].shareId);
	assert.deepEqual(await prepareSyncCloudDestination(fresh(), scope, f.api), leaf);
	assert.equal(f.writes.length, 3);
});

test('lost create responses and concurrent preparations recover through exact readback', async () => {
	const f = fixture(); f.lose();
	const results = await Promise.all([prepareSyncCloudDestination(fresh(), scope, f.api), prepareSyncCloudDestination(fresh(), scope, f.api)]);
	assert.equal(results[0].id, results[1].id);
	assert.equal(f.rows.size, 3);
});

test('different device, origin, owner or data plane never silently coalesces matching paths', async () => {
	const original = await prepareSyncCloudDestination(fresh(), scope, fixture().api);
	for (const change of [{ deviceId: 'second-device' }, { origin: 'https://preview.example' }, { ownerId: 'other-owner' }, { dataPlane: 'other-plane' }]) {
		const f = fixture();
		if (change.ownerId) f.api.get = async id => {
			const row = f.rows.get(id);
			if (!row) throw Object.assign(Error('missing'), { status: 404 });
			return { ...row, author: { id: change.ownerId } };
		};
		const other = await prepareSyncCloudDestination(fresh(), { ...scope, ...change }, f.api);
		assert.notEqual(original.id, other.id);
	}
});

test('existing configurations and explicit destinations are never retargeted', async () => {
	for (const request of [{ ...fresh(), baseUpdatedAt: '2026-10-26T00:00:00Z' }, { ...fresh(), remoteFolderId: 'chosen' }]) {
		const f = fixture();
		await assert.rejects(prepareSyncCloudDestination(request as any, scope, f.api), /preserved/);
		assert.equal(f.writes.length, 0);
	}
});

test('foreign, shared, renamed, moved or wrong-identity folder reuse fails closed', async () => {
	for (const patch of [{ author: { id: 'other' } }, { acl: ['tt:user', 'public'] }, { crystal: { name: 'Renamed' } }, { folderId: 'moved' }, { id: 'different' }, { targetId: 'target' }, { appId: 'app' }, { thingtime: ['folder', 'data'] }]) {
		const f = fixture();
		await prepareSyncCloudDestination(fresh(), scope, f.api);
		Object.assign(f.rows.get(f.writes[0].shareId), patch);
		await assert.rejects(prepareSyncCloudDestination(fresh(), scope, f.api));
		assert.equal(f.writes.length, 3);
	}
});

test('unavailable reads and cancellation prevent dependent creation', async () => {
	const f = fixture();
	f.api.get = async () => { throw Object.assign(Error('offline'), { status: 503 }); };
	await assert.rejects(prepareSyncCloudDestination(fresh(), scope, f.api), /offline/);
	assert.equal(f.writes.length, 0);
	const cancelled = fixture();
	cancelled.api.create = async input => { cancelled.writes.push(input); cancelled.cancel(); };
	await assert.rejects(prepareSyncCloudDestination(fresh(), scope, cancelled.api), /identity changed/);
	assert.equal(cancelled.writes.length, 1);
});

test('unconfirmed creation retries a stable identity without deleting partial hierarchy', async () => {
	const f = fixture();
	f.api.create = async input => { f.writes.push(input); throw Error('timeout'); };
	await assert.rejects(prepareSyncCloudDestination(fresh(), scope, f.api), /timeout/);
	await assert.rejects(prepareSyncCloudDestination(fresh(), scope, f.api), /timeout/);
	assert.equal(f.writes[0].shareId, f.writes[1].shareId);
});
