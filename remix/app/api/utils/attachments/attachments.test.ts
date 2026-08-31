import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ATTACHMENT_MIN_PART_BYTES,
	attachmentExpectedPartBytes,
	attachmentIdForRequest,
	createReadyAttachmentPostInsertHook,
	createAttachmentService,
	validateCompletedAttachmentParts
} from './attachments';
import {
	attachmentDeleteClaimFence,
	attachmentDeletingRetryAt,
	attachmentDeletingRetryUpdate,
	attachmentMpuSettlementAt,
	attachmentObjectlessPendingDeleteFence,
	AttachmentBindingError,
	AttachmentStoreConflictError,
	expiredAttachmentDraftFilter,
	type AttachmentDoc
} from './attachmentStore';
import type { AttachmentS3 } from './privateS3';
import { StorageMutationError } from '../storage/storageCore';
import { PrivateS3ConfigError } from './config';

const checksum = (byte: number) => Buffer.alloc(32, byte).toString('base64');
const now = new Date('2026-08-09T00:00:00.000Z');

const attachmentDoc = (overrides: Partial<AttachmentDoc> = {}): AttachmentDoc => ({
	shareId: 'attachment-1',
	schemaVersion: 2,
	thingtime: ['attachment'],
	crystal: { name: 'launch.bin', size: 10 * 1024 * 1024, contentType: 'application/octet-stream', mediaKind: 'file' },
	extended: null,
	ownerId: 'user-1',
	acl: ['tt:user'],
	tags: [],
	storageClass: 'content',
	storageAccountingVersion: 1,
	sizeBytes: 10 * 1024 * 1024 + 100,
	attachmentEnvelopeVersion: 1,
	attachmentState: 'pending',
	objectSizeBytes: 10 * 1024 * 1024,
	objectKey: 'objects/attachment-1',
	uploadId: 'mpu-1',
	attachmentExpiresAt: new Date(now.getTime() + 60_000),
	createdAt: now,
	updatedAt: now,
	...overrides
});

const noopS3 = (overrides: Partial<AttachmentS3> = {}): AttachmentS3 => ({
	createMultipartUpload: async () => ({ uploadId: 'mpu-1' }),
	signUploadPart: async ({ partNumber, checksumSha256 }) => ({
		url: `https://s3.example/${partNumber}`,
		expiresAt: now.toISOString(),
		headers: { 'x-amz-checksum-sha256': checksumSha256 }
	}),
	listParts: async () => [],
	completeMultipartUpload: async () => ({ versionId: 'version-1' }),
	headObject: async () => ({
		sizeBytes: 1,
		checksumSha256: checksum(1),
		checksumType: 'COMPOSITE',
		attachmentId: 'attachment-1',
		versionId: 'version-1'
	}),
	detectContentType: async () => undefined,
	markObjectReady: async () => {},
	abortMultipartUpload: async () => {},
	deleteObject: async () => {},
	signDownload: async () => ({ url: 'https://s3.example/download', expiresAt: now.toISOString() }),
	isNoSuchUpload: () => false,
	isNotFound: () => false,
	...overrides
});

test('start reserves billed pending metadata before creating the S3 MPU', async () => {
	const events: string[] = [];
	let reserved: any;
	const store: any = {
		listExpiredOwned: async () => [],
		reservePending: async (input: any) => {
			events.push('reserve');
			reserved = input;
			return attachmentDoc({ uploadId: undefined, attachmentExpiresAt: input.expiresAt });
		},
		setUploadId: async (_ownerId: string, _id: string, uploadId: string) => {
			events.push('persist-upload-id');
			return attachmentDoc({ uploadId, attachmentExpiresAt: reserved.expiresAt });
		}
	};
	const s3 = noopS3({
		createMultipartUpload: async () => {
			events.push('create-mpu');
			return { uploadId: 'mpu-1' };
		}
	});
	const service = createAttachmentService({
		store,
		getS3: () => s3,
		now: () => now,
		uuid: () => 'attachment-1',
		customMongoActive: () => false
	});

	const result = await service.start('user-1', {
		filename: 'launch.svg',
		contentType: 'image/svg+xml',
		sizeBytes: 10 * 1024 * 1024
	});
	assert.equal(result.ok, true);
	assert.deepEqual(events, ['reserve', 'create-mpu', 'persist-upload-id']);
	assert.equal(reserved.objectKey, 'objects/attachment-1');
	assert.deepEqual(reserved.crystal, {
		name: 'launch.svg',
		size: 10 * 1024 * 1024,
		contentType: 'application/octet-stream',
		mediaKind: 'file'
	});
	if (result.ok) {
		assert.deepEqual(result.upload, {
			id: 'attachment-1',
			partSizeBytes: ATTACHMENT_MIN_PART_BYTES,
			partCount: 2,
			expiresAt: '2026-08-10T00:00:00.000Z'
		});
	}
});

test('start rejects zero-byte files before reserving quota or creating an MPU', async () => {
	let touched = false;
	const service = createAttachmentService({
		store: {
			reservePending: async () => {
				touched = true;
				return attachmentDoc();
			}
		} as any,
		getS3: () => {
			touched = true;
			return noopS3();
		}
	});
	assert.deepEqual(
		await service.start('user-1', {
			filename: 'empty.bin',
			contentType: 'application/octet-stream',
			sizeBytes: 0
		}),
		{
			ok: false,
			status: 400,
			error: 'Attachment size must be between 1 byte and 5 TiB'
		}
	);
	assert.equal(touched, false);
});

test('start preserves safe quota and storage-configuration failure codes', async () => {
	let createdMpu = false;
	const quota = createAttachmentService({
		store: {
			listExpiredOwned: async () => [],
			getById: async () => null,
			reservePending: async () => {
				throw new StorageMutationError(507, 'quota_exceeded', 'Private account byte counts');
			}
		} as any,
		getS3: () =>
			noopS3({
				createMultipartUpload: async () => {
					createdMpu = true;
					return { uploadId: 'mpu-never' };
				}
			}),
		now: () => now,
		uuid: () => 'quota-attachment',
		customMongoActive: () => false
	});
	assert.deepEqual(
		await quota.start('user-1', {
			filename: 'too-large-for-tier.bin',
			contentType: 'application/octet-stream',
			sizeBytes: 1024
		}),
		{
			ok: false,
			status: 507,
			error: 'Private account byte counts',
			code: 'quota_exceeded',
			retryable: false
		}
	);
	assert.equal(createdMpu, false);

	const unconfigured = createAttachmentService({
		store: {} as any,
		getS3: () => {
			throw new PrivateS3ConfigError();
		},
		customMongoActive: () => false
	});
	assert.deepEqual(
		await unconfigured.start('user-1', {
			filename: 'photo.jpg',
			contentType: 'image/jpeg',
			sizeBytes: 1024
		}),
		{
			ok: false,
			status: 503,
			error: 'Private attachment storage is not configured',
			code: 'storage_unconfigured',
			retryable: false
		}
	);
});

test('profile upload purpose is home-pinned, fingerprinted, raster-only, and bounded before reservation', async () => {
	const stored = new Map<string, AttachmentDoc>();
	const reservations: any[] = [];
	let creates = 0;
	const store: any = {
		listExpiredOwned: async () => [],
		getById: async (id: string) => stored.get(id) || null,
		reservePending: async (input: any) => {
			reservations.push(input);
			const doc = attachmentDoc({
				shareId: input.id,
				ownerId: input.ownerId,
				crystal: input.crystal,
				objectSizeBytes: input.crystal.size,
				objectKey: input.objectKey,
				attachmentRequestFingerprint: input.requestFingerprint,
				attachmentPurpose: input.purpose,
				attachmentProfileSlot: input.profileSlot,
				attachmentExpiresAt: input.expiresAt,
				uploadId: undefined
			});
			stored.set(input.id, doc);
			return doc;
		},
		setUploadId: async (_ownerId: string, id: string, uploadId: string) => {
			const doc = { ...stored.get(id)!, uploadId };
			stored.set(id, doc);
			return doc;
		}
	};
	const service = createAttachmentService({
		store,
		getS3: () =>
			noopS3({
				createMultipartUpload: async () => {
					creates += 1;
					return { uploadId: `mpu-${creates}` };
				}
			}),
		now: () => now,
		customMongoActive: () => true
	});
	const sizeBytes = Math.floor(31.6 * 1024 * 1024);
	const started = await service.start('user-1', {
		requestId: 'profile-avatar-request',
		purpose: 'profile-avatar',
		filename: 'avatar.jpg',
		contentType: 'image/jpeg',
		sizeBytes
	});
	assert.equal(started.ok, true);
	if (started.ok) {
		assert.equal(started.upload.partCount, 4);
		assert.equal(started.upload.partSizeBytes, ATTACHMENT_MIN_PART_BYTES);
	}
	assert.equal(reservations[0].purpose, 'profile');
	assert.equal(reservations[0].profileSlot, 'avatar');
	assert.equal(reservations[0].crystal.contentType, 'application/octet-stream');

	assert.deepEqual(
		await service.start('user-1', {
			requestId: 'profile-avatar-request',
			purpose: 'profile-banner',
			filename: 'avatar.jpg',
			contentType: 'image/jpeg',
			sizeBytes
		}),
		{ ok: false, status: 409, error: 'Attachment request id is already in use' }
	);
	for (const [contentType, size] of [
		['image/svg+xml', 1024],
		['video/mp4', 1024],
		['image/jpeg', 64 * 1024 * 1024 + 1]
	] as const) {
		const rejected = await service.start('user-1', {
			requestId: `${contentType}-${size}`.replace(/[^A-Za-z0-9._:-]/g, '-'),
			purpose: 'profile-avatar',
			filename: 'profile.bin',
			contentType,
			sizeBytes: size
		});
		assert.equal(rejected.ok, false);
		if (!rejected.ok) assert.equal(rejected.status, 400);
	}
	assert.equal(reservations.length, 1);
	assert.equal(creates, 1);
});

