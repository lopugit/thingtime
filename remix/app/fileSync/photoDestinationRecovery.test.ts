import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudFileSyncEntry, type CloudFile } from './cloudFile';
import { contentPartPlan, fingerprintSource } from './contentFingerprint';
import { runForegroundCloudSync, type ForegroundSyncInput } from './foregroundSync';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { preparePhotoDestinationRecovery } from './photoDestinationRecovery';
import { syncScopeKey } from './reconcile';
import { previousPhotoRunKey } from './photoDestinationJournal';
import type { SyncRun } from './execute';
import { PAGED_RUN_HEADS, PAGED_RUN_STORES, type PagedRunSpec } from './pagedRunJournal';

const oldFolder = 'old-photos', newFolder = 'iphone-folder';
const old = { ...saved, configuration: { ...saved.configuration, sourceKind: 'photos' as const, remoteFolderId: oldFolder } };
const current = { ...old, updatedAt: '2026-10-18T00:00:00.000Z',
	configuration: { ...old.configuration, name: 'iPhone Photos', remoteFolderId: newFolder } };

for (const [format, start] of [['paged', runPagedForegroundCloudSync], ['legacy', runForegroundCloudSync]] as const)
	test(`Photos Retry leaves an interrupted ${format} plan and its receipts at the previous destination`, async t => {
		const f = await foregroundFixture();
		t.after(() => f.journal().close());
		const signal = new AbortController().signal, access = { scope, currentScope: () => scope, signal };
		const entries = await Promise.all(['a', 'b', 'c'].map(async (letter, i) => {
			const bytes = new Uint8Array([i + 1]), source = { size: bytes.length, read: async () => bytes, check: () => {} };
			const fingerprint = await fingerprintSource(source), name = letter.repeat(64) + '-1.HEIC';
			const file = { id: 'existing-' + letter, name, folderId: newFolder, revision: 'original', trashed: false,
				content: { attachmentId: 'existing-attachment-' + letter, version: letter.repeat(64), size: bytes.length, fingerprint } };
			return { source, file, local: { ...cloudFileSyncEntry(file, name), id: 'asset-' + letter, version: 'local-revision' } };
		}));
		const cloud = new Map<string, CloudFile>([[entries[0].file.id, entries[0].file]]);
		const receipts = new Map<string, CloudFile>(), attachments = new Map<string, CloudFile['content']>();
		let selected = old, lose = true, scans = 0;
		const reserveFolders: string[] = [];
		const input = (): ForegroundSyncInput => ({
			...f.input(),
			readConfiguration: async () => ({ id: selected.id, updatedAt: selected.updatedAt, crystal: selected.configuration,
				author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'] }),
			scanLocal: async () => { scans++; return entries.map(entry => entry.local); },
			inspectLocal: async path => entries.find(entry => entry.local.path === path)?.local ?? null,
			source: async entry => entries.find(item => item.local.path === entry.path)!.source,
			inventory: async () => ({ version: 1, complete: true, rootId: selected.configuration.remoteFolderId, rootRevision: 'r1',
				nodes: [...cloud.values()].filter(file => file.folderId === selected.configuration.remoteFolderId)
					.map(file => ({ kind: 'file', path: file.name, file })) }),
			runtime: { ...f.input().runtime, fetch: async (url, init) => {
				const u = new URL(String(url)), query = u.searchParams;
				const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
				if (u.pathname === '/api/v1/attachments/uploads') {
					const original = entries.find(item => item.file.name === body.filename)!;
					assert.equal(body.fileSyncOrigin.folderId, selected.configuration.remoteFolderId);
					reserveFolders.push(body.fileSyncOrigin.folderId);
					const id = 'upload-' + body.requestId;
					attachments.set(id, { ...original.file.content, attachmentId: id });
					return Response.json({ ok: true, upload: { id, state: 'ready', ...contentPartPlan(original.source.size) } });
				}
				if (u.pathname === '/api/v1/attachments/content') return Response.json({ ok: true, id: query.get('id'), ...attachments.get(query.get('id')!) });
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
		const first = (await jobs().photoQueue(await jobs().admit(old, 'old-job'), crypto.randomUUID()))!;
		await assert.rejects(start(old, scope, input(), signal), /Photo publication reply lost/);
		const pending = format === 'paged' ? (await f.journal().pagedRuns(access).active())!.spec : (await f.journal().read(scope))!;
		assert.equal(receipts.size, 2);
		assert.equal(format === 'paged' ? (await f.journal().pagedRuns(access).active())!.progress.confirmed :
			(await f.journal().read(scope))!.operations.filter(op => op.confirmed).length, 1);
		const oldFiles = [...cloud.values()].filter(file => file.folderId === oldFolder);
		selected = current;
		await f.reload();
		await assert.rejects(jobs().admit(current, 'blocked'), /different settings/, 'ordinary admission still refuses changed settings');
		const prepare = (prior = first, port = { verify: async () => {}, disarm: async () => {}, check: () => {} }) =>
			preparePhotoDestinationRecovery(f.journal(), access, prior, current, port);
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
		await assert.rejects(jobs().admit(current, 'stale-retry', undefined, beforeStop), /job changed while stopping/);
		assert.deepEqual(await jobs().read(), stopped);
		const recovery = (await prepare(stopped))!;
		const replacement = await jobs().admit(current, 'new-job', undefined, recovery);
		assert.notEqual(replacement.id, first.id);
		assert.equal(replacement.photoQueueEpoch, undefined);
		assert.equal(await jobs().finish(first, Date.now()), null);
		assert.equal(await f.journal().read(scope), null);
		assert.equal(await f.journal().pagedRuns(access).active(), null);
		if (format === 'paged') await assert.rejects(f.journal().pagedRuns(access).prepare(pending as PagedRunSpec), /lost its active root/);
		if (format === 'legacy') await assert.rejects(f.journal().persist(pending as SyncRun), /previous destination/);
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
		f.condition('cellular'); const beforeWait = scans;
		await assert.rejects(runPagedForegroundCloudSync(current, scope, input(), signal), /Waiting for Wi-Fi/);
		assert.equal(scans, beforeWait); assert.deepEqual(reserveFolders, [oldFolder, oldFolder]);
		f.condition('wifi');
		await runPagedForegroundCloudSync(current, scope, input(), signal);
		assert.deepEqual(reserveFolders, [oldFolder, oldFolder, newFolder, newFolder]);
		assert.deepEqual([...cloud.values()].filter(file => file.folderId === oldFolder), oldFiles);
		assert.deepEqual(cloud.get(entries[0].file.id), entries[0].file, 'matching original at the new folder retains its exact revision');
		assert.equal([...cloud.values()].filter(file => file.folderId === newFolder).length, 3);
		assert.equal((await f.journal().pagedCheckpoints(access).current())?.remoteFolderId, newFolder);
		await f.reload();
		await runPagedForegroundCloudSync(current, scope, input(), signal);
		assert.deepEqual(reserveFolders, [oldFolder, oldFolder, newFolder, newFolder], 'reopening and checking never duplicates the copies');
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

test('only a destination change on the same deletion-free Photos grant can supersede an unfinished admission', async t => {
	const f = await foregroundFixture();
	t.after(() => f.journal().close());
	const access = { scope, currentScope: () => scope }, journal = f.journal(), jobs = journal.jobs(access);
	const previous = await jobs.admit(old, 'photo-job');
	const port = { verify: async () => { throw Error('unexpected verification'); },
		disarm: async () => { throw Error('unexpected cancellation'); }, check: () => {} };
	for (const patch of [{ localRootId: 'another-grant' }, { network: 'any' }, { chargingOnly: true }, { paused: true },
		{ sourceKind: 'folder', mode: 'two-way', propagateDeletes: true }, { remoteFolderId: oldFolder }] as const) {
		const changed = { ...current, configuration: { ...current.configuration, ...patch } };
		assert.equal(await preparePhotoDestinationRecovery(journal, access, previous, changed, port), undefined);
	}
	assert.deepEqual(await jobs.read(), previous);
});
