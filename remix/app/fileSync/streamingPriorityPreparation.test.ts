import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { prepareCloudInventoryWrite } from './cloudWrite';
import type { PagedRunSpec } from './pagedRunJournal';
import { syncScopeKey, type SyncEntry } from './reconcile';
import { executeSyncOperation, type SyncExecutionPort, type SyncReceipt } from './execute';
import { openSyncJournal } from './journal.client';
import { REVIEW_STORE } from './pagedRunJournal';
import { IDBFactory, IDBIndex, IDBKeyRange } from 'fake-indexeddb';
import { streamOneWayForegroundSync } from './streamingForegroundSync';
import type { ForegroundSyncInput } from './foregroundSync';
import type { NativeIndexChangesPage } from './streamingIndex';
const identity = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
const spec = (): PagedRunSpec => ({
	id: crypto.randomUUID(),
	configuration: saved.configuration,
	streaming: { source: 'local', captureId: crypto.randomUUID() },
	plan: {
		id: crypto.randomUUID(),
		local: identity('local'),
		remote: identity('remote'),
		baseline: { local: identity('local'), remote: identity('remote') },
		policy: { mode: 'backup', propagateDeletes: false },
		excludedPaths: []
	}
});
const folder = (path: string): SyncEntry => ({ path, id: 'native-' + path, version: '1', kind: 'folder', size: 0, sha256: null });
test('late priority ancestry prepares ahead of durable ordinary input behind a full ready queue', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		runs = f.journal().pagedRuns(access),
		s = spec();
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	for (let sequence = 1; sequence <= 129; sequence++) {
		const source = folder('ready-' + sequence),
			operation = {
				id: crypto.randomUUID(),
				mutation: { kind: 'copy' as const, path: source.path, from: 'local' as const, source, expectedTarget: null },
				confirmed: false
			};
		await runs.appendStream(
			s,
			{ generation: s.streaming!.captureId, sequence, revision: source.version, entry: source },
			{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') }
		);
	}
	const entries = [...Array.from({ length: 260 }, (_, i) => folder('ordinary-' + i)), folder('Z'), folder('Z/sub'), folder('Z/sub/target')];
	for (let offset = 0; offset < entries.length; offset += 128) {
		await runs.appendStreamInput(
			s,
			s.streaming!.captureId,
			entries.slice(offset, offset + 128).map((entry, i) => ({ sequence: 130 + offset + i, revision: entry.version, entry })),
			false
		);
	}
	await f.journal().priorities(access).save(['Z/sub/target'], 0);
	assert.equal((await runs.active())!.progress.operations, 129);
	assert.equal((await runs.nextStreamInput(s))!.entry.path, 'Z');
	f.journal().close();
});

const binding = (s: PagedRunSpec, input: { entry: SyncEntry }, parent = 'cloud-root') => {
	const operation = {
		id: crypto.randomUUID(),
		mutation: { kind: 'copy' as const, from: 'local' as const, path: input.entry.path, source: input.entry, expectedTarget: null },
		confirmed: false
	};
	return { write: prepareCloudInventoryWrite(operation, scope, s.configuration!.remoteFolderId, null, parent) };
};
const acknowledge = async (
	runs: ReturnType<ReturnType<Awaited<ReturnType<typeof foregroundFixture>>['journal']>['pagedRuns']>,
	s: PagedRunSpec,
	op: NonNullable<Awaited<ReturnType<typeof runs.claimNext>>>
) => {
	assert.equal(op.mutation.kind, 'copy');
	return runs.confirm(s, {
		operationId: op.id,
		scope,
		entry: { ...(op.mutation as Extract<typeof op.mutation, { kind: 'copy' }>).source, id: op.id, version: 'created' }
	});
};