test('stable requestId makes reservation and MPU creation idempotent while rejecting metadata or owner collisions', async () => {
	const stored = new Map<string, AttachmentDoc>();
	let reserves = 0;
	let creates = 0;
	const store: any = {
		listExpiredOwned: async () => [],
		getById: async (id: string) => stored.get(id) || null,
		reservePending: async (input: any) => {
			reserves += 1;
			const doc = attachmentDoc({
				shareId: input.id,
				ownerId: input.ownerId,
				crystal: input.crystal,
				objectSizeBytes: input.crystal.size,
				objectKey: input.objectKey,
				attachmentRequestFingerprint: input.requestFingerprint,
				attachmentExpiresAt: input.expiresAt,
				uploadId: undefined
			});
			stored.set(input.id, doc);
			return doc;
		},
		setUploadId: async (_ownerId: string, id: string, uploadId: string) => {
			const doc = { ...stored.get(id)!, uploadId };
			stored.set(id, doc);
			return doc;
		}
	};
	const service = createAttachmentService({
		store,
		getS3: () =>
			noopS3({
				createMultipartUpload: async () => {
					creates += 1;
					return { uploadId: 'mpu-1' };
				}
			}),
		now: () => now,
		customMongoActive: () => false
	});
	const request = {
		requestId: 'stable-client-uuid',
		filename: 'launch.bin',
		contentType: 'application/octet-stream',
		sizeBytes: 10 * 1024 * 1024
	};

	const first = await service.start('user-1', request);
	const retried = await service.start('user-1', request);
	assert.deepEqual(retried, first);
	assert.equal(reserves, 1);
	assert.equal(creates, 1);

	assert.deepEqual(await service.start('user-1', { ...request, filename: 'other.bin' }), {
		ok: false,
		status: 409,
		error: 'Attachment request id is already in use'
	});
	const otherOwner = await service.start('user-2', request);
	assert.equal(otherOwner.ok, true);
	if (first.ok && otherOwner.ok) assert.notEqual(first.upload.id, otherOwner.upload.id);
	assert.equal(reserves, 2);
	assert.equal(creates, 2);
});

