import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_FORMAT, backupJson, type BackupHeader, type BackupItem } from '../../../backups/manifest';
import { parseTimelineEvent } from '../../../timeline/contract';
import { splitTimelineEvent, joinTimelineEvent } from '../../../timeline/records';
import { backupTimelineIdentity, timelineBackupJson, parseBackupTimelineRecord, type BackupTimelineRecord } from './timelineRecords';
import { prepareBackup, retainBackupPayload, sealBackup, openIndexedSealedBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';

const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
async function fixture() {
	const objects = new Map<string, Uint8Array>(), reads: string[] = [];
	const store: BackupObjectStore = {
		async read(key, max) { reads.push(key); const bytes = objects.get(key); if (!bytes) return null; if (bytes.length > max) throw Error('Read exceeds bound'); return Uint8Array.from(bytes); },
		async put(key, bytes) { const old = objects.get(key); if (old && !Buffer.from(old).equals(bytes)) throw Error('Immutable object changed'); objects.set(key, Uint8Array.from(bytes)); }
	};
	const header: BackupHeader = { format: BACKUP_FORMAT, snapshotId: randomUUID(), scope,
		boundary: { kind: 'point-in-time', token: 'frozen', startedAt: '2026-11-06T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z' },
		coverage: { selectionId: 'test', description: 'Isolated normalized-history fixture' } };
	const access: BackupAccess = { scope: { ...scope }, authorize: async () => {} };
	const event = parseTimelineEvent({ formatVersion: 1, id: 'event-child', ownerId: scope.ownerId, thingId: 'file-id', branchId: 'archive', parentIds: ['event-parent'], dependencies: [],
		operationId: 'operation', actorId: scope.ownerId, source: 'api', clientId: null, occurredAt: '2026-11-06T00:00:00.000Z', mode: 'revision', operation: 'update', label: 'Updated file',
		before: { adapter: 'file-content', version: 1, value: { name: 'before' } }, after: { adapter: 'file-content', version: 1, value: { name: 'after' } } });
	const normalized = splitTimelineEvent(event);
	const records: BackupTimelineRecord[] = [
		{ kind: 'timeline-event', value: { event: normalized.event, receipt: { formatVersion: 1, eventId: event.id, ownerId: scope.ownerId, position: 1, acceptedAt: event.occurredAt } } },
		...normalized.links.map(value => ({ kind: 'timeline-link' as const, value }))
	];
	records.sort((a, b) => backupTimelineIdentity(a).thingId.localeCompare(backupTimelineIdentity(b).thingId, 'en'));
	// Retained payloads precede the sealed inventory, as in account capture.
	await store.put(`snapshots/${header.snapshotId}/header.json`, Buffer.from(backupJson(header)));
	const items: BackupItem[] = [];
	for (const record of records) {
		const bytes = Buffer.from(timelineBackupJson(record)), digest = sha(bytes);
		items.push(await retainBackupPayload(store, header.snapshotId, { ordinal: items.length, thingId: backupTimelineIdentity(record).thingId, revision: 'snapshot-' + digest,
			snapshot: { adapter: 'backup-timeline-record', version: 1, value: { kind: record.kind, sha256: digest } } }, bytes, access));
	}
	await prepareBackup(store, header, (async function* () { yield* items; })(), access);
	await sealBackup(store, header.snapshotId, access); reads.length = 0;
	return { store, objects, reads, header, access, items, event, normalized };
}

async function bytes(reader: Awaited<ReturnType<typeof openIndexedSealedBackup>>, id: string) {
	const result = await reader.get(id), chunks: Uint8Array[] = [];
	for await (const chunk of result.ranges) chunks.push(chunk);
	return { item: result.item, bytes: Buffer.concat(chunks) };
}

test('indexed sealed reader traverses once and retains current normalized history with independent repeatable reads', async () => {
	const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'backup-index-test-'));
	const reader = await openIndexedSealedBackup(f.store, f.header.snapshotId, f.access, { temporaryDirectory: directory });
	try {
		assert.equal(f.reads.filter(key => key.includes('/plan/')).length, 1);
		assert.equal(f.reads.filter(key => key.includes('/ranges/')).length, f.items.length);
		const metadataReads = f.reads.length;
		const decoded: BackupTimelineRecord[] = [];
		for (const item of f.items) decoded.push(parseBackupTimelineRecord(JSON.parse((await bytes(reader, item.thingId)).bytes.toString())));
		const archived = decoded.find(record => record.kind === 'timeline-event')!.value as any;
		assert.equal(archived.event.parentCount, 1); assert.equal(archived.event.parentIds, undefined);
		assert.deepEqual(joinTimelineEvent(archived.event, decoded.filter(record => record.kind === 'timeline-link').map(record => record.value as any)), f.event);
		const first = await reader.get(f.items[0].thingId);
		(first.item.snapshot.value as any).sha256 = '0'.repeat(64);
		assert.deepEqual((await bytes(reader, f.items[0].thingId)).item, f.items[0]);
		const listed = []; for await (const item of reader.items()) listed.push(item);
		assert.deepEqual(listed, f.items);
		assert(f.reads.slice(metadataReads).every(key => key.startsWith('chunks/')), 'lookups must not rescan source metadata');
		await assert.rejects(reader.get('missing'), /not found/);
	} finally { await reader.close(); await reader.close(); }
	assert.deepEqual(await readdir(directory), []);
	await assert.rejects(reader.get(f.items[0].thingId), /closed/);
	await rm(directory, { recursive: true });
});

