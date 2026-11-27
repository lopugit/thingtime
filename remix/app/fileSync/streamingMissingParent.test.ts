import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { streamOneWayForegroundSync } from './streamingForegroundSync';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import type { ForegroundSyncInput } from './foregroundSync';

test('child hint before its parent defers effects until sealed reconciliation, retaining one parent and child', async () => {
	const f = await foregroundFixture();
	const parent = { path: 'Parent', id: 'parent-inode', version: 'v1', kind: 'folder' as const, size: 0, sha256: null };
	const child = { ...parent, path: 'Parent/Child', id: 'child-inode' };
	f.local.splice(0, f.local.length, parent, child);
	const input = (): ForegroundSyncInput => ({ ...f.input(), inventory: async () => {
		const path = (id: string): string => {
			const row = f.rows.get(id)!;
			return row.folderId === 'cloud-root' ? row.name : `${path(row.folderId)}/${row.name}`;
		};
		return { version: 1 as const, complete: true as const, rootId: 'cloud-root', rootRevision: 'root-revision',
			nodes: [...f.rows.values()].map(row => ({ kind: 'folder' as const, path: path(row.id), id: row.id, folderId: row.folderId, revision: row.revision })) };
	}, inspectLocal: async path => structuredClone(f.local.find(entry => entry.path === path) ?? null),
	streamLocalChanges: async function* (id, after) {
		assert.equal(after, 0);
		yield { id, generation: id, state: 'complete' as const, revision: 2,
			changes: [child, parent].map((entry, i) => ({ sequence: i + 1, revision: entry.version, entry })),
			nextSequence: 2, hasMore: false };
	} });
	try {
		const first = input();
		await streamOneWayForegroundSync(saved, scope, first, new AbortController().signal);
		assert.equal(f.creates(), 1, 'early stream can publish only the root parent');
		assert.deepEqual([...f.rows.values()].map(row => ({ name: row.name, folderId: row.folderId })), [{ name: 'Parent', folderId: 'cloud-root' }]);
		assert.equal((await first.journal.pagedRuns({ scope, currentScope: first.currentScope }).streamAwaitingReconciliation())?.streaming?.source, 'local');
		await f.reload();
		await runPagedForegroundCloudSync(saved, scope, input(), new AbortController().signal);
		assert.equal(f.creates(), 2, 'sealed full-tree scan publishes the child once');
		const rows = [...f.rows.values()];
		const parentRow = rows.find(row => row.name === 'Parent');
		const childRow = rows.find(row => row.name === 'Child');
		assert.ok(parentRow && childRow);
		assert.equal(childRow.folderId, parentRow.id);
	} finally { f.journal().close(); }
});