test('concurrent stable start aborts its redundant MPU and returns the persisted winner plan', async () => {
	const reserved = attachmentDoc({
		shareId: 'stable-race-id',
		uploadId: undefined,
		attachmentRequestFingerprint: 'a'.repeat(64)
	});
	let fingerprint = '';
	const aborted: string[] = [];
	const service = createAttachmentService({
		store: {
			listExpiredOwned: async () => [],
			getById: async () => null,
			reservePending: async (input: any) => {
				fingerprint = input.requestFingerprint;
				return {
					...reserved,
					shareId: input.id,
					objectKey: input.objectKey,
					attachmentRequestFingerprint: input.requestFingerprint,
					attachmentExpiresAt: input.expiresAt
				};
			},
			setUploadId: async () => ({
				...reserved,
				shareId: attachmentIdForRequest('user-1', 'stable-race-id'),
				objectKey: `objects/${attachmentIdForRequest('user-1', 'stable-race-id')}`,
				attachmentRequestFingerprint: fingerprint,
				uploadId: 'mpu-winner'
			})
		} as any,
		getS3: () =>
			noopS3({
				createMultipartUpload: async () => ({ uploadId: 'mpu-redundant' }),
				abortMultipartUpload: async ({ uploadId }) => {
					aborted.push(uploadId);
				}
			}),
		now: () => now,
		customMongoActive: () => false
	});

	const result = await service.start('user-1', {
		requestId: 'stable-race-id',
		filename: 'launch.bin',
		contentType: 'application/octet-stream',
		sizeBytes: 10 * 1024 * 1024
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.upload.id, attachmentIdForRequest('user-1', 'stable-race-id'));
	assert.deepEqual(aborted, ['mpu-redundant']);
});

test('ambiguous setUploadId success never aborts the canonical persisted MPU', async () => {
	let persisted: AttachmentDoc | null = null;
	const aborted: string[] = [];
	const service = createAttachmentService({
		store: {
			listExpiredOwned: async () => [],
			getById: async () => null,
			reservePending: async (input: any) => {
				persisted = attachmentDoc({
					shareId: input.id,
					ownerId: input.ownerId,
					crystal: input.crystal,
					objectSizeBytes: input.crystal.size,
					objectKey: input.objectKey,
					attachmentRequestFingerprint: input.requestFingerprint,
					attachmentExpiresAt: input.expiresAt,
					uploadId: undefined
				});
				return persisted;
			},
			setUploadId: async (_owner: string, _id: string, uploadId: string) => {
				persisted = { ...persisted!, uploadId };
				throw new Error('response lost after commit');
			},
			getOwned: async () => persisted
		} as any,
		getS3: () =>
			noopS3({
				createMultipartUpload: async () => ({ uploadId: 'mpu-canonical' }),
				abortMultipartUpload: async ({ uploadId }) => {
					aborted.push(uploadId);
				}
			}),
		now: () => now,
		customMongoActive: () => false
	});

	const result = await service.start('user-1', {
		requestId: 'ambiguous-commit',
		filename: 'launch.bin',
		contentType: 'application/octet-stream',
		sizeBytes: 10 * 1024 * 1024
	});
	assert.equal(result.ok, true);
	assert.deepEqual(aborted, []);
	assert.equal(persisted?.uploadId, 'mpu-canonical');
});

test('a duplicate start cannot initialize or clean up a fresh shared reservation', async () => {
	let raced: AttachmentDoc | null = null;
	let creates = 0;
	let cleanupClaims = 0;
	const service = createAttachmentService({
		store: {
			listExpiredOwned: async () => [],
			getById: async () => raced,
			reservePending: async (input: any) => {
				raced = attachmentDoc({
					shareId: input.id,
					ownerId: input.ownerId,
					objectKey: input.objectKey,
					objectSizeBytes: input.crystal.size,
					crystal: input.crystal,
					uploadId: undefined,
					attachmentRequestFingerprint: input.requestFingerprint,
					attachmentExpiresAt: input.expiresAt,
					updatedAt: now
				});
				throw Object.assign(new Error('duplicate'), { code: 11000 });
			},
			claimUploadInitialization: async () => null,
			claimObjectlessPendingDeleting: async () => {
				cleanupClaims += 1;
				return null;
			}
		} as any,
		getS3: () =>
			noopS3({
				createMultipartUpload: async () => {
					creates += 1;
					throw new Error('duplicate caller must not create');
				}
			}),
		now: () => now,
		customMongoActive: () => false
	});

	assert.deepEqual(
		await service.start('user-1', {
			requestId: 'same-request',
			filename: 'launch.bin',
			contentType: 'application/octet-stream',
			sizeBytes: 10 * 1024 * 1024
		}),
		{
			ok: false,
			status: 409,
			error: 'Attachment upload is still initializing — try again',
			code: 'upload_initializing',
			retryable: true
		}
	);
	assert.equal(creates, 0);
	assert.equal(cleanupClaims, 0);
});

test('completion trusts S3 list/head data, detects magic bytes, and returns canonical metadata only', async () => {
	const pending = attachmentDoc();
	let readyInput: any;
	let claimedLease = '';
	let tagged = false;
	const ready = attachmentDoc({
		attachmentState: 'ready',
		crystal: { name: 'launch.bin', size: pending.objectSizeBytes, contentType: 'image/png', mediaKind: 'image' },
		objectVersionId: 'version-1',
		uploadId: undefined
	});
	const store: any = {
		claimFinalizing: async (_ownerId: string, _id: string, leaseId: string) => {
			claimedLease = leaseId;
			return {
				doc: { ...pending, attachmentState: 'finalizing', attachmentFinalizationLeaseId: leaseId },
				acquired: true
			};
		},
		renewFinalizing: async (_ownerId: string, _id: string, leaseId: string) =>
			leaseId === claimedLease ? { ...pending, attachmentState: 'finalizing', attachmentFinalizationLeaseId: leaseId } : null,
		markReady: async (_ownerId: string, _id: string, crystal: any, objectVersionId: string, expiresAt: Date, leaseId: string) => {
			readyInput = { crystal, objectVersionId, expiresAt, leaseId };
			return ready;
		}
	};
	const s3 = noopS3({
		listParts: async () => [
			{ partNumber: 1, etag: 'etag-1', sizeBytes: 8 * 1024 * 1024, checksumSha256: checksum(1) },
			{ partNumber: 2, etag: 'etag-2', sizeBytes: 2 * 1024 * 1024, checksumSha256: checksum(2) }
		],
		headObject: async () => ({
			sizeBytes: pending.objectSizeBytes,
			checksumSha256: `${checksum(3)}-2`,
			checksumType: 'COMPOSITE',
			attachmentId: pending.shareId,
			versionId: 'version-1'
		}),
		detectContentType: async () => 'image/png',
		markObjectReady: async () => {
			tagged = true;
		}
	});
	const service = createAttachmentService({ store, getS3: () => s3, now: () => now });
	const result = await service.complete('user-1', { uploadId: 'attachment-1' });
	assert.equal(result.ok, true);
	assert.deepEqual(readyInput.crystal, {
		name: 'launch.bin',
		size: 10 * 1024 * 1024,
		contentType: 'image/png',
		mediaKind: 'image'
	});
	assert.equal(readyInput.expiresAt.toISOString(), '2026-08-10T00:00:00.000Z');
	assert.equal(readyInput.objectVersionId, 'version-1');
	assert.equal(readyInput.leaseId, claimedLease);
	assert.equal(tagged, true);
	if (result.ok) {
		assert.deepEqual(result.attachment, {
			id: 'attachment-1',
			name: 'launch.bin',
			size: 10 * 1024 * 1024,
			contentType: 'image/png',
			mediaKind: 'image'
		});
	}
});

test('completion publishes browser-playable containers inline and preserves sniffed types on opaque downloads', async () => {
	const cases = [
		{ sniffed: 'video/quicktime', expected: { contentType: 'video/quicktime', mediaKind: 'video' } },
		{ sniffed: 'video/x-matroska', expected: { contentType: 'video/x-matroska', mediaKind: 'video' } },
		{
			sniffed: 'video/x-msvideo',
			expected: { contentType: 'application/octet-stream', mediaKind: 'file', detectedContentType: 'video/x-msvideo' }
		}
	] as const;
	for (const { sniffed, expected } of cases) {
		const pending = attachmentDoc();
		let readyCrystal: any;
		let claimedLease = '';
		const store: any = {
			claimFinalizing: async (_ownerId: string, _id: string, leaseId: string) => {
				claimedLease = leaseId;
				return {
					doc: { ...pending, attachmentState: 'finalizing', attachmentFinalizationLeaseId: leaseId },
					acquired: true
				};
			},
			renewFinalizing: async (_ownerId: string, _id: string, leaseId: string) =>
				leaseId === claimedLease ? { ...pending, attachmentState: 'finalizing', attachmentFinalizationLeaseId: leaseId } : null,
			markReady: async (_ownerId: string, _id: string, crystal: any, objectVersionId: string) => {
				readyCrystal = crystal;
				return attachmentDoc({ attachmentState: 'ready', crystal, objectVersionId, uploadId: undefined });
			}
		};
		const s3 = noopS3({
			listParts: async () => [
				{ partNumber: 1, etag: 'etag-1', sizeBytes: 8 * 1024 * 1024, checksumSha256: checksum(1) },
				{ partNumber: 2, etag: 'etag-2', sizeBytes: 2 * 1024 * 1024, checksumSha256: checksum(2) }
			],
			headObject: async () => ({
				sizeBytes: pending.objectSizeBytes,
				checksumSha256: `${checksum(3)}-2`,
				checksumType: 'COMPOSITE',
				attachmentId: pending.shareId,
				versionId: 'version-1'
			}),
			detectContentType: async () => sniffed,
			markObjectReady: async () => {}
		});
		const service = createAttachmentService({ store, getS3: () => s3, now: () => now });
		const result = await service.complete('user-1', { uploadId: 'attachment-1' });
		assert.equal(result.ok, true, sniffed);
		assert.deepEqual(readyCrystal, { name: 'launch.bin', size: 10 * 1024 * 1024, ...expected }, sniffed);
		if (result.ok) {
			assert.deepEqual(result.attachment, { id: 'attachment-1', name: 'launch.bin', size: 10 * 1024 * 1024, ...expected }, sniffed);
		}
	}
});

test('completed part verification rejects gaps, wrong sizes, and malformed checksums', () => {
	assert.deepEqual(
		validateCompletedAttachmentParts(10 * 1024 * 1024, [
			{ partNumber: 1, etag: 'one', sizeBytes: 8 * 1024 * 1024, checksumSha256: checksum(1) },
			{ partNumber: 2, etag: 'two', sizeBytes: 2 * 1024 * 1024, checksumSha256: checksum(2) }
		]).ok,
		true
	);
	assert.deepEqual(
		validateCompletedAttachmentParts(10 * 1024 * 1024, [{ partNumber: 1, etag: 'one', sizeBytes: 8 * 1024 * 1024, checksumSha256: checksum(1) }]),
		{ ok: false, status: 409, error: 'Upload parts are incomplete' }
	);
	assert.equal(
		validateCompletedAttachmentParts(10 * 1024 * 1024, [
			{ partNumber: 1, etag: 'one', sizeBytes: 8 * 1024 * 1024, checksumSha256: 'not-a-checksum' },
			{ partNumber: 2, etag: 'two', sizeBytes: 2 * 1024 * 1024, checksumSha256: checksum(2) }
		]).ok,
		false
	);
	assert.equal(attachmentExpectedPartBytes(10 * 1024 * 1024, 1), 8 * 1024 * 1024);
	assert.equal(attachmentExpectedPartBytes(10 * 1024 * 1024, 2), 2 * 1024 * 1024);
	assert.throws(() => attachmentExpectedPartBytes(10 * 1024 * 1024, 3), /Invalid upload part number/);
});

test('incomplete completion atomically reverts finalizing to pending and returns a retryable authored code', async () => {
	const finalizing = attachmentDoc({ attachmentState: 'finalizing' });
	let revertedWith = '';
	let completed = false;
	const service = createAttachmentService({
		store: {
			claimFinalizing: async (_owner: string, _id: string, leaseId: string) => ({
				doc: { ...finalizing, attachmentFinalizationLeaseId: leaseId },
				acquired: true
			}),
			renewFinalizing: async (_owner: string, _id: string, leaseId: string) => ({
				...finalizing,
				attachmentFinalizationLeaseId: leaseId
			}),
			revertFinalizing: async (_owner: string, _id: string, leaseId: string) => {
				revertedWith = leaseId;
				return { ...finalizing, attachmentState: 'pending' };
			}
		} as any,
		getS3: () =>
			noopS3({
				listParts: async () => [{ partNumber: 1, etag: 'one', sizeBytes: 8 * 1024 * 1024, checksumSha256: checksum(1) }],
				completeMultipartUpload: async () => {
					completed = true;
					return { versionId: 'version-1' };
				}
			})
	});

	assert.deepEqual(await service.complete('user-1', { uploadId: finalizing.shareId }), {
		ok: false,
		status: 409,
		error: 'Upload parts are incomplete',
		code: 'upload_parts_retryable',
		retryable: true
	});
	assert.match(revertedWith, /^[0-9a-f-]{36}$/);
	assert.equal(completed, false);
});

test('a concurrent completion observer cannot revert or execute the active finalization lease', async () => {
	const finalizing = attachmentDoc({ attachmentState: 'finalizing' });
	let listed = false;
	let reverted = false;
	const service = createAttachmentService({
		store: {
			claimFinalizing: async () => ({ doc: finalizing, acquired: false }),
			revertFinalizing: async () => {
				reverted = true;
				return null;
			}
		} as any,
		getS3: () =>
			noopS3({
				listParts: async () => {
					listed = true;
					return [];
				}
			})
	});

	assert.deepEqual(await service.complete('user-1', { uploadId: finalizing.shareId }), {
		ok: false,
		status: 409,
		error: 'Attachment finalization is in progress — try again',
		code: 'finalization_in_progress',
		retryable: true
	});
	assert.equal(listed, false);
	assert.equal(reverted, false);
});

test('a stale finalizer that loses its lease after Complete cannot publish or delete the takeover version', async () => {
	const pending = attachmentDoc();
	let renewals = 0;
	let markedReady = false;
	let reverted = false;
	const deletedVersions: string[] = [];
	const service = createAttachmentService({
		uuid: () => 'lease-old',
		store: {
			claimFinalizing: async (_owner: string, _id: string, leaseId: string) => ({
				doc: {
					...pending,
					attachmentState: 'finalizing',
					attachmentFinalizationLeaseId: leaseId
				},
				acquired: true
			}),
			renewFinalizing: async () => {
				renewals += 1;
				return renewals === 1
					? attachmentDoc({
							attachmentState: 'finalizing',
							attachmentFinalizationLeaseId: 'lease-old'
					  })
					: null;
			},
			getOwned: async () =>
				attachmentDoc({
					attachmentState: 'finalizing',
					attachmentFinalizationLeaseId: 'lease-new',
					updatedAt: new Date(now.getTime() + 16 * 60 * 1000)
				}),
			markReady: async () => {
				markedReady = true;
				throw new Error('stale lease reached markReady');
			},
			revertFinalizing: async () => {
				reverted = true;
				return null;
			}
		} as any,
		getS3: () =>
			noopS3({
				listParts: async () => [
					{ partNumber: 1, etag: 'one', sizeBytes: 8 * 1024 * 1024, checksumSha256: checksum(1) },
					{ partNumber: 2, etag: 'two', sizeBytes: 2 * 1024 * 1024, checksumSha256: checksum(2) }
				],
				completeMultipartUpload: async () => ({ versionId: 'version-takeover' }),
				deleteObject: async ({ versionId }) => {
					deletedVersions.push(versionId);
				}
			})
	});

	assert.deepEqual(await service.complete('user-1', { uploadId: pending.shareId }), {
		ok: false,
		status: 409,
		error: 'Attachment finalization is in progress — try again',
		code: 'finalization_in_progress',
		retryable: true
	});
	assert.equal(renewals, 2);
	assert.equal(markedReady, false);
	assert.equal(reverted, false);
	assert.deepEqual(deletedVersions, []);
});

test('NoSuchUpload followed by HEAD 404 stays finalizing because an older fenced Complete may still settle', async () => {
	const finalizing = attachmentDoc({
		attachmentState: 'finalizing',
		attachmentFinalizationLeaseId: 'lease-new'
	});
	let reverted = false;
	const noSuchUpload = new Error('NoSuchUpload');
	const notFound = new Error('NotFound');
	const service = createAttachmentService({
		uuid: () => 'lease-new',
		store: {
			claimFinalizing: async () => ({ doc: finalizing, acquired: true }),
			renewFinalizing: async () => finalizing,
			revertFinalizing: async () => {
				reverted = true;
				return null;
			}
		} as any,
		getS3: () =>
			noopS3({
				listParts: async () => {
					throw noSuchUpload;
				},
				headObject: async () => {
					throw notFound;
				},
				isNoSuchUpload: (error) => error === noSuchUpload,
				isNotFound: (error) => error === notFound
			})
	});

	assert.deepEqual(await service.complete('user-1', { uploadId: finalizing.shareId }), {
		ok: false,
		status: 409,
		error: 'Attachment finalization is still settling — try again',
		code: 'finalization_settling',
		retryable: true
	});
	assert.equal(reverted, false);
});

test('part signing passes the server-derived exact length for every checksum-locked URL', async () => {
	const lengths: number[] = [];
	let partsIssuedAt: Date | undefined;
	const service = createAttachmentService({
		store: {
			getOwned: async () => attachmentDoc(),
			markPartsIssued: async (_owner: string, _id: string, issuedAt: Date) => {
				partsIssuedAt = issuedAt;
				return attachmentDoc({ attachmentPartsIssuedAt: issuedAt });
			}
		} as any,
		now: () => now,
		getS3: () =>
			noopS3({
				signUploadPart: async ({ partNumber, checksumSha256, contentLength }) => {
					lengths.push(contentLength);
					return {
						url: `https://s3.example/${partNumber}`,
						expiresAt: now.toISOString(),
						headers: { 'x-amz-checksum-sha256': checksumSha256 }
					};
				}
			})
	});
	const result = await service.signParts('user-1', {
		uploadId: 'attachment-1',
		parts: [
			{ partNumber: 1, checksumSha256: checksum(1) },
			{ partNumber: 2, checksumSha256: checksum(2) }
		]
	});
	assert.equal(result.ok, true);
	assert.deepEqual(lengths, [8 * 1024 * 1024, 2 * 1024 * 1024]);
	assert.equal(partsIssuedAt, now);
});

test('post preflight is owner-bound, ready, unexpired and unattached, then atomic bind remains separate', async () => {
	const visual = attachmentDoc({
		attachmentState: 'ready',
		crystal: { name: 'x.png', size: 10 * 1024 * 1024, contentType: 'image/png', mediaKind: 'image' },
		uploadId: undefined
	});
	let requestedOwner = '';
	const service = createAttachmentService({
		store: {
			getOwnedMany: async (ownerId: string) => {
				requestedOwner = ownerId;
				return [visual];
			}
		} as any,
		now: () => now,
		customMongoActive: () => false
	});
	assert.deepEqual(await service.inspectForPost('user-1', ['attachment-1']), {
		ok: true,
		hasAny: true,
		hasVisual: true
	});
	assert.equal(requestedOwner, 'user-1');
});

test('conversation attachment preflight is purpose-bound and accepts only one consistent draft or idempotent target state', async () => {
	let docs: AttachmentDoc[] = [
		attachmentDoc({
			attachmentState: 'ready',
			attachmentPurpose: 'comment',
			uploadId: undefined,
			crystal: { name: 'comment.png', size: 10, contentType: 'image/png', mediaKind: 'image' }
		})
	];
	const service = createAttachmentService({
		store: { getOwnedMany: async () => docs } as any,
		now: () => now,
		customMongoActive: () => false
	});

	const draft = await service.inspectForComment('user-1', ['attachment-1'], 'comment-1');
	assert.equal(draft.ok, true);
	if (draft.ok)
		assert.deepEqual(
			draft.attachments.map((attachment) => attachment.id),
			['attachment-1']
		);

	docs = docs.map((doc) => ({ ...doc, targetId: 'comment-1', attachmentExpiresAt: undefined }));
	assert.equal((await service.inspectForComment('user-1', ['attachment-1'], 'comment-1')).ok, true);
	assert.deepEqual(await service.inspectForComment('user-1', ['attachment-1'], 'other-comment'), {
		ok: false,
		status: 409,
		error: 'One or more attachments are unavailable or already attached'
	});

	docs = [
		...docs,
		attachmentDoc({
			shareId: 'attachment-2',
			attachmentState: 'ready',
			attachmentPurpose: 'comment',
			uploadId: undefined
		})
	];
	assert.equal((await service.inspectForComment('user-1', ['attachment-1', 'attachment-2'], 'comment-1')).ok, false);
	docs = [attachmentDoc({ attachmentState: 'ready', attachmentPurpose: 'message', uploadId: undefined })];
	assert.equal((await service.inspectForComment('user-1', ['attachment-1'], 'comment-1')).ok, false);
});

test('message and custom emoji retries may re-inspect only their exact already-bound target', async () => {
	let doc = attachmentDoc({
		attachmentState: 'ready',
		attachmentPurpose: 'message',
		targetId: 'message-1',
		attachmentExpiresAt: undefined,
		uploadId: undefined
	});
	const service = createAttachmentService({
		store: { getOwnedMany: async () => [doc] } as any,
		now: () => now,
		customMongoActive: () => false
	});
	assert.equal((await service.inspectForMessage('user-1', ['attachment-1'], 'message-1')).ok, true);
	assert.equal((await service.inspectForMessage('user-1', ['attachment-1'])).ok, false);

	doc = {
		...doc,
		attachmentPurpose: 'emoji',
		targetId: 'emoji-1',
		objectSizeBytes: 10,
		crystal: { name: 'party.gif', size: 10, contentType: 'image/gif', mediaKind: 'image' }
	};
	assert.equal((await service.inspectForEmoji('user-1', ['attachment-1'], 'emoji-1')).ok, true);
	assert.equal((await service.inspectForEmoji('user-1', ['attachment-1'], 'emoji-2')).ok, false);
});

test('post insert hook binds the stable created shareId in-session and binding failures are authored storage errors', async () => {
	const calls: unknown[][] = [];
	const session = { transaction: true };
	const hook = createReadyAttachmentPostInsertHook(['attachment-1'], async (...args: unknown[]) => {
		calls.push(args);
	});
	await hook({ shareId: 'stable-post-id', ownerId: 'user-1' }, session);
	assert.deepEqual(calls, [['user-1', ['attachment-1'], 'stable-post-id', session]]);

	const authored = new AttachmentBindingError(409, 'One or more attachments changed');
	assert.ok(authored instanceof StorageMutationError);
	const failing = createReadyAttachmentPostInsertHook(['attachment-1'], async () => {
		throw authored;
	});
	await assert.rejects(failing({ shareId: 'stable-post-id', ownerId: 'user-1' }, session), (error) => error === authored);
});

test('session replacement cleanup is owner-scoped, bounded, and preserves deferred MPU billing', async () => {
	const pending = attachmentDoc({ attachmentState: 'pending', attachmentPartsIssuedAt: now });
	const ready = attachmentDoc({
		shareId: 'attachment-2',
		objectKey: 'objects/attachment-2',
		attachmentState: 'ready',
		uploadId: undefined,
		objectVersionId: 'version-2'
	});
	const scopes: unknown[] = [];
	let listArgs: unknown[] = [];
	const deleted: string[] = [];
	const service = createAttachmentService({
		now: () => now,
		customMongoActive: () => false,
		store: {
			listUnboundOwned: async (...args: unknown[]) => {
				listArgs = args;
				return [pending, ready];
			},
			claimDeleting: async (_owner: string, id: string, _states: unknown, scope: unknown) => {
				scopes.push(scope);
				return id === pending.shareId
					? { ...pending, attachmentState: 'deleting', attachmentExpiresAt: attachmentMpuSettlementAt(now) }
					: { ...ready, attachmentState: 'deleting' };
			},
			removeDeleting: async () => true
		} as any,
		getS3: () =>
			noopS3({
				deleteObject: async ({ objectKey }) => {
					deleted.push(objectKey);
				}
			})
	});

	assert.deepEqual(await service.beforeSessionReplacement('user-1'), {
		ok: true,
		scanned: 2,
		deleted: 1,
		deferred: 1,
		skipped: 0,
		failed: 0,
		hasMore: false
	});
	assert.deepEqual(listArgs, ['user-1', 26]);
	assert.deepEqual(scopes, [{ kind: 'draft' }, { kind: 'draft' }]);
	assert.deepEqual(deleted, ['objects/attachment-2']);
});

test('cascade preparation never queries home attachments for a custom-plane shareId and scopes normal lookup by owner', async () => {
	let calls = 0;
	const custom = createAttachmentService({
		customMongoActive: () => true,
		store: {
			listForTarget: async () => {
				calls += 1;
				return [];
			}
		} as any
	});
	assert.deepEqual(await custom.beforeCascade({ shareId: 'collision', ownerId: 'custom-user' }), { ok: true });
	assert.equal(calls, 0);

	let lookup: string[] = [];
	const home = createAttachmentService({
		customMongoActive: () => false,
		store: {
			listForTarget: async (ownerId: string, targetId: string) => {
				lookup = [ownerId, targetId];
				return [];
			}
		} as any
	});
	assert.deepEqual(await home.beforeCascade({ shareId: 'post-1', ownerId: 'user-1' }), { ok: true });
	assert.deepEqual(lookup, ['user-1', 'post-1']);
});

test('download authorization keeps active files opaque and hides unauthorized existence', async () => {
	const signed: any[] = [];
	const file = attachmentDoc({
		attachmentState: 'ready',
		targetId: 'post-1',
		objectVersionId: 'version-1',
		uploadId: undefined,
		crystal: { name: 'active.svg', size: 10, contentType: 'application/octet-stream', mediaKind: 'file' }
	});
	const service = createAttachmentService({
		store: { getById: async () => file } as any,
		canViewTarget: async (viewer) => viewer?.id === 'reader',
		getS3: () =>
			noopS3({
				signDownload: async (input) => {
					signed.push(input);
					return { url: 'https://s3.example/private', expiresAt: now.toISOString() };
				}
			})
	});
	assert.deepEqual(await service.download({ id: 'stranger' }, 'attachment-1', false), {
		ok: false,
		status: 404,
		error: 'Attachment not found'
	});
	assert.equal(signed.length, 0);
	assert.equal((await service.download({ id: 'reader' }, 'attachment-1', false)).ok, true);
	assert.equal(signed[0].contentType, 'application/octet-stream');
	assert.match(signed[0].contentDisposition, /^attachment;/);
});

test('pending moderation quarantines bytes from the audience while owner and admin evidence access remain available', async () => {
	const file = attachmentDoc({
		attachmentState: 'ready',
		targetId: 'post-1',
		objectVersionId: 'version-1',
		uploadId: undefined,
		moderation: { status: 'pending' }
	});
	let signed = 0;
	const service = createAttachmentService({
		store: { getById: async () => file } as any,
		canViewTarget: async () => true,
		getS3: () =>
			noopS3({
				signDownload: async () => {
					signed += 1;
					return { url: 'https://s3.example/private', expiresAt: now.toISOString() };
				}
			})
	});

	assert.deepEqual(await service.download({ id: 'reader' }, file.shareId, false), {
		ok: false,
		status: 404,
		error: 'Attachment not found'
	});
	assert.equal((await service.download({ id: file.ownerId }, file.shareId, false)).ok, true);
	assert.equal((await service.download({ id: 'admin-1', isAdmin: true }, file.shareId, false)).ok, true);
	assert.equal(signed, 2);
});

test('download never authorizes a home S3 object against a custom data plane', async () => {
	let storeReads = 0;
	let visibilityChecks = 0;
	const service = createAttachmentService({
		customMongoActive: () => true,
		store: {
			getById: async () => {
				storeReads += 1;
				return attachmentDoc({ attachmentState: 'ready', targetId: 'spoofed-post' });
			}
		} as any,
		canViewTarget: async () => {
			visibilityChecks += 1;
			return true;
		}
	});
	assert.deepEqual(await service.download({ id: 'attacker' }, 'attachment-1', false), {
		ok: false,
		status: 404,
		error: 'Attachment not found'
	});
	assert.equal(storeReads, 1);
	assert.equal(visibilityChecks, 0);
});

test('profile download under a custom post data plane requires the exact home user slot even for its owner', async () => {
	const profile = attachmentDoc({
		attachmentState: 'ready',
		targetId: 'user-1',
		attachmentPurpose: 'profile',
		attachmentProfileSlot: 'avatar',
		objectVersionId: 'version-1',
		uploadId: undefined,
		attachmentExpiresAt: undefined,
		crystal: { name: 'avatar.jpg', size: 10, contentType: 'image/jpeg', mediaKind: 'image' }
	});
	let checked: AttachmentDoc | null = null;
	const allowed = createAttachmentService({
		customMongoActive: () => true,
		store: { getById: async () => profile } as any,
		canViewTarget: async (_viewer, attachment) => {
			checked = attachment;
			return true;
		},
		getS3: () => noopS3()
	});
	assert.equal((await allowed.download(null, 'attachment-1', false)).ok, true);
	assert.equal(checked, profile);

	const stale = createAttachmentService({
		customMongoActive: () => true,
		store: { getById: async () => profile } as any,
		canViewTarget: async () => false,
		getS3: () => noopS3()
	});
	assert.deepEqual(await stale.download({ id: 'user-1' }, 'attachment-1', false), {
		ok: false,
		status: 404,
		error: 'Attachment not found'
	});
});

test('an expired released profile draft is inaccessible to its owner while exact-version cleanup remains pending', async () => {
	let s3Reads = 0;
	const released = attachmentDoc({
		attachmentState: 'ready',
		attachmentPurpose: 'profile',
		attachmentProfileSlot: 'avatar',
		targetId: undefined,
		attachmentExpiresAt: now,
		objectVersionId: 'version-1',
		uploadId: undefined
	});
	const service = createAttachmentService({
		now: () => now,
		store: { getById: async () => released } as any,
		getS3: () => {
			s3Reads += 1;
			return noopS3();
		}
	});
	assert.deepEqual(await service.download({ id: 'user-1' }, 'attachment-1', false), {
		ok: false,
		status: 404,
		error: 'Attachment not found'
	});
	assert.equal(s3Reads, 0);
});

test('explicit delete cannot remove an attachment after an ambiguously successful post create', async () => {
	let claimed = false;
	const service = createAttachmentService({
		store: {
			getOwned: async () => attachmentDoc({ attachmentState: 'ready', targetId: 'post-1' }),
			claimDeleting: async () => {
				claimed = true;
				return null;
			}
		} as any
	});
	assert.deepEqual(await service.remove('user-1', { id: 'attachment-1' }), {
		ok: false,
		status: 409,
		error: 'Attached files must be removed from their post'
	});
	assert.equal(claimed, false);
});

test('explicit edit deletion requires and claims the exact bound target', async () => {
	let claimScope: unknown;
	const service = createAttachmentService({
		store: {
			getOwned: async () => attachmentDoc({ attachmentState: 'ready', targetId: 'post-1' }),
			claimDeleting: async (_owner: string, _id: string, _states: unknown, scope: unknown) => {
				claimScope = scope;
				return null;
			}
		} as any,
		getS3: () => noopS3()
	});
	assert.deepEqual(await service.remove('user-1', { id: 'attachment-1', targetId: 'post-1' }), { ok: true, deferred: false });
	assert.deepEqual(claimScope, { kind: 'target', targetId: 'post-1' });
	assert.deepEqual(await service.remove('user-1', { id: 'attachment-1', targetId: 'post-2' }), {
		ok: false,
		status: 409,
		error: 'Attached files must be removed from their post'
	});
});

test('delete claim fences distinguish unattached drafts, expired drafts, and one exact target', () => {
	assert.deepEqual(attachmentDeleteClaimFence({ kind: 'draft' }), { targetId: { $exists: false } });
	assert.deepEqual(attachmentDeleteClaimFence({ kind: 'draft', expiredAtOrBefore: now }), {
		targetId: { $exists: false },
		attachmentExpiresAt: { $lte: now }
	});
	assert.deepEqual(attachmentDeleteClaimFence({ kind: 'target', targetId: 'post-1' }), { targetId: 'post-1' });
	assert.deepEqual(attachmentObjectlessPendingDeleteFence({ kind: 'draft', expiredAtOrBefore: now }), {
		targetId: { $exists: false },
		attachmentExpiresAt: { $lte: now },
		attachmentState: 'pending',
		uploadId: { $exists: false },
		objectVersionId: { $exists: false },
		attachmentObjectlessDelete: { $exists: false }
	});
	assert.equal(attachmentDeletingRetryAt(now).toISOString(), '2026-08-09T00:15:00.000Z');
	assert.equal(attachmentMpuSettlementAt(now).toISOString(), '2026-08-17T00:00:00.000Z');
	assert.deepEqual(attachmentDeletingRetryUpdate(attachmentDeletingRetryAt(now), now), {
		$max: { attachmentExpiresAt: attachmentDeletingRetryAt(now) },
		$set: { updatedAt: now }
	});
});

test('draft cleanup loses safely when a concurrent post bind wins the atomic claim', async () => {
	let deleteCalls = 0;
	let claimScope: unknown;
	const service = createAttachmentService({
		store: {
			getOwned: async () => attachmentDoc({ attachmentState: 'ready', uploadId: undefined }),
			claimDeleting: async (_owner: string, _id: string, _states: unknown, scope: unknown) => {
				claimScope = scope;
				// Simulates bindReadyAttachmentsToTarget winning first: the store's
				// targetId-absent fence no longer matches, so cleanup claims nothing.
				return null;
			}
		} as any,
		getS3: () =>
			noopS3({
				deleteObject: async () => {
					deleteCalls += 1;
				}
			})
	});
	assert.deepEqual(await service.remove('user-1', { id: 'attachment-1' }), { ok: true, deferred: false });
	assert.deepEqual(claimScope, { kind: 'draft' });
	assert.equal(deleteCalls, 0);
});

test('cascade S3 claim is fenced to the exact owner target relation', async () => {
	let claimArgs: unknown[] = [];
	const linked = attachmentDoc({ attachmentState: 'ready', targetId: 'post-1', uploadId: undefined });
	const service = createAttachmentService({
		customMongoActive: () => false,
		store: {
			listForTarget: async () => [linked],
			claimDeleting: async (...args: unknown[]) => {
				claimArgs = args;
				return null;
			},
			getOwned: async () => null
		} as any,
		getS3: () => noopS3()
	});
	assert.deepEqual(await service.beforeCascade({ shareId: 'post-1', ownerId: 'user-1' }), { ok: true });
	assert.equal(claimArgs[0], 'user-1');
	assert.equal(claimArgs[1], 'attachment-1');
	assert.deepEqual(claimArgs[3], { kind: 'target', targetId: 'post-1' });
});

test('cascade removes each exact-version row immediately and leaves a later failure retryable', async () => {
	const first = attachmentDoc({
		shareId: 'attachment-1',
		objectKey: 'objects/attachment-1',
		objectVersionId: 'version-1',
		attachmentState: 'ready',
		targetId: 'post-1',
		uploadId: undefined
	});
	const second = attachmentDoc({
		shareId: 'attachment-2',
		objectKey: 'objects/attachment-2',
		objectVersionId: 'version-2',
		attachmentState: 'ready',
		targetId: 'post-1',
		uploadId: undefined
	});
	const removed: string[] = [];
	const deleted: string[] = [];
	const service = createAttachmentService({
		customMongoActive: () => false,
		store: {
			listForTarget: async () => [first, second],
			claimDeleting: async (_owner: string, id: string) => ({
				...(id === first.shareId ? first : second),
				attachmentState: 'deleting'
			}),
			removeDeleting: async (_owner: string, id: string) => {
				removed.push(id);
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				deleteObject: async ({ objectKey, versionId }) => {
					deleted.push(`${objectKey}@${versionId}`);
					if (objectKey === second.objectKey) throw new Error('S3 unavailable');
				}
			})
	});
	const result = await service.beforeCascade({ shareId: 'post-1', ownerId: 'user-1' });
	assert.equal(result.ok, false);
	assert.deepEqual(deleted, ['objects/attachment-1@version-1', 'objects/attachment-2@version-2']);
	assert.deepEqual(removed, ['attachment-1']);
});

test('pending cancellation stays billed until delayed repeated abort/list verification', async () => {
	const pending = attachmentDoc({ attachmentPartsIssuedAt: now });
	let aborts = 0;
	let removals = 0;
	const delayed = attachmentDoc({
		attachmentState: 'deleting',
		attachmentPartsIssuedAt: now,
		attachmentExpiresAt: attachmentMpuSettlementAt(now)
	});
	const cancelService = createAttachmentService({
		now: () => now,
		store: {
			getOwned: async () => pending,
			claimDeleting: async () => delayed,
			removeDeleting: async () => {
				removals += 1;
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				abortMultipartUpload: async () => {
					aborts += 1;
				}
			})
	});
	assert.deepEqual(await cancelService.cancel('user-1', { uploadId: pending.shareId }), {
		ok: true,
		deferred: true,
		retryAt: '2026-08-17T00:00:00.000Z'
	});
	assert.equal(aborts, 1);
	assert.equal(removals, 0);

	const mature = attachmentDoc({
		attachmentState: 'deleting',
		attachmentPartsIssuedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
		attachmentExpiresAt: new Date(now.getTime() - 1),
		updatedAt: new Date(now.getTime() - 15 * 60 * 1000)
	});
	const missing = Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
	let firstEmptyAt: Date | null = null;
	let firstRetryAt: Date | null = null;
	let lists = 0;
	const firstVerificationService = createAttachmentService({
		now: () => now,
		clock: () => 0,
		store: {
			listExpired: async () => [mature],
			claimDeleting: async () => mature,
			recordMpuCleanupVerification: async (_owner: string, _id: string, verifiedAt: Date | null, retryAt: Date) => {
				firstEmptyAt = verifiedAt;
				firstRetryAt = retryAt;
			}
		} as any,
		getS3: () =>
			noopS3({
				abortMultipartUpload: async () => {
					aborts += 1;
				},
				listParts: async () => {
					lists += 1;
					return [];
				}
			})
	});
	const firstPass = await firstVerificationService.reapExpired();
	assert.equal(firstPass.ok, true);
	if (firstPass.ok) {
		assert.equal(firstPass.deleted, 0);
		assert.equal(firstPass.deferred, 1);
	}
	assert.equal(firstEmptyAt?.toISOString(), '2026-08-09T00:00:00.000Z');
	assert.equal(firstRetryAt?.toISOString(), '2026-08-09T01:00:00.000Z');
	assert.equal(removals, 0);

	const secondNow = new Date(now.getTime() + 60 * 60 * 1000 + 1);
	const confirmed = attachmentDoc({
		...mature,
		attachmentMpuEmptyVerifiedAt: now,
		attachmentExpiresAt: new Date(now.getTime() + 60 * 60 * 1000)
	});
	const secondVerificationService = createAttachmentService({
		now: () => secondNow,
		clock: () => 0,
		store: {
			listExpired: async () => [confirmed],
			claimDeleting: async () => confirmed,
			removeDeleting: async () => {
				removals += 1;
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				abortMultipartUpload: async () => {
					aborts += 1;
				},
				listParts: async () => {
					lists += 1;
					return [];
				},
				headObject: async () => {
					throw missing;
				},
				isNotFound: (error) => error === missing
			})
	});
	const secondPass = await secondVerificationService.reapExpired();
	assert.equal(secondPass.ok, true);
	if (secondPass.ok) {
		assert.equal(secondPass.deleted, 1);
		assert.equal(secondPass.deferred, 0);
	}
	assert.equal(lists, 2);
	assert.equal(removals, 1);
});

test('an MPU with no issued part URL aborts and refunds promptly after one empty verification', async () => {
	const pending = attachmentDoc({ attachmentPartsIssuedAt: undefined });
	const deleting = attachmentDoc({
		attachmentState: 'deleting',
		attachmentPartsIssuedAt: undefined,
		attachmentExpiresAt: attachmentDeletingRetryAt(now)
	});
	const missing = Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
	let aborts = 0;
	let lists = 0;
	let removals = 0;
	const service = createAttachmentService({
		now: () => now,
		store: {
			getOwned: async () => pending,
			claimDeleting: async () => deleting,
			removeDeleting: async () => {
				removals += 1;
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				abortMultipartUpload: async () => {
					aborts += 1;
				},
				listParts: async () => {
					lists += 1;
					return [];
				},
				headObject: async () => {
					throw missing;
				},
				isNotFound: (error) => error === missing
			})
	});

	assert.deepEqual(await service.cancel('user-1', { uploadId: pending.shareId }), {
		ok: true,
		deferred: false
	});
	assert.equal(aborts, 1);
	assert.equal(lists, 1);
	assert.equal(removals, 1);
});

test('unexpected MPU parts without an issuance marker escalate to the full settlement hold', async () => {
	const deleting = attachmentDoc({
		attachmentState: 'deleting',
		attachmentPartsIssuedAt: undefined,
		attachmentExpiresAt: new Date(now.getTime() - 1)
	});
	let recorded: { retryAt: Date; partsIssuedAt?: Date } | undefined;
	const service = createAttachmentService({
		now: () => now,
		clock: () => 0,
		store: {
			listExpired: async () => [deleting],
			claimDeleting: async () => deleting,
			recordMpuCleanupVerification: async (_owner: string, _id: string, _empty: Date | null, retryAt: Date, partsIssuedAt?: Date) => {
				recorded = { retryAt, partsIssuedAt };
			}
		} as any,
		getS3: () =>
			noopS3({
				listParts: async () => [{ partNumber: 1, etag: 'etag', sizeBytes: 1, checksumSha256: checksum(1) }]
			})
	});

	const result = await service.reapExpired();
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.deferred, 1);
	assert.equal(recorded?.partsIssuedAt, now);
	assert.equal(recorded?.retryAt.toISOString(), '2026-08-17T00:00:00.000Z');
});

