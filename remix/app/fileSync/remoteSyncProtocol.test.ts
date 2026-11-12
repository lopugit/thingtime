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

test('queue-only remote enrollment accepts only an exact timed start', () => {
	const start = { action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00Z', intervalMs: 300_000, queueOnly: true };
	assert.deepEqual(validateRemoteSyncCommand(start), start);
	for (const fields of [{ intervalMs: undefined }, { queueOnly: false }, { queueOnly: 'true' }, { ownerId: 'foreign' }])
		assert.throws(() => validateRemoteSyncCommand({ ...start, ...fields }), /Invalid remote sync command/);
});

test('saved-intent recovery is an additive exact timed start and cannot combine with queue-only', () => {
 const start = { action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-23T00:00:00Z', intervalMs: 300_000, recoverSavedIntent: true };
 assert.deepEqual(validateRemoteSyncCommand(start), start);
 for (const patch of [{ recoverSavedIntent: false }, { recoverSavedIntent: 'true' }, { intervalMs: undefined }, { queueOnly: true }, { ownerId: 'foreign' }])
  assert.throws(() => validateRemoteSyncCommand({ ...start, ...patch }), /Invalid remote sync command/);
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

test('rootless device resource controls have exact keys and positive policy bounds', async () => {
 const { parseRemoteSyncResources } = await import('./remoteSyncProtocol');
 const policy = { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 };
 assert.deepEqual(validateRemoteSyncCommand({ action: 'resources', operation: 'read' }), { action: 'resources', operation: 'read' });
 assert.deepEqual(validateRemoteSyncCommand({ action: 'resources', operation: 'save', deviceResourceLimits: policy }), { action: 'resources', operation: 'save', deviceResourceLimits: policy });
 for (const patch of [{ rootId: 'grant' }, { ownerId: 'foreign' }, { start: true }]) assert.throws(() => validateRemoteSyncCommand({ action: 'resources', operation: 'read', ...patch }));
 for (const bad of [{ ...policy, cpuPercent: 0 }, { ...policy, cpuPercent: 15.5 }, { ...policy, transferBytesPerSecond: 0 }, { ...policy, secret: 'x' }]) assert.throws(() => validateRemoteSyncCommand({ action: 'resources', operation: 'save', deviceResourceLimits: bad }));
 assert.throws(() => parseRemoteSyncResources({ deviceResourceLimits: policy, roots: [] }));
 assert.deepEqual(parseRemoteSyncResources({ deviceResourceLimits: policy }), { deviceResourceLimits: policy });
});