test('indexed byte access rejects changed, missing and truncated chunks against pinned identities', async () => {
	for (const change of ['corrupt', 'missing', 'truncate'] as const) {
		const f = await fixture(), reader = await openIndexedSealedBackup(f.store, f.header.snapshotId, f.access);
		try {
			const key = [...f.objects.keys()].find(key => key.startsWith('chunks/'))!, original = f.objects.get(key)!;
			if (change === 'missing') f.objects.delete(key);
			else if (change === 'truncate') f.objects.set(key, original.subarray(0, original.length - 1));
			else { const corrupted = Uint8Array.from(original); corrupted[0] ^= 1; f.objects.set(key, corrupted); }
			await assert.rejects(bytes(reader, f.items[0].thingId), /Backup chunk|backup bytes|retained chunk/i);
		} finally { await reader.close(); }
	}
});

test('index construction refuses missing, duplicate, truncated or source-changed metadata and removes scratch', async () => {
	for (const change of ['missing', 'duplicate', 'truncate', 'changed-seal'] as const) {
		const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'backup-index-reject-'));
		const planKey = `snapshots/${f.header.snapshotId}/plan/0.json`, completeKey = `snapshots/${f.header.snapshotId}/complete.json`;
		if (change === 'missing') f.objects.delete(planKey);
		else if (change === 'truncate') f.objects.set(planKey, f.objects.get(planKey)!.subarray(0, 20));
		else if (change === 'duplicate') { const page = JSON.parse(Buffer.from(f.objects.get(planKey)!).toString()); page.items[1] = { ...page.items[0], ordinal: 1 }; f.objects.set(planKey, Buffer.from(backupJson(page))); }
		else { const seal = JSON.parse(Buffer.from(f.objects.get(completeKey)!).toString()); seal.manifestHash = '0'.repeat(64); f.objects.set(completeKey, Buffer.from(backupJson(seal))); }
		await assert.rejects(openIndexedSealedBackup(f.store, f.header.snapshotId, f.access, { temporaryDirectory: directory }));
		assert.deepEqual(await readdir(directory), []); await rm(directory, { recursive: true });
	}
});

test('indexed reads fence authorization, scope, cancellation and in-flight close', async () => {
	const f = await fixture(), controller = new AbortController();
	let allowed = true;
	const access = { ...f.access, signal: controller.signal, authorize: async () => { if (!allowed) throw Error('Access revoked'); } };
	const reader = await openIndexedSealedBackup(f.store, f.header.snapshotId, access);
	try {
		allowed = false; await assert.rejects(reader.get(f.items[0].thingId), /revoked/); allowed = true;
		access.scope.ownerId = 'other'; await assert.rejects(reader.get(f.items[0].thingId), /account or origin changed/); access.scope.ownerId = scope.ownerId;
		const opened = await reader.get(f.items[0].thingId); controller.abort();
		await assert.rejects(async () => { for await (const _ of opened.ranges) { /* must refuse before emission */ } }, /abort/i);
	} finally { await reader.close(); }
	const next = await openIndexedSealedBackup(f.store, f.header.snapshotId, f.access), opened = await next.get(f.items[0].thingId);
	await next.close();
	await assert.rejects(async () => { for await (const _ of opened.ranges) { /* closed reader */ } }, /closed/);
});

test('index construction cancellation removes incomplete scratch before returning', async () => {
	const f = await fixture(), controller = new AbortController(), directory = await mkdtemp(join(tmpdir(), 'backup-index-abort-'));
	const store: BackupObjectStore = { ...f.store, async read(key, max) {
		const result = await f.store.read(key, max);
		if (key.includes('/ranges/')) controller.abort();
		return result;
	} };
	try {
		await assert.rejects(openIndexedSealedBackup(store, f.header.snapshotId, { ...f.access, signal: controller.signal }, { temporaryDirectory: directory }), /abort/i);
		assert.deepEqual(await readdir(directory), []);
	} finally { await rm(directory, { recursive: true }); }
});

test('full source fingerprint is checked even when every indexed chunk has a valid checksum', async () => {
	const f = await fixture(), prefix = `snapshots/${f.header.snapshotId}`;
	const page = JSON.parse(Buffer.from(f.objects.get(`${prefix}/plan/0.json`)!).toString());
	page.items[0].content.fingerprint.sha256 = '0'.repeat(64);
	const pageBytes = Buffer.from(backupJson(page));
	f.objects.set(`${prefix}/plan/0.json`, pageBytes);
	const plan = JSON.parse(Buffer.from(f.objects.get(`${prefix}/plan.json`)!).toString());
	plan.headHash = sha(pageBytes); f.objects.set(`${prefix}/plan.json`, Buffer.from(backupJson(plan)));
	const manifest = createHash('sha256').update(BACKUP_FORMAT + '\0' + backupJson(plan) + '\0');
	for (const item of page.items) manifest.update(Buffer.from(f.objects.get(`${prefix}/ranges/${item.ordinal}/0.json`)!).toString() + '\0');
	const seal = JSON.parse(Buffer.from(f.objects.get(`${prefix}/complete.json`)!).toString());
	f.objects.set(`${prefix}/complete.json`, Buffer.from(backupJson({ ...seal, ...plan, manifestHash: manifest.digest('hex') })));
	const reader = await openIndexedSealedBackup(f.store, f.header.snapshotId, f.access);
	try { await assert.rejects(bytes(reader, f.items[0].thingId), /pinned source fingerprint/); }
	finally { await reader.close(); }
});
