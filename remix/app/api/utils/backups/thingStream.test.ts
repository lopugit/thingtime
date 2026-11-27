import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKUP_FORMAT, BACKUP_CHUNK_BYTES, type BackupItem, type BackupHeader } from '../../../backups/manifest';
import { openLocalBackupStore } from './localBackupStore';
import { prepareBackup, retainBackupPayload, sealBackup, copySealedBackup, openSealedBackup, type BackupObjectStore } from './portableBackup';
import { backupThingJson, parseBackupThingSnapshot, retainBackupThingSnapshot, openBackupThingSnapshot, readBackupThingStream } from './thingSnapshots';
import { readAccountRestoreRecord } from './accountRestoreRecord';
import { prepareAccountRestorePlan } from './accountRestorePlan';
import { thingContentSnapshot } from '../timeline/recordMutation';

const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
const header = (snapshotId: string): BackupHeader => ({ format: BACKUP_FORMAT, snapshotId, scope,
	boundary: { kind: 'point-in-time' as const, token: 'pinned-fixture', startedAt: '2026-11-06T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z' },
	coverage: { selectionId: 'ordinary-fixture', description: 'Explicit ordinary fixture only' } });
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-thing-stream-'));
	const first = await openLocalBackupStore(join(directory, 'first')), second = await openLocalBackupStore(join(directory, 'second'));
	return { directory, first, second, id: randomUUID(), clean: () => rm(directory, { recursive: true, force: true }) };
}
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function firstEntry(store: BackupObjectStore, id: string) {
	const next = await (await openSealedBackup(store, id, access)).entries.next();
	const value = next.value; if (!value) throw Error('Missing fixture entry'); return value;
}


test('v1 fixed bytes/hash and retained reader remain unchanged beside v2', async () => {
	const legacy = '{"adapter":"thing-content","value":{"acl":["tt:user"],"crystal":{"a":1,"z":"✨"},"extended":null,"folderId":null,"geo":null,"tags":[],"targetId":null,"thingtime":["data"]},"version":1}';
	const snapshot = JSON.parse(legacy);
	assert.equal(backupThingJson(snapshot), legacy);
	assert.equal(sha(legacy), '44cef0f41999fe60dccb6a57d42b92d529d164342a9a32fe1cde95fe42edc2e9');
	assert.deepEqual(parseBackupThingSnapshot(snapshot), snapshot);
	const f = await fixture();
	try {
		async function* items() { yield await retainBackupPayload(f.first, f.id,
			{ ordinal: 0, thingId: 'legacy', revision: 'old-head', snapshot: { adapter: 'backup-thing-content', version: 1, value: { sha256: sha(legacy) } } }, Buffer.from(legacy), access); }
		await prepareBackup(f.first, header(f.id), items(), access); await sealBackup(f.first, f.id, access);
		assert.deepEqual(await openBackupThingSnapshot(f.first, f.id, 'legacy', access), snapshot);
		const entry = await firstEntry(f.first, f.id);
		assert.deepEqual((await readAccountRestoreRecord(entry.item, entry.ranges, scope.ownerId))!.value, snapshot.value);
	} finally { await f.clean(); }
});

