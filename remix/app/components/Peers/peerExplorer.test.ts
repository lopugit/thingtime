import assert from 'node:assert/strict';
import test from 'node:test';

import { filterPeerExplorerRows, mergePeerExplorerPage, peerValueMatches, type PeerExplorerRow } from './peerExplorer';

const peers: PeerExplorerRow[] = [
	{
		origin: 'https://thingtime.com',
		signingPublicKey: 'MCowBQYDK2VwAyEAproduction',
		firstSeenAt: '2026-08-24T00:00:00.000Z',
		lastSeenAt: '2026-08-24T10:00:00.000Z',
		expiresAt: '2026-08-24T10:10:00.000Z',
		status: 'active'
	},
	{
		origin: 'https://pr-68.previews.dev.thingtime.com',
		signingPublicKey: 'MCowBQYDK2VwAyEAPreview',
		firstSeenAt: '2026-08-23T00:00:00.000Z',
		lastSeenAt: '2026-08-23T10:00:00.000Z',
		expiresAt: '2026-08-23T10:10:00.000Z',
		status: 'expired'
	}
];

test('peer explorer searches every safe public peer property and an explicit field', () => {
	assert.equal(peerValueMatches(peers[0], 'production'), true);
	assert.equal(peerValueMatches(peers[1], 'expired'), true);
	assert.equal(peerValueMatches(peers[1], 'preview', 'origin'), true);
	assert.equal(peerValueMatches(peers[1], 'preview', 'status'), false);
	assert.deepEqual(filterPeerExplorerRows(peers, '2026-08-24', 'lastSeenAt'), [peers[0]]);
});

test('peer explorer pages deduplicate by origin and remain newest-first', () => {
	const refreshed = { ...peers[1], lastSeenAt: '2026-08-24T11:00:00.000Z', status: 'active' as const };
	assert.deepEqual(mergePeerExplorerPage([peers[0]], [peers[1], refreshed]), [refreshed, peers[0]]);
});
