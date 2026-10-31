import assert from 'node:assert/strict';
import test from 'node:test';

import {
	customEmojiIdForAttachment,
	exactStringSet,
	matchesCommittedEmojiRequest,
	matchesCommittedMessageRequest,
	messageIdForRequest,
	normalizedMessengerRequestId
} from './messengerMediaCore.ts';

test('conversation request ids are bounded and deterministic only within one owner', () => {
	assert.equal(normalizedMessengerRequestId('request:one'), 'request:one');
	assert.equal(normalizedMessengerRequestId(' request:one'), null);
	assert.equal(normalizedMessengerRequestId('bad/request'), null);
	assert.equal(normalizedMessengerRequestId('x'.repeat(129)), null);
	assert.equal(messageIdForRequest('user-1', 'request:one'), messageIdForRequest('user-1', 'request:one'));
	assert.notEqual(messageIdForRequest('user-1', 'request:one'), messageIdForRequest('user-2', 'request:one'));
	assert.notEqual(customEmojiIdForAttachment('user-1', 'attachment-1'), customEmojiIdForAttachment('user-2', 'attachment-1'));
});

test('ambiguous message reconciliation requires exact topology, immutable content, and attachment set equality', () => {
	const existing = {
		ownerId: 'user-1',
		targetId: 'chat-1',
		crystal: { text: 'hello', threadRootId: 'root-1', replyToId: null, deletedAt: null }
	};
	const expected = {
		ownerId: 'user-1',
		chatId: 'chat-1',
		text: 'hello',
		threadRootId: 'root-1',
		replyToId: null,
		attachmentIds: ['a-1', 'a-2']
	};
	assert.equal(matchesCommittedMessageRequest(existing, expected, ['a-2', 'a-1']), true);
	assert.equal(matchesCommittedMessageRequest({ ...existing, ownerId: 'attacker' }, expected, ['a-1', 'a-2']), false);
	assert.equal(matchesCommittedMessageRequest({ ...existing, targetId: 'other-chat' }, expected, ['a-1', 'a-2']), false);
	assert.equal(matchesCommittedMessageRequest({ ...existing, crystal: { ...existing.crystal, text: 'changed' } }, expected, ['a-1', 'a-2']), false);
	assert.equal(
		matchesCommittedMessageRequest({ ...existing, crystal: { ...existing.crystal, deletedAt: new Date() } }, expected, ['a-1', 'a-2']),
		false
	);
	assert.equal(matchesCommittedMessageRequest(existing, expected, ['a-1']), false);
	assert.equal(exactStringSet(['a', 'a'], ['a']), false);
});

test('ambiguous custom emoji reconciliation accepts only the exact owner, scope, name, and attachment', () => {
	const existing = {
		ownerId: 'user-1',
		targetId: 'community-1',
		emojiAttachmentId: 'attachment-1',
		crystal: { name: 'party' }
	};
	const expected = {
		ownerId: 'user-1',
		communityId: 'community-1',
		name: 'party',
		attachmentId: 'attachment-1'
	};
	assert.equal(matchesCommittedEmojiRequest(existing, expected), true);
	assert.equal(matchesCommittedEmojiRequest({ ...existing, ownerId: 'user-2' }, expected), false);
	assert.equal(matchesCommittedEmojiRequest({ ...existing, targetId: null }, expected), false);
	assert.equal(matchesCommittedEmojiRequest({ ...existing, emojiAttachmentId: 'attachment-2' }, expected), false);
	assert.equal(matchesCommittedEmojiRequest({ ...existing, crystal: { name: 'other' } }, expected), false);
});
