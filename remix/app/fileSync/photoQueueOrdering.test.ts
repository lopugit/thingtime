import assert from 'node:assert/strict';
import test from 'node:test';
import { streamingFileFixture } from './streamingFile.fixture';
import { saved } from './foregroundSync.fixture';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { runNativePhotoQueue } from './photoBackupPasses';
import type { ForegroundSyncProgress } from './foregroundSync';
import type { NativePhotoQueueBatch } from './nativeInventory';

const completed: ForegroundSyncProgress = { stage: 'complete', total: 0, confirmed: 0 };
const epoch = '01234567-0000-0000-0000-0123456789ab';
const batch = (assets: string[], pending = 0, unavailable = 0): NativePhotoQueueBatch =>
	({ epoch, id: crypto.randomUUID(), assetKeys: assets, pending, unavailable });

test('queue observes a new photo after the previously last upload and finishes only after a fresh empty batch', async () => {
	const last = batch(['f'.repeat(64)]);
	const arrival = batch(['e'.repeat(64)]);
	const empty = batch([], 0, 1);
	const next = [last, arrival, empty], acknowledged: string[] = [];
	const result = await runNativePhotoQueue(async () => ({ progress: completed, photoQueue: next.shift() }),
		async row => { acknowledged.push(row.id); }, () => {}, epoch);
	assert.deepEqual(acknowledged, [last.id, arrival.id, empty.id]);
	assert.equal(result.photoQueue?.unavailable, 1);
});

test('obsolete batch is never acknowledged and repeated obsolete selection stops for retry', async () => {
	const old = batch(['f'.repeat(64)], 1), latest = batch(['e'.repeat(64)]), empty = batch([]);
	const next = [{ photoQueue: old, replacedPhotoBatch: true }, { photoQueue: latest }, { photoQueue: empty }];
	const acknowledged: string[] = [];
	await runNativePhotoQueue(async () => ({ progress: completed, ...next.shift() }),
		async row => { acknowledged.push(row.id); }, () => {}, epoch);
	assert.deepEqual(acknowledged, [latest.id, empty.id]);
	await assert.rejects(runNativePhotoQueue(async () => ({ progress: completed, photoQueue: old, replacedPhotoBatch: true }),
		async () => { assert.fail('A superseded batch must not be acknowledged'); }, () => {}, epoch), /selection changed again/i);
	await assert.rejects(runNativePhotoQueue(async () => ({ progress: completed, photoQueue: batch(['1'.repeat(64)]), replacedPhotoBatch: true }),
		async () => { assert.fail('Distinct obsolete batches also must not be acknowledged'); }, () => {}, epoch), /selection changed again/i);
});

test('canonical publication follows Photos asset rank, preserves companion group and retains receipts when a source changes', async () => {
	const f = await streamingFileFixture(), input = f.input;
	const newest = 'f'.repeat(64), deleted = 'e'.repeat(64), older = '1'.repeat(64);
	const entries = [
		{ ...f.entry(), path: newest + '-0-photo.jpg', id: 'photo' },
		{ ...f.entry(), path: newest + '-1-companion.mov', id: 'companion' },
		{ ...f.entry(), path: deleted + '-0-deleted.jpg', id: 'deleted' },
		{ ...f.entry(), path: older + '-0-older.jpg', id: 'older' }
	];
	const current = () => entries.filter(row => f.publications() === 0 || row.id !== 'deleted');
	const latestBatch = batch([newest, deleted, older]);
	const photos = { ...saved, configuration: { ...saved.configuration, sourceKind: 'photos' as const } };
	const readConfiguration = input.readConfiguration;
	input.readConfiguration = async () => ({ ...(await readConfiguration() as object), crystal: photos.configuration });
	input.inspectLocal = async path => structuredClone(current().find(row => row.path === path) ?? null);
	input.inventory = async () => ({
		version: 1 as const, complete: true as const, rootId: 'cloud-root', rootRevision: 'fixture-root',
		nodes: [...f.files.values()].map(file => ({ kind: 'file' as const, path: file.name, id: file.id,
			folderId: file.folderId, revision: file.revision, file }))
	});
	input.scanLocalPages = async function* (options) {
		const id = crypto.randomUUID(), rows = options?.observationPurpose === 'checkpoint' ? current() : entries;
		const capture = { id, generation: id, totalEntries: rows.length, totalSkipped: 0,
			coverage: 'full' as const, consistency: 'per-entry' as const, photoQueue: latestBatch };
		yield { generation: id, ordinal: 0, entries: [], backupCapture: capture,
			skippedPage: { capture, offset: 0, totalSkipped: 0, nextOffset: null, skipped: [] } };
		yield { generation: id, ordinal: 0, entries: [...rows].sort((a, b) => a.path.localeCompare(b.path)),
			totalEntries: rows.length, backupCapture: capture };
	};
	try {
		const result = await runPagedForegroundCloudSync(photos, f.scope, input, new AbortController().signal);
		assert.ok('spec' in result);
		assert.equal(result.progress.photoSourceChanged, true);
		assert.equal(result.progress.confirmed, 3);
		assert.deepEqual([...f.files.values()].map(file => file.name), [entries[0].path, entries[1].path, entries[3].path]);
		assert.equal(f.puts(), 3);
		const head = await f.journal().pagedCheckpoints({ scope: f.scope, currentScope: input.currentScope }).current();
		assert.ok(head);
		assert.equal((await f.journal().inventory({ scope: f.scope, currentScope: input.currentScope }).read(head.baseline.local)).totalEntries, 3);
	} finally { f.journal().close(); }
});

