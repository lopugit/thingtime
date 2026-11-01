import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openCloudBackupTree } from './cloudBackupTree';
import type { CloudInventoryNode } from '../../../fileSync/cloudInventory';

const root = { id: 'root', name: 'Root', folderId: null, revision: 'r1' };
const folder = (id: string, path = id, folderId = 'root'): CloudInventoryNode => ({ kind: 'folder', id, path, folderId, revision: 'r1' });

test('disk-backed backup index accepts out-of-order parents, sorts canonical IDs and removes its private workspace', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'backup-index-test-'));
	try {
		const tree = await openCloudBackupTree(root, { temporaryDirectory: directory });
		try {
			tree.append([folder('a-child', 'Parent/Child', 'z-parent')]);
			tree.append([folder('z-parent', 'Parent')]);
			await assert.rejects(async () => { for await (const _ of tree.items()) void _; }, /not ready/);
			await tree.validate(() => {});
			const items = []; for await (const row of tree.items()) items.push(row);
			assert.deepEqual(items.map(row => [row.ordinal, row.thingId]), [[0, 'a-child'], [1, 'root'], [2, 'z-parent']]);
			assert.throws(() => tree.append([]), /not writing/);
		} finally { await tree.close(); await tree.close(); }
		assert.deepEqual(await readdir(directory), []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('duplicate IDs and normalized paths across pages poison the capture', async () => {
	for (const nodes of [
		[folder('one', 'A'), folder('one', 'B')],
		[folder('one', 'Café'), folder('two', 'CAFE\u0301')],
		[folder('root', 'Duplicate root')]
	]) {
		const tree = await openCloudBackupTree(root);
		try {
			assert.throws(() => { for (const node of nodes) tree.append([node]); }, /UNIQUE constraint/);
			await assert.rejects(tree.validate(() => {}), /not writing/);
		} finally { await tree.close(); }
	}
});

test('missing or mismatched physical parents and a selected-root cycle refuse a complete inventory', async () => {
	for (const { selected, nodes } of [
		{ selected: root, nodes: [folder('child', 'Missing/Child', 'missing')] },
		{ selected: root, nodes: [folder('parent', 'Parent'), folder('child', 'Other/Child', 'parent')] },
		{ selected: { ...root, folderId: 'child' }, nodes: [folder('child', 'Child')] }
	]) {
		const tree = await openCloudBackupTree(selected);
		try { tree.append(nodes); await assert.rejects(tree.validate(() => {}), /ancestry/); }
		finally { await tree.close(); }
	}
});

test('disk budget and cancellation refuse preparation and leave no scratch files', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'backup-index-budget-'));
	try {
		const tree = await openCloudBackupTree(root, { maxBytes: 65536, temporaryDirectory: directory });
		try {
			assert.throws(() => {
				for (let i = 0; i < 1000; i++) tree.append([folder('id-' + i, 'x'.repeat(200) + i)]);
			}, /full/);
			await assert.rejects(tree.validate(() => {}), /not writing/);
		} finally { await tree.close(); }
		const cancelled = await openCloudBackupTree(root, { temporaryDirectory: directory });
		try { await assert.rejects(cancelled.validate(() => { throw Error('Cancelled'); }), /Cancelled/); }
		finally { await cancelled.close(); }
		assert.deepEqual(await readdir(directory), []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
