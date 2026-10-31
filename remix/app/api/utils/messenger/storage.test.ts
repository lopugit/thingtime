import assert from 'node:assert/strict';
import test from 'node:test';

import { USER_STORAGE_ACCOUNTING_VERSION, currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore.ts';
import { newThingDoc } from './shared.ts';
import { stampMessengerStorageDocument } from './storage.ts';

test('Messenger rows receive the canonical account-storage stamp', () => {
	const message = newThingDoc('chat-message', {
		ownerId: 'user-1',
		targetId: 'chat-1',
		crystal: {
			text: 'Messenger bytes count 🥰',
			threadRootId: null,
			replyToId: null,
			editedAt: null,
			deletedAt: null,
			systemType: null,
			systemMeta: null,
			externalSource: {
				provider: 'chatgpt',
				sourceId: 'chatgpt-desktop',
				readOnly: true
			}
		}
	});
	const stamped = stampMessengerStorageDocument(message);
	assert.equal(stamped.storageClass, 'content');
	assert.equal(stamped.storageAccountingVersion, USER_STORAGE_ACCOUNTING_VERSION);
	assert.equal(stamped.sizeBytes, thingStorageSizeBytes(message));
	assert.equal(currentContentStorageSizeBytes(stamped), stamped.sizeBytes);
});

test('attachment object bytes remain on attachment Things, not duplicated onto Messenger rows', () => {
	const emoji = newThingDoc('custom-emoji', {
		ownerId: 'user-1',
		crystal: { name: 'party', emojiKey: 'user:user-1:party', animated: false }
	});
	const withAttachmentReference = { ...emoji, emojiAttachmentId: 'attachment-1' };
	assert.equal(
		thingStorageSizeBytes(withAttachmentReference),
		thingStorageSizeBytes(emoji),
		'Messenger JSON is charged here; verified objectSizeBytes is charged by the protected attachment Thing'
	);
});