test('expired pending reservation without an upload id persists objectless proof before HEAD-404 refund', async () => {
	const pending = attachmentDoc({
		uploadId: undefined,
		attachmentExpiresAt: new Date(now.getTime() - 1)
	});
	const claimed = attachmentDoc({
		uploadId: undefined,
		attachmentState: 'deleting',
		attachmentObjectlessDelete: true,
		attachmentExpiresAt: new Date(now.getTime() + 15 * 60 * 1000)
	});
	const missing = Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
	let objectlessClaimScope: unknown;
	let ordinaryClaims = 0;
	let removed = 0;
	const service = createAttachmentService({
		now: () => now,
		clock: () => 0,
		store: {
			listExpired: async () => [pending],
			claimObjectlessPendingDeleting: async (_owner: string, _id: string, scope: unknown) => {
				objectlessClaimScope = scope;
				return claimed;
			},
			claimDeleting: async () => {
				ordinaryClaims += 1;
				return null;
			},
			removeDeleting: async () => {
				removed += 1;
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				headObject: async () => {
					throw missing;
				},
				isNotFound: (error) => error === missing
			})
	});

	const result = await service.reapExpired();
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.deleted, 1);
	assert.deepEqual(objectlessClaimScope, {
		kind: 'draft',
		expiredAtOrBefore: now,
		finalizingUpdatedAtOrBefore: new Date(now.getTime() - 60 * 60 * 1000)
	});
	assert.equal(ordinaryClaims, 0);
	assert.equal(removed, 1);
});

