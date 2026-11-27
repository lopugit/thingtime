import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBIndex, IDBKeyRange } from 'fake-indexeddb';
import { streamingFileFixture } from './streamingFile.fixture';
import { saved, scope } from './foregroundSync.fixture';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { streamForegroundSync } from './streamingForegroundSync';
import { projectSyncProgress, type SyncProgressDescriptor } from './progressProjection';
import { createJournalSyncProgressSource } from './progressProjection.client';
import { openSyncJournal } from './journal.client';
import type { ForegroundSyncProgress } from './foregroundSync';

for (const interrupted of [false, true])
	test(`backup completion retains confirmed file and byte counts through strict reconciliation and reload${
		interrupted ? ' after interrupted handoff' : ''
	}`, async () => {
		const f = await streamingFileFixture();
		const input = f.input;
		input.inventory = async () => ({
			version: 1,
			complete: true,
			rootId: 'cloud-root',
			rootRevision: 'root',
			nodes: [...f.files.values()].map((file) => ({ kind: 'file', path: file.name, file }))
		});
		input.streamLocalChanges = async function* (id) {
			yield {
				id,
				generation: id,
				state: 'complete',
				revision: 1,
				nextSequence: 1,
				hasMore: false,
				changes: [{ sequence: 1, revision: f.entry().version, entry: f.entry() }]
			};
		};
		const access = { scope, currentScope: () => scope };
		const reload = async () => {
			input.journal.close();
			input.journal = await openSyncJournal(f.factory, 'thingtime-file-sync-v1', IDBKeyRange);
		};
		if (interrupted) {
			await streamForegroundSync(saved, scope, input, new AbortController().signal);
			assert.ok(await input.journal.pagedRuns(access).streamAwaitingReconciliation());
			await reload();
		}
		let latest: ForegroundSyncProgress | undefined, descriptor: SyncProgressDescriptor | undefined;
		input.progress = (value) => {
			latest = value;
		};
		input.progressSession = (value) => {
			descriptor = value;
		};
		await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal);
		assert.equal(latest?.stage, 'complete');
		assert.deepEqual([latest?.confirmed, latest?.total], [1, 1]);
		assert.equal(latest?.directions?.upload.bytesConfirmed, '3');
		assert.equal(f.publications(), 1);
		assert.ok(descriptor && !descriptor.run.streaming);
		const open: typeof openSyncJournal = () => openSyncJournal(f.factory, 'thingtime-file-sync-v1', IDBKeyRange);
		const read = () => projectSyncProgress(createJournalSyncProgressSource(descriptor!, () => scope, open));
		const projected = await read();
		assert.deepEqual([projected.parent.operations, projected.parent.confirmed, projected.parent.bytesConfirmed], [1, 1, 3]);
		assert.deepEqual(await read(), projected);
		await reload();
		assert.deepEqual(await read(), projected);
		assert.equal(await input.journal.pagedRuns(access).streamAwaitingReconciliation(), null);
		await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal);
		assert.equal(f.publications(), 1);
		assert.deepEqual([latest?.confirmed, latest?.total], [0, 0]);
		const noWork = await read();
		assert.deepEqual([noWork.parent.operations, noWork.parent.confirmed, noWork.parent.bytesConfirmed], [0, 0, 0]);
		input.journal.close();
	});

