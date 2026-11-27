import assert from 'node:assert/strict';
import test from 'node:test';
import { openBackupWorkspace, BACKUP_WORKSPACE_BYTES } from './backupWorkspace';

test('available-disk workspaces remove application graph ceilings while preserving legacy and explicit resource budgets', async () => {
	const normal = await openBackupWorkspace();
	try { assert.equal(Number(normal.db.prepare('PRAGMA max_page_count').get()?.max_page_count), BACKUP_WORKSPACE_BYTES / 4096); }
	finally { await normal.close(); }
	await assert.rejects(openBackupWorkspace({ maxBytes: 16 * 1024 ** 3 }), /bound/);
	const available = await openBackupWorkspace({ diskBudget: 'available' });
	try {
		assert(Number(available.db.prepare('PRAGMA max_page_count').get()?.max_page_count) > 8 * 1024 ** 3 / 4096);
		assert.equal(Number(available.db.prepare('PRAGMA cache_size').get()?.cache_size), -2048);
		assert.equal(Number(available.db.prepare('PRAGMA mmap_size').get()?.mmap_size), 0);
	} finally { await available.close(); }
	for (const maxBytes of [65536, 16 * 1024 ** 3]) {
		const budgeted = await openBackupWorkspace({ diskBudget: 'available', maxBytes });
		try { assert.equal(Number(budgeted.db.prepare('PRAGMA max_page_count').get()?.max_page_count), maxBytes / 4096); }
		finally { await budgeted.close(); }
	}
	await assert.rejects(openBackupWorkspace({ diskBudget: 'available', maxBytes: -1 }), /bound/);
});