test('durable objectless deleting tombstone survives a process crash and remains safely refundable', async () => {
	const tombstone = attachmentDoc({
		uploadId: undefined,
		attachmentState: 'deleting',
		attachmentObjectlessDelete: true,
		attachmentExpiresAt: new Date(now.getTime() - 1)
	});
	const missing = Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
	let removed = 0;
	const service = createAttachmentService({
		now: () => now,
		clock: () => 0,
		store: {
			listExpired: async () => [tombstone],
			claimDeleting: async () => tombstone,
			removeDeleting: async () => {
				removed += 1;
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				headObject: async () => {
					throw missing;
				},
				isNotFound: (error) => error === missing
			})
	});

	const result = await service.reapExpired();
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.deleted, 1);
	assert.equal(removed, 1);
});

test('failed deleting tombstones are pushed out of the oldest-first reaper window', async () => {
	const deleting = attachmentDoc({
		attachmentState: 'deleting',
		objectVersionId: 'version-1',
		uploadId: undefined,
		attachmentExpiresAt: new Date(now.getTime() - 1)
	});
	let retryAt: Date | undefined;
	const service = createAttachmentService({
		now: () => now,
		clock: () => 0,
		store: {
			listExpired: async () => [deleting],
			claimDeleting: async () => deleting,
			deferDeletingRetry: async (_owner: string, _id: string, next: Date) => {
				retryAt = next;
			}
		} as any,
		getS3: () =>
			noopS3({
				deleteObject: async () => {
					throw new Error('temporary S3 failure');
				}
			})
	});
	const result = await service.reapExpired();
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.failed, 1);
	assert.equal(retryAt?.toISOString(), '2026-08-09T00:15:00.000Z');
});