test('exactly 128 pending frees one ordinary slot then executes priority ancestors outside the prefix', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec();
	let runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	for (let sequence = 1; sequence <= 128; sequence++) {
		const change = { generation: s.streaming!.captureId, sequence, revision: '1', entry: folder('a-' + sequence) };
		await runs.appendStream(s, change, binding(s, change));
	}
	const entries: SyncEntry[] = [
		...Array.from({ length: 260 }, (_, i) => folder('b-' + i)),
		folder('Z'),
		folder('Z/sub'),
		{ ...folder('Z/sub/target'), kind: 'file', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', size: 0 }
	];
	for (let offset = 0; offset < entries.length; offset += 128)
		await runs.appendStreamInput(
			s,
			s.streaming!.captureId,
			entries.slice(offset, offset + 128).map((entry, i) => ({ sequence: 129 + offset + i, revision: entry.version, entry })),
			offset + 128 >= entries.length
		);
	await f.journal().priorities(access).save(['Z/sub/target'], 0);
	const ordinary = (await runs.claimNext(s))!;
	assert.match(ordinary.mutation.path, /^a-/);
	await acknowledge(runs, s, ordinary);
	assert.equal(await runs.claimNext(s), null, 'ordinary claiming waits for the priority preparation slot');
	const prepared = new Map<string, string>(),
		executed: string[] = [],
		receipts = new Map<string, SyncReceipt>(),
		remote = new Map<string, SyncEntry>();
	let lose = true;
	const port: SyncExecutionPort = {
		currentScope: () => scope,
		persist: async () => {},
		read: async (side, path) => (side === 'local' ? entries.find((entry) => entry.path === path) ?? null : remote.get(path) ?? null),
		lookup: async (id) => (receipts.has(id) ? { status: 'complete', receipt: receipts.get(id)! } : { status: 'missing' }),
		apply: async (operation) => {
			assert.equal(operation.mutation.kind, 'copy');
			const parent = operation.mutation.path.split('/').slice(0, -1).join('/');
			if (parent) assert.ok(remote.has(parent), 'the parent must have an accepted receipt before child execution');
			const receipt = {
				operationId: operation.id,
				scope,
				entry: { ...(operation.mutation as Extract<typeof operation.mutation, { kind: 'copy' }>).source, id: operation.id, version: 'created' }
			};
			receipts.set(operation.id, receipt);
			remote.set(operation.mutation.path, receipt.entry);
			executed.push(operation.mutation.path);
			if (lose) {
				lose = false;
				throw Error('lost accepted priority publication');
			}
			return receipt;
		}
	};
	for (const path of ['Z', 'Z/sub', 'Z/sub/target']) {
		const change = (await runs.nextStreamInput(s))!;
		assert.equal(change.entry.path, path);
		const parent = path.split('/').slice(0, -1).join('/'),
			write = binding(s, change, parent ? prepared.get(parent)! : 'cloud-root');
		prepared.set(path, write.write.operation.id);
		await runs.appendStream(s, change, write);
		assert.equal((await runs.streamState(s)).sequence, 128, 'ahead work cannot bypass ordinary input');
		await f.reload();
		runs = f.journal().pagedRuns(access);
		assert.equal((await runs.find(s, path))!.id, write.write.operation.id);
		const op = (await runs.claimNext(s))!;
		assert.equal(op.mutation.path, path);
		if (path === 'Z') {
			await assert.rejects(executeSyncOperation(op, scope, port), /lost accepted/);
			await f.reload();
			runs = f.journal().pagedRuns(access);
			assert.equal((await runs.claimNext(s))!.id, op.id, 'uncertain acceptance keeps its reserved ID');
		}
		await runs.confirm(s, await executeSyncOperation(op, scope, port));
	}
	assert.deepEqual(executed, ['Z', 'Z/sub', 'Z/sub/target']);
	assert.equal((await runs.streamState(s)).preparedAhead, 3);
	assert.equal((await runs.nextStreamInput(s))!.entry.path, 'b-0');
	await assert.rejects(runs.sealStream(s, s.streaming!.captureId, 391), /completion changed/);
	for (let i = 0; i < 260; i++) {
		const change = (await runs.nextStreamInput(s))!;
		assert.equal(change.entry.path, 'b-' + i);
		await runs.appendStream(s, change, null);
	}
	assert.equal(await runs.nextStreamInput(s), null);
	assert.equal((await runs.streamState(s)).sequence, 391);
	assert.equal((await runs.streamState(s)).preparedAhead, 0);
	assert.equal(await runs.streamReadyToFinish(s), false, 'ordinary operations still need their receipts');
	f.journal().close();
});

