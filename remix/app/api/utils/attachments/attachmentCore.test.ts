import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ATTACHMENT_ENVELOPE_VERSION,
	ATTACHMENT_STATES,
	applyAttachmentAnnotationPatch,
	attachmentMediaKindForContentType,
	attachmentModerationHidesFromPublic,
	attachmentObjectSizeBytesForAccounting,
	canonicalLinkedAttachmentUrl,
	isAttachmentFinalizationLeaseId,
	isAttachmentObjectVersionId,
	LINKED_ATTACHMENT_OBJECT_KEY_PREFIX,
	LINKED_MEDIA_EXTENSION_TYPES,
	linkedAttachmentNameForUrl,
	linkedMediaTypeForUrl,
	orderAttachmentDocsByStoredSort,
	planAttachmentReorder,
	planAttachmentSync,
	sanitizeAttachmentPublicMetadata,
	toAttachmentPublicMetadata
} from './attachmentCore.ts';
import { LINKED_MEDIA_EXTENSION_KINDS } from '../../../components/Attachments/attachmentUiCore.ts';

const attachment = (overrides: Record<string, unknown> = {}) => ({
	thingtime: ['attachment'],
	attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION,
	attachmentState: 'pending',
	attachmentPurpose: 'post',
	objectSizeBytes: 42,
	objectKey: 'pending/user/attachment-id',
	crystal: {
		name: 'photo.png',
		size: 42,
		contentType: 'image/png',
		mediaKind: 'image'
	},
	...overrides
});

test('attachment metadata is canonical, bounded, and derives a safe media kind', () => {
	assert.deepEqual(
		sanitizeAttachmentPublicMetadata({
			name: '  Holiday Photo.PNG  ',
			size: 42,
			contentType: 'IMAGE/PNG',
			mediaKind: 'file'
		}),
		{
			ok: true,
			crystal: {
				name: 'Holiday Photo.PNG',
				size: 42,
				contentType: 'image/png',
				mediaKind: 'image'
			}
		}
	);
	assert.equal(attachmentMediaKindForContentType('image/svg+xml'), 'file');
	assert.equal(attachmentMediaKindForContentType('text/html'), 'file');
	assert.equal(attachmentMediaKindForContentType('video/mp4'), 'video');
	assert.equal(attachmentMediaKindForContentType('video/quicktime'), 'video');
	assert.equal(attachmentMediaKindForContentType('video/x-matroska'), 'video');
	assert.equal(attachmentMediaKindForContentType('video/x-msvideo'), 'file');
	assert.equal(attachmentMediaKindForContentType('audio/mpeg'), 'audio');
	assert.equal(attachmentMediaKindForContentType('audio/x-m4a'), 'audio');
	assert.equal(attachmentMediaKindForContentType('audio/x-custom-recorder'), 'audio');
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'bad\0name', size: 1, contentType: 'text/plain' }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'bad\ud800name', size: 1, contentType: 'text/plain' }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'safe\u202Egnp.exe', size: 1, contentType: 'text/plain' }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'bad', size: 1.5, contentType: 'text/plain' }).ok, false);
	assert.deepEqual(toAttachmentPublicMetadata('attachment-id', attachment().crystal), {
		id: 'attachment-id',
		name: 'photo.png',
		size: 42,
		contentType: 'image/png',
		mediaKind: 'image'
	});
	const opaqueCrystal = {
		name: 'clip.avi',
		size: 42,
		contentType: 'application/octet-stream',
		mediaKind: 'file',
		detectedContentType: 'video/x-msvideo'
	};
	assert.deepEqual(toAttachmentPublicMetadata('attachment-id', opaqueCrystal), { id: 'attachment-id', ...opaqueCrystal });
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...opaqueCrystal, contentType: 'video/mp4', mediaKind: 'video' }), null);
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...opaqueCrystal, detectedContentType: 'application/octet-stream' }), null);
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...opaqueCrystal, detectedContentType: 'VIDEO/X-MSVIDEO' }), null);
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...opaqueCrystal, detectedContentType: 42 }), null);
});

test('every lifecycle state remains a valid billable attachment envelope', () => {
	for (const attachmentState of ATTACHMENT_STATES) {
		assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentState })), 42, attachmentState);
	}
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ objectVersionId: 'opaque-version-id' })), 42);
	assert.equal(isAttachmentObjectVersionId('opaque-version-id'), true);
	assert.equal(isAttachmentFinalizationLeaseId('finalize:lease-1'), true);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: 'profile', attachmentProfileSlot: 'avatar' })), 42);
	for (const attachmentPurpose of ['comment', 'message', 'emoji'] as const) {
		assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose })), 42, attachmentPurpose);
	}
	assert.equal(
		attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: undefined, attachmentProfileSlot: undefined })),
		42,
		'pre-purpose post rows remain accountable during rollout'
	);
});

