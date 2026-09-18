import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaPageLink } from './mediaGalleryCore';
import { attachmentCountLimit } from '../../schemas/attachmentLimits';
import { planAttachmentReorder, planAttachmentSync } from '../../api/utils/attachments/attachmentCore';

test('large post galleries preserve every id and reject duplicates during reorder and edit', () => {
	const ids = Array.from({ length: 80 }, (_, i) => `media-${i}`);
	const requested = [...ids].reverse();
	assert.deepEqual(planAttachmentReorder(requested, ids, attachmentCountLimit()), { ok: true, orderedIds: requested });
	assert.equal(planAttachmentSync([...requested, 'new-video'], ids, [], attachmentCountLimit()).ok, true);
	assert.equal(planAttachmentSync([...requested, ids[0]], ids, [], attachmentCountLimit()).ok, false);
	assert.equal(planAttachmentSync(requested, ids, [], attachmentCountLimit('comment')).ok, false);
});

test('media permalinks keep first-party secret-link context without sharing storage URLs', () => {
	assert.equal(mediaPageLink('video-1', '/api/v1/attachments/content?id=video-1'), '/media/video-1');
	assert.equal(
		mediaPageLink('video-1', '/api/v1/attachments/content?id=video-1&key=secret&sharedRoot=post-1&download=true'),
		'/media/video-1?key=secret&sharedRoot=post-1'
	);
	assert.equal(mediaPageLink('video-1', 'https://storage.example/video.mp4?key=private'), '/media/video-1');
	assert.equal(mediaPageLink('video-1', '/api/v1/attachments/content?id=other&key=private'), '/media/video-1');
});