test('v2 wide/deep content survives independent copy, source loss and account restore scan without v1 limits', async () => {
	const f = await fixture();
	let deep: any = { leaf: 'saved' }; for (let i = 0; i < 150; i++) deep = { child: deep };
	let doc: any = { shareId: 'ordinary', ownerId: scope.ownerId, thingtime: ['data'], timelineHeadId: 'exact-source-head',
		crystal: { deep, values: Array.from({ length: 150_001 }, (_, i) => i), localGraph: '[{"self":"0"}]', inert: { ttype: 'function', source: 'doNotExecute()' } } };
	try {
		async function* items() { yield await retainBackupThingSnapshot(f.first, f.id, 0, doc, access); }
		await prepareBackup(f.first, header(f.id), items(), access); await sealBackup(f.first, f.id, access);
		await copySealedBackup(f.first, f.second, f.id, access);
		doc = null; await rm(join(f.directory, 'first'), { recursive: true });
		const snapshot = await openBackupThingSnapshot(f.second, f.id, 'ordinary', access), value = snapshot.value as any;
		assert.equal(value.crystal.values.length, 150_001); assert.equal(value.crystal.values[150_000], 150_000);
		assert.equal(value.crystal.localGraph, '[{"self":"0"}]'); assert.deepEqual(value.crystal.inert, { ttype: 'function', source: 'doNotExecute()' });
		let leaf = value.crystal.deep; for (let i = 0; i < 150; i++) leaf = leaf.child; assert.deepEqual(leaf, { leaf: 'saved' });
		const entry = await firstEntry(f.second, f.id);
		assert.equal(entry.item.snapshot.version, 2); assert.equal(entry.item.revision, 'exact-source-head');
		assert.deepEqual((await readAccountRestoreRecord(entry.item, entry.ranges, scope.ownerId))!.value, value);
		const again = await firstEntry(f.second, f.id), controller = new AbortController();
		const interrupt = (async function* () {
			for await (const range of again.ranges) yield { read: async () => {
				const bytes = await range.read(); setImmediate(() => controller.abort(Error('rehash-cancelled'))); return bytes;
			} };
		})();
		await assert.rejects(readAccountRestoreRecord(again.item, interrupt, scope.ownerId, () => controller.signal.throwIfAborted()), /rehash-cancelled/);
		const plans = await openLocalBackupStore(join(f.directory, 'plans'));
		const plan = await prepareAccountRestorePlan(f.second, plans, f.id, randomUUID(), { scope: { ...scope, ownerId: 'destination' }, rootId: 'root', rootRevision: 'root-head', capabilities: {} }, access);
		assert.deepEqual(plan.coverage.sourceFormatLimitations, []); assert.equal(plan.coverage.wholeAccountReady, false);
		for (const version of [0, 3, 99]) {
			await assert.rejects(readBackupThingStream({ ...entry.item, snapshot: { ...entry.item.snapshot, version } }, (async function* () {})()), /descriptor/);
		}
		await assert.rejects(readBackupThingStream({ ...entry.item, snapshot: { ...entry.item.snapshot, value: { codec: 'unknown', sha256: '0'.repeat(64) } } }, (async function* () {})()), /descriptor/);
	} finally { await f.clean(); }
});

test('v2 kind metadata does not inherit unversioned backup-only count or character ceilings', async () => {
	const f = await fixture();
	// The canonical source writer resolves its schema registry; this adapter
	// preserves already-approved stored kind metadata rather than inventing a
	// second registry or limiting a later compatible source's identifiers.
	const kinds = Array.from({ length: 65 }, (_, n) => 'schema-' + n + '-'.repeat(201));
	try {
		async function* items() { yield await retainBackupThingSnapshot(f.first, f.id, 0, { shareId: 'kinds', ownerId: scope.ownerId, thingtime: kinds, crystal: {} }, access); }
		await prepareBackup(f.first, header(f.id), items(), access); await sealBackup(f.first, f.id, access);
		assert.deepEqual(((await openBackupThingSnapshot(f.first, f.id, 'kinds', access)).value as any).thingtime, kinds);
	} finally { await f.clean(); }
});

test('small records beyond manifest depth use retained v2 instead of widening the old metadata decoder', async () => {
	for (const depth of [70, 150]) {
		const f = await fixture();
		let crystal: any = { text: 'saved' }; for (let n = 0; n < depth; n++) crystal = { child: crystal };
		try {
			let item!: BackupItem;
			async function* items() { item = await retainBackupThingSnapshot(f.first, f.id, 0, { shareId: 'deep', ownerId: scope.ownerId, thingtime: ['data'], crystal }, access); yield item; }
			await prepareBackup(f.first, header(f.id), items(), access); await sealBackup(f.first, f.id, access);
			assert.equal(item.snapshot.version, 2);
			let value = (await openBackupThingSnapshot(f.first, f.id, 'deep', access)).value as any;
			value = value.crystal; for (let n = 0; n < depth; n++) value = value.child;
			assert.deepEqual(value, { text: 'saved' });
		} finally { await f.clean(); }
	}
});

test('scalar beyond 128MiB uses bounded chunks and multiple range pages, with no whole-record byte buffer', { timeout: 90000 }, async () => {
	const f = await fixture(), length = 128 * 1024 * 1024 + 17;
	const doc: any = { shareId: 'scalar', ownerId: scope.ownerId, thingtime: ['data'], crystal: { value: 'x'.repeat(length) } };
	let largest = 0, item!: BackupItem;
	const store: BackupObjectStore = { read: f.first.read, put: async (key, bytes) => { largest = Math.max(largest, bytes.length); await f.first.put(key, bytes); } };
	try {
		async function* items() { item = await retainBackupThingSnapshot(store, f.id, 0, doc, access); yield item; }
		await prepareBackup(store, header(f.id), items(), access); await sealBackup(store, f.id, access);
		assert.equal(item.snapshot.version, 2); assert(item.content!.size > 128 * 1024 * 1024);
		assert.equal(largest, BACKUP_CHUNK_BYTES);
		assert(await store.read(`snapshots/${f.id}/ranges/0/2.json`, 131072));
		doc.crystal = null;
		const value = (await openBackupThingSnapshot(store, f.id, 'scalar', access)).value as any;
		assert.equal(value.crystal.value.length, length); assert.equal(value.crystal.value.slice(-17), 'x'.repeat(17));
	} finally { await f.clean(); }
});

