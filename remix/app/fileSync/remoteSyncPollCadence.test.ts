import assert from 'node:assert/strict';
import test from 'node:test';
import { REMOTE_SYNC_ACTIVE_POLL_MS, REMOTE_SYNC_MAX_IDLE_POLL_MS, remoteSyncPollDelay } from './remoteSyncPollCadence';

test('the remote sync mailbox polls quickly while active and backs off to the cap when idle', () => {
	assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 50].map(remoteSyncPollDelay), [2_000, 2_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
	assert.equal(remoteSyncPollDelay(Number.NaN), REMOTE_SYNC_ACTIVE_POLL_MS);
	assert.equal(remoteSyncPollDelay(Number.MAX_SAFE_INTEGER), REMOTE_SYNC_MAX_IDLE_POLL_MS);
});
