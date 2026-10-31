import assert from 'node:assert/strict';
import test from 'node:test';

import { attachmentCascadeCleanupTargets } from './attachmentCascadeCore.ts';

test('nested cascade attachments reduce to deterministic exact owner-target cleanup roots', () => {
	assert.deepEqual(
		attachmentCascadeCleanupTargets([
			{ thingtime: ['comment'], targetId: 'post-1', ownerId: 'commenter' },
			{ thingtime: ['attachment'], targetId: 'reply-2', ownerId: 'user-2' },
			{ thingtime: 'attachment', targetId: 'comment-1', ownerId: 'user-1' },
			{ kind: 'attachment', targetId: 'comment-1', ownerId: 'user-1' },
			{ thingtime: ['attachment'], targetId: '', ownerId: 'user-3' },
			{ thingtime: ['attachment'], targetId: 'comment-3', ownerId: null }
		]),
		[
			{ shareId: 'comment-1', ownerId: 'user-1' },
			{ shareId: 'reply-2', ownerId: 'user-2' }
		]
	);
});
