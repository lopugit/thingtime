import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	attachmentContentUrl,
	attachmentCleanupAction,
	attachmentCompleteRetryPhase,
	attachmentSnapshot,
	attachmentUploadError,
	attachmentUploadFailurePhase,
	canonicalPostTags,
	formatAttachmentBytes,
	matchesCommittedPostCreate,
	MAX_POST_ATTACHMENTS,
	multipartPartRange,
	normalizePublicAttachment,
	safeAttachmentMediaKind,
	shouldFreezeAmbiguousPostSubmission
} from './attachmentUiCore.ts';

test('only vetted raster image and video types render inline', () => {
	assert.equal(safeAttachmentMediaKind('image/jpeg', 'image'), 'image');
	assert.equal(safeAttachmentMediaKind('video/mp4', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('image/svg+xml', 'image'), 'file');
	assert.equal(safeAttachmentMediaKind('text/html', 'image'), 'file');
	assert.equal(safeAttachmentMediaKind('application/javascript', 'video'), 'file');
	assert.equal(safeAttachmentMediaKind('video/quicktime', 'video'), 'file');
	assert.equal(safeAttachmentMediaKind('video/ogg', 'video'), 'file');
	assert.equal(safeAttachmentMediaKind('image/png', 'file'), 'file');
});

test('normalises only canonical stable attachment metadata', () => {
	assert.deepEqual(normalizePublicAttachment({ id: 'att 1', name: 'photo.jpg', size: 42, contentType: 'IMAGE/JPEG', mediaKind: 'image' }), {
		id: 'att 1',
		name: 'photo.jpg',
		size: 42,
		contentType: 'image/jpeg',
		mediaKind: 'image'
	});
	assert.deepEqual(normalizePublicAttachment({ id: 'att-2', name: 'notes.html', size: 7, contentType: 'text/html', mediaKind: 'image' }), {
		id: 'att-2',
		name: 'notes.html',
		size: 7,
		contentType: 'text/html',
		mediaKind: 'file'
	});
	assert.deepEqual(normalizePublicAttachment({ id: 'audio', name: 'voice.mp3', size: 8, contentType: 'audio/mpeg', mediaKind: 'audio' }), {
		id: 'audio',
		name: 'voice.mp3',
		size: 8,
		contentType: 'audio/mpeg',
		mediaKind: 'file'
	});
	assert.equal(normalizePublicAttachment({ id: 'legacy', name: 'photo.jpg', sizeBytes: 42, contentType: 'image/jpeg', previewKind: 'image' }), null);
	assert.equal(MAX_POST_ATTACHMENTS, 25);
});

test('content links are stable same-origin routes derived only from attachment ids', () => {
	assert.equal(attachmentContentUrl('a/b ?'), '/api/v1/attachments/content?id=a%2Fb+%3F');
	assert.equal(attachmentContentUrl('a/b ?', true), '/api/v1/attachments/content?id=a%2Fb+%3F&download=1');
});

test('upload errors are fixed client-authored messages', () => {
	const hostile = { status: 507, error: 'secret upstream response' };
	const message = attachmentUploadError(hostile, 'prepare');
	assert.match(message, /enough storage/i);
	assert.doesNotMatch(message, /secret|upstream/i);
	assert.match(attachmentUploadError({ status: 500, error: 'proxy stack' }, 'upload'), /could not reach storage/i);
	assert.match(
		attachmentUploadError({ status: 409, code: 'upload_parts_retryable', retryable: true, error: 'private server detail' }, 'complete'),
		/parts need uploading again/i
	);
	assert.match(attachmentUploadError({ status: 409, code: 'finalization_settling', error: 'private server detail' }, 'complete'), /settling/i);
	assert.equal(attachmentCompleteRetryPhase({ status: 409, code: 'upload_parts_retryable', retryable: true }), 'upload');
	assert.equal(attachmentCompleteRetryPhase({ status: 409, code: 'finalization_settling', retryable: true }), 'complete');
	assert.equal(attachmentCompleteRetryPhase({ status: 503 }), 'complete');
	assert.equal(attachmentCompleteRetryPhase({ status: 410, code: 'upload_unavailable', retryable: false }), 'terminal');
	assert.equal(attachmentUploadFailurePhase({ status: 410, code: 'upload_unavailable' }, 'upload'), 'terminal');
});

test('composer stays blocked until every selected upload is ready', () => {
	const file = { name: 'x', size: 1, lastModified: 1, type: 'text/plain' } as File;
	const base = { localId: 'local', file, previewUrl: null, progress: 0, uploadId: null, attachment: null, error: null, failedAt: null };
	assert.deepEqual(attachmentSnapshot([]), { attachmentIds: [], attachments: [], blocking: false, hasSelection: false });
	assert.equal(attachmentSnapshot([{ ...base, status: 'uploading' }]).blocking, true);
	const attachment = { id: 'att', name: 'x', size: 1, contentType: 'text/plain', mediaKind: 'file' as const };
	assert.deepEqual(attachmentSnapshot([{ ...base, status: 'ready', attachment }]).attachmentIds, ['att']);
	assert.deepEqual(attachmentCleanupAction({ ...base, status: 'ready', attachment }, new Set()), {
		kind: 'delete',
		attachmentId: 'att'
	});
	assert.equal(attachmentCleanupAction({ ...base, status: 'ready', attachment }, new Set(['att'])), null);
	assert.deepEqual(attachmentCleanupAction({ ...base, status: 'uploading', uploadId: 'upload-1' }, new Set()), {
		kind: 'abort',
		uploadId: 'upload-1'
	});
	assert.deepEqual(attachmentCleanupAction({ ...base, status: 'preparing' }, new Set()), {
		kind: 'abort',
		uploadId: 'local'
	});
});

test('formats bytes and computes exact multipart slices', () => {
	assert.equal(formatAttachmentBytes(0), '0 B');
	assert.equal(formatAttachmentBytes(1536), '1.50 KiB');
	assert.deepEqual(multipartPartRange(1, 5, 12), { start: 0, end: 5 });
	assert.deepEqual(multipartPartRange(3, 5, 12), { start: 10, end: 12 });
});

test('ambiguous post creation reconciles only an exact committed snapshot', () => {
	const expected = {
		shareId: 'post-1',
		ownerId: 'owner-1',
		crystal: { type: 'text', text: '', images: [], listing: null, thing: null },
		tags: ['notes'],
		visibility: 'private',
		attachmentIds: ['attachment-b', 'attachment-a']
	};
	const response = {
		ok: true,
		thing: {
			id: 'post-1',
			thingtime: ['post'],
			author: { id: 'owner-1' },
			targetId: null,
			crystal: { thing: null, listing: null, images: [], text: '', type: 'text' },
			tags: ['notes']
		},
		post: {
			id: 'post-1',
			author: { id: 'owner-1' },
			isShare: false,
			visibility: 'private',
			tags: ['notes'],
			attachments: [{ id: 'attachment-a' }, { id: 'attachment-b' }]
		}
	};
	assert.equal(matchesCommittedPostCreate(response, expected), true);
	assert.equal(matchesCommittedPostCreate({ ...response, post: { ...response.post, attachments: [{ id: 'attachment-a' }] } }, expected), false);
	assert.equal(matchesCommittedPostCreate({ ...response, thing: { ...response.thing, author: { id: 'another-owner' } } }, expected), false);
	assert.equal(
		matchesCommittedPostCreate({ ...response, thing: { ...response.thing, crystal: { ...response.thing.crystal, text: 'changed' } } }, expected),
		false
	);
});

test('post tag reconciliation uses the server create canonicalizer', () => {
	assert.deepEqual(canonicalPostTags(['  One ', 'ONE', 'x'.repeat(50), 42, '', ...Array.from({ length: 20 }, (_, index) => `t${index}`)]), [
		'one',
		'x'.repeat(40),
		't0',
		't1',
		't2',
		't3',
		't4',
		't5',
		't6',
		't7',
		't8',
		't9'
	]);
});

test('only a genuinely unknown post outcome keeps later duplicate conflicts frozen', () => {
	assert.equal(shouldFreezeAmbiguousPostSubmission(true, 503, false), true);
	assert.equal(shouldFreezeAmbiguousPostSubmission(false, 409, true), true);
	assert.equal(shouldFreezeAmbiguousPostSubmission(false, 409, false), false);
	assert.equal(shouldFreezeAmbiguousPostSubmission(false, 422, true), false);
});