test('absent or blocked priorities cannot deadlock ordinary work; reserved IDs survive changed priorities and restart', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec();
	let runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	const first = { generation: s.streaming!.captureId, sequence: 1, revision: '1', entry: folder('priority') },
		write = binding(s, first);
	await runs.appendStream(s, first, write);
	await runs.appendStreamInput(
		s,
		s.streaming!.captureId,
		[
			{ sequence: 2, revision: '1', entry: folder('ordinary') },
			{ sequence: 3, revision: 'B', entry: { ...first.entry, version: 'B' } }
		],
		false
	);
	await f.journal().priorities(access).save(['missing', 'priority'], 0);
	const original = (await runs.claimNext(s))!;
	assert.equal(original.id, write.write.operation.id);
	await f.journal().priorities(access).save(['ordinary'], 1);
	await f.reload();
	runs = f.journal().pagedRuns(access);
	assert.equal((await runs.claimNext(s))!.id, original.id);
	await acknowledge(runs, s, original);
	assert.equal(await runs.claimNext(s), null);
	const change = (await runs.nextStreamInput(s))!;
	assert.equal(change.entry.path, 'ordinary');
	await runs.appendStream(s, change, binding(s, change));
	assert.equal((await runs.claimNext(s))!.mutation.path, 'ordinary');
	f.journal().close();
});

test('generic local and remote sources keep FIFO despite saved priorities', async () => {
	for (const source of ['local', 'remote'] as const) {
		const f = await foregroundFixture(),
			access = { scope, currentScope: () => scope },
			s = spec(),
			runs = f.journal().pagedRuns(access);
		if (source === 'remote') {
			s.streaming!.source = source;
			s.plan.policy.mode = 'download';
			s.configuration = { ...s.configuration!, mode: 'download' };
		}
		await runs.begin(s);
		await f.journal().priorities(access).save(['priority'], 0);
		await runs.appendStreamInput(
			s,
			s.streaming!.captureId,
			['ordinary', 'priority'].map((path, i) => ({ sequence: i + 1, revision: '1', entry: folder(path) })),
			false
		);
		assert.equal((await runs.nextStreamInput(s))!.entry.path, 'ordinary');
		if (source === 'remote') await assert.rejects(runs.enableStreamPriorities(s), /local stream/);
		f.journal().close();
	}
});

async function database(factory: IDBFactory, work: (db: IDBDatabase) => Promise<void>) {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open('thingtime-file-sync-v1');
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		await work(db);
	} finally {
		db.close();
	}
}
const editReview = (factory: IDBFactory, work: (store: IDBObjectStore) => void) =>
	database(
		factory,
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(REVIEW_STORE, 'readwrite');
				tx.oncomplete = () => resolve();
				tx.onabort = tx.onerror = () => reject(tx.error);
				work(tx.objectStore(REVIEW_STORE));
			})
	);

test('v12 retained inputs gain a scoped path index and resumable folded backfill without replacing operations', async () => {
	const factory = new IDBFactory(),
		legacyFactory = {
			open: (name: string) => {
				const request = factory.open(name, 12);
				request.addEventListener('upgradeneeded', () =>
					queueMicrotask(() => {
						const store = request.transaction!.objectStore(REVIEW_STORE);
						for (const index of Array.from(store.indexNames)) store.deleteIndex(index);
					})
				);
				return request;
			}
		} as IDBFactory;
	let journal = await openSyncJournal(legacyFactory, 'thingtime-file-sync-v1', IDBKeyRange);
	const access = { scope, currentScope: () => scope },
		s = spec();
	let runs = journal.pagedRuns(access);
	await runs.begin(s);
	const entries = Array.from({ length: 300 }, (_, i) => folder(i === 279 ? 'Cafe\u0301' : 'ordinary-' + i));
	for (let offset = 0; offset < entries.length; offset += 128)
		await runs.appendStreamInput(
			s,
			s.streaming!.captureId,
			entries.slice(offset, offset + 128).map((entry, i) => ({ sequence: offset + i + 1, revision: '1', entry })),
			offset + 128 >= entries.length
		);
	await journal.priorities(access).save(['CAFÉ'], 0);
	journal.close();
	await editReview(factory, (store) => {
		const request = store.openCursor();
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return;
			const value = cursor.value;
			if (Array.isArray(cursor.key) && cursor.key[2] === 'input') {
				delete value.inputScope;
				delete value.inputRun;
				delete value.inputPath;
				cursor.update(value);
			}
			cursor.continue();
		};
	});
	journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
	runs = journal.pagedRuns(access);
	await database(factory, async (db) => {
		assert.equal(db.version, 14);
		assert.equal(db.transaction(REVIEW_STORE).objectStore(REVIEW_STORE).indexNames.length, 1);
	});
	await runs.enableStreamPriorities(s);
	assert.equal((await runs.backfillStreamInputs(s)).complete, false);
	assert.equal((await runs.streamState(s)).inputBackfillSequence, 128);
	journal.close();
	journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
	runs = journal.pagedRuns(access);
	assert.equal((await runs.streamState(s)).inputBackfillSequence, 128);
	assert.equal((await runs.nextStreamInput(s))!.sequence, 1, 'selection falls back while folded proof is pending');
	while (!(await runs.backfillStreamInputs(s)).complete) {
		/* Each call commits one bounded migration page. */
	}
	const priority = (await runs.nextStreamInput(s))!;
	assert.equal(priority.sequence, 280);
	assert.equal(priority.entry.path, 'Cafe\u0301');
	await runs.appendStream(s, priority, binding(s, priority));
	assert.equal((await runs.streamState(s)).sequence, 0);
	assert.equal((await runs.streamState(s)).preparedAhead, 1);
	const operation = (await runs.claimNext(s))!;
	journal.close();
	journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
	runs = journal.pagedRuns(access);
	assert.equal((await runs.claimNext(s))!.id, operation.id);
	assert.equal(await journal.pagedCheckpoints(access).current(), null);
	journal.close();
});

