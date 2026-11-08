import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudFileSyncEntry, type CloudFile } from './cloudFile';
import { contentPartPlan, fingerprintSource } from './contentFingerprint';
import { runForegroundCloudSync, type ForegroundSyncInput } from './foregroundSync';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { parseNativePhotoQueueBatch } from './nativeInventory';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { preparePhotoSettingsRecovery } from './photoSettingsRecovery';
import { syncScopeKey } from './reconcile';
import { previousPhotoRunKey } from './photoSettingsJournal';
import type { SyncRun } from './execute';
import { PAGED_RUN_HEADS, PAGED_RUN_STORES, type PagedRunSpec } from './pagedRunJournal';

const oldFolder = 'old-photos';
const old = { ...saved, configuration: { ...saved.configuration, sourceKind: 'photos' as const, remoteFolderId: oldFolder } };
const current = { ...old, updatedAt: '2026-10-18T00:00:00.000Z',
	configuration: { ...old.configuration, name: 'iPhone Photos', remoteFolderId: 'iphone-folder', network: 'any' as const, chargingOnly: true } };
const photoCases = [
	{ format: 'paged', start: runPagedForegroundCloudSync, variant: 'same folder' },
	{ format: 'paged', start: runPagedForegroundCloudSync, variant: 'new folder' },
	{ format: 'legacy', start: runForegroundCloudSync, variant: 'same folder' },
	{ format: 'legacy', start: runForegroundCloudSync, variant: 'new folder' },
	{ format: 'paged', start: runPagedForegroundCloudSync, variant: 'revision only' },
	{ format: 'paged', start: runPagedForegroundCloudSync, variant: 'v4 policy migration' }
] as const;