test('global reaper stops before its wall-clock budget and reports remaining work', async () => {
	let clockCalls = 0;
	let claims = 0;
	const service = createAttachmentService({
		now: () => now,
		clock: () => (clockCalls++ === 0 ? 0 : 25_000),
		store: {
			listExpired: async () => [
				attachmentDoc({ attachmentExpiresAt: new Date(now.getTime() - 1) }),
				attachmentDoc({ shareId: 'attachment-2', attachmentExpiresAt: new Date(now.getTime() - 1) })
			],
			claimDeleting: async () => {
				claims += 1;
				return null;
			}
		} as any,
		getS3: () => noopS3()
	});
	const result = await service.reapExpired();
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.scanned, 0);
		assert.equal(result.hasMore, true);
		assert.equal(result.stoppedForTimeBudget, true);
	}
	assert.equal(claims, 0);
});

test('global expired draft scan is expiry-first, unattached, bounded, and repeat-safe', async () => {
	assert.deepEqual(expiredAttachmentDraftFilter(now), {
		thingtime: 'attachment',
		attachmentExpiresAt: { $lte: now },
		$or: [
			{ targetId: { $exists: false }, attachmentState: { $in: ['pending', 'ready'] } },
			{
				targetId: { $exists: false },
				attachmentState: 'finalizing',
				updatedAt: { $lte: now }
			},
			{ attachmentState: 'deleting' }
		]
	});

	const first = attachmentDoc({
		attachmentState: 'ready',
		objectVersionId: 'version-1',
		uploadId: undefined,
		attachmentExpiresAt: new Date(now.getTime() - 2_000)
	});
	const raced = attachmentDoc({
		shareId: 'attachment-2',
		objectKey: 'objects/attachment-2',
		attachmentExpiresAt: new Date(now.getTime() - 1_000)
	});
	const events: string[] = [];
	let firstClaimed = false;
	let listArgs: unknown[] = [];
	const service = createAttachmentService({
		now: () => now,
		clock: () => 0,
		store: {
			listExpired: async (...args: unknown[]) => {
				listArgs = args;
				return [first, raced];
			},
			claimDeleting: async (_owner: string, id: string, _states: unknown, scope: unknown) => {
				events.push(`claim:${id}:${JSON.stringify(scope)}`);
				if (id === first.shareId && !firstClaimed) {
					firstClaimed = true;
					return { ...first, attachmentState: 'deleting' };
				}
				return null;
			},
			removeDeleting: async (_owner: string, id: string) => {
				events.push(`remove:${id}`);
				return true;
			}
		} as any,
		getS3: () =>
			noopS3({
				abortMultipartUpload: async ({ objectKey }) => {
					events.push(`abort:${objectKey}`);
				},
				deleteObject: async ({ objectKey }) => {
					events.push(`delete:${objectKey}`);
				}
			})
	});

	assert.deepEqual(await service.reapExpired(), {
		ok: true,
		scanned: 2,
		deleted: 1,
		deferred: 0,
		skipped: 1,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	});
	assert.deepEqual(listArgs, [1001, now]);
	assert.ok(events.indexOf('delete:objects/attachment-1') < events.indexOf('remove:attachment-1'));

	assert.deepEqual(await service.reapExpired(), {
		ok: true,
		scanned: 2,
		deleted: 0,
		deferred: 0,
		skipped: 2,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	});
	assert.equal(events.filter((event) => event === 'delete:objects/attachment-1').length, 1);
});

