import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { prepareCloudInventoryWrite } from './cloudWrite';
import type { PagedRunSpec } from './pagedRunJournal';
import type { SyncEntry } from './reconcile';
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
test('ready stream priorities preserve parent order and revisit new earlier paths without skipping confirmed receipts', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		runs = f.journal().pagedRuns(access),
		s = spec();
	await runs.begin(s);
	await f.journal().priorities(access).save(['Z/sub'], 0);
	const ids = new Map<string, string>();
	let sequence = 0;
	const append = async (path: string) => {
		const source: SyncEntry = { path, id: 'native-' + path, version: '1', kind: 'folder', size: 0, sha256: null },
			operation = {
				id: crypto.randomUUID(),
				mutation: { kind: 'copy' as const, path, from: 'local' as const, source, expectedTarget: null },
				confirmed: false
			};
		ids.set(path, operation.id);
		const parent = path.split('/').slice(0, -1).join('/');
		await runs.appendStream(
			s,
			{ generation: s.streaming!.captureId, sequence: ++sequence, revision: '1', entry: source },
			{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, parent ? ids.get(parent)! : 'cloud-root') }
		);
	};
	for (const path of ['a', 'Z', 'Z/sub']) await append(path);
	const order: string[] = [];
	const confirm = async () => {
		const op = (await runs.claimNext(s))!;
		assert.ok(op);
		order.push(op.mutation.path);
		const source = op.mutation.kind === 'copy' ? op.mutation.source : null;
		await runs.confirm(s, { operationId: op.id, scope, entry: source && { ...source, id: op.id, version: 'created' } });
	};
	await confirm();
	await confirm();
	await confirm();
	assert.deepEqual(order, ['Z', 'Z/sub', 'a']);
	assert.equal(await runs.streamReadyToFinish(s), true);
	assert.equal(await runs.claimNext(s), null);
	await append('0-new');
	assert.equal(await runs.streamReadyToFinish(s), false);
	await confirm();
	assert.equal(order.at(-1), '0-new');
	await runs.sealStream(s, s.streaming!.captureId, sequence);
	await runs.finishStream(s);
	f.journal().close();
});
test('same event retries preserve IDs and a reserved unpublished effect cannot be replaced by a new path revision', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		runs = f.journal().pagedRuns(access),
		s = spec();
	await runs.begin(s);
	const source: SyncEntry = { path: 'file', id: 'native', version: '1', kind: 'folder', size: 0, sha256: null },
		op = {
			id: crypto.randomUUID(),
			mutation: { kind: 'copy' as const, path: 'file', from: 'local' as const, source, expectedTarget: null },
			confirmed: false
		};
	const event = { generation: s.streaming!.captureId, sequence: 1, revision: '1', entry: source },
		binding = { write: prepareCloudInventoryWrite(op, scope, 'cloud-root', null, 'cloud-root') };
	await runs.appendStream(s, event, binding);
	await runs.appendStream(s, event, binding);
	assert.equal((await runs.active())!.progress.operations, 1);
	assert.equal((await runs.claimNext(s))!.id, op.id);
	await assert.rejects(runs.appendStream(s, { ...event, sequence: 2 }, binding), /Finish the prior/);
	assert.equal((await runs.claimNext(s))!.id, op.id);
	await assert.rejects(runs.appendStream(s, { ...event, entry: { ...source, version: 'changed' }, revision: 'changed' }, null), /retry changed/);
	f.journal().close();
});

test('raw index pages survive reopen independently of prepared operations and source cursors cannot overrun durable input', async () => {
	const f = await foregroundFixture(),
		access = { scope, currentScope: () => scope },
		s = spec();
	s.streaming!.source = 'remote';
	s.plan.policy.mode = 'download';
	s.configuration = { ...s.configuration!, mode: 'download' };
	let runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	await runs.checkpointStreamSource(s, 0, '100', false);
	const entry: SyncEntry = { path: 'file', id: 'inode', version: '1', kind: 'folder', size: 0, sha256: null };
	await runs.appendStreamInput(s, s.streaming!.captureId, [{ sequence: 1, revision: '1', entry }], false);
	assert.equal((await runs.active())!.progress.operations, 0);
	assert.equal(await runs.streamReadyToFinish(s), false);
	await assert.rejects(runs.checkpointStreamSource(s, 0, '101', false), /changed/);
	await runs.checkpointStreamSource(s, 1, '101', true);
	await f.reload();
	runs = f.journal().pagedRuns(access);
	const status = await runs.streamState(s);
	assert.equal(status.indexedSequence, 1);
	assert.equal(status.sequence, 0);
	assert.equal(status.sourceCursor, '101');
	assert.equal((await runs.nextStreamInput(s))!.entry.path, 'file');
	await assert.rejects(runs.appendStream(s, { generation: s.streaming!.captureId, sequence: 1, revision: 'changed', entry: { ...entry, version: 'changed' } }, null), /input changed/);
	assert.equal((await runs.streamState(s)).sequence, 0);
	assert.equal((await runs.nextStreamInput(s))!.entry.version, '1');
	await assert.rejects(runs.checkpointStreamSource(s, 1, '99', true), /changed/);
	await assert.rejects(runs.checkpointStreamSource(s, 1, '102', false), /changed/);
	await assert.rejects(runs.sealStream(s, s.streaming!.captureId, 0), /changed/);
	f.journal().close();
});