test('only an exact server envelope contributes object bytes', () => {
	assert.equal(attachmentObjectSizeBytesForAccounting({ thingtime: ['post'], objectSizeBytes: 999 }), undefined);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentEnvelopeVersion: 0 })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentState: 'uploaded' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ objectSizeBytes: 41 })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ objectKey: '' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ objectVersionId: '' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ objectVersionId: 'bad\nversion' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentRequestFingerprint: 'a'.repeat(64) })), 42);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentRequestFingerprint: 'not-a-fingerprint' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: 'unknown' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: 'post', attachmentProfileSlot: 'avatar' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: 'profile', attachmentProfileSlot: undefined })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: 'profile', attachmentProfileSlot: 'cover' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPurpose: undefined, attachmentProfileSlot: 'avatar' })), null);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(attachment({ attachmentState: 'finalizing', attachmentFinalizationLeaseId: 'finalize:lease-1' })),
		42
	);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentFinalizationLeaseId: 'finalize:lease-1' })), null);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(attachment({ attachmentState: 'finalizing', attachmentFinalizationLeaseId: 'bad lease' })),
		null
	);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(attachment({ attachmentPartsIssuedAt: new Date('2026-08-09T00:00:00.000Z'), uploadId: 'mpu-1' })),
		42
	);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentPartsIssuedAt: new Date('2026-08-09T00:00:00.000Z') })), null);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(
			attachment({
				attachmentState: 'ready',
				attachmentPartsIssuedAt: new Date('2026-08-09T00:00:00.000Z'),
				uploadId: 'mpu-1'
			})
		),
		null
	);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentState: 'deleting', attachmentObjectlessDelete: true })), 42);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentObjectlessDelete: true })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentState: 'deleting', attachmentObjectlessDelete: false })), null);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(attachment({ attachmentState: 'deleting', attachmentObjectlessDelete: true, uploadId: 'mpu-1' })),
		null
	);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(
			attachment({
				attachmentState: 'deleting',
				uploadId: 'mpu-1',
				attachmentPartsIssuedAt: new Date('2026-08-08T00:00:00.000Z'),
				attachmentMpuEmptyVerifiedAt: new Date('2026-08-09T00:00:00.000Z')
			})
		),
		42
	);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ attachmentMpuEmptyVerifiedAt: new Date('2026-08-09T00:00:00.000Z') })), null);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(attachment({ crystal: { name: 'photo.png', size: 42, contentType: 'image/png', mediaKind: 'file' } })),
		null,
		'a caller cannot forge an inline-safe media kind or a noncanonical crystal'
	);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(
			attachment({
				crystal: {
					name: 'clip.avi',
					size: 42,
					contentType: 'application/octet-stream',
					mediaKind: 'file',
					detectedContentType: 'video/x-msvideo'
				}
			})
		),
		42,
		'a sniffed display type on an opaque download remains a canonical billable crystal'
	);
	assert.equal(
		attachmentObjectSizeBytesForAccounting(
			attachment({
				crystal: { name: 'clip.mp4', size: 42, contentType: 'video/mp4', mediaKind: 'video', detectedContentType: 'video/x-msvideo' }
			})
		),
		null,
		'a sniffed display type may never accompany an inline-served contentType'
	);
});

test('stored sort order wins over createdAt order; legacy unstamped docs keep their place after stamped ones', () => {
	const docs = [
		{ shareId: 'a', attachmentSortIndex: 2 },
		{ shareId: 'b', attachmentSortIndex: 0 },
		{ shareId: 'c', attachmentSortIndex: 1 }
	];
	assert.deepEqual(
		orderAttachmentDocsByStoredSort(docs).map((doc) => doc.shareId),
		['b', 'c', 'a']
	);
	// legacy docs (no stamp) sort after stamped ones, preserving incoming
	// (createdAt) order between themselves; corrupt stamps count as unstamped
	const mixed = [
		{ shareId: 'old-1' },
		{ shareId: 'new-1', attachmentSortIndex: 1 },
		{ shareId: 'old-2', attachmentSortIndex: -3 },
		{ shareId: 'new-2', attachmentSortIndex: 0 }
	];
	assert.deepEqual(
		orderAttachmentDocsByStoredSort(mixed).map((doc) => doc.shareId),
		['new-2', 'new-1', 'old-1', 'old-2']
	);
	// input order is never mutated in place
	assert.deepEqual(
		docs.map((doc) => doc.shareId),
		['a', 'b', 'c']
	);
});