for (const { format, start, variant } of photoCases)
	test(`Photos Retry reconciles an interrupted ${format} backup after a ${variant} change`, async t => {
		const sameFolder = variant !== 'new folder', revisionOnly = variant === 'revision only';
		const newFolder = sameFolder ? oldFolder : current.configuration.remoteFolderId;
		const updated: typeof old = { ...current, configuration: revisionOnly ? old.configuration : { ...current.configuration,
			remoteFolderId: newFolder, ...(variant === 'v4 policy migration' ? { configurationVersion: 4 as const,
				photoAutomation: { notificationIntervalMs: 1_800_000, uploadBytesPerSecond: 625_000, uploadBytesPerHour: 1_000_000_000 } } : {}) } };
		const f = await foregroundFixture();
		t.after(() => f.journal().close());
		const signal = new AbortController().signal, access = { scope, currentScope: () => scope, signal };
		const entries = await Promise.all(['a', 'b', 'c'].map(async (letter, i) => {
			const bytes = new TextEncoder().encode(`test Photos original ${letter} ${i}`),
				source = { size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length), check: () => {} };
			const fingerprint = await fingerprintSource(source), name = letter.repeat(64) + '-1.HEIC';
			const file = { id: 'existing-' + letter, name, folderId: newFolder, revision: 'original', trashed: false,
				content: { attachmentId: 'existing-attachment-' + letter, version: letter.repeat(64), size: bytes.length, fingerprint } };
			return { bytes, source, file, local: { ...cloudFileSyncEntry(file, name), id: 'asset-' + letter, version: 'local-revision' } };
		}));
		const cloud = new Map<string, CloudFile>(sameFolder ? [] : [[entries[0].file.id, entries[0].file]]);
		const receipts = new Map<string, CloudFile>(), attachments = new Map<string, CloudFile['content']>();
		let selected: typeof updated = old, lose = true, scans = 0, charging = true, visible = entries;
		let photoEpoch: string | undefined;
		const oldPhotoBatch = crypto.randomUUID(), newPhotoBatch = crypto.randomUUID();
		let photoBatch = oldPhotoBatch;
		const reserveFolders: string[] = [], uploads: { root: string; bytes: Uint8Array }[] = [];
		const accepted = new Map<string, { root: string; checksum?: string; complete?: boolean }>();
		const input = (): ForegroundSyncInput => ({
			...f.input(),
			readConfiguration: async () => ({ id: selected.id, updatedAt: selected.updatedAt, crystal: selected.configuration,
				author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'] }),
			conditions: async () => ({ ...await f.input().conditions(), charging }),
			scanLocal: async () => { scans++; return visible.map(entry => entry.local); },
			...(revisionOnly ? { scanLocalPages: async function* () {
				scans++;
				const generation = crypto.randomUUID(), entries = visible.map(item => item.local);
				const capture = { id: generation, generation, totalEntries: entries.length, totalSkipped: 0,
					coverage: 'full' as const, consistency: 'per-entry' as const,
					photoQueue: { epoch: photoEpoch!, id: photoBatch, assetKeys: entries.map(entry => entry.path.slice(0, 64)), pending: 0, unavailable: 0 } };
				yield { generation, ordinal: 0, entries: [], backupCapture: capture,
					skippedPage: { capture, offset: 0, totalSkipped: 0, nextOffset: null, skipped: [] } };
				yield { generation, ordinal: 0, entries, totalEntries: capture.totalEntries, backupCapture: capture };
			} } : {}),
			inspectLocal: async path => visible.find(entry => entry.local.path === path)?.local ?? null,
			source: async entry => entries.find(item => item.local.path === entry.path)!.source,
			inventory: async () => ({ version: 1, complete: true, rootId: selected.configuration.remoteFolderId, rootRevision: 'r1',
				nodes: [...cloud.values()].filter(file => file.folderId === selected.configuration.remoteFolderId)
					.map(file => ({ kind: 'file', path: file.name, file })) }),
			runtime: { ...f.input().runtime, fetch: async (url, init) => {
				const u = new URL(String(url)), query = u.searchParams;
				const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
				if (u.origin === 'https://storage.test') {
					const id = u.pathname.slice(1), reservation = accepted.get(id)!;
					assert.equal(init?.method, 'PUT');
					const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
					const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
					assert.equal(btoa(String.fromCharCode(...hash)), reservation.checksum);
					uploads.push({ root: reservation.root, bytes });
					reservation.complete = true;
					return new Response(null);
				}
				if (u.pathname === '/api/v1/attachments/uploads') {
					const original = entries.find(item => item.file.name === body.filename)!;
					assert.equal(body.fileSyncOrigin.folderId, selected.configuration.remoteFolderId);
					reserveFolders.push(body.fileSyncOrigin.folderId);
					const id = 'upload-' + body.requestId;
					attachments.set(id, { ...original.file.content, attachmentId: id });
					accepted.set(id, { root: body.fileSyncOrigin.folderId });
					return Response.json({ ok: true, upload: { id, ...contentPartPlan(original.source.size) } });
				}
				if (u.pathname === '/api/v1/attachments/uploads/parts') {
					const checksum = body.parts[0].checksumSha256;
					accepted.get(body.uploadId)!.checksum = checksum;
					return Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/' + body.uploadId,
						headers: { 'x-amz-checksum-sha256': checksum } }] });
				}
				if (u.pathname === '/api/v1/attachments/uploads/complete') {
					assert.equal(accepted.get(body.uploadId)?.complete, true);
					return Response.json({ ok: true });
				}
				if (u.pathname === '/api/v1/attachments/content') {
					const id = query.get('id')!;
					assert.equal(accepted.get(id)?.complete, true);
					return Response.json({ ok: true, id, ...attachments.get(id) });
				}
				assert.equal(u.pathname, '/api/v1/files');
				if (body) {
					assert.equal(body.folderId, selected.configuration.remoteFolderId);
					assert.equal(body.trashed, false);
					assert.ok(!receipts.has(body.operationId), 'never replay an old operation at either folder');
					const file = { id: body.id, folderId: body.folderId, name: body.name, trashed: false, revision: 'published',
						content: attachments.get(body.attachmentId)! };
					assert.ok(file.content);
					cloud.set(file.id, file); receipts.set(body.operationId, file);
					if (lose && receipts.size === 2) { lose = false; throw Error('Photo publication reply lost'); }
					return Response.json({ ok: true, file });
				}
				if (query.has('operationId')) {
					const file = receipts.get(query.get('operationId')!);
					return Response.json({ ok: true, receipt: file ? { file } : null });
				}
				if (query.has('rootId')) {
					const rootId = query.get('rootId')!, path = query.get('path')!;
					assert.equal(rootId, selected.configuration.remoteFolderId);
					const file = [...cloud.values()].find(file => file.folderId === rootId && file.name === path);
					return Response.json({ ok: true, observation: { version: 1, complete: true, rootId, rootRevision: 'r1', path,
						entry: file ? cloudFileSyncEntry(file, path) : null } });
				}
				if (query.has('id')) {
					const file = cloud.get(query.get('id')!);
					return file ? Response.json({ ok: true, file }) : Response.json({ ok: false }, { status: 404 });
				}
				throw Error('Unexpected request ' + u);
			} }
		});
		const jobs = () => f.journal().jobs(access);
		// A prior successful pass may have published a checkpoint for this
		// same pair. Replanning a policy edit must keep that baseline usable.
		if (format === 'paged' && variant === 'same folder') {
			visible = [];
			await start(old, scope, input(), signal);
			visible = entries;
		}
		const before = await f.journal().pagedCheckpoints(access).current();
		const first = (await jobs().photoQueue(await jobs().admit(old, 'old-job'), crypto.randomUUID()))!;
		photoEpoch = first.photoQueueEpoch;
		await assert.rejects(start(old, scope, input(), signal), /Photo publication reply lost/);
		const pending = format === 'paged' ? (await f.journal().pagedRuns(access).active())!.spec : (await f.journal().read(scope))!;
		assert.equal(receipts.size, 2);
		if (revisionOnly) {
			const spec = pending as PagedRunSpec;
			assert.deepEqual(spec.photoAssetOrder, entries.map(entry => entry.local.path.slice(0, 64)));
			const coverage = await f.journal().inventory(access).coverage(spec.plan.local);
			assert.equal(coverage?.photoQueue?.epoch, first.photoQueueEpoch);
			assert.equal(coverage?.photoQueue?.id, oldPhotoBatch);
		}
		assert.equal(format === 'paged' ? (await f.journal().pagedRuns(access).active())!.progress.confirmed :
			(await f.journal().read(scope))!.operations.filter(op => op.confirmed).length, 1);
		const oldFiles = [...cloud.values()].filter(file => file.folderId === oldFolder);
		selected = updated;
		await f.reload();
		await assert.rejects(start(old, scope, input(), signal), /configuration or device approval changed/);
		assert.equal(uploads.length, 2, 'old reviewed settings cannot dispatch another upload');
		if (!revisionOnly) await assert.rejects(jobs().admit(updated, 'blocked'), /different settings/,
			'ordinary admission still refuses changed settings');
		const prepare = (prior = first, port = { verify: async () => {}, disarm: async () => {}, check: () => {} }) =>
			preparePhotoSettingsRecovery(f.journal(), access, prior, updated, port);
		await assert.rejects(prepare(first, { verify: async () => {}, disarm: async () => { throw Error('disarm unavailable'); }, check: () => {} }),
			/disarm unavailable/);
		let verified = 0;
		await assert.rejects(prepare(first, { verify: async () => { if (++verified === 2) throw Error('configuration changed again'); },
			disarm: async () => {}, check: () => {} }), /configuration changed again/);
		if (format === 'paged') {
			// Older WebViews may leave an opaque legacy record beside a
			// paged one. An unknown unfinished legacy binding stays guarded
			// even if the old paged head could otherwise be parked.
			const spec = pending as PagedRunSpec;
			const unconfirmed = (await f.journal().pagedRuns(access).read(spec)).operations.find(op => !op.confirmed)!;
			const db = await new Promise<IDBDatabase>(resolve => {
				const request = f.factory.open('thingtime-file-sync-v1'); request.onsuccess = () => resolve(request.result);
			});
			const alterLegacy = (put: boolean) => new Promise<void>((resolve, reject) => {
				const tx = db.transaction('runs', 'readwrite'), store = tx.objectStore('runs'), key = syncScopeKey(scope);
				if (put) store.put({ version: 1, id: 'opaque-legacy', scope, operations: [unconfirmed] }, key);
				else store.delete(key);
				tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
			});
			await alterLegacy(true);
			await assert.rejects(prepare(first, { verify: async () => { throw Error('unexpected verification'); },
				disarm: async () => { throw Error('unexpected cancellation'); }, check: () => {} }), /different settings/);
			assert.equal((await f.journal().pagedRuns(access).active())?.spec.id, spec.id);
			await alterLegacy(false); db.close();
		}
		const beforeStop = (await prepare())!;
		await f.reload(); // Process loss after disarming leaves the exact old journal recoverable.
		assert.deepEqual(await jobs().read(), first);
		const stopped = (await jobs().pause(first))!;
		await assert.rejects(jobs().admit(updated, 'stale-retry', undefined, beforeStop), /job changed while stopping/);
		assert.deepEqual(await jobs().read(), stopped);
		const recovery = (await prepare(stopped))!;
		const replacement = await jobs().admit(updated, 'new-job', undefined, recovery);
		assert.notEqual(replacement.id, first.id);
		assert.equal(replacement.photoQueueEpoch, undefined);
		assert.equal(await jobs().finish(first, Date.now()), null);
		assert.equal(await f.journal().read(scope), null);
		assert.equal(await f.journal().pagedRuns(access).active(), null);
		assert.deepEqual(await f.journal().pagedCheckpoints(access).current(), before, 'archiving does not change the checkpoint');
		if (format === 'paged') await assert.rejects(f.journal().pagedRuns(access).prepare(pending as PagedRunSpec), /lost its active root/);
		if (format === 'legacy') await assert.rejects(f.journal().persist(pending as SyncRun), /earlier settings/);
		// Read exact archived records independently of the active journal.
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = f.factory.open('thingtime-file-sync-v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		const key = syncScopeKey(scope), archive = [key, 'previous-photo-destination', oldFolder, pending.id];
		const read = (store: string, id: IDBValidKey) => new Promise<any>(resolve => {
			const request = db.transaction(store).objectStore(store).get(id); request.onsuccess = () => resolve(request.result);
		});
		if (format === 'paged') {
			assert.equal(await read(PAGED_RUN_HEADS, archive), pending.id);
			assert.equal((await read(PAGED_RUN_STORES[0], [key, pending.id])).confirmed, 1);
		} else assert.deepEqual(await read('runs', previousPhotoRunKey(key, pending.id)), pending);
		await f.reload();
		assert.deepEqual(await jobs().read(), replacement);
		const armed = (await jobs().photoQueue(replacement, crypto.randomUUID()))!;
		assert.notEqual(armed.photoQueueEpoch, first.photoQueueEpoch);
		photoEpoch = armed.photoQueueEpoch; photoBatch = newPhotoBatch;
		const paused = (await jobs().pause(armed))!;
		assert.equal(await jobs().begin(paused, Date.now(), 'automatic'), null);
		await f.reload();
		assert.equal(await prepare(paused), undefined, 'exact reviewed settings do not replan a repeat Retry');
		const retry = await jobs().admit(updated, 'repeat');
		assert.equal(retry.id, replacement.id);
		assert.equal(retry.photoQueueEpoch, armed.photoQueueEpoch);

		f.condition('cellular'); charging = false; const beforeWait = scans;
		await assert.rejects(runPagedForegroundCloudSync(updated, scope, input(), signal), revisionOnly ? /Waiting for Wi-Fi/ : /waiting for this device to charge/i);
		assert.equal(scans, beforeWait); assert.deepEqual(reserveFolders, [oldFolder, oldFolder]);
		charging = true;
		if (revisionOnly) f.condition('wifi');
		const result = await runPagedForegroundCloudSync(updated, scope, input(), signal);
		assert.ok('progress' in result); assert.equal(result.progress.phase, 'complete');
		if (revisionOnly) {
			assert.ok('photoQueue' in result);
			const completed = parseNativePhotoQueueBatch(result.photoQueue);
			assert.equal(completed.epoch, armed.photoQueueEpoch);
			assert.equal(completed.id, newPhotoBatch);
		}
		const expectedFolders = [oldFolder, oldFolder, ...(sameFolder ? [newFolder] : [newFolder, newFolder])];
		assert.deepEqual(reserveFolders, expectedFolders);
		assert.deepEqual(uploads.map(upload => upload.root), expectedFolders);
		assert.deepEqual(uploads.slice(2).map(upload => upload.bytes), sameFolder ? [entries[2].bytes] : [entries[1].bytes, entries[2].bytes]);
		for (const oldFile of oldFiles) assert.deepEqual(cloud.get(oldFile.id), oldFile, 'already-published copies keep their exact revision');
		if (!sameFolder) assert.deepEqual(cloud.get(entries[0].file.id), entries[0].file, 'matching original at the new folder keeps its revision');
		assert.equal([...cloud.values()].filter(file => file.folderId === newFolder).length, 3);
		assert.equal((await f.journal().pagedCheckpoints(access).current())?.remoteFolderId, newFolder);
		await f.reload();
		await runPagedForegroundCloudSync(updated, scope, input(), signal);
		assert.deepEqual(reserveFolders, expectedFolders, 'reopening and checking never duplicates the copies');
		// A new run performs the regular maintenance sweep; its old receipt
		// must stay intact together with the now-inactive plan and input pins.
		await f.journal().maintenance(access).collect();
		if (format === 'paged') {
			const spec = pending as PagedRunSpec;
			assert.equal(await read(PAGED_RUN_HEADS, archive), spec.id);
			assert.equal((await read(PAGED_RUN_STORES[0], [key, spec.id])).confirmed, 1);
			assert.equal((await f.journal().plans(access).read(spec.plan)).totalDecisions, 3);
			assert.equal((await f.journal().inventory(access).read(spec.plan.local)).totalEntries, 3);
		} else assert.deepEqual(await read('runs', previousPhotoRunKey(key, pending.id)), pending);
		db.close();
	});

