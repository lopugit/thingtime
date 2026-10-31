import assert from 'node:assert/strict';
import test from 'node:test';

import { attachmentPostActorAllowed, bodyHasAttachmentIds, postAttachmentRequest, postBodyWithoutAttachmentIds } from './postCreate';

test('generic Things accept attachmentIds only on POST top-level post creation', () => {
	assert.deepEqual(
		postAttachmentRequest('POST', { thingtime: ['post'], crystal: { type: 'text', text: '' }, attachmentIds: ['attachment-1'] }, true),
		{ ok: true, present: true, kind: 'create', attachmentIds: ['attachment-1'] }
	);
	assert.equal(postAttachmentRequest('POST', { thingtime: ['post', 'comment'], targetId: 'post-1', crystal: {}, attachmentIds: [] }, true).ok, false);
	assert.equal(postAttachmentRequest('POST', { thingtime: ['post'], targetId: 'post-1', crystal: {}, attachmentIds: [] }, true).ok, false);
	assert.equal(postAttachmentRequest('POST', { type: 'text', attachmentIds: 'not-a-list' }, false).ok, false);
});

test('PATCH attachmentIds is a sync (reorder + add) request bound to an explicit thing id', () => {
	assert.deepEqual(postAttachmentRequest('PATCH', { id: 'post-1', attachmentIds: ['attachment-2', 'attachment-1'] }, false), {
		ok: true,
		present: true,
		kind: 'sync',
		attachmentIds: ['attachment-2', 'attachment-1']
	});
	// no id → nothing to sync against
	assert.equal(postAttachmentRequest('PATCH', { attachmentIds: ['attachment-1'] }, false).ok, false);
	assert.equal(postAttachmentRequest('PATCH', { id: '   ', attachmentIds: ['attachment-1'] }, false).ok, false);
	assert.equal(postAttachmentRequest('PATCH', { id: 'post-1', attachmentIds: 'not-a-list' }, false).ok, false);
	// upserts and deletes stay closed
	assert.equal(postAttachmentRequest('PUT', { id: 'post-1', attachmentIds: [] }, false).ok, false);
	assert.equal(postAttachmentRequest('DELETE', { id: 'post-1', attachmentIds: [] }, false).ok, false);
});

test('attachmentIds key detection is presence-based for dedicated attachment-aware routes', () => {
	assert.equal(bodyHasAttachmentIds({ attachmentIds: undefined }), true);
	assert.equal(bodyHasAttachmentIds({ text: 'no attachments' }), false);
	const legacy = postAttachmentRequest('POST', { type: 'text', attachmentIds: [] }, false);
	if ('error' in legacy) assert.fail(legacy.error);
	assert.equal(legacy.present, true);
});

test('attachment post context is available only to full first-party user sessions', () => {
	assert.equal(attachmentPostActorAllowed('user', 'user'), true);
	assert.equal(attachmentPostActorAllowed('pat', 'user'), false);
	assert.equal(attachmentPostActorAllowed('app', 'user'), false);
	assert.equal(attachmentPostActorAllowed('user', 'service'), false);
});

test('server-only attachmentIds are stripped without changing the stable client shareId', () => {
	assert.deepEqual(
		postBodyWithoutAttachmentIds({
			shareId: 'stable-post-id',
			type: 'text',
			attachmentIds: ['attachment-1']
		}),
		{ shareId: 'stable-post-id', type: 'text' }
	);
});