test('an attachment reorder must be a pure permutation of the bound set', () => {
	assert.deepEqual(planAttachmentReorder(['b', 'a'], ['a', 'b'], 25), { ok: true, orderedIds: ['b', 'a'] });
	assert.deepEqual(planAttachmentReorder([], [], 25), { ok: true, orderedIds: [] });
	// set changes are not reorders
	assert.equal(planAttachmentReorder(['a'], ['a', 'b'], 25).ok, false);
	assert.equal(planAttachmentReorder(['a', 'b', 'c'], ['a', 'b'], 25).ok, false);
	assert.equal(planAttachmentReorder(['a', 'c'], ['a', 'b'], 25).ok, false);
	const missing = planAttachmentReorder(['a'], ['a', 'b'], 25);
	assert.equal(missing.ok === false && missing.status, 409);
	// malformed ids and duplicates fail as bad requests
	const duplicate = planAttachmentReorder(['a', 'a'], ['a'], 25);
	assert.equal(duplicate.ok === false && duplicate.status, 400);
	assert.equal(planAttachmentReorder([''], [''], 25).ok, false);
	assert.equal(planAttachmentReorder([' a'], ['a'], 25).ok, false);
	assert.equal(planAttachmentReorder([42], ['42'], 25).ok, false);
	const overCap = planAttachmentReorder(['a', 'b', 'c'], ['a', 'b', 'c'], 2);
	assert.equal(overCap.ok === false && overCap.status, 400);
});

test('an attachment sync covers every visible bound id and may only append new ids', () => {
	// pure permutation — nothing to add
	assert.deepEqual(planAttachmentSync(['b', 'a'], ['a', 'b'], [], 25), { ok: true, orderedIds: ['b', 'a'], addedIds: [], hiddenTrailingIds: [] });
	assert.deepEqual(planAttachmentSync([], [], [], 25), { ok: true, orderedIds: [], addedIds: [], hiddenTrailingIds: [] });
	// additions surface as addedIds, in the requested display order
	assert.deepEqual(planAttachmentSync(['c', 'a', 'b'], ['a', 'b'], [], 25), {
		ok: true,
		orderedIds: ['c', 'a', 'b'],
		addedIds: ['c'],
		hiddenTrailingIds: []
	});
	assert.deepEqual(planAttachmentSync(['a'], [], [], 25), { ok: true, orderedIds: ['a'], addedIds: ['a'], hiddenTrailingIds: [] });
	// removals are never a side effect of saving an edit
	const missing = planAttachmentSync(['a'], ['a', 'b'], [], 25);
	assert.equal(missing.ok === false && missing.status, 409);
	// malformed ids, duplicates, and the per-target cap fail as bad requests
	const duplicate = planAttachmentSync(['a', 'a'], ['a'], [], 25);
	assert.equal(duplicate.ok === false && duplicate.status, 400);
	assert.equal(planAttachmentSync([''], [], [], 25).ok, false);
	assert.equal(planAttachmentSync([' a'], ['a'], [], 25).ok, false);
	assert.equal(planAttachmentSync([42], ['42'], [], 25).ok, false);
	const overCap = planAttachmentSync(['a', 'b', 'c'], ['a', 'b'], [], 2);
	assert.equal(overCap.ok === false && overCap.status, 400);
});

