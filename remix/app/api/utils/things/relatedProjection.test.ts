import assert from 'node:assert/strict';
import test from 'node:test';

import { RELATED_CHILD_PROJECTION, visibleRelatedModerationClause } from './things.ts';

test('related child projection preserves rich comment media layouts', () => {
  assert.equal(RELATED_CHILD_PROJECTION['crystal.mediaLayout'], 1);
});

test('related projections keep a pending comment visible to its owner', () => {
	assert.deepEqual(visibleRelatedModerationClause('owner-1'), {
		$or: [
			{ 'moderation.status': { $nin: ['blocked', 'pending'] } },
			{ ownerId: 'owner-1', 'moderation.status': 'pending' }
		]
	});
});

test('related projections hide pending comments from anonymous viewers', () => {
	assert.deepEqual(visibleRelatedModerationClause(null), {
		'moderation.status': { $nin: ['blocked', 'pending'] }
	});
});