test('lost chunk acknowledgement resumes the same pinned record and cancellation cannot publish an item', async () => {
	const f = await fixture();
	const doc = { shareId: 'ordinary', ownerId: scope.ownerId, thingtime: ['data'], crystal: { value: 'x'.repeat(9 * 1024 * 1024) } };
	let lost = false, resumed = false;
	const store: BackupObjectStore = { read: f.first.read, put: async (key, bytes) => {
		await f.first.put(key, bytes);
		if (!lost && key.startsWith('chunks/')) { lost = true; throw Error('lost acknowledgement'); }
	} };
	try {
		async function* items() {
			await assert.rejects(retainBackupThingSnapshot(store, f.id, 0, doc, access), /lost acknowledgement/);
			assert.equal(await store.read(`snapshots/${f.id}/plan.json`, 131072), null);
			const item = await retainBackupThingSnapshot(store, f.id, 0, doc, access); resumed = true; yield item;
		}
		await prepareBackup(store, header(f.id), items(), access); assert(resumed); await sealBackup(store, f.id, access);
		const controller = new AbortController(); controller.abort();
		await assert.rejects(retainBackupThingSnapshot(f.first, randomUUID(), 0, doc, { ...access, signal: controller.signal }));
	} finally { await f.clean(); }
});

test('canonical bytes, SHA and multipart identity all remain mandatory for v2 decoding', async () => {
	const f = await fixture();
	const snapshot = thingContentSnapshot({ thingtime: ['data'], crystal: { a: 1, z: 2 } })!;
	const canonical = backupThingJson(snapshot);
	// A valid digest of valid JSON is insufficient when its ordering changed.
	const unsorted = canonical.replace('"a":1,"z":2', '"z":2,"a":1');
	try {
		async function* items() { yield await retainBackupPayload(f.first, f.id,
			{ ordinal: 0, thingId: 'ordinary', revision: 'source-head', snapshot: { adapter: 'backup-thing-content', version: 2, value: { codec: 'canonical-json-utf8-v1', sha256: sha(unsorted) } } }, Buffer.from(unsorted), access); }
		await prepareBackup(f.first, header(f.id), items(), access); await sealBackup(f.first, f.id, access);
		await assert.rejects(openBackupThingSnapshot(f.first, f.id, 'ordinary', access), /canonical/);
		const entry = await firstEntry(f.first, f.id);
		const bytes = Buffer.from(unsorted);
		await assert.rejects(readBackupThingStream({ ...entry.item, snapshot: { ...entry.item.snapshot, value: { codec: 'canonical-json-utf8-v1', sha256: '0'.repeat(64) } } }, (async function* () { yield bytes; })()), /digest/);
		await assert.rejects(readBackupThingStream(entry.item, (async function* () { yield bytes.subarray(0, bytes.length - 1); })()));
	} finally { await f.clean(); }
});

test('revocation during streaming retention prevents plan publication and retains no successful item', async () => {
	const f = await fixture(), controller = new AbortController();
	const doc = { shareId: 'ordinary', ownerId: scope.ownerId, thingtime: ['data'], crystal: { value: 'x'.repeat(9 * 1024 * 1024) } };
	const current = { ...access, signal: controller.signal };
	const store: BackupObjectStore = { read: f.first.read, put: async (key, bytes) => { await f.first.put(key, bytes); if (key.startsWith('chunks/')) controller.abort(); } };
	try {
		async function* items() { yield await retainBackupThingSnapshot(store, f.id, 0, doc, current); }
		await assert.rejects(prepareBackup(store, header(f.id), items(), current));
		assert.equal(await store.read(`snapshots/${f.id}/plan.json`, 131072), null);
		assert.equal(await store.read(`snapshots/${f.id}/complete.json`, 131072), null);
	} finally { await f.clean(); }
});
