import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSecretKey, randomBytes, randomUUID } from 'node:crypto';
import { BACKUP_FORMAT, BACKUP_CHUNK_BYTES, backupJson, type BackupHeader, type BackupItem } from '../../../backups/manifest';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { prepareBackup, captureBackup, captureBackupRangePage, sealBackup, openBackupWorkerView, type BackupObjectStore } from './portableBackup';
import { createResumableHashWorker, type HashCheckpointRef, type HashStreamBinding } from './resumableHash';

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
async function fixture(captured = true) {
	const objects = new Map<string, Uint8Array>(), reads: string[] = [], data = Buffer.alloc(BACKUP_CHUNK_BYTES + 17, 73);
	let permitted = true, afterRead: ((key: string) => void) | undefined;
	const store: BackupObjectStore = {
		async read(key, max) { reads.push(key); const data = objects.get(key); if (!data) return null; assert.ok(data.length <= max); const copy = Uint8Array.from(data); afterRead?.(key); return copy; },
		async put(key, bytes) { const old = objects.get(key); if (old) assert.deepEqual(old, bytes); else objects.set(key, Uint8Array.from(bytes)); }
	};
	const scope = { apiOrigin: 'https://worker-read.test', ownerId: 'owner', dataPlane: 'home' }, access = { scope, authorize: async () => { if (!permitted) throw Error('Access revoked'); } };
	const id = randomUUID(), header: BackupHeader = { format: BACKUP_FORMAT, snapshotId: id, scope,
		boundary: { kind: 'point-in-time', token: 'frozen', startedAt: '2026-11-06T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z' }, coverage: { selectionId: 'selected', description: 'Synthetic bounded read fixture' } };
	const fingerprint = await fingerprintSource({ size: data.length, read: async (o, n) => data.subarray(o, o + n), check: () => {} });
	const items: BackupItem[] = [{ ordinal: 0, thingId: 'a-file', revision: 'version', snapshot: { adapter: 'fixture', version: 1, value: {} }, content: { size: data.length, fingerprint } },
		...Array.from({ length: 130 }, (_, i): BackupItem => ({ ordinal: i + 1, thingId: `z-folder-${String(i).padStart(4, '0')}`, revision: 'version', snapshot: { adapter: 'fixture', version: 1, value: {} }, content: null }))];
	const plan = await prepareBackup(store, header, (async function* () { yield* items; })(), access);
	if (captured) await captureBackup(store, id, { read: async (_, o, n) => data.subarray(o, o + n) }, access);
	const seal = captured ? await sealBackup(store, id, access) : null, pins = { planHash: sha(backupJson(plan)), sealHash: seal ? sha(backupJson(seal)) : null };
	reads.length = 0;
	return { objects, reads, store, access, id, plan, data, pins, hook(fn: (key: string) => void) { afterRead = fn; }, revoke() { permitted = false; } };
}
test('bounded worker view authenticates reverse page-chain cursors without full traversal or scratch', async () => {
	const f = await fixture(), view = await openBackupWorkerView(f.store, f.id, f.access, f.pins);
	assert.equal(f.reads.filter(key => key.includes('/plan/')).length, 0);
	const last = await view.readPlanPage(f.plan.pages - 1, f.plan.headHash!);
	assert.equal(f.reads.filter(key => key.includes('/plan/')).length, 1);
	const first = await view.readPlanPage(0, last.previous!); assert.equal(first.items[0].thingId, 'a-file');
	await assert.rejects(view.readPlanPage(0, '0'.repeat(64)), /changed/);
	const item = { planPage: 0, pageHash: last.previous!, itemIndex: 0 }, ranges = await view.readRangePage(item, 0, 0);
	f.reads.length = 0; const read = await view.readChunk(item, 0, 0, ranges.pageHash, 1);
	assert.deepEqual(Buffer.from(read.bytes), f.data.subarray(BACKUP_CHUNK_BYTES));
	assert.equal(f.reads.filter(key => key.startsWith('chunks/')).length, 1);
});
test('current chunk corruption, root/seal changes and range-page changes refuse', async () => {
	for (const mode of ['chunk', 'seal', 'range']) {
		const f = await fixture(), view = await openBackupWorkerView(f.store, f.id, f.access, f.pins), last = await view.readPlanPage(1, f.plan.headHash!);
		const item = { planPage: 0, pageHash: last.previous!, itemIndex: 0 }, ranges = await view.readRangePage(item, 0, 0);
		if (mode === 'chunk') f.objects.set('chunks/' + ranges.page.ranges[0].sha256, Buffer.alloc(BACKUP_CHUNK_BYTES));
		if (mode === 'seal') { const key = `snapshots/${f.id}/complete.json`, seal = JSON.parse(Buffer.from(f.objects.get(key)!).toString()); seal.manifestHash = '0'.repeat(64); f.objects.set(key, Buffer.from(backupJson(seal))); }
		if (mode === 'range') { const key = `snapshots/${f.id}/ranges/0/0.json`, page = JSON.parse(Buffer.from(f.objects.get(key)!).toString()); page.ranges[0].sha256 = '0'.repeat(64); f.objects.set(key, Buffer.from(backupJson(page))); }
		await assert.rejects(view.readChunk(item, 0, 0, ranges.pageHash, 0));
	}
});
test('revocation during an actual retained chunk read prevents return', async () => {
	const f = await fixture(), view = await openBackupWorkerView(f.store, f.id, f.access, f.pins), last = await view.readPlanPage(1, f.plan.headHash!);
	const item = { planPage: 0, pageHash: last.previous!, itemIndex: 0 }, ranges = await view.readRangePage(item, 0, 0);
	f.hook(key => { if (key.startsWith('chunks/')) f.revoke(); });
	await assert.rejects(view.readChunk(item, 0, 0, ranges.pageHash, 0), /revoked/);
});
test('fresh bounded workers verify canonical multipart identity from actual retained bytes', async () => {
	const f = await fixture(), view = await openBackupWorkerView(f.store, f.id, f.access, f.pins), last = await view.readPlanPage(1, f.plan.headHash!);
	const item = { planPage: 0, pageHash: last.previous!, itemIndex: 0 }, ranges = await view.readRangePage(item, 0, 0), fingerprint = ranges.item.content!.fingerprint!;
	const key = createSecretKey(randomBytes(32)), heads = new Map<string, HashCheckpointRef>();
	const worker = () => createResumableHashWorker({ store: f.store, access: f.access,
		keys: { current: async () => ({ id: 'fixture', key }), get: async () => key },
		coordinator: { current: async id => heads.get(id) ?? null, accept: async (id, previous, next) => {
			if (backupJson(heads.get(id) ?? null) !== backupJson(previous)) return 'conflict'; heads.set(id, structuredClone(next)); return 'accepted';
		} } });
	const partDigests: Uint8Array[] = [];
	for (let part = 0; part < fingerprint.partCount; part++) {
		const length = Math.min(fingerprint.partSizeBytes, ranges.item.content!.size - part * fingerprint.partSizeBytes);
		const binding: HashStreamBinding = { operationId: randomUUID(), snapshotId: f.id, streamId: `file-part-${part}`, objectVersion: view.version, bytes: String(length), expectedSha256: null };
		const source = { assertIdentity: async () => { await view.readRangePage(item, 0, 0, ranges.pageHash); }, read: async () => (await view.readChunk(item, 0, 0, ranges.pageHash, part)).bytes };
		const initial = await worker().start(binding, source), complete = await worker().advance(binding, initial, randomUUID(), source);
		assert.equal(complete.complete, true); partDigests.push(Buffer.from(complete.finalDigest!, 'hex'));
	}
	const digestBytes = Buffer.concat(partDigests), binding: HashStreamBinding = { operationId: randomUUID(), snapshotId: f.id, streamId: 'file-composite', objectVersion: view.version, bytes: String(digestBytes.length), expectedSha256: fingerprint.sha256 };
	const source = { assertIdentity: async () => view.assertCurrent(), read: async (offset: bigint, length: number) => digestBytes.subarray(Number(offset), Number(offset) + length) };
	const initial = await worker().start(binding, source), first = await worker().advance(binding, initial, randomUUID(), source, 32);
	const complete = await worker().advance(binding, first, randomUUID(), source, 32);
	assert.equal(complete.finalDigest, fingerprint.sha256); assert.equal(complete.complete, true);
});
test('bounded capture continues in fresh units, reuses uncertain immutable receipts and seals canonical v1 bytes', async () => {
	const f = await fixture(false), pins = { planHash: f.pins.planHash, sealHash: null }, view = await openBackupWorkerView(f.store, f.id, f.access, pins);
	const last = await view.readPlanPage(1, f.plan.headHash!), proof = { planPage: 0, pageHash: last.previous!, itemIndex: 0 };
	let reads = 0;
	const source = { read: async (_: BackupItem, offset: number, length: number) => { reads++; assert.ok(length <= BACKUP_CHUNK_BYTES); return f.data.subarray(offset, offset + length); } };
	const first = await captureBackupRangePage(f.store, f.id, f.access, pins, proof, { ordinal: 0, offset: 0 }, source);
	assert.equal(first.done, false); assert.equal(first.nextOffset, BACKUP_CHUNK_BYTES); assert.equal(reads, 1);
	const replay = await captureBackupRangePage(f.store, f.id, f.access, pins, proof, { ordinal: 0, offset: 0 }, { read: async () => { throw Error('Source no longer available'); } });
	assert.equal(replay.reusedBytes, String(BACKUP_CHUNK_BYTES)); assert.equal(replay.pageHash, first.pageHash);
	const second = await captureBackupRangePage(f.store, f.id, f.access, pins, proof, { ordinal: first.nextOrdinal, offset: first.nextOffset }, source);
	assert.equal(second.done, true); assert.equal(second.copiedBytes, '17'); assert.equal(reads, 2);
	const seal = await sealBackup(f.store, f.id, f.access); assert.equal(seal.bytes, String(f.data.length)); assert.equal(seal.chunks, '2');
});