test('more than 128 ahead receipts drain contiguously across restart; no source rows disappear at the batch boundary', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec();
	let runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	await f.journal().priorities(access).save(['Z'], 0);
	const entries = [folder('ordinary'), ...Array.from({ length: 260 }, (_, i) => folder('Z/' + String(i).padStart(3, '0')))];
	for (let offset = 0; offset < entries.length; offset += 128)
		await runs.appendStreamInput(
			s,
			s.streaming!.captureId,
			entries.slice(offset, offset + 128).map((entry, i) => ({ sequence: offset + i + 1, revision: '1', entry })),
			offset + 128 >= entries.length
		);
	for (let i = 0; i < 260; i++) {
		const event = (await runs.nextStreamInput(s))!;
		assert.ok(event.entry.path.startsWith('Z/'));
		await runs.appendStream(s, event, null);
	}
	assert.equal((await runs.streamState(s)).sequence, 0);
	assert.equal((await runs.streamState(s)).preparedAhead, 260);
	await f.reload();
	runs = f.journal().pagedRuns(access);
	const gap = (await runs.nextStreamInput(s))!;
	assert.equal(gap.sequence, 1);
	await runs.appendStream(s, gap, null);
	assert.equal((await runs.streamState(s)).sequence, 128);
	assert.equal((await runs.streamState(s)).preparedAhead, 133);
	assert.equal(await runs.nextStreamInput(s), null);
	assert.equal((await runs.streamState(s)).sequence, 261);
	assert.equal((await runs.streamState(s)).preparedAhead, 0);
	await runs.sealStream(s, s.streaming!.captureId, 261);
	await runs.finishStream(s);
	assert.equal(await f.journal().pagedCheckpoints(access).current(), null);
	f.journal().close();
});

test('missing ahead markers and changed staged observations fail closed instead of proving a terminal baseline', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec(),
		runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	await f.journal().priorities(access).save(['priority'], 0);
	await runs.appendStreamInput(
		s,
		s.streaming!.captureId,
		['ordinary', 'priority'].map((path, i) => ({ sequence: i + 1, revision: '1', entry: folder(path) })),
		true
	);
	const priority = (await runs.nextStreamInput(s))!;
	await assert.rejects(
		runs.appendStream(s, { ...priority, entry: { ...priority.entry, version: 'changed' }, revision: 'changed' }, null),
		/input changed/
	);
	assert.equal((await runs.streamState(s)).sequence, 0);
	await runs.appendStream(s, priority, null);
	await editReview(f.factory, (store) => store.delete([syncScopeKey(scope), s.id, 'event', 2]));
	await runs.appendStream(s, (await runs.nextStreamInput(s))!, null);
	await assert.rejects(runs.nextStreamInput(s), /input is missing or changed/);
	await assert.rejects(runs.sealStream(s, s.streaming!.captureId, 2), /completion changed/);
	assert.equal((await runs.streamState(s)).sequence, 1);
	assert.equal(await f.journal().pagedCheckpoints(access).current(), null);
	f.journal().close();
});

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};
const page = (id: string, entries: SyncEntry[], after = 0, terminal = false): NativeIndexChangesPage => ({
	id,
	generation: id,
	state: terminal ? 'complete' : 'running',
	revision: after + entries.length,
	changes: entries.map((entry, i) => ({ entry, revision: entry.version, sequence: after + i + 1 })),
	nextSequence: after + entries.length,
	hasMore: false
});

