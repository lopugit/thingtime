import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import type { ForegroundSyncInput } from './foregroundSync';
import { openSyncJournal } from './journal.client';
import { projectSyncProgress, syncProgressMetrics, type SyncProgressDescriptor } from './progressProjection';
import { createJournalSyncProgressSource } from './progressProjection.client';

test('completed journal hierarchy reopens after checkpoint releases active root and upload handle closes', async () => {
	const f = await foregroundFixture(135), input: ForegroundSyncInput = f.input();
	let descriptor: SyncProgressDescriptor | undefined;
	input.progressSession = value => { descriptor = value; };
	await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal);
	assert.ok(descriptor); assert.equal(await f.journal().pagedRuns({ scope, currentScope: () => scope }).active(), null);
	f.journal().close();
	let opens = 0, closes = 0;
	const open: typeof openSyncJournal = async () => {
		opens++; const journal = await openSyncJournal(f.factory, 'thingtime-file-sync-v1', IDBKeyRange), close = journal.close;
		return { ...journal, close: () => { closes++; close(); } };
	};
	const source = createJournalSyncProgressSource(descriptor, () => scope, open), page = await projectSyncProgress(source);
	assert.equal(page.parent.folders, 135); assert.equal(page.parent.operations, 135); assert.equal(page.parent.confirmed, 135);
	assert.equal(syncProgressMetrics(page.parent).percent, 100); assert.equal(page.rows.length, 32);
	assert.equal(opens, 1); assert.equal(closes, 1); assert.equal(f.creates(), 135);
	const second = await projectSyncProgress(source, { after: page.next });
	assert.equal(second.rows[0].path, 'Folder-032'); assert.equal(second.parent.confirmed, 135);
	assert.equal(opens, 2); assert.equal(closes, 2);
});

test('interrupted receipts remain readable with an independent view signal and account changes fail closed', async () => {
	const f = await foregroundFixture(135), input: ForegroundSyncInput = f.input(), runController = new AbortController();
	let descriptor: SyncProgressDescriptor | undefined; input.progressSession = value => { descriptor = value; }; f.lose();
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, runController.signal), /lost accepted/);
	runController.abort(); assert.ok(descriptor);
	let current = scope;
	const open: typeof openSyncJournal = () => openSyncJournal(f.factory, 'thingtime-file-sync-v1', IDBKeyRange);
	const source = createJournalSyncProgressSource(descriptor, () => current, open);
	const page = await projectSyncProgress(source);
	assert.equal(page.parent.confirmed, 128); assert.equal(page.parent.operations, 135);
	assert.equal(syncProgressMetrics(page.parent, undefined, 'paused').status, 'Paused');
	current = { ...scope, ownerId: 'other' };
	await assert.rejects(projectSyncProgress(source), /account or folder changed/);
	f.journal().close();
});

test('progress joins reject oversized pages, changed run settings, and foreign paths', async () => {
	const f = await foregroundFixture(), input: ForegroundSyncInput = f.input(); let descriptor: SyncProgressDescriptor | undefined;
	input.progressSession = value => { descriptor = value; };
	await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal); assert.ok(descriptor);
	const runs = f.journal().pagedRuns({ scope, currentScope: () => scope });
	await assert.rejects(runs.operationsForPaths(descriptor.run, Array.from({ length: 129 }, (_, i) => `file-${i}`)), /progress page/);
	await assert.rejects(runs.operationsForPaths(descriptor.run, ['../outside']), /progress page/);
	const changed = structuredClone(descriptor.run); changed.plan.local.generation = 'different';
	await assert.rejects(runs.operationsForPaths(changed, ['Documents']), /changed or is unavailable/);
	f.journal().close();
});