// Rows finalized before magic-byte detection existed: ready, opaque crystal,
// no sniffed label — the detection backfill's exact candidate shape.
const legacyReadyDoc = (overrides: Partial<AttachmentDoc> = {}) =>
	attachmentDoc({
		attachmentState: 'ready',
		uploadId: undefined,
		objectVersionId: 'version-1',
		targetId: 'post-1',
		attachmentExpiresAt: undefined,
		...overrides
	});

test('detection backfill publishes exactly what completion would have and never touches names or sizes', async () => {
	const docs = [
		legacyReadyDoc({
			shareId: 'att-avi',
			objectKey: 'objects/att-avi',
			crystal: {
				...attachmentDoc().crystal,
				name: 'clip.avi',
				title: 'Owner title',
				description: 'Owner description'
			} as any
		}),
		legacyReadyDoc({ shareId: 'att-mov', objectKey: 'objects/att-mov', crystal: { ...attachmentDoc().crystal, name: 'clip.mov' } }),
		legacyReadyDoc({ shareId: 'att-raw', objectKey: 'objects/att-raw' })
	];
	const sniffed: Record<string, string | undefined> = {
		'objects/att-avi': 'video/x-msvideo',
		'objects/att-mov': 'video/quicktime',
		'objects/att-raw': undefined
	};
	let listArgs: unknown[] = [];
	const upgrades = new Map<string, { crystal: any; versionId: string }>();
	const service = createAttachmentService({
		store: {
			listReadyUndetected: async (...args: unknown[]) => {
				listArgs = args;
				return docs;
			},
			upgradeReadyCrystal: async (id: string, crystal: any, versionId: string) => {
				upgrades.set(id, { crystal, versionId });
				return legacyReadyDoc({ shareId: id, crystal });
			}
		} as any,
		getS3: () => noopS3({ detectContentType: async ({ objectKey }) => sniffed[objectKey] }),
		customMongoActive: () => false
	});

	const result = await service.backfillDetectedTypes({});
	assert.deepEqual(result, {
		ok: true,
		dryRun: false,
		scanned: 3,
		upgradedInline: 1,
		labeledOpaque: 1,
		undetected: 1,
		missingObject: 0,
		conflicts: 0,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	});
	assert.deepEqual(listArgs, [201, undefined]);
	assert.deepEqual(upgrades.get('att-mov'), {
		crystal: { name: 'clip.mov', size: 10 * 1024 * 1024, contentType: 'video/quicktime', mediaKind: 'video' },
		versionId: 'version-1'
	});
	assert.deepEqual(upgrades.get('att-avi'), {
		crystal: {
			name: 'clip.avi',
			size: 10 * 1024 * 1024,
			contentType: 'application/octet-stream',
			mediaKind: 'file',
			detectedContentType: 'video/x-msvideo',
			title: 'Owner title',
			description: 'Owner description'
		},
		versionId: 'version-1'
	});
	// Undetectable bytes stay untouched so a later, wider detector can claim them.
	assert.equal(upgrades.has('att-raw'), false);

	// Once the candidate set is empty a re-run reports pure zeros — idempotent.
	const drained = createAttachmentService({
		store: { listReadyUndetected: async () => [] } as any,
		getS3: () => noopS3(),
		customMongoActive: () => false
	});
	assert.deepEqual(await drained.backfillDetectedTypes({}), {
		ok: true,
		dryRun: false,
		scanned: 0,
		upgradedInline: 0,
		labeledOpaque: 0,
		undetected: 0,
		missingObject: 0,
		conflicts: 0,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	});
});

