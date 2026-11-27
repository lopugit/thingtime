import assert from 'node:assert/strict';
import test from 'node:test';
import { presentVisualMedia } from './livePhotoPresentation';
import type { PublicAttachment } from './attachmentTypes';

const item = (id: string, mediaKind: PublicAttachment['mediaKind'], pairId?: string, role?: 'photo' | 'motion'): PublicAttachment =>
	({ id, name: id, size: 1, contentType: mediaKind === 'image' ? 'image/jpeg' : 'video/quicktime', mediaKind, ...(pairId && role ? { livePhoto: { pairId, role } } : {}) });

test('explicit complete pair occupies the first sibling position without losing other media', () => {
	const motion = item('motion', 'video', 'pair', 'motion');
	const still = item('still', 'image', 'pair', 'photo');
	const ordinary = item('ordinary', 'video');
	assert.deepEqual(presentVisualMedia([motion, ordinary, still]), [
		{ attachment: still, motion }, { attachment: ordinary }
	]);
});

test('incomplete, ambiguous, wrong-kind and linked siblings remain separate', () => {
	const still = item('still', 'image', 'pair', 'photo');
	const motion = item('motion', 'video', 'pair', 'motion');
	assert.deepEqual(presentVisualMedia([still]), [{ attachment: still }]);
	assert.equal(presentVisualMedia([still, item('other', 'image', 'pair', 'photo'), motion]).length, 3);
	assert.equal(presentVisualMedia([still, { ...motion, mediaKind: 'image' }]).length, 2);
	assert.equal(presentVisualMedia([still, { ...motion, url: 'https://example.com/movie.mov' }]).length, 2);
});