test('backup A to B to A preserves three early transfers but checkpoints only the latest confirmed effect', { timeout: 10000 }, async () => {
	const f = await streamingFileFixture(),
		input = f.input;
	input.inventory = async () => ({
		version: 1,
		complete: true,
		rootId: 'cloud-root',
		rootRevision: 'root',
		nodes: [...f.files.values()].map((file) => ({ kind: 'file', path: file.name, file }))
	});
	let wake!: () => void,
		transferred = new Promise<void>((resolve) => {
			wake = resolve;
		});
	input.transfer = (value) => {
		if ('kind' in value && value.kind === 'file') wake();
	};
	const frame = (id: string, sequence: number, complete = false) => ({
		id,
		generation: id,
		state: complete ? ('complete' as const) : ('running' as const),
		revision: sequence,
		nextSequence: sequence,
		hasMore: false,
		changes: [{ sequence, revision: f.entry().version, entry: f.entry() }]
	});
	input.streamLocalChanges = async function* (id) {
		yield frame(id, 1);
		await transferred;
		transferred = new Promise<void>((resolve) => {
			wake = resolve;
		});
		await f.revise([4, 5, 6, 7]);
		yield frame(id, 2);
		await transferred;
		await f.revise([1, 2, 3], '1');
		yield frame(id, 3, true);
	};
	let latest: ForegroundSyncProgress | undefined, descriptor: SyncProgressDescriptor | undefined;
	input.progress = (value) => {
		latest = value;
	};
	input.progressSession = (value) => {
		descriptor = value;
	};
	await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal);
	assert.deepEqual([latest?.confirmed, latest?.total, latest?.directions?.upload.bytesConfirmed], [3, 3, '10']);
	assert.equal(f.publications(), 3);
	assert.equal(f.puts(), 3);
	const live = [...f.files.values()][0];
	assert.deepEqual(f.objects.get(live.content.attachmentId), new Uint8Array([1, 2, 3]));
	const access = { scope, currentScope: () => scope },
		runs = input.journal.pagedRuns(access);
	const early = await runs.earlyProgressSource(descriptor!.run);
	assert.ok(early);
	assert.equal((await runs.readConfirmed(early)).total, 1);
	const checkpoint = await input.journal.pagedCheckpoints(access).current();
	assert.ok(checkpoint);
	const remote = await input.journal.inventory(access).entriesForPaths(checkpoint.baseline.remote, [f.entry().path]);
	assert.equal(remote[0]?.version, live.revision);
	input.journal.close();
	const open: typeof openSyncJournal = () => openSyncJournal(f.factory, 'thingtime-file-sync-v1', IDBKeyRange);
	const tree = await projectSyncProgress(createJournalSyncProgressSource(descriptor!, () => scope, open));
	assert.deepEqual([tree.parent.files, tree.parent.operations, tree.parent.confirmed, tree.parent.bytesConfirmed], [1, 3, 3, 10]);
});

