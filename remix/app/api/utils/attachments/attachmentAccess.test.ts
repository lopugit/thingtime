import assert from 'node:assert/strict';
import test from 'node:test';

import { attachmentTargetAclAllows } from './attachmentAccess';

const post = (overrides: Record<string, unknown> = {}) => ({
	shareId: 'post-1',
	ownerId: 'owner-1',
	thingtime: ['post'],
	targetId: null,
	acl: ['tt:all'],
	...overrides
});

test('narrow attachment target ACL check handles owners, public grants, exclusions, and fails closed', () => {
	assert.equal(attachmentTargetAclAllows(post(), null), true);
	assert.equal(attachmentTargetAclAllows(post({ acl: ['tt:user'] }), { id: 'reader-1' }), false);
	assert.equal(attachmentTargetAclAllows(post({ acl: ['tt:user'] }), { id: 'owner-1' }), true);
	assert.equal(
		attachmentTargetAclAllows(post({ acl: ['tt:all', '-tt:user/blocked'] }), {
			id: 'reader-1',
			username: 'blocked'
		}),
		false
	);
	assert.equal(
		attachmentTargetAclAllows(post({ acl: ['tt:user/invited'] }), {
			id: 'reader-2',
			username: 'invited'
		}),
		true
	);
	assert.equal(attachmentTargetAclAllows(post({ thingtime: ['post', 'share'], targetId: 'root-1' }), null), false);
	assert.equal(attachmentTargetAclAllows(post({ acl: ['tt:inherit'] }), { id: 'reader-1' }), false);
	assert.equal(attachmentTargetAclAllows(null, { id: 'reader-1' }), false);
});