test('moderation-hidden bound ids are exempt from the sync cover and re-stamp after the request', () => {
	// a client that never saw the hidden id (moderation-pending for someone
	// else's projection era, or blocked) is not conflicting by omitting it
	assert.deepEqual(planAttachmentSync(['b', 'a'], ['a', 'b', 'hidden'], ['hidden'], 25), {
		ok: true,
		orderedIds: ['b', 'a'],
		addedIds: [],
		hiddenTrailingIds: ['hidden']
	});
	// an owner-visible pending id CAN be included and then orders normally
	assert.deepEqual(planAttachmentSync(['hidden', 'a', 'b'], ['a', 'b', 'hidden'], ['hidden'], 25), {
		ok: true,
		orderedIds: ['hidden', 'a', 'b'],
		addedIds: [],
		hiddenTrailingIds: []
	});
	// hidden exemption never excuses a VISIBLE bound id going missing
	const missing = planAttachmentSync(['a'], ['a', 'b', 'hidden'], ['hidden'], 25);
	assert.equal(missing.ok === false && missing.status, 409);
	// the cap counts hidden trailing ids too — they stay bound
	const overCap = planAttachmentSync(['a', 'b'], ['a', 'b', 'hidden'], ['hidden'], 2);
	assert.equal(overCap.ok === false && overCap.status, 400);
	// additions never double-count hidden ids
	assert.deepEqual(planAttachmentSync(['new', 'a'], ['a', 'hidden'], ['hidden'], 25), {
		ok: true,
		orderedIds: ['new', 'a'],
		addedIds: ['new'],
		hiddenTrailingIds: ['hidden']
	});
	assert.equal(attachmentModerationHidesFromPublic({ status: 'pending' }), true);
	assert.equal(attachmentModerationHidesFromPublic({ status: 'blocked' }), true);
	assert.equal(attachmentModerationHidesFromPublic({ status: 'nsfw' }), false);
	assert.equal(attachmentModerationHidesFromPublic({ status: 'clear' }), false);
	assert.equal(attachmentModerationHidesFromPublic(undefined), false);
});

test('owner display filename/title/description are optional, bounded, hygienic, and never stored empty', () => {
	const annotated = sanitizeAttachmentPublicMetadata({
		name: 'sunset.jpg',
		size: 42,
		contentType: 'image/jpeg',
		filenamePreview: '  Bay sunset.jpg  ',
		title: '  Sunset over the bay  ',
		description: 'Line one\nline two 🍉'
	});
	assert.deepEqual(annotated, {
		ok: true,
		crystal: {
			name: 'sunset.jpg',
			size: 42,
			contentType: 'image/jpeg',
			mediaKind: 'image',
			filenamePreview: 'Bay sunset.jpg',
			title: 'Sunset over the bay',
			description: 'Line one\nline two 🍉'
		}
	});
	// blanks collapse to ABSENT keys
	const blank = sanitizeAttachmentPublicMetadata({
		name: 'a.png',
		size: 1,
		contentType: 'image/png',
		filenamePreview: '',
		title: '   ',
		description: ''
	});
	assert.equal(blank.ok, true);
	if (blank.ok) {
		assert.equal('title' in blank.crystal, false);
		assert.equal('description' in blank.crystal, false);
		assert.equal('filenamePreview' in blank.crystal, false);
	}
	// titles are single-line; descriptions allow newlines but no other controls
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', title: 'two\nlines' }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', description: 'bad\ttab' }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', title: 'bad‮title' }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', title: 'x'.repeat(201) }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', description: 'x'.repeat(2001) }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', title: 42 }).ok, false);
	assert.equal(sanitizeAttachmentPublicMetadata({ name: 'a.png', size: 1, contentType: 'image/png', filenamePreview: 'x'.repeat(256) }).ok, false);
});

test('annotated crystals stay canonical for projection and accounting; foreign keys still fail closed', () => {
	const crystal = {
		name: 'photo.png',
		size: 42,
		contentType: 'image/png',
		mediaKind: 'image',
		title: 'A title',
		description: 'A description'
	};
	assert.deepEqual(toAttachmentPublicMetadata('attachment-id', crystal), { id: 'attachment-id', ...crystal });
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ crystal })), 42);
	// untrimmed or empty stored owner text is NOT canonical
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...crystal, title: ' padded ' }), null);
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...crystal, title: '' }), null);
	// unknown keys stay rejected
	assert.equal(toAttachmentPublicMetadata('attachment-id', { ...crystal, objectKey: 'leak' }), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(attachment({ crystal: { ...crystal, extra: true } })), null);
});

test('annotation preserves server-owned magic-byte detection and rejects non-canonical source metadata', () => {
	const opaque = {
		name: 'legacy.avi',
		size: 42,
		contentType: 'application/octet-stream',
		mediaKind: 'file' as const,
		detectedContentType: 'video/x-msvideo',
		title: 'Old title'
	};
	assert.deepEqual(applyAttachmentAnnotationPatch(opaque, { title: 'Detected video', description: 'Still opaque in this browser' }), {
		ok: true,
		crystal: {
			name: 'legacy.avi',
			size: 42,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			title: 'Detected video',
			description: 'Still opaque in this browser',
			detectedContentType: 'video/x-msvideo'
		}
	});
	assert.deepEqual(applyAttachmentAnnotationPatch(opaque, { title: null }), {
		ok: true,
		crystal: {
			name: 'legacy.avi',
			size: 42,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'video/x-msvideo'
		}
	});
	assert.equal(applyAttachmentAnnotationPatch({ ...opaque, detectedContentType: 'application/octet-stream' }, { title: 'x' }).ok, false);
});

