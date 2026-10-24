import assert from 'node:assert/strict';
import test from 'node:test';

import { attachmentFromThing, canEditLocalFileDetails, directAttachmentReferences } from './thingAttachmentDetailCore.ts';

test('attachment detail only accepts persisted attachment Things and preserves safe image metadata', () => {
	assert.deepEqual(
		attachmentFromThing({
			id: 'att-image',
			thingtime: ['attachment'],
			crystal: { name: 'photo.png', size: 42, contentType: 'image/png', mediaKind: 'image' }
		}),
		{ id: 'att-image', name: 'photo.png', size: 42, contentType: 'image/png', mediaKind: 'image' }
	);
	assert.equal(
		attachmentFromThing({
			id: 'post-that-looks-like-a-file',
			thingtime: ['post'],
			crystal: { name: 'photo.png', size: 42, contentType: 'image/png', mediaKind: 'image' }
		}),
		null
	);
	assert.equal(
		attachmentFromThing({
			id: 'att-unsafe',
			thingtime: ['attachment'],
			crystal: { name: 'not-an-image.html', size: 42, contentType: 'text/html', mediaKind: 'image' }
		})?.mediaKind,
		'file'
	);
});

test('attachment references contain the ACL-checked direct target only', () => {
	const reference = { id: 'post-1' } as any;
	assert.deepEqual(directAttachmentReferences(reference), [reference]);
	assert.deepEqual(directAttachmentReferences(null), []);
});

test('local metadata editing requires the scoped capability and current ownership, never an ID prefix', () => {
 const row = { id: 'local-imported', thingtime: ['attachment'], crystal: { name: 'audio.wav', size: 20, contentType: 'audio/wav' }, author: { id: 'owner' }, canEditLocalFileDetails: true };
 assert.equal(canEditLocalFileDetails(row, 'owner'), true);
 assert.equal(canEditLocalFileDetails({ ...row, id: 'local-file-upload' }, 'owner'), true);
 for (const candidate of [null, { ...row, canEditLocalFileDetails: false }, { ...row, canEditLocalFileDetails: undefined }, { ...row, thingtime: ['post'] }, { ...row, targetId: 'post' }]) assert.equal(canEditLocalFileDetails(candidate, 'owner'), false);
 assert.equal(canEditLocalFileDetails(row, 'other'), false);
 assert.equal(canEditLocalFileDetails(row), false);
 assert.equal(canEditLocalFileDetails(row, 'owner', 'shared-link'), false);
});