test(
	'actual planner reselects priorities changed while a 128-operation queue waits, before the next ordinary effect',
	{ timeout: 15000 },
	async () => {
		const f = await foregroundFixture(128),
			access = { scope, currentScope: () => scope },
			s = spec(),
			runs = f.journal().pagedRuns(access);
		await runs.begin(s);
		for (const [i, entry] of f.local.entries()) {
			const change = { generation: s.streaming!.captureId, sequence: i + 1, revision: '1', entry };
			await runs.appendStream(s, change, binding(s, change));
		}
		await f.journal().priorities(access).save(['not-yet-indexed'], 0);
		const extra = ['late-ordinary', 'priority'].map((path) => ({ ...f.local[0], path, id: 'native-' + path }));
		f.local.push(...extra);
		const input: ForegroundSyncInput = {
				...f.input(),
				nativeOperationGuards: true,
				inspectLocal: async (path) => f.local.find((entry) => entry.path === path) ?? null
			},
			started = deferred(),
			release = deferred(),
			spooled = deferred(),
			effects: string[] = [],
			fetch = input.runtime.fetch;
		input.runtime.fetch = async (url, init) => {
			if (init?.method === 'POST') {
				effects.push(JSON.parse(String(init.body)).name);
				if (effects.length === 1) {
					started.resolve();
					await release.promise;
				}
			}
			return fetch(url, init);
		};
		const pagedRuns = input.journal.pagedRuns.bind(input.journal);
		input.journal = {
			...input.journal,
			pagedRuns: (...args) => {
				const journal = pagedRuns(...args);
				return {
					...journal,
					appendStreamInput: async (...values) => {
						const result = await journal.appendStreamInput(...values);
						spooled.resolve();
						return result;
					}
				};
			}
		};
		input.streamLocalChanges = async function* (id, after) {
			assert.equal(after, 128);
			yield page(id, extra, after, true);
		};
		const work = streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
		await Promise.all([started.promise, spooled.promise]);
		await f.journal().priorities(access).save(['priority'], 1);
		release.resolve();
		await work;
		assert.equal(effects.length, 130);
		assert.equal(effects[1], 'priority', 'the planner must not retain an ordinary selection made before capacity opened');
		assert.equal(effects.filter((path) => path === 'priority').length, 1);
		f.journal().close();
	}
);

test('prioritized file A to B to A retains revision instances, accepted receipts and final A content', { timeout: 10000 }, async () => {
	const { streamingFileFixture } = await import('./streamingFile.fixture'),
		f = await streamingFileFixture();
	f.input.nativeOperationGuards = true;
	const access = { scope, currentScope: f.input.currentScope };
	await f.input.journal.priorities(access).save([f.entry().path], 0);
	const first = deferred(),
		second = deferred();
	let transferred = 0;
	f.input.transfer = (value) => {
		if ('kind' in value && value.kind === 'file') {
			if (++transferred === 1) first.resolve();
			else second.resolve();
		}
	};
	f.input.streamLocalChanges = async function* (id) {
		yield page(id, [folder('unrelated-stale-row'), f.entry()]);
		await first.promise;
		await f.revise([4, 5, 6, 7]);
		yield page(id, [f.entry()], 2);
		await second.promise;
		await f.revise([1, 2, 3], '1');
		yield page(id, [f.entry()], 3, true);
	};
	await streamOneWayForegroundSync(saved, scope, f.input, new AbortController().signal);
	assert.equal(f.publications(), 3);
	assert.equal(f.puts(), 3);
	const current = [...f.files.values()][0];
	assert.deepEqual(f.objects.get(current.content.attachmentId), new Uint8Array([1, 2, 3]));
	assert.equal(await f.input.journal.pagedCheckpoints(access).current(), null);
	f.journal().close();
});

