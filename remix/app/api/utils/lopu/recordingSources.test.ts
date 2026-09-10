import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateRecordingPost, isPrivateSavedRecording } from './recordingSources';

const saved = { shareId: 'audio-id', ownerId: 'owner', thingtime: ['attachment'], acl: ['tt:user'],
	attachmentPurpose: 'recording', attachmentState: 'ready', crystal: { mediaKind: 'audio' } };

test('only canonical owner-private ready standalone audio qualifies for explicit processing', () => {
	assert.equal(isPrivateSavedRecording(saved, 'owner'), true);
	for (const patch of [{ ownerId: 'other' }, { appId: 'app' }, { deletedAt: new Date() },
		{ acl: ['tt:all'] }, { acl: ['tt:user', 'tt:all'] }, { acl: ['tt:inherit'] }, { targetId: 'post' }, { targetId: null },
		{ thingtime: ['attachment', 'post'] }, { attachmentLinked: true }, { attachmentState: 'pending' },
		{ attachmentState: 'deleting' }, { attachmentPurpose: 'message' }, { attachmentPurpose: 'post' },
		{ crystal: { mediaKind: 'image' } }, { moderation: { status: 'blocked' } }])
		assert.equal(isPrivateSavedRecording({ ...saved, ...patch }, 'owner'), false, JSON.stringify(patch));
	assert.equal(isPrivateSavedRecording(null, 'owner'), false);
});

test('standalone recording support does not expand automatic Watch discovery', () => {
	assert.equal(isPrivateRecordingPost(saved, 'owner'), false);
	const watch = { shareId: 'watch-upload-test', ownerId: 'owner', thingtime: ['post'], acl: ['tt:user'], tags: ['apple-watch'] };
	assert.equal(isPrivateRecordingPost(watch, 'owner'), true);
	for (const patch of [{ ownerId: 'other' }, { tags: [] }, { acl: ['tt:all'] }, { thingtime: ['post', 'comment'] }])
		assert.equal(isPrivateRecordingPost({ ...watch, ...patch }, 'owner'), false);
});