for (const order of ['native before browser preflight', 'native during guarded browser commit', 'different native bytes'] as const) {
	test(`Photos WebView reconciles independent native publication: ${order}`, async () => {
		const key = 'a'.repeat(64), path = key + '-0-original.jpg';
		const f = await streamingFileFixture(path), { input } = f, entry = f.entry();
		const photos = { ...saved, configuration: { ...saved.configuration, sourceKind: 'photos' as const } };
		const originalRead = input.readConfiguration;
		input.readConfiguration = async () => ({ ...(await originalRead() as object), crystal: photos.configuration });
		input.deferredUploads = { publishPhotos: true, skipLookahead: true, queued: () => assert.fail('Native run owns background replenishment') };
		const nativeFile = { id: 'native-other-operation', revision: 'native-revision', name: path, folderId: 'cloud-root', trashed: false,
			content: { attachmentId: 'native-upload', version: 'a'.repeat(64), size: entry.size,
				fingerprint: order === 'different native bytes' ? { ...entry.fingerprint, sha256: 'b'.repeat(64) } : entry.fingerprint } };
		const nativePublish = () => f.files.set(nativeFile.id, nativeFile);
		input.inventory = async () => ({
			version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root',
			nodes: [...f.files.values()].map(file => ({ kind: 'file', path, id: file.id, folderId: file.folderId, revision: file.revision, file }))
		});
		const photoQueue = batch([key]);
		input.scanLocalPages = async function* () {
			const id = crypto.randomUUID();
			const capture = { id, generation: id, totalEntries: 1, totalSkipped: 0, coverage: 'full' as const, consistency: 'per-entry' as const, photoQueue };
			yield { generation: id, ordinal: 0, entries: [], backupCapture: capture,
				skippedPage: { capture, offset: 0, totalSkipped: 0, nextOffset: null, skipped: [] } };
			yield { generation: id, ordinal: 0, entries: [entry], totalEntries: 1, backupCapture: capture };
		};
		if (order !== 'native during guarded browser commit') input.progressSession = () => { nativePublish(); };
		else {
			const fetch = input.runtime.fetch;
			input.runtime.fetch = async (url, init) => {
				if (new URL(String(url)).pathname === '/api/v1/files' && typeof init?.body === 'string') {
					assert.deepEqual(JSON.parse(init.body).syncDestination, { rootId: 'cloud-root', path });
					nativePublish();
					return Response.json({ ok: false, code: 'sync_destination_changed' }, { status: 409 });
				}
				return fetch(url, init);
			};
		}
		try {
			const run = () => runPagedForegroundCloudSync(photos, f.scope, input, new AbortController().signal);
			if (order === 'different native bytes') await assert.rejects(run(), /Sync file changed/);
			else {
				const result = await run();
				assert.ok('spec' in result);
				assert.equal(result.progress.phase, 'complete');
				assert.equal(result.progress.confirmed, 0, 'Native receipt was not copied to the old browser operation');
				assert.equal(result.progress.photoSourceChanged, undefined);
				const head = await f.journal().pagedCheckpoints({ scope: f.scope, currentScope: input.currentScope }).current();
				assert.ok(head, 'The checkpoint reobserved the accepted native bytes');
			}
			assert.deepEqual([...f.files.values()], [nativeFile]);
			assert.equal(f.publications(), 0);
			assert.equal(f.puts(), order === 'native during guarded browser commit' ? 1 : 0);
		} finally { f.journal().close(); }
	});
}
