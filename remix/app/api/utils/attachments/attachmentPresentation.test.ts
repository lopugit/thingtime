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
	assert.deepEqual(
		attachmentPublicProjection('attachment-2', {
			name: 'clip.avi',
			size: 9,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'video/x-msvideo'
		}),
		{
			id: 'attachment-2',
			name: 'clip.avi',
			size: 9,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'video/x-msvideo'
		}
	);
});

test('every browser-playable container renders inline; other sniffed types stay labelled downloads', () => {
	assert.deepEqual(detectedAttachmentType('image/png', 'fake.svg'), { contentType: 'image/png', mediaKind: 'image' });
	for (const mime of [
		'video/3gpp',
		'video/3gpp2',
		'video/mp4',
		'video/ogg',
		'video/quicktime',
		'video/webm',
		'video/x-m4v',
		'video/x-matroska'
	]) {
		assert.deepEqual(detectedAttachmentType(mime, 'video.bin'), { contentType: mime, mediaKind: 'video' }, mime);
	}
	for (const mime of ['audio/aac', 'audio/flac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-m4a']) {
		assert.deepEqual(detectedAttachmentType(mime, 'recording.bin'), { contentType: mime, mediaKind: 'audio' }, mime);
	}
	assert.deepEqual(detectedAttachmentType('image/svg+xml', 'active.svg'), {
		contentType: 'application/octet-stream',
		mediaKind: 'file',
		detectedContentType: 'image/svg+xml'
	});
	assert.deepEqual(detectedAttachmentType('text/html', 'active.html'), {
		contentType: 'application/octet-stream',
		mediaKind: 'file',
		detectedContentType: 'text/html'
	});
	assert.deepEqual(detectedAttachmentType('video/x-msvideo', 'clip.avi'), {
		contentType: 'application/octet-stream',
		mediaKind: 'file',
		detectedContentType: 'video/x-msvideo'
	});
	assert.deepEqual(detectedAttachmentType(undefined, 'unknown.mov'), { contentType: 'application/octet-stream', mediaKind: 'file' });
	assert.deepEqual(detectedAttachmentType('not a mime type', 'weird.bin'), { contentType: 'application/octet-stream', mediaKind: 'file' });
	assert.equal(attachmentMayRenderInline({ name: 'x', size: 1, contentType: 'image/png', mediaKind: 'image' }), true);
	assert.equal(attachmentMayRenderInline({ name: 'x', size: 1, contentType: 'video/quicktime', mediaKind: 'video' }), true);
	assert.equal(attachmentMayRenderInline({ name: 'x', size: 1, contentType: 'audio/x-m4a', mediaKind: 'audio' }), true);
	assert.equal(attachmentMayRenderInline({ name: 'x', size: 1, contentType: 'image/svg+xml', mediaKind: 'image' }), false);
	assert.equal(
		attachmentMayRenderInline({
			name: 'x',
			size: 1,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'video/x-msvideo'
		}),
		false
	);
});

test('content disposition neutralizes active filename syntax while retaining UTF-8 name', () => {
	const value = attachmentContentDisposition('résumé "final".pdf', false);
	assert.match(value, /^attachment; filename="resume _final_\.pdf";/);
	assert.match(value, /filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22\.pdf$/);
	assert.doesNotMatch(value, /[\r\n]/);
});