test('only the same deletion-free Photos grant and device can supersede an unfinished admission', async t => {
	const f = await foregroundFixture();
	t.after(() => f.journal().close());
	const access = { scope, currentScope: () => scope }, journal = f.journal(), jobs = journal.jobs(access);
	const previous = await jobs.admit(old, 'photo-job');
	const port = { verify: async () => { throw Error('unexpected verification'); },
		disarm: async () => { throw Error('unexpected cancellation'); }, check: () => {} };
	for (const patch of [{ localRootId: 'another-grant' }, { deviceId: 'another-device' }, { paused: true },
		{ sourceKind: 'folder', mode: 'two-way', propagateDeletes: true }] as const) {
		const changed = { ...current, configuration: { ...current.configuration, ...patch } };
		assert.equal(await preparePhotoSettingsRecovery(journal, access, previous, changed, port), undefined);
	}
	for (const patch of [{ mode: 'two-way' }, { propagateDeletes: true }] as const)
		await assert.rejects(preparePhotoSettingsRecovery(journal, access, previous,
			{ ...current, configuration: { ...current.configuration, ...patch } }, port), /Photo libraries require backup mode/);
	for (const patch of [{ ownerId: 'different-owner' }, { origin: 'https://other.example' }])
		await assert.rejects(preparePhotoSettingsRecovery(journal, { ...access, currentScope: () => ({ ...scope, ...patch }) },
			previous, current, port), /account or root changed/);
	assert.deepEqual(await jobs.read(), previous);
});

test('the fresh admission keeps the current name, exclusions and supported resource policy', async t => {
	const f = await foregroundFixture();
	t.after(() => f.journal().close());
	const access = { scope, currentScope: () => scope }, journal = f.journal(), jobs = journal.jobs(access);
	const previous = await jobs.admit(old, 'photo-job');
	const configuration = { ...old.configuration, configurationVersion: 3 as const, name: 'My Photos',
		excludedPaths: ['excluded.HEIC'], resourceLimits: { uploadBytesPerSecond: 2_000_000 } };
	const saved = { ...current, configuration };
	const recovery = await preparePhotoSettingsRecovery(journal, access, previous, saved,
		{ verify: async () => {}, disarm: async () => {}, check: () => {} });
	assert.ok(recovery);
	const replacement = await jobs.admit(saved, 'new-photo-job', undefined, recovery);
	assert.deepEqual(replacement.reviewed.configuration, configuration);
});