test(
	'completion evidence migrates legacy repeated receipts in bounded pages and resumes after cancellation without counting unpublished intents',
	{ timeout: 10000 },
	async () => {
		const { foregroundFixture } = await import('./foregroundSync.fixture');
		const { prepareCloudInventoryWrite } = await import('./cloudWrite');
		const f = await foregroundFixture(),
			controller = new AbortController();
		const access = { scope, currentScope: () => scope, signal: controller.signal };
		const runs = f.journal().pagedRuns(access);
		const identity = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
		const spec = {
			id: crypto.randomUUID(),
			configuration: saved.configuration,
			streaming: { source: 'local' as const, captureId: crypto.randomUUID() },
			plan: {
				id: crypto.randomUUID(),
				local: identity('local'),
				remote: identity('remote'),
				baseline: { local: identity('local'), remote: identity('remote') },
				policy: { mode: 'backup' as const, propagateDeletes: false },
				excludedPaths: []
			}
		};
		await runs.begin(spec);
		for (let sequence = 1; sequence <= 132; sequence++) {
			const source = { ...f.local[0], version: String(sequence) },
				operation = {
					id: crypto.randomUUID(),
					mutation: { kind: 'copy' as const, path: source.path, from: 'local' as const, source, expectedTarget: null },
					confirmed: false
				};
			await runs.appendStream(
				spec,
				{ generation: spec.streaming.captureId, sequence, revision: source.version, entry: source },
				{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') }
			);
			const claimed = await runs.claimNext(spec);
			assert.equal(claimed?.id, operation.id);
			await runs.confirm(spec, { operationId: operation.id, scope, entry: { ...source, id: operation.id, version: 'cloud-' + sequence } });
		}
		const skippedSource = { ...f.local[0], path: 'Skipped', version: '1' },
			skipped = {
				id: crypto.randomUUID(),
				mutation: { kind: 'copy' as const, path: skippedSource.path, from: 'local' as const, source: skippedSource, expectedTarget: null },
				confirmed: false
			};
		await runs.appendStream(
			spec,
			{ generation: spec.streaming.captureId, sequence: 133, revision: skippedSource.version, entry: skippedSource },
			{ write: prepareCloudInventoryWrite(skipped, scope, 'cloud-root', null, 'cloud-root') }
		);
		assert.equal((await runs.claimNext(spec))?.id, skipped.id);
		await runs.skipUnpublishedStreamOperation(spec, skipped.id, true);
		await runs.sealStream(spec, spec.streaming.captureId, 133);
		// Let the first bounded migration transaction commit, then abort at its yield.
		const task = runs.finishStream(spec);
		const observer = f.journal().pagedRuns({ scope, currentScope: () => scope });
		const partial = await observer.confirmedHistoryForPaths(spec, [f.local[0].path]);
		assert.ok(partial[0] && partial[0].operations > 0 && partial[0].operations <= 128);
		controller.abort(Error('cancel completion migration'));
		await assert.rejects(task, /cancel completion migration/);
		await f.reload();
		const resumed = f.journal().pagedRuns({ scope, currentScope: () => scope });
		const originalCount = IDBIndex.prototype.count;
		let indexCounts = 0;
		IDBIndex.prototype.count = function (...args) {
			if (this.name === 'path') indexCounts++;
			return originalCount.apply(this, args);
		};
		try {
			await resumed.finishStream(spec);
			assert.deepEqual([(await resumed.completedStreamProgress(spec)).operations, (await resumed.readConfirmed(spec)).total], [132, 1]);
			await resumed.readConfirmed(spec);
			assert.equal(indexCounts, 1, 'seal counts latest effects once; immutable cursor reads use the sealed count');
		} finally {
			IDBIndex.prototype.count = originalCount;
		}
		const history = await resumed.confirmedHistoryForPaths(spec, [f.local[0].path]);
		assert.deepEqual(history, [{ operations: 131, files: 0, bytes: '0' }]);
		await resumed.completedStreamProgress(spec);
		assert.deepEqual(await resumed.confirmedHistoryForPaths(spec, [f.local[0].path]), history);
		f.journal().close();
	}
);

test('confirmed history-only paths retain root and parent activity totals without inventing current files or checkpoint effects', async () => {
	const { prepareCloudInventoryWrite } = await import('./cloudWrite');
	const f = await streamingFileFixture('Parent/removed.bin'),
		input = f.input;
	const access = { scope, currentScope: () => scope },
		runs = input.journal.pagedRuns(access);
	const identity = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
	const spec = {
		id: crypto.randomUUID(),
		configuration: saved.configuration,
		streaming: { source: 'local' as const, captureId: crypto.randomUUID() },
		plan: {
			id: crypto.randomUUID(),
			local: identity('local'),
			remote: identity('remote'),
			baseline: { local: identity('local'), remote: identity('remote') },
			policy: { mode: 'backup' as const, propagateDeletes: false },
			excludedPaths: []
		}
	};
	await runs.begin(spec);
	const first = {
		id: crypto.randomUUID(),
		mutation: { kind: 'copy' as const, path: f.entry().path, from: 'local' as const, source: f.entry(), expectedTarget: null },
		confirmed: false
	};
	await runs.appendStream(
		spec,
		{ generation: spec.streaming.captureId, sequence: 1, revision: f.entry().version, entry: f.entry() },
		{ write: prepareCloudInventoryWrite(first, scope, 'cloud-root', null, 'cloud-root') }
	);
	await runs.claimNext(spec);
	await runs.confirm(spec, { operationId: first.id, scope, entry: { ...f.entry(), id: first.id, version: 'confirmed-A' } });
	await f.revise([4, 5, 6, 7]);
	const second = { ...first, id: crypto.randomUUID(), mutation: { ...first.mutation, source: f.entry() } };
	await runs.appendStream(
		spec,
		{ generation: spec.streaming.captureId, sequence: 2, revision: f.entry().version, entry: f.entry() },
		{ write: prepareCloudInventoryWrite(second, scope, 'cloud-root', null, 'cloud-root') }
	);
	assert.equal((await runs.claimNext(spec))?.id, second.id);
	await runs.skipUnpublishedStreamOperation(spec, second.id, true);
	await runs.sealStream(spec, spec.streaming.captureId, 2);
	await runs.finishStream(spec);
	assert.equal((await runs.readConfirmed(spec)).total, 0);
	input.scanLocal = async () => [];
	input.inspectLocal = async () => null;
	input.inventory = async () => ({ version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root', nodes: [] });
	let descriptor: SyncProgressDescriptor | undefined, final: ForegroundSyncProgress | undefined;
	input.progressSession = (value) => {
		descriptor = value;
	};
	input.progress = (value) => {
		final = value;
	};
	await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal);
	assert.deepEqual([final?.confirmed, final?.total, final?.directions?.upload.bytesConfirmed], [1, 1, '3']);
	assert.equal(f.publications(), 0);
	const checkpoint = await input.journal.pagedCheckpoints(access).current();
	assert.ok(checkpoint);
	assert.deepEqual((await input.journal.inventory(access).read(checkpoint.baseline.local)).entries, []);
	assert.deepEqual((await input.journal.inventory(access).read(checkpoint.baseline.remote)).entries, []);
	input.journal.close();
	const open: typeof openSyncJournal = () => openSyncJournal(f.factory, 'thingtime-file-sync-v1', IDBKeyRange);
	const source = () => createJournalSyncProgressSource(descriptor!, () => scope, open);
	const root = await projectSyncProgress(source()),
		parent = await projectSyncProgress(source(), { parent: 'Parent' });
	for (const summary of [root.parent, root.rows[0], parent.parent, parent.rows[0]])
		assert.deepEqual(
			[summary.files, summary.folders, summary.indexedBytes, summary.operations, summary.confirmed, summary.bytesConfirmed],
			[0, 0, 0, 1, 1, 3]
		);
	assert.deepEqual(await projectSyncProgress(source()), root);
});
