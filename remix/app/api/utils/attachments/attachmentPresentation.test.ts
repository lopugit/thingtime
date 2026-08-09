import assert from 'node:assert/strict';
import test from 'node:test';

import {
	attachmentContentDisposition,
	attachmentMayRenderInline,
	attachmentPublicProjection,
	detectedAttachmentType
} from './attachmentPresentation';

test('attachment projection exposes only canonical public metadata', () => {
	const projected = attachmentPublicProjection('attachment-1', {
		name: 'launch.png',
		size: 123,
		contentType: 'image/png',
		mediaKind: 'image'
	});
	assert.deepEqual(projected, {
		id: 'attachment-1',
		name: 'launch.png',
		size: 123,
		contentType: 'image/png',
		mediaKind: 'image'
	});
	assert.deepEqual(Object.keys(projected).sort(), ['contentType', 'id', 'mediaKind', 'name', 'size']);
});

test('only the narrow magic-detected raster/video allowlist renders inline', () => {
	assert.deepEqual(detectedAttachmentType('image/png', 'fake.svg'), { contentType: 'image/png', mediaKind: 'image' });
	assert.deepEqual(detectedAttachmentType('video/mp4', 'video.bin'), { contentType: 'video/mp4', mediaKind: 'video' });
	assert.deepEqual(detectedAttachmentType('image/svg+xml', 'active.svg'), {
		contentType: 'application/octet-stream',
		mediaKind: 'file'
	});
	assert.deepEqual(detectedAttachmentType('text/html', 'active.html'), {
		contentType: 'application/octet-stream',
		mediaKind: 'file'
	});
	assert.equal(attachmentMayRenderInline({ name: 'x', size: 1, contentType: 'image/png', mediaKind: 'image' }), true);
	assert.equal(attachmentMayRenderInline({ name: 'x', size: 1, contentType: 'image/svg+xml', mediaKind: 'image' }), false);
});

test('content disposition neutralizes active filename syntax while retaining UTF-8 name', () => {
	const value = attachmentContentDisposition('résumé "final".pdf', false);
	assert.match(value, /^attachment; filename="resume _final_\.pdf";/);
	assert.match(value, /filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22\.pdf$/);
	assert.doesNotMatch(value, /[\r\n]/);
});
