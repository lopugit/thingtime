import assert from 'node:assert/strict';
import test from 'node:test';
import { REMOTE_SYNC_RESULT_BYTES, validateRemoteSyncCommand } from './remoteSyncProtocol';

test('remote sync accepts management controls but never arbitrary native file transport', () => {
	for (const command of [{ action: 'status' }, { action: 'status', cursor: '32' }, { action: 'folders', request: { action: 'choose' } },
		{ action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00.000Z', intervalMs: 300000 },
		{ action: 'pause', connectionId: 'connection' }]) assert.deepEqual(validateRemoteSyncCommand(command), command);
	for (const action of ['read', 'read-range', 'upload-file', 'upload-batch', 'publish', 'trash', 'write-approve', 'stage-range', 'scan']) {
		assert.throws(() => validateRemoteSyncCommand({ action: 'folders', request: { action, rootId: 'local' } }), /Invalid remote/);
	}
	assert.throws(() => validateRemoteSyncCommand({ action: 'status', ownerId: 'foreign' }));
	assert.throws(() => validateRemoteSyncCommand({ action: 'folders', request: { action: 'choose', rootId: 'injected' } }));
	assert.throws(() => validateRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: 'yesterday', intervalMs: 300000 }));
	assert.throws(() => validateRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00Z', intervalMs: '300000' }));
});

test('remote conflict approvals bind the exact review and observed revision', () => {
	const base = { action: 'review', connectionId: 'connection', reviewId: 'review' };
	assert.deepEqual(validateRemoteSyncCommand({ ...base, operation: 'finish', resolution: 'resolve', revision: 4 }), { ...base, operation: 'finish', resolution: 'resolve', revision: 4 });
	assert.throws(() => validateRemoteSyncCommand({ ...base, operation: 'finish', resolution: 'resolve' }));
	assert.throws(() => validateRemoteSyncCommand({ ...base, operation: 'choose', path: '../secret', from: 'local', revision: 1 }));
	assert.throws(() => validateRemoteSyncCommand({ ...base, operation: 'cancel', revision: 1 }));
});

test('remote control envelope preserves the existing one MiB native metadata page budget', () => {
	const page = { roots: [], trashPage: { items: [{ metadata: 'x'.repeat(1024 * 1024) }], nextCursor: null } };
	assert.ok(new TextEncoder().encode(JSON.stringify({ ok: true, status: 'complete', result: page })).byteLength < REMOTE_SYNC_RESULT_BYTES);
});
