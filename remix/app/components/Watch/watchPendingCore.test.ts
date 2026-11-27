import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleWatchRequests } from './watchPendingCore.ts';

test('signed-out first paint and account switching never expose pending Watch requests', () => {
	const request = { pairingId: 'test-pairing', expiresAt: '2026-09-06T12:05:00Z' };
	const snapshot = { accountId: 'owner', requests: [request] };
	const now = Date.parse('2026-09-06T12:00:00Z');
	const dismissed = new Set<string>();
	assert.deepEqual(visibleWatchRequests(null, undefined, dismissed, now), []);
	assert.deepEqual(visibleWatchRequests(null, null, dismissed, now), []);
	for (const user of [undefined, null, {}, { id: 'different' }, { id: 'owner', temporary: true }]) {
		assert.deepEqual(visibleWatchRequests(snapshot, user, dismissed, now), []);
	}
	assert.deepEqual(visibleWatchRequests(snapshot, { id: 'owner' }, dismissed, now), [request]);
	assert.deepEqual(visibleWatchRequests(snapshot, { id: 'owner' }, new Set(['test-pairing']), now), []);
	assert.deepEqual(visibleWatchRequests(snapshot, { id: 'owner' }, dismissed, now + 300_000), []);
});

test('an idle approval prompt checks on signals and every five minutes, and every tick only while a request is pending', async () => {
	const { shouldPollWatchApprovals, WATCH_APPROVAL_IDLE_POLL_MS } = await import('./watchPendingCore.ts');
	const now = 10_000_000;
	const recent = { lastPolledAt: now - 15_000, hasPending: false };
	assert.equal(shouldPollWatchApprovals('tick', recent, now), false);
	assert.equal(shouldPollWatchApprovals('signal', recent, now), true, 'focus, visibility and offers always check');
	assert.equal(shouldPollWatchApprovals('tick', { ...recent, hasPending: true }, now), true);
	assert.equal(shouldPollWatchApprovals('tick', { lastPolledAt: now - WATCH_APPROVAL_IDLE_POLL_MS, hasPending: false }, now), true);
	assert.equal(shouldPollWatchApprovals('tick', { lastPolledAt: 0, hasPending: false }, now), true);
});