test('preparing a priority cannot bypass fresh configuration, network, account or scope checks', { timeout: 10000 }, async () => {
	for (const drift of ['configuration', 'network', 'scope'] as const) {
		const f = await foregroundFixture(2),
			input: ForegroundSyncInput = {
				...f.input(),
				nativeOperationGuards: true,
				inspectLocal: async (path) => f.local.find((entry) => entry.path === path) ?? null
			};
		let current = { ...scope },
			changed = false;
		input.currentScope = () => current;
		await input.journal.priorities({ scope, currentScope: input.currentScope }).save([f.local[1].path], 0);
		const fetch = input.runtime.fetch;
		input.runtime.fetch = async (url, init) => {
			const response = await fetch(url, init);
			if (!changed && new URL(String(url)).searchParams.get('path') === f.local[1].path) {
				changed = true;
				if (drift === 'configuration') f.change();
				else if (drift === 'network') f.condition('offline');
				else current = { ...scope, ownerId: 'changed-owner' };
			}
			return response;
		};
		input.streamLocalChanges = async function* (id) {
			yield page(id, f.local, 0, true);
		};
		await assert.rejects(streamOneWayForegroundSync(saved, scope, input, new AbortController().signal));
		assert.equal(changed, true);
		assert.equal(f.creates(), 0);
		f.journal().close();
	}
});

test('normalized index candidates must match their actual scope/run primary keys', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec(),
		runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	await runs.appendStreamInput(
		s,
		s.streaming!.captureId,
		[
			{ sequence: 1, revision: '1', entry: folder('ordinary') },
			{ sequence: 2, revision: '1', entry: folder('priority') }
		],
		false
	);
	await editReview(f.factory, (store) =>
		store.add(
			{
				generation: s.streaming!.captureId,
				sequence: 1,
				revision: '1',
				entry: folder('priority'),
				inputScope: 'foreign',
				inputRun: s.id,
				inputPath: 'priority'
			},
			['foreign', s.id, 'input', 1]
		)
	);
	await f.journal().priorities(access).save(['priority'], 0);
	assert.equal((await runs.nextStreamInput(s))!.sequence, 2);
	await editReview(f.factory, (store) =>
		store.put(
			{
				generation: s.streaming!.captureId,
				sequence: 1,
				revision: '1',
				entry: folder('priority'),
				inputScope: syncScopeKey(scope),
				inputRun: s.id,
				inputPath: 'priority'
			},
			['foreign', s.id, 'input', 1]
		)
	);
	await assert.rejects(runs.nextStreamInput(s), /input is missing or changed/);
	assert.equal((await runs.active())!.progress.operations, 0);
	f.journal().close();
});

test('bounded preference and maximum-depth ancestor scans resume without starving a valid late preference', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec(),
		runs = f.journal().pagedRuns(access),
		path = Array.from({ length: 128 }, () => 'a').join('/');
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	const change = { generation: s.streaming!.captureId, sequence: 1, revision: '1', entry: folder(path) };
	await runs.appendStream(s, change, binding(s, change));
	await f
		.journal()
		.priorities(access)
		.save([...Array.from({ length: 140 }, (_, i) => 'missing-' + i), path], 0);
	assert.equal((await runs.claimNext(s))!.mutation.path, path);
	f.journal().close();
});

test('a fallback host retains ahead receipts but does not enable new priority preparation or block ordinary claims', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec(),
		runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.enableStreamPriorities(s);
	const ready = { generation: s.streaming!.captureId, sequence: 1, revision: '1', entry: folder('ready') };
	await runs.appendStream(s, ready, binding(s, ready));
	await runs.appendStreamInput(
		s,
		s.streaming!.captureId,
		['ordinary', 'priority'].map((path, i) => ({ sequence: i + 2, revision: '1', entry: folder(path) })),
		false
	);
	await f.journal().priorities(access).save(['priority'], 0);
	assert.equal((await runs.nextStreamInput(s, false))!.entry.path, 'ordinary');
	assert.equal((await runs.claimNext(s, false))!.mutation.path, 'ready');
	f.journal().close();
});