test('detection backfill fails closed instead of erasing malformed annotation metadata', async () => {
	let wrote = false;
	const service = createAttachmentService({
		store: {
			listReadyUndetected: async () => [
				legacyReadyDoc({
					shareId: 'att-malformed-annotation',
					crystal: { ...attachmentDoc().crystal, title: { unexpected: true } } as any
				})
			],
			upgradeReadyCrystal: async () => {
				wrote = true;
				throw new Error('malformed annotation must not be rewritten');
			}
		} as any,
		getS3: () => noopS3({ detectContentType: async () => 'video/quicktime' }),
		customMongoActive: () => false
	});
	const result = await service.backfillDetectedTypes({});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.conflicts, 1);
		assert.equal(result.upgradedInline, 0);
	}
	assert.equal(wrote, false);
});

test('detection backfill dry run counts changes, writes nothing, and pages with a cursor', async () => {
	const docs = [
		legacyReadyDoc({ shareId: 'att-1', objectKey: 'objects/att-1' }),
		legacyReadyDoc({ shareId: 'att-2', objectKey: 'objects/att-2' }),
		legacyReadyDoc({ shareId: 'att-3', objectKey: 'objects/att-3' })
	];
	const listCalls: Array<unknown[]> = [];
	let wrote = false;
	const service = createAttachmentService({
		store: {
			listReadyUndetected: async (...args: unknown[]) => {
				listCalls.push(args);
				const after = args[1] as string | undefined;
				return docs.filter((doc) => !after || doc.shareId > after).slice(0, Number(args[0]));
			},
			upgradeReadyCrystal: async () => {
				wrote = true;
				throw new Error('dry run must not write');
			},
			setObjectVersionId: async () => {
				wrote = true;
				throw new Error('dry run must not write');
			}
		} as any,
		getS3: () => noopS3({ detectContentType: async () => 'video/quicktime' }),
		customMongoActive: () => false
	});

	const first = await service.backfillDetectedTypes({ dryRun: true, limit: 2 });
	assert.deepEqual(first, {
		ok: true,
		dryRun: true,
		scanned: 2,
		upgradedInline: 2,
		labeledOpaque: 0,
		undetected: 0,
		missingObject: 0,
		conflicts: 0,
		failed: 0,
		hasMore: true,
		stoppedForTimeBudget: false,
		nextCursor: 'att-2'
	});
	assert.deepEqual(listCalls[0], [3, undefined]);

	const second = await service.backfillDetectedTypes({ dryRun: true, limit: 2, cursor: 'att-2' });
	assert.deepEqual(listCalls[1], [3, 'att-2']);
	assert.equal(second.ok, true);
	if (second.ok) {
		assert.equal(second.scanned, 1);
		assert.equal(second.hasMore, false);
		assert.equal('nextCursor' in second, false);
	}
	assert.equal(wrote, false);
});

test('detection backfill adopts missing object versions and counts gone objects and losing races', async () => {
	const versionless = legacyReadyDoc({ shareId: 'att-nover', objectKey: 'objects/att-nover', objectVersionId: undefined });
	const gone = legacyReadyDoc({ shareId: 'att-gone', objectKey: 'objects/att-gone' });
	const raced = legacyReadyDoc({ shareId: 'att-raced', objectKey: 'objects/att-raced' });
	const events: string[] = [];
	const upgrades = new Map<string, { versionId: string }>();
	const s3 = noopS3({
		headObject: async () => ({
			sizeBytes: versionless.objectSizeBytes,
			checksumSha256: `${checksum(3)}-2`,
			checksumType: 'COMPOSITE',
			attachmentId: versionless.shareId,
			versionId: 'version-9'
		}),
		detectContentType: async ({ objectKey }) => {
			if (objectKey === 'objects/att-gone') {
				throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
			}
			return 'video/quicktime';
		},
		isNotFound: (error) => (error as any)?.name === 'NoSuchKey'
	});
	const store: any = {
		listReadyUndetected: async () => [versionless, gone, raced],
		setObjectVersionId: async (_ownerId: string, id: string, versionId: string) => {
			events.push(`adopt:${id}:${versionId}`);
			return legacyReadyDoc({ shareId: id, objectKey: `objects/${id}`, objectVersionId: versionId });
		},
		upgradeReadyCrystal: async (id: string, _crystal: any, versionId: string) => {
			if (id === 'att-raced') throw new AttachmentStoreConflictError();
			upgrades.set(id, { versionId });
			return legacyReadyDoc({ shareId: id });
		}
	};
	const service = createAttachmentService({ store, getS3: () => s3, customMongoActive: () => false });

	const result = await service.backfillDetectedTypes({});
	assert.deepEqual(result, {
		ok: true,
		dryRun: false,
		scanned: 3,
		upgradedInline: 1,
		labeledOpaque: 0,
		undetected: 0,
		missingObject: 1,
		conflicts: 1,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	});
	assert.deepEqual(events, ['adopt:att-nover:version-9']);
	assert.deepEqual(upgrades.get('att-nover'), { versionId: 'version-9' });

	// A dry run reads the recovered version but never persists it.
	events.length = 0;
	const dry = await service.backfillDetectedTypes({ dryRun: true });
	assert.equal(dry.ok, true);
	assert.deepEqual(events, []);
});

test('detection backfill validates input, fails closed off the home plane, and stops on its wall-clock budget', async () => {
	const untouched = createAttachmentService({
		store: {
			listReadyUndetected: async () => {
				throw new Error('must not list');
			}
		} as any,
		getS3: () => noopS3(),
		customMongoActive: () => false
	});
	assert.deepEqual(await untouched.backfillDetectedTypes(null), { ok: false, status: 400, error: 'Invalid backfill request' });
	assert.deepEqual(await untouched.backfillDetectedTypes({ nonsense: true }), { ok: false, status: 400, error: 'Invalid backfill request' });
	assert.deepEqual(await untouched.backfillDetectedTypes({ dryRun: 'yes' }), { ok: false, status: 400, error: 'dryRun must be a boolean' });
	assert.deepEqual(await untouched.backfillDetectedTypes({ limit: 0 }), {
		ok: false,
		status: 400,
		error: 'limit must be an integer between 1 and 200'
	});
	assert.deepEqual(await untouched.backfillDetectedTypes({ limit: 201 }), {
		ok: false,
		status: 400,
		error: 'limit must be an integer between 1 and 200'
	});
	assert.deepEqual(await untouched.backfillDetectedTypes({ cursor: ' bad cursor ' }), {
		ok: false,
		status: 400,
		error: 'Invalid backfill cursor'
	});

	const customPlane = createAttachmentService({
		store: {} as any,
		getS3: () => noopS3(),
		customMongoActive: () => true
	});
	assert.deepEqual(await customPlane.backfillDetectedTypes({}), {
		ok: false,
		status: 400,
		error: 'Attachment maintenance is unavailable with a custom MongoDB endpoint'
	});

	const unconfigured = createAttachmentService({
		store: { listReadyUndetected: async () => [legacyReadyDoc()] } as any,
		getS3: () => {
			throw new PrivateS3ConfigError();
		},
		customMongoActive: () => false
	});
	assert.deepEqual(await unconfigured.backfillDetectedTypes({}), {
		ok: false,
		status: 503,
		error: 'Private attachment storage is not configured',
		code: 'storage_unconfigured',
		retryable: false
	});

	let clockCalls = 0;
	let detections = 0;
	const budgeted = createAttachmentService({
		clock: () => (clockCalls++ === 0 ? 0 : 25_000),
		store: {
			listReadyUndetected: async () => [legacyReadyDoc({ shareId: 'att-1' }), legacyReadyDoc({ shareId: 'att-2' })]
		} as any,
		getS3: () =>
			noopS3({
				detectContentType: async () => {
					detections += 1;
					return 'video/quicktime';
				}
			}),
		customMongoActive: () => false
	});
	assert.deepEqual(await budgeted.backfillDetectedTypes({}), {
		ok: true,
		dryRun: false,
		scanned: 0,
		upgradedInline: 0,
		labeledOpaque: 0,
		undetected: 0,
		missingObject: 0,
		conflicts: 0,
		failed: 0,
		hasMore: true,
		stoppedForTimeBudget: true
	});
	assert.equal(detections, 0);
});
