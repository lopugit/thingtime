import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	attachmentFilesFromClipboard,
	attachmentContentUrl,
	attachmentDisplayName,
	attachmentThingUrl,
	attachmentCleanupAction,
	attachmentCompleteRetryPhase,
	attachmentSnapshot,
	attachmentTypeLabel,
	attachmentUploadScopeForPurpose,
	attachmentUploadError,
	attachmentUploadFailurePhase,
	canonicalPostTags,
	formatAttachmentBytes,
	matchesCommittedPostCreate,
	MAX_POST_ATTACHMENTS,
	multipartPartRange,
	normalizePublicAttachment,
	sameAttachmentSnapshot,
	safeAttachmentMediaKind,
	shouldFreezeAmbiguousPostSubmission
} from './attachmentUiCore.ts';

test('clipboard files prefer the canonical file list without double-queuing item fallbacks', () => {
	const screenshot = { name: 'Screenshot.png', size: 42 } as File;
	const duplicatedItem = { kind: 'file', getAsFile: () => screenshot };
	assert.deepEqual(attachmentFilesFromClipboard({ files: [screenshot], items: [duplicatedItem] }), [screenshot]);
});

test('clipboard files fall back to file-kind items when the browser file list is empty', () => {
	const copiedImage = { name: 'pasted-image.png', size: 7 } as File;
	assert.deepEqual(
		attachmentFilesFromClipboard({
			files: [],
			items: [
				{ kind: 'string', getAsFile: () => null },
				{ kind: 'file', getAsFile: () => copiedImage },
				{ kind: 'file', getAsFile: () => null }
			]
		}),
		[copiedImage]
	);
});

test('upload purposes map to exactly one canonical approval scope', () => {
	for (const purpose of ['post', 'comment', 'custom-emoji'] as const) {
		assert.equal(attachmentUploadScopeForPurpose(purpose), 'public');
	}
	for (const purpose of ['message', 'profile-avatar', 'profile-banner'] as const) {
		assert.equal(attachmentUploadScopeForPurpose(purpose), 'private');
	}
});