test(
	'a suspended legacy backfill cannot block a full queue; growing input keeps a fixed cutoff and later priority proof wakes execution',
	{ timeout: 60000 },
	async () => {
		const f = await foregroundFixture(128),
			access = { scope, currentScope: () => scope },
			s = spec(),
			runs = f.journal().pagedRuns(access);
		await runs.begin(s);
		for (const [i, entry] of f.local.entries()) {
			const change = { generation: s.streaming!.captureId, sequence: i + 1, revision: '1', entry };
			await runs.appendStream(s, change, binding(s, change));
		}
		const legacy = [...Array.from({ length: 256 }, (_, i) => 'legacy-' + i), 'priority'].map((path) => ({
				...f.local[0],
				path,
				id: 'native-' + path
			})),
			growing = Array.from({ length: 100 }, (_, i) => ({ ...f.local[0], path: 'growing-' + i, id: 'new-' + i }));
		f.local.push(...legacy, ...growing);
		for (let offset = 0; offset < legacy.length; offset += 128)
			await runs.appendStreamInput(
				s,
				s.streaming!.captureId,
				legacy.slice(offset, offset + 128).map((entry, i) => ({ sequence: 129 + offset + i, revision: '1', entry })),
				false
			);
		await f.journal().priorities(access).save(['not-indexed-first', 'priority'], 0);
		const input: ForegroundSyncInput = {
				...f.input(),
				nativeOperationGuards: true,
				inspectLocal: async (path) => f.local.find((entry) => entry.path === path) ?? null
			},
			migrationStarted = deferred(),
			releaseMigration = deferred(),
			twoEffects = deferred(),
			growingSpooled = deferred(),
			effects: string[] = [];
		let migrationComplete = false,
			first = true;
		const pagedRuns = input.journal.pagedRuns.bind(input.journal);
		input.journal = {
			...input.journal,
			pagedRuns: (...args) => {
				const journal = pagedRuns(...args);
				return {
					...journal,
					backfillStreamInputs: async (...values) => {
						if (first) {
							first = false;
							migrationStarted.resolve();
							await releaseMigration.promise;
						}
						const result = await journal.backfillStreamInputs(...values);
						migrationComplete = result.complete;
						return result;
					},
					appendStreamInput: async (...values) => {
						const result = await journal.appendStreamInput(...values);
						growingSpooled.resolve();
						return result;
					}
				};
			}
		};
		const diagnostics: NonNullable<Parameters<typeof input.progress>[0]['priorityReadiness']>[] = [];
		const publish = input.progress;
		input.progress = value => { if (value.priorityReadiness) diagnostics.push(value.priorityReadiness); publish(value); };
		const fetch = input.runtime.fetch;
		input.runtime.fetch = async (url, init) => {
			if (init?.method === 'POST') {
				effects.push(JSON.parse(String(init.body)).name);
				if (effects.length <= 2) assert.equal(migrationComplete, false);
				if (effects.length === 2) twoEffects.resolve();
			}
			return fetch(url, init);
		};
		input.streamLocalChanges = async function* (id, after) {
			assert.equal(after, 385);
			yield page(id, growing, after, true);
		};
		const work = streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
		await Promise.all([migrationStarted.promise, twoEffects.promise, growingSpooled.promise]);
		const status = await runs.streamState(s);
		assert.equal(status.inputBackfillThrough, 385);
		assert.equal(status.indexedSequence, 485);
		assert.equal(migrationComplete, false, 'ordinary effects must occur while migration is still suspended');
		releaseMigration.resolve();
		await work;
		assert.equal(effects.length, 485);
		assert.ok(
			effects.indexOf('priority') >= 2 && effects.indexOf('priority') < 128,
			'newly proven priority must wake/reselect ahead of the ordinary backlog'
		);
		assert.ok(diagnostics.some(value => value.gate === 'enabled' && value.preferencesCount === 2 && value.proofCutoff === 385));
		assert.ok(diagnostics.some(value => value.proofCursor === 385 && value.proofCutoff === 385), 'migration completion reaches the visible saved progress path');
		assert.equal(migrationComplete, true);
		f.journal().close();
	}
);

