import assert from 'node:assert/strict';
import test from 'node:test';

import { layeredPostCommentCounts, RELATED_CHILD_PROJECTION, visibleRelatedModerationClause } from './things.ts';

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

test('post comment count layers separate direct comments, replies, and loaded rows', () => {
	assert.deepEqual(layeredPostCommentCounts(3, 8, 2), {
		direct: 3,
		replies: 5,
		total: 8,
		loaded: 2
	});
});

test('post comment count layers never report a negative reply count', () => {
	assert.equal(layeredPostCommentCounts(2, 1, 1).replies, 0);
});
