import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMobileFolderResult, supportsMobileTrashRecovery, type MobileTrashRequest } from './mobileFolders.client';

const owner = { requestId: 'request', ownerId: 'owner', origin: 'https://native.test' };
const rootId = '00000000-0000-4000-8000-000000000001';
const entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 3, sha256: 'a'.repeat(64) };
const trash: MobileTrashRequest = {
	rootId,
	scope: { ...owner, dataPlane: 'home', rootId: 'previous-connection', deviceId: 'previous-device' },
	operation: {
		id: '00000000-0000-4000-8000-000000000002',
		confirmed: false,
		mutation: { kind: 'trash', side: 'local', path: entry.path, expected: entry }
	}
};
const item = { request: trash, kind: 'file', size: 3, state: 'retained' };
const response = (extra: object) => ({
	type: 'mobile-files-result',
	payload: { ...owner, rootId, roots: [{ id: rootId, name: 'Folder' }], ...extra }
});
const page = (items: any[], nextCursor: unknown = null) =>
	parseMobileFolderResult(response({ trashPage: { items, nextCursor } }), owner, { action: 'trash-list', rootId });

test('native recovery pages bind owner and grant while permitting previous connections and pairing', () => {
	assert.equal(page([item])?.trashPage?.items[0].request.scope.deviceId, 'previous-device');
	assert.equal(page([], 'a'.repeat(64))?.trashPage?.nextCursor, 'a'.repeat(64));
	for (const key of ['ownerId', 'origin', 'dataPlane']) {
		const foreign = structuredClone(item);
		(foreign.request.scope as any)[key] = 'other';
		assert.throws(() => page([foreign]));
	}
	assert.throws(() => page([{ ...item, request: { ...trash, rootId: 'different' } }]));
	for (const invalid of [
		[item, item],
		Array(21).fill(item),
		[{ ...item, size: -1 }],
		[{ ...item, state: 'restoring' }],
		[{ ...item, request: { ...trash, childrenOperationId: trash.operation.id } }]
	])
		assert.throws(() => page(invalid));
	assert.throws(() => page([], '../bad'));
});
test('recovery preserves immutable native restore intent and rejects forged completion', () => {
	const restore = { path: 'restored-file', expected: entry };
	const result = parseMobileFolderResult(response({ retainedEntry: null, restoreIntent: { request: restore } }), owner, {
		action: 'trash-inspect',
		rootId,
		trash
	});
	assert.deepEqual(result?.restoreIntent?.request, restore);
	const request = { action: 'trash-restore-reviewed' as const, rootId, trash, restore };
	assert.equal(
		parseMobileFolderResult(response({ restoredEntry: { ...entry, path: restore.path, version: '2' } }), owner, request)?.restoredEntry?.path,
		restore.path
	);
	for (const changed of [{ path: 'wrong' }, { id: 'different-inode' }, { sha256: 'b'.repeat(64) }]) {
		assert.throws(() => parseMobileFolderResult(response({ restoredEntry: { ...entry, path: restore.path, ...changed } }), owner, request));
	}
	assert.throws(() =>
		parseMobileFolderResult(response({ retainedEntry: null, restoreIntent: { request: { ...restore, path: '../escape' } } }), owner, {
			action: 'trash-inspect',
			rootId,
			trash
		})
	);
	assert.throws(() => page([{ ...item, state: 'restoring', restore: { ...restore, expected: { ...entry, path: 'wrong-source' } } }]));
});
test('native recovery is advertised only with its own compatible protocol version', () => {
	const bridge = { platform: 'ios' as const, fileAccessVersion: '1.4.0', fileStagingVersion: '1.2.0', filePublicationVersion: '1.0.0' };
	for (const version of ['1.0.0', '1.1.0', '2.0.0', 'invalid'])
		assert.equal(supportsMobileTrashRecovery({ ...bridge, fileTrashVersion: version }), false);
	assert.equal(supportsMobileTrashRecovery({ ...bridge, fileTrashVersion: '1.2.0' }), true);
});
