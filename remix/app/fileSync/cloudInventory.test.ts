import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCloudInventory, inventorySyncEntry } from './cloudInventory';
import { contentPartPlan } from './contentFingerprint';
const content = {
	attachmentId: 'attachment',
	version: 'a'.repeat(64),
	size: 4,
	fingerprint: { ...contentPartPlan(4), algorithm: 'sha256-parts-v1', sha256: 'b'.repeat(64) }
};
const folder = { kind: 'folder' as const, id: 'folder', folderId: 'root', path: 'Documents', revision: 'folder-revision' };
const file = {
	kind: 'file' as const,
	path: 'Documents/file.txt',
	file: { id: 'file', revision: 'file-revision', name: 'file.txt', folderId: 'folder', trashed: false, content }
};
const inventory = () => ({ version: 1, complete: true, rootId: 'root', rootRevision: 'root-revision', nodes: [folder, file] });
test('nested cloud inventory retains exact stable file metadata and produces shared scan entries', () => {
	const result = parseCloudInventory(inventory(), 'root');
	assert.equal(result.nodes.length, 2);
	assert.equal(inventorySyncEntry(result.nodes[0]).kind, 'folder');
	assert.equal(inventorySyncEntry(result.nodes[1]).version, 'file-revision');
});
test('partial, foreign and malformed cloud observations never become complete scans', () => {
	for (const patch of [{ complete: false }, { rootId: 'other' }, { rootRevision: '' }, { nodes: [] }, { version: 2 }]) {
		if ('nodes' in patch) assert.equal(parseCloudInventory({ ...inventory(), ...patch }, 'root').nodes.length, 0);
		else assert.throws(() => parseCloudInventory({ ...inventory(), ...patch }, 'root'));
	}
	for (const nodes of [
		[file],
		[folder, { ...file, file: { ...file.file, folderId: 'other' } }],
		[folder, { ...file, file: { ...file.file, trashed: true } }],
		[folder, { ...file, path: '../outside' }],
		[folder, { ...file, file: { ...file.file, name: 'renamed' } }],
		[folder, { ...file, file: { ...file.file, id: 'root' } }],
		[folder, { ...folder, path: 'documents' }],
		[folder, { ...folder, id: 'second', path: 'documents' }],
		[folder, { ...folder, id: 'second', path: 'Documents/child', folderId: 'root' }]
	]) {
		assert.throws(() => parseCloudInventory({ ...inventory(), nodes }, 'root'));
	}
});