test('legacy migration has a fixed cutoff, yields after 128 rows and honors cancellation while the producer grows', async () => {
	const f = await foregroundFixture(),
		controller = new AbortController(),
		access = { scope, currentScope: () => scope, signal: controller.signal },
		s = spec(),
		runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	for (let offset = 0; offset < 300; offset += 128)
		await runs.appendStreamInput(
			s,
			s.streaming!.captureId,
			Array.from({ length: Math.min(128, 300 - offset) }, (_, i) => ({
				sequence: offset + i + 1,
				revision: '1',
				entry: folder('ordinary-' + (offset + i))
			})),
			false
		);
	await runs.enableStreamPriorities(s);
	await f.journal().priorities(access).save(['absent-first', 'not-yet-indexed'], 0);
	assert.equal((await runs.nextStreamInput(s))!.sequence, 1);
	assert.equal((await runs.backfillStreamInputs(s)).complete, false);
	assert.equal((await runs.streamState(s)).inputBackfillSequence, 128);
	await runs.appendStreamInput(
		s,
		s.streaming!.captureId,
		Array.from({ length: 128 }, (_, i) => ({ sequence: 301 + i, revision: '1', entry: folder('new-' + i) })),
		false
	);
	assert.equal((await runs.streamState(s)).inputBackfillThrough, 300);
	controller.abort();
	await assert.rejects(
		async () => runs.backfillStreamInputs(s),
		(error) => (error as Error).name === 'AbortError'
	);
	await assert.rejects(runs.nextStreamInput(s), (error) => (error as Error).name === 'AbortError');
	const retained = f.journal().pagedRuns({ scope, currentScope: () => scope });
	assert.equal((await retained.streamState(s)).inputBackfillSequence, 128);
	assert.equal((await retained.streamState(s)).indexedSequence, 428);
	f.journal().close();
});

test('producer inserts between candidate lookup and ancestor proof cannot select an unproven alias revision', async () => {
	for (const insertedPath of ['Z/a', 'Z']) {
		const f = await foregroundFixture(),
			access = { scope, currentScope: () => scope },
			s = spec(),
			runs = f.journal().pagedRuns(access);
		await runs.begin(s);
		const entries = Array.from({ length: 300 }, (_, i) =>
			folder(i === 9 ? 'Z/z' : i === 199 ? (insertedPath === 'Z' ? 'z' : 'Z/A') : 'ordinary-' + i)
		);
		for (let offset = 0; offset < entries.length; offset += 128)
			await runs.appendStreamInput(
				s,
				s.streaming!.captureId,
				entries.slice(offset, offset + 128).map((entry, i) => ({ sequence: offset + i + 1, revision: '1', entry })),
				false
			);
		await editReview(f.factory, (store) => {
			const request = store.openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return;
				if (Array.isArray(cursor.key) && cursor.key[2] === 'input') {
					const value = cursor.value;
					delete value.inputScope;
					delete value.inputRun;
					delete value.inputPath;
					cursor.update(value);
				}
				cursor.continue();
			};
		});
		await runs.enableStreamPriorities(s);
		await runs.backfillStreamInputs(s);
		await f
			.journal()
			.priorities(access)
			.save([insertedPath === 'Z' ? 'Z/z' : 'Z'], 0);
		const original = IDBIndex.prototype.openCursor;
		let insertion: Promise<void> | undefined;
		IDBIndex.prototype.openCursor = function (...args: Parameters<typeof original>) {
			const request = original.apply(this, args);
			if (this.name === 'stream-input-path')
				request.addEventListener('success', () => {
					if (!insertion && request.result?.value.sequence === 10)
						insertion = runs.appendStreamInput(s, s.streaming!.captureId, [{ sequence: 301, revision: '1', entry: folder(insertedPath) }], false);
				});
			return request;
		};
		try {
			const selected = (await runs.nextStreamInput(s))!;
			assert.ok(insertion);
			await insertion;
			assert.equal((await runs.streamState(s)).inputBackfillSequence, 128);
			assert.equal(
				selected.sequence,
				insertedPath === 'Z' ? 1 : 10,
				'retain the proven original candidate or fall back when its actual ancestor is unproven'
			);
			await runs.appendStream(s, selected, null);
			assert.equal((await runs.active())!.progress.read, 1, 'the scheduling race must not terminate the job at the append guard');
		} finally {
			IDBIndex.prototype.openCursor = original;
			f.journal().close();
		}
	}
});
