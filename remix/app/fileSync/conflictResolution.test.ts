import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictCopySides, resolveFileSyncConflicts, type SyncConflict } from './conflictResolution';
import { type SyncEntry, type SyncPlan } from './reconcile';
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'config' };
const file = (side: string, digest: string): SyncEntry => ({
	path: 'report.txt',
	id: side,
	version: side + '-1',
	kind: 'file',
	size: 3,
	sha256: digest.repeat(64)
});
const conflict: SyncConflict = {
	kind: 'conflict',
	path: 'report.txt',
	reason: 'both-changed',
	local: file('local', 'a'),
	remote: file('remote', 'b')
};
const plan: SyncPlan = { scope, decisions: [conflict] };
test('reviewed file choices become conditional copies and preserve the original plan', () => {
	for (const from of ['local', 'remote'] as const) {
		const result = resolveFileSyncConflicts(plan, [conflict], [{ path: conflict.path, from }], 'two-way');
		assert.deepEqual(result.decisions, [
			{ kind: 'copy', path: conflict.path, from, source: conflict[from], expectedTarget: conflict[from === 'local' ? 'remote' : 'local'] }
		]);
		assert.equal(plan.decisions[0].kind, 'conflict');
		assert.notEqual((result.decisions[0] as any).source, conflict[from]);
	}
});
test('changed versions, contents, identities, conflict reasons and conflict sets require new review', () => {
	for (const side of ['local', 'remote'] as const)
		for (const patch of [{ version: 'new' }, { id: 'new' }, { sha256: 'c'.repeat(64) }, { size: 4 }]) {
			const changed = { ...conflict, [side]: { ...conflict[side], ...patch } };
			assert.throws(
				() => resolveFileSyncConflicts({ scope, decisions: [changed] }, [conflict], [{ path: conflict.path, from: 'local' }], 'two-way'),
				/changed during review/
			);
		}
	for (const decisions of [[], [{ ...conflict, reason: 'destination-changed' as const }], [conflict, { ...conflict, path: 'other' }]])
		assert.throws(() => resolveFileSyncConflicts({ scope, decisions }, [conflict], [{ path: conflict.path, from: 'local' }], 'two-way'), /changed/);
});
test('choices cannot reverse one-way policy, delete a survivor or bypass folder conflicts', () => {
	for (const mode of ['backup', 'upload', 'download'] as const) {
		const allowed = mode === 'download' ? 'remote' : 'local';
		assert.deepEqual(conflictCopySides(conflict, mode), [allowed]);
		assert.throws(
			() => resolveFileSyncConflicts(plan, [conflict], [{ path: conflict.path, from: allowed === 'local' ? 'remote' : 'local' }], mode),
			/source folders/
		);
	}
	const deleted = { ...conflict, reason: 'delete-edit' as const, local: null };
	assert.deepEqual(conflictCopySides(deleted, 'two-way'), ['remote']);
	assert.equal(
		(resolveFileSyncConflicts({ scope, decisions: [deleted] }, [deleted], [{ path: deleted.path, from: 'remote' }], 'two-way').decisions[0] as any)
			.expectedTarget,
		null
	);
	for (const row of [
		{ ...conflict, reason: 'excluded-descendants' as const },
		{ ...conflict, local: { ...conflict.local!, kind: 'folder' as const, size: 0, sha256: null } }
	]) {
		assert.deepEqual(conflictCopySides(row, 'two-way'), []);
		assert.throws(
			() => resolveFileSyncConflicts({ scope, decisions: [row] }, [row], [{ path: row.path, from: 'remote' }], 'two-way'),
			/source folders/
		);
	}
});
test('missing, extra, duplicate or unknown choices cannot partially apply a plan', () => {
	for (const choices of [
		[],
		[{ path: 'other', from: 'local' as const }],
		[
			{ path: conflict.path, from: 'local' as const },
			{ path: conflict.path, from: 'remote' as const }
		]
	])
		assert.throws(() => resolveFileSyncConflicts(plan, [conflict], choices, 'two-way'));
});