// ————— linked (external URL) attachments —————————————————————————————————————

const linkedCrystal = (overrides: Record<string, unknown> = {}) => ({
	name: 'sunset.jpg',
	size: 0,
	contentType: 'image/jpeg',
	mediaKind: 'image',
	url: 'https://example.com/photos/sunset.jpg',
	...overrides
});

const linkedDoc = (overrides: Record<string, unknown> = {}) => ({
	thingtime: ['attachment'],
	attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION,
	attachmentState: 'ready',
	attachmentPurpose: 'post',
	attachmentLinked: true,
	objectSizeBytes: 0,
	objectKey: `${LINKED_ATTACHMENT_OBJECT_KEY_PREFIX}attachment-1`,
	crystal: linkedCrystal(),
	...overrides
});

test('linked URLs are plain bounded http(s) with no credentials or control characters', () => {
	assert.equal(canonicalLinkedAttachmentUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
	assert.equal(canonicalLinkedAttachmentUrl('  https://example.com/a.jpg  '), 'https://example.com/a.jpg');
	assert.equal(canonicalLinkedAttachmentUrl('http://example.com'), 'http://example.com');
	assert.equal(canonicalLinkedAttachmentUrl('ftp://example.com/a.jpg'), null);
	assert.equal(canonicalLinkedAttachmentUrl('https://user:pass@example.com/a.jpg'), null);
	assert.equal(canonicalLinkedAttachmentUrl('https://example.com/a b.jpg'), null);
	assert.equal(canonicalLinkedAttachmentUrl('https://example.com/a\\b.jpg'), null);
	assert.equal(canonicalLinkedAttachmentUrl(`https://example.com/${'a'.repeat(2048)}.jpg`), null);
	assert.equal(canonicalLinkedAttachmentUrl('javascript:alert(1)'), null);
	assert.equal(canonicalLinkedAttachmentUrl(42), null);
});

test('linked media types derive from the extension; unknown defaults to an image hint', () => {
	assert.deepEqual(linkedMediaTypeForUrl('https://example.com/a.JPG'), { contentType: 'image/jpeg', mediaKind: 'image' });
	assert.deepEqual(linkedMediaTypeForUrl('https://example.com/clip.mp4'), { contentType: 'video/mp4', mediaKind: 'video' });
	assert.deepEqual(linkedMediaTypeForUrl('https://example.com/voice.m4a'), { contentType: 'audio/mp4', mediaKind: 'audio' });
	assert.deepEqual(linkedMediaTypeForUrl('https://example.com/voice.flac'), { contentType: 'audio/flac', mediaKind: 'audio' });
	assert.deepEqual(linkedMediaTypeForUrl('https://example.com/spec.pdf'), { contentType: 'application/pdf', mediaKind: 'file' });
	// svg never gets a visual hint — it is a file row, not an inline image
	assert.equal(linkedMediaTypeForUrl('https://example.com/art.svg').mediaKind, 'file');
	assert.deepEqual(linkedMediaTypeForUrl('https://picsum.photos/id/1/600/400'), {
		contentType: 'application/octet-stream',
		mediaKind: 'image'
	});
	assert.equal(linkedAttachmentNameForUrl('https://example.com/photos/sun%20set.jpg'), 'sun set.jpg');
	assert.equal(linkedAttachmentNameForUrl('https://example.com/'), 'example.com');
});

test('linked names always survive the crystal sanitizer round-trip', () => {
	// the 255-char slice must not leave a trailing space or a split surrogate —
	// every derived name has to mint a canonical crystal
	const awkward = [
		`https://example.com/${'a'.repeat(254)}%20b.png`, // slice ends on the encoded space
		`https://example.com/${'a'.repeat(254)}%F0%9F%8D%89.png`, // slice splits the melon emoji
		`https://example.com/${'a'.repeat(400)}.png`, // plain over-long basename
		'https://example.com/%20%20/', // whitespace-only decoded basename
		'https://example.com/a.jpg'
	];
	for (const url of awkward) {
		const name = linkedAttachmentNameForUrl(url);
		const sanitized = sanitizeAttachmentPublicMetadata({ name, size: 0, contentType: 'image/png' });
		assert.equal(sanitized.ok, true, url);
		if (sanitized.ok) assert.equal(sanitized.crystal.name, name, url);
	}
});

test('the client extension table mirrors the server table exactly (pin)', () => {
	const serverKinds = Object.fromEntries(Object.entries(LINKED_MEDIA_EXTENSION_TYPES).map(([ext, entry]) => [ext, entry.mediaKind]));
	assert.deepEqual(LINKED_MEDIA_EXTENSION_KINDS, serverKinds);
});

test('a linked crystal is canonical only as the exact closed shape', () => {
	assert.deepEqual(toAttachmentPublicMetadata('attachment-1', linkedCrystal()), {
		id: 'attachment-1',
		name: 'sunset.jpg',
		size: 0,
		contentType: 'image/jpeg',
		mediaKind: 'image',
		url: 'https://example.com/photos/sunset.jpg'
	});
	// declared render hint survives even when contentType would derive 'file'
	const probed = linkedCrystal({ contentType: 'application/octet-stream', mediaKind: 'image' });
	assert.equal(toAttachmentPublicMetadata('attachment-1', probed)?.mediaKind, 'image');
	// size must be exactly 0; url must be canonical; kinds clamp; extras rejected
	assert.equal(toAttachmentPublicMetadata('attachment-1', linkedCrystal({ size: 12 })), null);
	assert.equal(toAttachmentPublicMetadata('attachment-1', linkedCrystal({ url: 'ftp://x' })), null);
	assert.equal(toAttachmentPublicMetadata('attachment-1', linkedCrystal({ url: ' https://example.com/a.jpg' })), null);
	assert.equal(toAttachmentPublicMetadata('attachment-1', linkedCrystal({ mediaKind: 'audio' }))?.mediaKind, 'audio');
	assert.equal(toAttachmentPublicMetadata('attachment-1', linkedCrystal({ detectedContentType: 'image/png' })), null);
	assert.equal(toAttachmentPublicMetadata('attachment-1', { ...linkedCrystal(), extra: true }), null);
});

test('annotating a linked crystal preserves its url and declared render hint', () => {
	const patched = applyAttachmentAnnotationPatch(linkedCrystal({ contentType: 'application/octet-stream' }), { title: 'Sunset' });
	assert.equal(patched.ok, true);
	if (patched.ok) {
		assert.equal(patched.crystal.url, 'https://example.com/photos/sunset.jpg');
		assert.equal(patched.crystal.mediaKind, 'image');
		assert.equal(patched.crystal.title, 'Sunset');
	}
});

test('linked accounting is a closed variant: exact shape counts zero object bytes, partial claims fail closed', () => {
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc()), 0);
	// every partial/forged combination is invalid
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ attachmentLinked: undefined })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ objectKey: 'objects/attachment-1' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ objectSizeBytes: 42 })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ uploadId: 'mpu-1' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ objectVersionId: 'v1' })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ crystal: linkedCrystal({ url: undefined }) })), null);
	assert.equal(attachmentObjectSizeBytesForAccounting(linkedDoc({ attachmentLinked: 'yes' })), null);
	// a normal upload doc squatting on the linked key namespace fails closed
	assert.equal(
		attachmentObjectSizeBytesForAccounting(
			linkedDoc({ attachmentLinked: undefined, crystal: { name: 'a.png', size: 0, contentType: 'image/png', mediaKind: 'image' } })
		),
		null
	);
});

test('the owner keeps seeing their own pending attachment (flagged); others never do', () => {
	const crystal = { name: 'photo.png', size: 42, contentType: 'image/png', mediaKind: 'image' };
	assert.equal(toAttachmentPublicMetadata('attachment-1', crystal, { status: 'pending' }), null);
	assert.deepEqual(toAttachmentPublicMetadata('attachment-1', crystal, { status: 'pending' }, { ownerView: true }), {
		id: 'attachment-1',
		...crystal,
		pending: true
	});
	// blocked stays hidden for everyone, owner included
	assert.equal(toAttachmentPublicMetadata('attachment-1', crystal, { status: 'blocked' }, { ownerView: true }), null);
	// clear/nsfw are unaffected by ownerView
	assert.equal(toAttachmentPublicMetadata('attachment-1', crystal, { status: 'nsfw' }, { ownerView: true })?.nsfw, true);
});