test('only vetted raster image and video types render inline', () => {
	assert.equal(safeAttachmentMediaKind('image/jpeg', 'image'), 'image');
	assert.equal(safeAttachmentMediaKind('video/mp4', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('image/svg+xml', 'image'), 'file');
	assert.equal(safeAttachmentMediaKind('text/html', 'image'), 'file');
	assert.equal(safeAttachmentMediaKind('application/javascript', 'video'), 'file');
	assert.equal(safeAttachmentMediaKind('video/quicktime', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('video/ogg', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('video/x-m4v', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('video/x-matroska', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('video/3gpp', 'video'), 'video');
	assert.equal(safeAttachmentMediaKind('video/x-msvideo', 'video'), 'file');
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
	assert.deepEqual(
		normalizePublicAttachment({
			id: 'att-3',
			name: 'clip.avi',
			size: 9,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'VIDEO/X-MSVIDEO'
		}),
		{
			id: 'att-3',
			name: 'clip.avi',
			size: 9,
			contentType: 'application/octet-stream',
			detectedContentType: 'video/x-msvideo',
			mediaKind: 'file'
		}
	);
	assert.deepEqual(
		normalizePublicAttachment({
			id: 'att-4',
			name: 'blob.bin',
			size: 1,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'application/octet-stream'
		}),
		{ id: 'att-4', name: 'blob.bin', size: 1, contentType: 'application/octet-stream', mediaKind: 'file' }
	);
	assert.equal(MAX_POST_ATTACHMENTS, 25);
});

test('filename preview overrides display text without replacing the immutable filename', () => {
	const attachment = normalizePublicAttachment({
		id: 'att-display',
		name: '7627.jpg',
		filenamePreview: 'Replacement blades.jpg',
		size: 42,
		contentType: 'image/jpeg',
		mediaKind: 'image'
	});
	assert.ok(attachment);
	assert.equal(attachmentDisplayName(attachment), 'Replacement blades.jpg');
	assert.equal(attachment.name, '7627.jpg');
});

test('download rows label the sniffed container instead of application/octet-stream', () => {
	assert.equal(attachmentTypeLabel({ contentType: 'application/octet-stream', detectedContentType: 'video/x-msvideo' }), 'AVI video');
	assert.equal(attachmentTypeLabel({ contentType: 'application/octet-stream', detectedContentType: 'video/quicktime' }), 'QuickTime video');
	assert.equal(
		attachmentTypeLabel({ contentType: 'application/octet-stream', detectedContentType: 'application/x-iso9660-image' }),
		'application/x-iso9660-image'
	);
	assert.equal(attachmentTypeLabel({ contentType: 'application/octet-stream' }), 'File');
	assert.equal(attachmentTypeLabel({ contentType: 'audio/mpeg' }), 'MP3 audio');
	assert.equal(attachmentTypeLabel({ contentType: 'text/plain' }), 'text/plain');
});

test('content links are stable same-origin routes derived only from attachment ids', () => {
	assert.equal(attachmentContentUrl('a/b ?'), '/api/v1/attachments/content?id=a%2Fb+%3F');
	assert.equal(attachmentContentUrl('a/b ?', true), '/api/v1/attachments/content?id=a%2Fb+%3F&download=1');
	assert.equal(attachmentThingUrl('a/b ?'), '/thing/a%2Fb%20%3F');
});

test('upload errors are fixed client-authored messages', () => {
	const hostile = { status: 507, error: 'secret upstream response' };
	const message = attachmentUploadError(hostile, 'prepare');
	assert.match(message, /storage quota is full/i);
	assert.match(message, /delete stored media|upgrade/i);
	assert.doesNotMatch(message, /secret|upstream/i);
	assert.match(attachmentUploadError({ status: 503, code: 'quota_exceeded', error: 'private ledger detail' }, 'prepare'), /storage quota is full/i);
	assert.match(
		attachmentUploadError({ status: 503, error: 'ambiguous private failure' }, 'prepare', {
			fileSizeBytes: 11,
			remainingBytes: 10,
			storageStatus: 'ready'
		}),
		/storage quota is full/i
	);
	assert.match(
		attachmentUploadError({ status: 503, code: 'accounting_unavailable', error: 'private ledger detail' }, 'prepare'),
		/verifying this account’s storage balance/i
	);
	assert.match(
		attachmentUploadError({ status: 409, code: 'storage_conflict', error: 'private migration detail' }, 'prepare'),
		/verifying this account’s storage balance/i
	);
	assert.match(attachmentUploadError({ status: 500, error: 'proxy stack' }, 'upload'), /could not reach storage/i);
	assert.match(attachmentUploadError({ status: 403, code: 'public_uploads_not_approved' }, 'prepare'), /public media uploads need admin approval/i);
	assert.match(attachmentUploadError({ status: 403, code: 'private_uploads_not_approved' }, 'prepare'), /private media uploads need admin approval/i);
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
	const unavailable = attachmentUploadError(
		{ status: 503, code: 'storage_unconfigured', error: 'missing private bucket private-example-bucket account 1234' },
		'prepare'
	);
	assert.match(unavailable, /unavailable in this environment/i);
	assert.match(unavailable, /public image URL/i);
	assert.doesNotMatch(unavailable, /private-example-bucket|bucket|account|1234|missing private/i);
	const temporary = attachmentUploadError({ status: 503, error: 'private runtime detail' }, 'prepare');
	assert.match(temporary, /temporarily unavailable/i);
	assert.doesNotMatch(temporary, /environment|private runtime/i);
	assert.equal(attachmentUploadError({ status: 503 }, 'upload'), 'The file could not reach storage. Check your connection and retry.');
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

test('progress-only upload changes do not emit a new composer snapshot', () => {
	const file = { name: 'photo.jpg', size: 10, lastModified: 1, type: 'image/jpeg' } as File;
	const base = { localId: 'local', file, previewUrl: 'blob:preview', uploadId: 'upload', attachment: null, error: null, failedAt: null };
	const first = attachmentSnapshot([{ ...base, status: 'uploading', progress: 10 }]);
	const progressed = attachmentSnapshot([{ ...base, status: 'uploading', progress: 90 }]);
	assert.equal(sameAttachmentSnapshot(first, progressed), true);
	const attachment = { id: 'att', name: 'photo.jpg', size: 10, contentType: 'image/jpeg', mediaKind: 'image' as const };
	const ready = attachmentSnapshot([{ ...base, status: 'ready', progress: 100, attachment }]);
	assert.equal(sameAttachmentSnapshot(first, ready), false);
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
