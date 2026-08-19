import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ATTACHMENT_ENVELOPE_VERSION,
	ATTACHMENT_STATES,
	attachmentMediaKindForContentType,
	attachmentObjectSizeBytesForAccounting,
	isAttachmentFinalizationLeaseId,
	isAttachmentObjectVersionId,
	orderAttachmentDocsByStoredSort,
	planAttachmentReorder,
	sanitizeAttachmentPublicMetadata,
	toAttachmentPublicMetadata
} from './attachmentCore.ts';

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
