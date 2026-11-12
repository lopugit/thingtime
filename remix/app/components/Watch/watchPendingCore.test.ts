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
