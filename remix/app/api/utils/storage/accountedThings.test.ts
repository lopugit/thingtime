import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { currentContentStorageSizeBytes, thingStorageSizeBytes } from './storageCore.ts';
import { stampAccountedStorageDocument } from './accountedThings.ts';

test('protected device mirrors use the exact same canonical content stamp as posts and Messenger', () => {
	const state = {
		shareId: 'state-1',
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: ['device-state'],
		ownerId: 'user-1',
		crystal: { revision: 1, state: { locked: false, openApps: [] } },
		extended: null,
		tags: []
	};
	const stamped = stampAccountedStorageDocument(state);
	assert.equal(stamped.storageClass, 'content');
	assert.equal(stamped.sizeBytes, thingStorageSizeBytes(state));
	assert.equal(currentContentStorageSizeBytes(stamped), stamped.sizeBytes);
});

test('attachment references do not duplicate attachment object bytes into device metadata', () => {
	const screen = {
		thingtime: ['device-screen-session'],
		crystal: { status: 'active', previewAttachmentId: 'attachment-1' },
		extended: null,
		tags: []
	};
	assert.equal(thingStorageSizeBytes(screen), thingStorageSizeBytes({ ...screen, objectSizeBytes: 999 }));
});
