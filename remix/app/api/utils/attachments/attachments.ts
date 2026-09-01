import { createHash, randomUUID } from 'node:crypto';

import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { StorageMutationError } from '../storage/storageCore';
import {
	attachmentMediaKindForContentType,
	canonicalLinkedAttachmentUrl,
	isAttachmentObjectVersionId,
	isLinkedAttachmentMediaKind,
	linkedAttachmentNameForUrl,
	linkedMediaTypeForUrl,
	sanitizeAttachmentPublicMetadata,
	toAttachmentPublicMetadata,
	type AttachmentCrystal,
	type AttachmentPublicMetadata
} from './attachmentCore';
import { canViewHomeAttachmentTarget, type AttachmentAccessViewer } from './attachmentAccess';
import {
	AttachmentStoreConflictError,
	ATTACHMENT_DELETING_RETRY_DELAY_MS,
	ATTACHMENT_FINALIZING_DELETE_GRACE_MS,
	ATTACHMENT_MPU_EMPTY_RECHECK_MS,
	ATTACHMENT_UPLOAD_INITIALIZATION_LEASE_MS,
	MAX_ATTACHMENTS_PER_TARGET,
	MAX_PROFILE_ATTACHMENT_BYTES,
	PROFILE_ATTACHMENT_CONTENT_TYPES,
	attachmentMpuSettlementAt,
	attachmentStore,
	bindReadyCommentAttachmentsToTarget,
	bindReadyEmojiAttachmentToTarget,
	bindReadyMessageAttachmentsToTarget,
	annotateOwnedAttachment,
	bindReadyAttachmentsToTarget,
	syncBoundTargetAttachments,
	type AttachmentDoc,
	type AttachmentPurpose,
	type ProfileAttachmentSlot,
	type AttachmentStore
} from './attachmentStore';
import {
	attachmentContentDisposition,
	attachmentMayRenderInline,
	attachmentPublicProjection,
	detectedAttachmentType
} from './attachmentPresentation';
import { PrivateS3ConfigError } from './config';
import { getPrivateS3, type AttachmentObjectHead, type AttachmentS3, type AttachmentUploadedPart } from './privateS3';
import { queueAttachmentModeration } from '../moderation/analyzeAttachment';

export const ATTACHMENT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_READY_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_MIN_PART_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;
export const ATTACHMENT_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024;
export const MAX_PART_URLS_PER_REQUEST = 20;
export const MAX_EXPIRED_ATTACHMENTS_PER_REAP = 1000;
export const ATTACHMENT_REAP_WALL_CLOCK_MS = 25 * 1000;
export const ATTACHMENT_REAP_CONCURRENCY = 5;
export const MAX_SESSION_REPLACEMENT_ATTACHMENT_CLEANUP = 25;
export const MAX_ATTACHMENT_DETECTION_BACKFILL_PER_RUN = 200;
export const ATTACHMENT_DETECTION_BACKFILL_WALL_CLOCK_MS = 25 * 1000;
export const ATTACHMENT_DETECTION_BACKFILL_CONCURRENCY = 5;
export const ATTACHMENT_UPLOAD_PURPOSES = ['post', 'comment', 'message', 'profile-avatar', 'profile-banner', 'custom-emoji'] as const;
export type AttachmentUploadPurpose = (typeof ATTACHMENT_UPLOAD_PURPOSES)[number];
export const MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES = 512 * 1024;
export const CUSTOM_EMOJI_ATTACHMENT_CONTENT_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

type AttachmentFail = {
	ok: false;
	status: number;
	error: string;
	code?: string;
	retryable?: boolean;
};
type AttachmentOk<T extends object = object> = { ok: true } & T;
export type AttachmentResult<T extends object = object> = AttachmentFail | AttachmentOk<T>;
type AttachmentCleanupOutcome = { status: 'deleted' | 'skipped' } | { status: 'deferred'; retryAt: Date };

type AttachmentViewer = AttachmentAccessViewer;

type AttachmentServiceDependencies = {
	store: AttachmentStore;
	getS3: () => AttachmentS3;
	now: () => Date;
	uuid: () => string;
	customMongoActive: () => boolean;
	canViewTarget: (viewer: AttachmentViewer, attachment: AttachmentDoc) => Promise<boolean>;
	clock: () => number;
	// Fire-and-forget NSFW/TOS analysis kickoff after markReady; optional so
	// unit tests that stub the store never trigger network analysis.
	queueModeration?: (shareId: string) => void;
};

class AttachmentServiceError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'AttachmentServiceError';
		this.status = status;
	}
}

const fail = (status: number, error: string, details: Pick<AttachmentFail, 'code' | 'retryable'> = {}): AttachmentFail => ({
	ok: false,
	status,
	error,
	...details
});

const normalizeId = (value: unknown): string | null => {
	if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 128) return null;
	return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
};

const attachmentRequestFingerprint = (metadata: AttachmentCrystal, purpose: AttachmentUploadPurpose): string =>
	createHash('sha256')
		.update(
			JSON.stringify({
				name: metadata.name,
				size: metadata.size,
				contentType: metadata.contentType,
				// Preserve the original post-upload fingerprint so in-flight uploads
				// created before purpose stamping remain safely resumable.
				...(purpose === 'post' ? {} : { purpose })
			})
		)
		.digest('hex');

const attachmentUploadIntent = (
	value: unknown
): { requestPurpose: AttachmentUploadPurpose; purpose: AttachmentPurpose; profileSlot?: ProfileAttachmentSlot } | null => {
	if (value === undefined || value === 'post') return { requestPurpose: 'post', purpose: 'post' };
	if (value === 'comment') return { requestPurpose: value, purpose: 'comment' };
	if (value === 'message') return { requestPurpose: value, purpose: 'message' };
	if (value === 'profile-avatar') return { requestPurpose: value, purpose: 'profile', profileSlot: 'avatar' };
	if (value === 'profile-banner') return { requestPurpose: value, purpose: 'profile', profileSlot: 'banner' };
	if (value === 'custom-emoji') return { requestPurpose: value, purpose: 'emoji' };
	return null;
};

export const attachmentIdForRequest = (ownerId: string, requestId: string): string =>
	`att_${createHash('sha256').update('thingtime-attachment-request-v1\0').update(ownerId).update('\0').update(requestId).digest('hex')}`;

const attachmentPartPlan = (sizeBytes: number) => {
	const oneMiB = 1024 * 1024;
	const minimumForTenThousand = Math.ceil(sizeBytes / 10_000);
	const partSizeBytes = Math.ceil(Math.max(ATTACHMENT_MIN_PART_BYTES, minimumForTenThousand) / oneMiB) * oneMiB;
	if (partSizeBytes > ATTACHMENT_MAX_PART_BYTES) {
		throw new AttachmentServiceError(400, 'Attachment is too large');
	}
	return {
		partSizeBytes,
		partCount: Math.ceil(sizeBytes / partSizeBytes)
	};
};

export const attachmentExpectedPartBytes = (objectSizeBytes: number, partNumber: number): number => {
	const plan = attachmentPartPlan(objectSizeBytes);
	if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.partCount) {
		throw new AttachmentServiceError(400, 'Invalid upload part number');
	}
	return partNumber === plan.partCount ? objectSizeBytes - plan.partSizeBytes * (plan.partCount - 1) : plan.partSizeBytes;
};

const isCanonicalSha256 = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
	const bytes = Buffer.from(value, 'base64');
	return bytes.byteLength === 32 && bytes.toString('base64') === value;
};

export const validateCompletedAttachmentParts = (
	objectSizeBytes: number,
	parts: readonly AttachmentUploadedPart[]
): { ok: true; parts: AttachmentUploadedPart[] } | AttachmentFail => {
	const plan = attachmentPartPlan(objectSizeBytes);
	const ordered = [...parts].sort((left, right) => left.partNumber - right.partNumber);
	if (ordered.length !== plan.partCount) {
		return fail(409, 'Upload parts are incomplete');
	}

	let total = 0;
	for (let index = 0; index < ordered.length; index += 1) {
		const part = ordered[index];
		const expectedPartNumber = index + 1;
		const expectedSize = expectedPartNumber === plan.partCount ? objectSizeBytes - plan.partSizeBytes * (plan.partCount - 1) : plan.partSizeBytes;
		if (part.partNumber !== expectedPartNumber || part.sizeBytes !== expectedSize || !part.etag || !isCanonicalSha256(part.checksumSha256)) {
			return fail(409, 'Upload parts failed integrity verification');
		}
		total += part.sizeBytes;
	}
	if (total !== objectSizeBytes) return fail(409, 'Uploaded object size does not match the reservation');
	return { ok: true, parts: ordered };
};

const knownFailure = (error: unknown): AttachmentFail | null => {
	if (error instanceof StorageMutationError) {
		return fail(error.status, error.message, {
			code: error.code,
			retryable: error.code === 'accounting_unavailable'
		});
	}
	if (error instanceof AttachmentServiceError) {
		return fail(error.status, error.message);
	}
	if (error instanceof AttachmentStoreConflictError) return fail(409, 'Attachment changed — try again');
	return null;
};

const unavailable = (operation: string, error: unknown): AttachmentFail => {
	const name = String((error as any)?.name || 'Error')
		.replace(/[^A-Za-z0-9_.-]/g, '')
		.slice(0, 80);
	const requestId = String((error as any)?.$metadata?.requestId || '')
		.replace(/[^A-Za-z0-9-]/g, '')
		.slice(0, 80);
	console.error(`[attachments] ${operation} failed (${name || 'Error'}${requestId ? `, request ${requestId}` : ''})`);
	if (error instanceof PrivateS3ConfigError) {
		return fail(503, 'Private attachment storage is not configured', {
			code: 'storage_unconfigured',
			retryable: false
		});
	}
	return fail(503, 'Attachment storage is temporarily unavailable', {
		code: 'storage_unavailable',
		retryable: true
	});
};

const exactPartRequest = (value: unknown, partCount: number) => {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PART_URLS_PER_REQUEST) {
		throw new AttachmentServiceError(400, `Request between 1 and ${MAX_PART_URLS_PER_REQUEST} upload parts at a time`);
	}
	const seen = new Set<number>();
	return value.map((entry) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new AttachmentServiceError(400, 'Invalid upload part request');
		}
		const raw = entry as Record<string, unknown>;
		if (Object.keys(raw).some((key) => key !== 'partNumber' && key !== 'checksumSha256')) {
			throw new AttachmentServiceError(400, 'Invalid upload part request');
		}
		const partNumber = Number(raw.partNumber);
		if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount || seen.has(partNumber)) {
			throw new AttachmentServiceError(400, 'Invalid upload part number');
		}
		if (!isCanonicalSha256(raw.checksumSha256)) {
			throw new AttachmentServiceError(400, 'Upload part checksum must be a base64 SHA-256 digest');
		}
		seen.add(partNumber);
		return { partNumber, checksumSha256: raw.checksumSha256 };
	});
};

const defaultDependencies: AttachmentServiceDependencies = {
	store: attachmentStore,
	getS3: getPrivateS3,
	now: () => new Date(),
	uuid: randomUUID,
	customMongoActive: isCustomMongoEndpointActive,
	canViewTarget: canViewHomeAttachmentTarget,
	clock: Date.now,
	queueModeration: queueAttachmentModeration
};

export const createAttachmentService = (overrides: Partial<AttachmentServiceDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };

	const getOwnedByAttachmentOrRequestId = async (ownerId: string, idOrRequestId: string): Promise<AttachmentDoc | null> => {
		const direct = await dependencies.store.getOwned(ownerId, idOrRequestId);
		if (direct) return direct;
		return dependencies.store.getOwned(ownerId, attachmentIdForRequest(ownerId, idOrRequestId));
	};

	const verifiedHeadForDoc = async (s3: AttachmentS3, doc: AttachmentDoc, versionId?: string): Promise<AttachmentObjectHead> => {
		const head = await s3.headObject({ objectKey: doc.objectKey, ...(versionId ? { versionId } : {}) });
		if (
			head.sizeBytes !== doc.objectSizeBytes ||
			head.attachmentId !== doc.shareId ||
			!isAttachmentObjectVersionId(head.versionId) ||
			(versionId && head.versionId !== versionId)
		) {
			throw new AttachmentServiceError(409, 'Uploaded object failed integrity verification');
		}
		return head;
	};

	const deleteS3ForDoc = async (s3: AttachmentS3, inputDoc: AttachmentDoc) => {
		let doc = inputDoc;

		let versionId = doc.objectVersionId;
		if (!versionId) {
			let head: AttachmentObjectHead;
			try {
				head = await verifiedHeadForDoc(s3, doc);
			} catch (error) {
				// A deleting MPU row is refundable only after repeated Abort/ListParts
				// proves the upload is gone and a strongly consistent HEAD sees no
				// completed object. Ready/current-object rows without a VersionId stay
				// conservatively billed: a delete marker could be hiding retained
				// noncurrent bytes.
				if ((doc.uploadId || doc.attachmentObjectlessDelete === true) && s3.isNotFound(error)) return;
				throw error;
			}
			versionId = head.versionId;
			doc = await dependencies.store.setObjectVersionId(doc.ownerId, doc.shareId, versionId);
		}
		if (!isAttachmentObjectVersionId(versionId)) {
			throw new AttachmentServiceError(409, 'Attachment object version is unavailable');
		}
		await s3.deleteObject({ objectKey: doc.objectKey, versionId });
	};

	const verifyMultipartCleanupPass = async (s3: AttachmentS3, doc: AttachmentDoc): Promise<AttachmentCleanupOutcome | null> => {
		if (!doc.uploadId) return null;
		const checkedAt = dependencies.now();
		try {
			await s3.abortMultipartUpload({ objectKey: doc.objectKey, uploadId: doc.uploadId });
		} catch (error) {
			if (!s3.isNoSuchUpload(error)) throw error;
		}

		let empty = false;
		try {
			empty = !(await s3.listParts({ objectKey: doc.objectKey, uploadId: doc.uploadId })).length;
		} catch (error) {
			if (!s3.isNoSuchUpload(error)) throw error;
			empty = true;
		}

		if (!empty) {
			const firstObservedParts = !doc.attachmentPartsIssuedAt;
			const retryAt = firstObservedParts ? attachmentMpuSettlementAt(checkedAt) : new Date(checkedAt.getTime() + ATTACHMENT_MPU_EMPTY_RECHECK_MS);
			await dependencies.store.recordMpuCleanupVerification(doc.ownerId, doc.shareId, null, retryAt, firstObservedParts ? checkedAt : undefined);
			return { status: 'deferred', retryAt };
		}

		// No part URL ever left the server, so after Abort/ListParts proves this
		// empty MPU has no bytes there is no late signed request to fence.
		if (!doc.attachmentPartsIssuedAt) return null;

		const firstEmptyAt = doc.attachmentMpuEmptyVerifiedAt;
		if (!firstEmptyAt || checkedAt.getTime() - firstEmptyAt.getTime() < ATTACHMENT_MPU_EMPTY_RECHECK_MS) {
			const verifiedAt = firstEmptyAt || checkedAt;
			const retryAt = new Date(verifiedAt.getTime() + ATTACHMENT_MPU_EMPTY_RECHECK_MS);
			await dependencies.store.recordMpuCleanupVerification(doc.ownerId, doc.shareId, verifiedAt, retryAt);
			return { status: 'deferred', retryAt };
		}
		return null;
	};

	const cleanupClaimedDoc = async (
		getS3: () => AttachmentS3,
		doc: AttachmentDoc,
		scope: { kind: 'draft'; expiredAtOrBefore?: Date; finalizingUpdatedAtOrBefore?: Date } | { kind: 'target'; targetId: string }
	): Promise<AttachmentCleanupOutcome> => {
		// Linked docs never touch S3. For everything else, resolve the client
		// BEFORE the destructive deleting claim so an unconfigured/broken S3
		// fails atomically — no half-deleted cascade, no doc stranded in
		// 'deleting' retry loops. attachmentLinked is immutable, so the pre-claim
		// doc is authoritative for this branch.
		const s3 = doc.attachmentLinked === true ? null : getS3();
		const allowedStates = doc.attachmentState === 'deleting' ? (['deleting'] as const) : ([doc.attachmentState, 'deleting'] as const);
		let claimed: AttachmentDoc | null = null;
		if (scope.kind === 'draft' && doc.attachmentState === 'pending' && !doc.uploadId && !doc.objectVersionId) {
			// This CAS is the durable proof that the reservation never issued a
			// part URL. Once pending becomes deleting, an ordinary state check can
			// no longer distinguish this safe objectless crash window from a
			// completed object whose VersionId was lost.
			claimed = await dependencies.store.claimObjectlessPendingDeleting(doc.ownerId, doc.shareId, scope);
		}
		if (!claimed) {
			claimed = await dependencies.store.claimDeleting(doc.ownerId, doc.shareId, [...allowedStates], scope);
		}
		if (!claimed) return { status: 'skipped' };
		// Linked attachments never had an S3 object: no MPU to abort, no HEAD to
		// verify, no version to delete. Straight to the transactional row removal
		// and exact quota refund — S3 stays untouched (and unrequired, so linked
		// cleanup works even where private storage is unconfigured).
		if (s3 === null || claimed.attachmentLinked === true) {
			return (await dependencies.store.removeDeleting(claimed.ownerId, claimed.shareId)) ? { status: 'deleted' } : { status: 'skipped' };
		}
		// A just-cancelled MPU remains billed until its retry-not-before. Part PUTs
		// already in flight may finish after Abort; the later sweep repeats
		// Abort/ListParts/HEAD before any refund.
		if (
			claimed.uploadId &&
			claimed.attachmentPartsIssuedAt &&
			claimed.attachmentExpiresAt &&
			claimed.attachmentExpiresAt.getTime() > dependencies.now().getTime()
		) {
			try {
				await s3.abortMultipartUpload({ objectKey: claimed.objectKey, uploadId: claimed.uploadId });
			} catch (error) {
				if (!s3.isNoSuchUpload(error)) throw error;
			}
			return { status: 'deferred', retryAt: claimed.attachmentExpiresAt };
		}
		const multipartDeferred = await verifyMultipartCleanupPass(s3, claimed);
		if (multipartDeferred) return multipartDeferred;
		await deleteS3ForDoc(s3, claimed);
		return (await dependencies.store.removeDeleting(claimed.ownerId, claimed.shareId)) ? { status: 'deleted' } : { status: 'skipped' };
	};

	const cleanupExpiredOwned = async (getS3: () => AttachmentS3, ownerId: string) => {
		const cleanupTime = dependencies.now();
		const finalizingBefore = new Date(cleanupTime.getTime() - ATTACHMENT_FINALIZING_DELETE_GRACE_MS);
		const expired = await dependencies.store.listExpiredOwned(ownerId, 5);
		for (const doc of expired) {
			try {
				await cleanupClaimedDoc(
					getS3,
					doc,
					doc.targetId
						? { kind: 'target', targetId: doc.targetId }
						: { kind: 'draft', expiredAtOrBefore: cleanupTime, finalizingUpdatedAtOrBefore: finalizingBefore }
				);
			} catch (error) {
				unavailable('expired upload cleanup', error);
			}
		}
	};

	const beforeSessionReplacement = async (
		ownerId: string
	): Promise<
		AttachmentResult<{
			scanned: number;
			deleted: number;
			deferred: number;
			skipped: number;
			failed: number;
			hasMore: boolean;
		}>
	> => {
		try {
			if (dependencies.customMongoActive()) {
				return { ok: true, scanned: 0, deleted: 0, deferred: 0, skipped: 0, failed: 0, hasMore: false };
			}
			const docs = await dependencies.store.listUnboundOwned(ownerId, MAX_SESSION_REPLACEMENT_ATTACHMENT_CLEANUP + 1);
			const queue = docs.slice(0, MAX_SESSION_REPLACEMENT_ATTACHMENT_CLEANUP);
			if (!queue.length) {
				return { ok: true, scanned: 0, deleted: 0, deferred: 0, skipped: 0, failed: 0, hasMore: false };
			}
			// resolved lazily so a queue of linked-only drafts never needs S3
			let s3: AttachmentS3 | null = null;
			const getS3 = () => (s3 ??= dependencies.getS3());
			let deleted = 0;
			let deferred = 0;
			let skipped = 0;
			let failed = 0;
			for (const doc of queue) {
				try {
					const outcome = await cleanupClaimedDoc(getS3, doc, { kind: 'draft' });
					if (outcome.status === 'deleted') deleted += 1;
					else if (outcome.status === 'deferred') deferred += 1;
					else skipped += 1;
				} catch (error) {
					failed += 1;
					unavailable('session replacement draft cleanup', error);
				}
			}
			return {
				ok: true,
				scanned: queue.length,
				deleted,
				deferred,
				skipped,
				failed,
				hasMore: docs.length > queue.length
			};
		} catch (error) {
			return knownFailure(error) || unavailable('session replacement draft scan', error);
		}
	};

	const reapExpired = async (): Promise<
		AttachmentResult<{
			scanned: number;
			deleted: number;
			deferred: number;
			skipped: number;
			failed: number;
			hasMore: boolean;
			stoppedForTimeBudget: boolean;
		}>
	> => {
		try {
			const expiredAtOrBefore = dependencies.now();
			const finalizingBefore = new Date(expiredAtOrBefore.getTime() - ATTACHMENT_FINALIZING_DELETE_GRACE_MS);
			const docs = await dependencies.store.listExpired(MAX_EXPIRED_ATTACHMENTS_PER_REAP + 1, expiredAtOrBefore);
			if (!docs.length) {
				return {
					ok: true,
					scanned: 0,
					deleted: 0,
					deferred: 0,
					skipped: 0,
					failed: 0,
					hasMore: false,
					stoppedForTimeBudget: false
				};
			}

			// resolved lazily so a reap pass of linked-only drafts never needs S3
			let s3Client: AttachmentS3 | null = null;
			const getS3 = () => (s3Client ??= dependencies.getS3());
			const queue = docs.slice(0, MAX_EXPIRED_ATTACHMENTS_PER_REAP);
			const hasMoreFromLimit = docs.length > queue.length;
			const startedAt = dependencies.clock();
			let nextIndex = 0;
			let scanned = 0;
			let deleted = 0;
			let deferred = 0;
			let skipped = 0;
			let failed = 0;
			let stoppedForTimeBudget = false;
			const worker = async () => {
				while (nextIndex < queue.length) {
					if (dependencies.clock() - startedAt >= ATTACHMENT_REAP_WALL_CLOCK_MS) {
						stoppedForTimeBudget = true;
						return;
					}
					const doc = queue[nextIndex++];
					scanned += 1;
					try {
						const outcome = await cleanupClaimedDoc(
							getS3,
							doc,
							doc.targetId
								? { kind: 'target', targetId: doc.targetId }
								: {
										kind: 'draft',
										expiredAtOrBefore,
										finalizingUpdatedAtOrBefore: finalizingBefore
								  }
						);
						if (outcome.status === 'deleted') deleted += 1;
						else if (outcome.status === 'deferred') deferred += 1;
						else skipped += 1;
					} catch (error) {
						failed += 1;
						try {
							await dependencies.store.deferDeletingRetry(
								doc.ownerId,
								doc.shareId,
								new Date(dependencies.now().getTime() + ATTACHMENT_DELETING_RETRY_DELAY_MS)
							);
						} catch (retryError) {
							unavailable('global cleanup retry scheduling', retryError);
						}
						unavailable('global expired draft cleanup', error);
					}
				}
			};
			await Promise.all(Array.from({ length: Math.min(ATTACHMENT_REAP_CONCURRENCY, queue.length) }, () => worker()));
			return {
				ok: true,
				scanned,
				deleted,
				deferred,
				skipped,
				failed,
				hasMore: hasMoreFromLimit || nextIndex < queue.length,
				stoppedForTimeBudget
			};
		} catch (error) {
			return knownFailure(error) || unavailable('global expired draft scan', error);
		}
	};

	// Re-run magic-byte detection for ready rows finalized before detection
	// existed (opaque contentType, no sniffed label) and publish exactly what
	// completion would have: browser-playable containers flip to their inline
	// contentType/mediaKind, other canonical sniffed types become
	// detectedContentType display metadata. Undetectable bytes stay untouched —
	// deliberately, so a later pass under a wider detector can still claim them.
	const backfillDetectedTypes = async (
		input: unknown
	): Promise<
		AttachmentResult<{
			dryRun: boolean;
			scanned: number;
			upgradedInline: number;
			labeledOpaque: number;
			undetected: number;
			missingObject: number;
			conflicts: number;
			failed: number;
			hasMore: boolean;
			stoppedForTimeBudget: boolean;
			nextCursor?: string;
		}>
	> => {
		try {
			if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Invalid backfill request');
			const raw = input as Record<string, unknown>;
			if (Object.keys(raw).some((key) => !['dryRun', 'limit', 'cursor'].includes(key))) {
				return fail(400, 'Invalid backfill request');
			}
			if (raw.dryRun !== undefined && typeof raw.dryRun !== 'boolean') return fail(400, 'dryRun must be a boolean');
			const dryRun = raw.dryRun === true;
			if (
				raw.limit !== undefined &&
				(!Number.isInteger(raw.limit) || Number(raw.limit) < 1 || Number(raw.limit) > MAX_ATTACHMENT_DETECTION_BACKFILL_PER_RUN)
			) {
				return fail(400, `limit must be an integer between 1 and ${MAX_ATTACHMENT_DETECTION_BACKFILL_PER_RUN}`);
			}
			const limit = raw.limit === undefined ? MAX_ATTACHMENT_DETECTION_BACKFILL_PER_RUN : Number(raw.limit);
			const cursor = raw.cursor === undefined ? undefined : normalizeId(raw.cursor);
			if (raw.cursor !== undefined && !cursor) return fail(400, 'Invalid backfill cursor');
			if (dependencies.customMongoActive()) {
				return fail(400, 'Attachment maintenance is unavailable with a custom MongoDB endpoint');
			}

			const docs = await dependencies.store.listReadyUndetected(limit + 1, cursor);
			const queue = docs.slice(0, limit);
			const hasMoreFromLimit = docs.length > queue.length;
			const empty = {
				ok: true as const,
				dryRun,
				scanned: 0,
				upgradedInline: 0,
				labeledOpaque: 0,
				undetected: 0,
				missingObject: 0,
				conflicts: 0,
				failed: 0,
				hasMore: false,
				stoppedForTimeBudget: false
			};
			if (!queue.length) return empty;

			const s3 = dependencies.getS3();
			const startedAt = dependencies.clock();
			let nextIndex = 0;
			let scanned = 0;
			let upgradedInline = 0;
			let labeledOpaque = 0;
			let undetected = 0;
			let missingObject = 0;
			let conflicts = 0;
			let failed = 0;
			let stoppedForTimeBudget = false;
			const worker = async () => {
				while (nextIndex < queue.length) {
					if (dependencies.clock() - startedAt >= ATTACHMENT_DETECTION_BACKFILL_WALL_CLOCK_MS) {
						stoppedForTimeBudget = true;
						return;
					}
					let doc = queue[nextIndex++];
					scanned += 1;
					try {
						let versionId = doc.objectVersionId;
						if (!isAttachmentObjectVersionId(versionId)) {
							// Adopt the exact current object version the way download and
							// completion recovery do; a dry run only reads it.
							const head = await verifiedHeadForDoc(s3, doc);
							versionId = head.versionId;
							if (!dryRun) doc = await dependencies.store.setObjectVersionId(doc.ownerId, doc.shareId, versionId);
						}
						const detected = detectedAttachmentType(await s3.detectContentType({ objectKey: doc.objectKey, versionId }), doc.crystal.name);
						if (detected.contentType === 'application/octet-stream' && !detected.detectedContentType) {
							undetected += 1;
							continue;
						}
						// #312 adds owner-authored presentation fields to the protected
						// attachment crystal. Re-detection owns only the type fields: preserve
						// existing annotation exactly, and fail closed rather than erase a
						// malformed value written by some other path.
						const existingPresentation = doc.crystal as AttachmentCrystal & {
							filenamePreview?: unknown;
							title?: unknown;
							description?: unknown;
						};
						const presentation: Record<string, string> = {};
						for (const key of ['filenamePreview', 'title', 'description'] as const) {
							if (!Object.prototype.hasOwnProperty.call(existingPresentation, key)) continue;
							const value = existingPresentation[key];
							if (typeof value !== 'string') throw new AttachmentStoreConflictError(`Attachment ${key} is malformed`);
							presentation[key] = value;
						}
						const crystal: AttachmentCrystal = {
							name: doc.crystal.name,
							size: doc.crystal.size,
							contentType: detected.contentType,
							mediaKind: detected.mediaKind,
							...(detected.detectedContentType ? { detectedContentType: detected.detectedContentType } : {}),
							...presentation
						};
						if (!dryRun) await dependencies.store.upgradeReadyCrystal(doc.shareId, crystal, versionId);
						if (crystal.contentType === 'application/octet-stream') labeledOpaque += 1;
						else upgradedInline += 1;
					} catch (error) {
						if (s3.isNotFound(error)) missingObject += 1;
						else if (error instanceof AttachmentStoreConflictError) conflicts += 1;
						else {
							failed += 1;
							unavailable('detection backfill', error);
						}
					}
				}
			};
			await Promise.all(Array.from({ length: Math.min(ATTACHMENT_DETECTION_BACKFILL_CONCURRENCY, queue.length) }, () => worker()));
			const hasMore = hasMoreFromLimit || nextIndex < queue.length;
			const lastClaimedId = nextIndex > 0 ? queue[Math.min(nextIndex, queue.length) - 1].shareId : undefined;
			return {
				...empty,
				scanned,
				upgradedInline,
				labeledOpaque,
				undetected,
				missingObject,
				conflicts,
				failed,
				hasMore,
				stoppedForTimeBudget,
				...(hasMore && lastClaimedId ? { nextCursor: lastClaimedId } : {})
			};
		} catch (error) {
			return knownFailure(error) || unavailable('detection backfill scan', error);
		}
	};

	const start = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ upload: Record<string, unknown> }>> => {
		try {
			if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Invalid attachment upload request');
			const raw = input as Record<string, unknown>;
			if (Object.keys(raw).some((key) => !['filename', 'contentType', 'sizeBytes', 'requestId', 'purpose'].includes(key))) {
				return fail(400, 'Invalid attachment upload request');
			}
			const intent = attachmentUploadIntent(raw.purpose);
			if (!intent) return fail(400, 'Invalid attachment upload purpose');
			if (intent.purpose !== 'profile' && dependencies.customMongoActive()) {
				return fail(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
			}
			const requestedId = raw.requestId === undefined ? null : normalizeId(raw.requestId);
			if (raw.requestId !== undefined && !requestedId) return fail(400, 'Invalid attachment request id');
			const sizeBytes = Number(raw.sizeBytes);
			if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > ATTACHMENT_MAX_OBJECT_BYTES) {
				return fail(400, 'Attachment size must be between 1 byte and 5 TiB');
			}
			const sanitized = sanitizeAttachmentPublicMetadata({
				name: raw.filename,
				size: sizeBytes,
				contentType: raw.contentType
			});
			if (sanitized.ok === false) return fail(400, sanitized.error);
			if (intent.purpose === 'profile') {
				if (sizeBytes > MAX_PROFILE_ATTACHMENT_BYTES) {
					return fail(400, `Profile images can contain at most ${MAX_PROFILE_ATTACHMENT_BYTES} bytes`);
				}
				if (!PROFILE_ATTACHMENT_CONTENT_TYPES.has(sanitized.crystal.contentType)) {
					return fail(400, 'Profile attachments must be a supported raster image');
				}
			}
			if (intent.purpose === 'emoji') {
				if (sizeBytes > MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES) {
					return fail(400, `Custom emoji images can contain at most ${MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES} bytes`);
				}
				if (!CUSTOM_EMOJI_ATTACHMENT_CONTENT_TYPES.has(sanitized.crystal.contentType)) {
					return fail(400, 'Custom emojis must be a GIF, PNG, JPEG, or WebP image');
				}
			}
			const crystal: AttachmentCrystal = {
				name: sanitized.crystal.name,
				size: sizeBytes,
				// Never trust a browser-provided media type for inline rendering. The
				// finalized value comes only from server-side magic-byte detection.
				contentType: 'application/octet-stream',
				mediaKind: attachmentMediaKindForContentType('application/octet-stream')
			};
			const plan = attachmentPartPlan(sizeBytes);
			const s3 = dependencies.getS3();
			await cleanupExpiredOwned(() => s3, ownerId);

			const id = requestedId ? attachmentIdForRequest(ownerId, requestedId) : dependencies.uuid();
			const objectKey = `objects/${id}`;
			const expires = new Date(dependencies.now().getTime() + ATTACHMENT_UPLOAD_TTL_MS);
			const requestFingerprint = attachmentRequestFingerprint(sanitized.crystal, intent.requestPurpose);
			const uploadPlan = (doc: AttachmentDoc) => ({
				id: doc.shareId,
				partSizeBytes: plan.partSizeBytes,
				partCount: plan.partCount,
				expiresAt: doc.attachmentExpiresAt!.toISOString()
			});
			const sameRequest = (doc: AttachmentDoc) =>
				doc.ownerId === ownerId &&
				doc.attachmentRequestFingerprint === requestFingerprint &&
				(intent.purpose === 'post'
					? (doc.attachmentPurpose === undefined || doc.attachmentPurpose === 'post') && doc.attachmentProfileSlot === undefined
					: doc.attachmentPurpose === intent.purpose && doc.attachmentProfileSlot === intent.profileSlot);

			let ownsInitialization = false;
			let reserved = requestedId ? await dependencies.store.getById(id) : null;
			if (reserved && !sameRequest(reserved)) {
				return fail(409, 'Attachment request id is already in use');
			}
			if (!reserved) {
				try {
					reserved = await dependencies.store.reservePending({
						id,
						ownerId,
						crystal,
						objectKey,
						requestFingerprint,
						purpose: intent.purpose,
						profileSlot: intent.profileSlot,
						expiresAt: expires
					});
					ownsInitialization = true;
				} catch (error) {
					const raced = await dependencies.store.getById(id);
					if (!raced || !sameRequest(raced)) {
						if (Number((error as any)?.code) === 11000) {
							return fail(409, 'Attachment request id is already in use');
						}
						throw error;
					}
					reserved = raced;
				}
			}
			if (
				reserved.attachmentState !== 'pending' ||
				!reserved.attachmentExpiresAt ||
				reserved.attachmentExpiresAt.getTime() <= dependencies.now().getTime()
			) {
				return fail(409, 'Attachment request cannot be resumed', {
					code: 'upload_unavailable',
					retryable: false
				});
			}
			if (reserved.uploadId) return { ok: true, upload: uploadPlan(reserved) };
			if (!ownsInitialization) {
				const claimed = await dependencies.store.claimUploadInitialization(
					ownerId,
					id,
					new Date(dependencies.now().getTime() - ATTACHMENT_UPLOAD_INITIALIZATION_LEASE_MS)
				);
				if (!claimed) {
					return fail(409, 'Attachment upload is still initializing — try again', {
						code: 'upload_initializing',
						retryable: true
					});
				}
				reserved = claimed;
				ownsInitialization = true;
			}

			let uploadId: string;
			try {
				uploadId = (await s3.createMultipartUpload({ objectKey, attachmentId: id })).uploadId;
			} catch (error) {
				// No part URL has been issued, so an ambiguously created empty MPU can
				// safely age out under the bucket's seven-day lifecycle rule. Keep a
				// durable objectless deletion intent, verify HEAD, and only then refund.
				try {
					await cleanupClaimedDoc(() => s3, reserved, { kind: 'draft' });
				} catch (cleanupError) {
					unavailable('failed upload reservation cleanup', cleanupError);
				}
				throw error;
			}

			try {
				const persisted = await dependencies.store.setUploadId(ownerId, id, uploadId);
				if (persisted.uploadId !== uploadId) {
					await s3.abortMultipartUpload({ objectKey, uploadId }).catch(() => {});
				}
				reserved = persisted;
			} catch (error) {
				// Mongo may have committed the upload id even if its response was
				// lost. Re-read before aborting: aborting the canonical persisted MPU
				// would make an idempotent retry return a dead plan.
				let persisted: AttachmentDoc | null;
				try {
					persisted = await dependencies.store.getOwned(ownerId, id);
				} catch {
					// Ambiguous persistence stays billed and the empty redundant MPU is
					// lifecycle-cleaned; never risk aborting a possibly canonical id.
					throw error;
				}
				if (persisted?.attachmentState === 'pending' && persisted.uploadId) {
					if (persisted.uploadId !== uploadId) {
						await s3.abortMultipartUpload({ objectKey, uploadId }).catch(() => {});
					}
					reserved = persisted;
				} else {
					if (!persisted) await s3.abortMultipartUpload({ objectKey, uploadId }).catch(() => {});
					throw error;
				}
			}

			return {
				ok: true,
				upload: uploadPlan(reserved)
			};
		} catch (error) {
			return knownFailure(error) || unavailable('start', error);
		}
	};

	const signParts = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ parts: Array<Record<string, unknown>> }>> => {
		try {
			if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Invalid upload part request');
			const raw = input as Record<string, unknown>;
			if (Object.keys(raw).some((key) => key !== 'uploadId' && key !== 'parts')) {
				return fail(400, 'Invalid upload part request');
			}
			const id = normalizeId(raw.uploadId);
			if (!id) return fail(400, 'Invalid attachment upload id');
			const doc = await dependencies.store.getOwned(ownerId, id);
			if (!doc || doc.attachmentState !== 'pending' || !doc.uploadId) return fail(404, 'Attachment upload not found');
			if (!doc.attachmentExpiresAt || doc.attachmentExpiresAt.getTime() <= dependencies.now().getTime()) {
				return fail(410, 'Attachment upload expired');
			}
			const plan = attachmentPartPlan(doc.objectSizeBytes);
			const requested = exactPartRequest(raw.parts, plan.partCount);
			const s3 = dependencies.getS3();
			const parts = await Promise.all(
				requested.map(async (part) => ({
					partNumber: part.partNumber,
					...(await s3.signUploadPart({
						objectKey: doc.objectKey,
						uploadId: doc.uploadId!,
						partNumber: part.partNumber,
						checksumSha256: part.checksumSha256,
						// Signed Content-Length closes the cost bypass where a tiny quota
						// reservation could otherwise accept an oversized incomplete part.
						contentLength: attachmentExpectedPartBytes(doc.objectSizeBytes, part.partNumber)
					}))
				}))
			);
			await dependencies.store.markPartsIssued(ownerId, id, dependencies.now());
			return { ok: true, parts };
		} catch (error) {
			return knownFailure(error) || unavailable('sign parts', error);
		}
	};

	const complete = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ attachment: Record<string, unknown> }>> => {
		try {
			if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Invalid completion request');
			const raw = input as Record<string, unknown>;
			if (Object.keys(raw).some((key) => key !== 'uploadId')) return fail(400, 'Invalid completion request');
			const id = normalizeId(raw.uploadId);
			if (!id) return fail(400, 'Invalid attachment upload id');
			const finalizationLeaseId = dependencies.uuid();
			const finalizationClaim = await dependencies.store.claimFinalizing(ownerId, id, finalizationLeaseId);
			if (!finalizationClaim) return fail(404, 'Attachment upload not found');
			let doc = finalizationClaim.doc;
			const s3 = dependencies.getS3();

			const finalizationInProgress = (): AttachmentFail =>
				fail(409, 'Attachment finalization is in progress — try again', {
					code: 'finalization_in_progress',
					retryable: true
				});

			// A stale request can resume after another request has taken over the
			// durable lease. Never let that old request publish, revert, or delete
			// the exact version the new lease holder may be adopting.
			const settleLostFinalizationLease = async (completedVersionId?: string): Promise<AttachmentResult<{ attachment: Record<string, unknown> }>> => {
				let raced = await dependencies.store.getOwned(ownerId, id);
				if (raced?.attachmentState === 'ready') {
					if (!raced.objectVersionId) {
						const recovered = completedVersionId ? await verifiedHeadForDoc(s3, raced, completedVersionId) : await verifiedHeadForDoc(s3, raced);
						raced = await dependencies.store.setObjectVersionId(ownerId, id, recovered.versionId);
					} else if (completedVersionId && raced.objectVersionId !== completedVersionId) {
						await s3.deleteObject({ objectKey: doc.objectKey, versionId: completedVersionId });
					}
					if (!isAttachmentObjectVersionId(raced.objectVersionId)) return finalizationInProgress();
					await s3.markObjectReady({ objectKey: raced.objectKey, versionId: raced.objectVersionId });
					return { ok: true, attachment: attachmentPublicProjection(raced.shareId, raced.crystal) };
				}

				if (raced?.attachmentState === 'finalizing') {
					// The exact version belongs to the shared object key/MPU. The active
					// lease holder will recover it via HEAD if Complete already won.
					return finalizationInProgress();
				}

				if (raced?.attachmentState === 'deleting') {
					if (completedVersionId) {
						if (!raced.objectVersionId) {
							raced = await dependencies.store.setObjectVersionId(ownerId, id, completedVersionId);
						} else if (raced.objectVersionId !== completedVersionId) {
							await s3.deleteObject({ objectKey: doc.objectKey, versionId: completedVersionId });
						}
						await deleteS3ForDoc(s3, raced);
						await dependencies.store.removeDeleting(ownerId, id);
					}
					return fail(409, 'Attachment changed — try again', {
						code: 'finalization_lease_lost',
						retryable: true
					});
				}

				if (completedVersionId) {
					// A different lease may have safely reverted to pending, or cleanup
					// may have removed the row. This exact noncanonical version is ours
					// to remove; the surviving billed row remains retryable/cleanable.
					await s3.deleteObject({ objectKey: doc.objectKey, versionId: completedVersionId });
				}
				return fail(409, 'Attachment changed — try again', {
					code: 'finalization_lease_lost',
					retryable: true
				});
			};

			const renewFinalizationLease = async (completedVersionId?: string): Promise<AttachmentResult<{ attachment: Record<string, unknown> }> | null> =>
				(await dependencies.store.renewFinalizing(ownerId, id, finalizationLeaseId)) ? null : settleLostFinalizationLease(completedVersionId);

			if (doc.attachmentState === 'ready') {
				if (!doc.objectVersionId) {
					const recovered = await verifiedHeadForDoc(s3, doc);
					doc = await dependencies.store.setObjectVersionId(ownerId, id, recovered.versionId);
				}
				if (!isAttachmentObjectVersionId(doc.objectVersionId)) {
					return fail(409, 'Attachment object version is unavailable');
				}
				await s3.markObjectReady({ objectKey: doc.objectKey, versionId: doc.objectVersionId });
				dependencies.queueModeration?.(doc.shareId);
				return { ok: true, attachment: attachmentPublicProjection(doc.shareId, doc.crystal) };
			}
			if (!finalizationClaim.acquired) {
				return finalizationInProgress();
			}
			if (!doc.uploadId) {
				await dependencies.store.revertFinalizing(ownerId, id, finalizationLeaseId);
				return fail(409, 'Attachment upload is not ready to finalize', {
					code: 'upload_not_ready',
					retryable: true
				});
			}

			let uploadStillOpen = true;
			let parts: AttachmentUploadedPart[] = [];
			try {
				parts = await s3.listParts({ objectKey: doc.objectKey, uploadId: doc.uploadId });
			} catch (error) {
				if (!s3.isNoSuchUpload(error)) {
					await dependencies.store.revertFinalizing(ownerId, id, finalizationLeaseId);
					throw error;
				}
				uploadStillOpen = false;
			}

			const lostAfterList = await renewFinalizationLease();
			if (lostAfterList) return lostAfterList;

			if (uploadStillOpen) {
				const verified = validateCompletedAttachmentParts(doc.objectSizeBytes, parts);
				if (verified.ok === false) {
					const reverted = await dependencies.store.revertFinalizing(ownerId, id, finalizationLeaseId);
					if (!reverted) return fail(409, 'Attachment changed — try again');
					return {
						...verified,
						code: 'upload_parts_retryable',
						retryable: true
					};
				}
				try {
					const completed = await s3.completeMultipartUpload({
						objectKey: doc.objectKey,
						uploadId: doc.uploadId,
						parts: verified.parts
					});
					if (completed.versionId && !isAttachmentObjectVersionId(completed.versionId)) {
						return fail(409, 'Uploaded object did not receive a valid version id');
					}
					if (completed.versionId) doc = { ...doc, objectVersionId: completed.versionId };
				} catch (error) {
					if (!s3.isNoSuchUpload(error)) throw error;
				}

				const lostAfterComplete = await renewFinalizationLease(doc.objectVersionId);
				if (lostAfterComplete) return lostAfterComplete;
			}

			let head: AttachmentObjectHead;
			try {
				head = await verifiedHeadForDoc(s3, doc, doc.objectVersionId);
			} catch (error) {
				if (s3.isNotFound(error)) {
					if (!uploadStillOpen) {
						// NoSuchUpload followed immediately by HEAD 404 can be the window
						// where an older fenced Complete is still settling. Keep this
						// lease durable instead of reverting to a dead pending MPU.
						return fail(409, 'Attachment finalization is still settling — try again', {
							code: 'finalization_settling',
							retryable: true
						});
					}
					return fail(409, 'Attachment finalization is still settling — try again', {
						code: 'finalization_settling',
						retryable: true
					});
				}
				throw error;
			}

			const lostAfterHead = await renewFinalizationLease(head.versionId);
			if (lostAfterHead) return lostAfterHead;
			if (!head.checksumSha256 || head.checksumType !== 'COMPOSITE' || !isAttachmentObjectVersionId(head.versionId)) {
				return fail(409, 'Uploaded object failed integrity verification');
			}

			const detected = detectedAttachmentType(await s3.detectContentType({ objectKey: doc.objectKey, versionId: head.versionId }), doc.crystal.name);
			const lostAfterDetection = await renewFinalizationLease(head.versionId);
			if (lostAfterDetection) return lostAfterDetection;
			const readyCrystal: AttachmentCrystal = { ...doc.crystal, ...detected };
			try {
				doc = await dependencies.store.markReady(
					ownerId,
					id,
					readyCrystal,
					head.versionId,
					new Date(dependencies.now().getTime() + ATTACHMENT_READY_DRAFT_TTL_MS),
					finalizationLeaseId
				);
			} catch (error) {
				if (!(error instanceof AttachmentStoreConflictError)) throw error;
				return settleLostFinalizationLease(head.versionId);
			}
			if (!isAttachmentObjectVersionId(doc.objectVersionId)) {
				return fail(409, 'Attachment object version is unavailable');
			}
			await s3.markObjectReady({ objectKey: doc.objectKey, versionId: doc.objectVersionId });
			// Moderation runs AFTER the upload is durable and never affects the
			// response — the analyzer stamps the protected root field async and the
			// admin sweep retries anything that misses this kickoff.
			dependencies.queueModeration?.(doc.shareId);
			return { ok: true, attachment: attachmentPublicProjection(doc.shareId, doc.crystal) };
		} catch (error) {
			return knownFailure(error) || unavailable('complete', error);
		}
	};

	const cleanupResponse = (outcome: AttachmentCleanupOutcome): AttachmentOk<{ deferred: boolean; retryAt?: string }> =>
		outcome.status === 'deferred' ? { ok: true, deferred: true, retryAt: outcome.retryAt.toISOString() } : { ok: true, deferred: false };

	const deferredDeletingResponse = (doc: AttachmentDoc | null): AttachmentOk<{ deferred: boolean; retryAt?: string }> | null =>
		doc?.attachmentState === 'deleting' &&
		!!doc.uploadId &&
		!!doc.attachmentExpiresAt &&
		doc.attachmentExpiresAt.getTime() > dependencies.now().getTime()
			? { ok: true, deferred: true, retryAt: doc.attachmentExpiresAt.toISOString() }
			: null;

	const cancel = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ deferred: boolean; retryAt?: string }>> => {
		try {
			if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Invalid cancellation request');
			const raw = input as Record<string, unknown>;
			if (Object.keys(raw).some((key) => key !== 'uploadId')) return fail(400, 'Invalid cancellation request');
			const id = normalizeId(raw.uploadId);
			if (!id) return fail(400, 'Invalid attachment upload id');
			const existing = await getOwnedByAttachmentOrRequestId(ownerId, id);
			if (!existing) return { ok: true, deferred: false };
			if (existing.targetId) return fail(409, 'Attached files must be removed from their post');
			if (existing.attachmentState === 'finalizing') {
				return fail(409, 'Attachment finalization is in progress — try again');
			}
			const outcome = await cleanupClaimedDoc(() => dependencies.getS3(), existing, { kind: 'draft' });
			if (outcome.status === 'skipped') {
				const raced = await getOwnedByAttachmentOrRequestId(ownerId, id);
				if (raced?.targetId) return fail(409, 'Attached files must be removed from their post');
				if (raced?.attachmentState === 'finalizing') {
					return fail(409, 'Attachment finalization is in progress — try again');
				}
				return deferredDeletingResponse(raced) || { ok: true, deferred: false };
			}
			return cleanupResponse(outcome);
		} catch (error) {
			return knownFailure(error) || unavailable('cancel', error);
		}
	};

	const remove = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ deferred: boolean; retryAt?: string }>> => {
		try {
			if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Invalid attachment deletion request');
			const raw = input as Record<string, unknown>;
			if (Object.keys(raw).some((key) => !['id', 'targetId'].includes(key))) return fail(400, 'Invalid attachment deletion request');
			const id = normalizeId(raw.id);
			const targetId = raw.targetId === undefined ? null : normalizeId(raw.targetId);
			if (!id) return fail(400, 'Invalid attachment id');
			if (raw.targetId !== undefined && !targetId) return fail(400, 'Invalid attachment target id');
			const existing = await getOwnedByAttachmentOrRequestId(ownerId, id);
			if (!existing) return { ok: true, deferred: false };
			// A client may miss a successful post-create response and then try to
			// clean up its former draft ids. Once bound, only post cascade deletion
			// may remove the object; this check makes that ambiguous success safe.
			if (existing.targetId && existing.targetId !== targetId) return fail(409, 'Attached files must be removed from their post');
			if (existing.targetId && existing.attachmentPurpose && !['post', 'comment'].includes(existing.attachmentPurpose)) {
				return fail(409, 'This attached file must be removed from its owning surface');
			}
			if (existing.attachmentState === 'finalizing') {
				return fail(409, 'Attachment finalization is in progress — try again');
			}
			const reason = existing.targetId ? { kind: 'target' as const, targetId: existing.targetId } : { kind: 'draft' as const };
			const outcome = await cleanupClaimedDoc(() => dependencies.getS3(), existing, reason);
			if (outcome.status === 'skipped') {
				const raced = await getOwnedByAttachmentOrRequestId(ownerId, id);
				if (raced?.targetId && raced.targetId !== targetId) return fail(409, 'Attached files must be removed from their post');
				if (raced?.attachmentState === 'finalizing') {
					return fail(409, 'Attachment finalization is in progress — try again');
				}
				return deferredDeletingResponse(raced) || { ok: true, deferred: false };
			}
			return cleanupResponse(outcome);
		} catch (error) {
			return knownFailure(error) || unavailable('delete', error);
		}
	};

	const download = async (
		viewer: AttachmentViewer,
		idInput: unknown,
		forceDownload: boolean
	): Promise<AttachmentResult<{ url: string; expiresAt: string }>> => {
		try {
			const id = normalizeId(idInput);
			if (!id) return fail(404, 'Attachment not found');
			let doc = await dependencies.store.getById(id);
			if (!doc || doc.attachmentState !== 'ready') return fail(404, 'Attachment not found');
			// Pending analysis fails closed for everyone except the owner preview and
			// an administrator reviewing evidence. Blocked attachments stay admin-only.
			// 404 (not 403) keeps moderation state from becoming an existence oracle.
			if (doc.moderation?.status === 'blocked' && !viewer?.isAdmin) return fail(404, 'Attachment not found');
			if (doc.moderation?.status === 'pending' && !viewer?.isAdmin && viewer?.id !== doc.ownerId) {
				return fail(404, 'Attachment not found');
			}
			// Unbound drafts are owner-previewable only while their reservation is
			// live. Profile replacement stamps immediate expiry in the same Mongo
			// transaction that removes the user-slot reference, making the old object
			// inaccessible while it remains billed until exact-version cleanup.
			if (!doc.targetId && (!doc.attachmentExpiresAt || doc.attachmentExpiresAt.getTime() <= dependencies.now().getTime())) {
				return fail(404, 'Attachment not found');
			}
			// Post attachments must never authorize a home object against a caller-
			// selected data plane. Profile media is different: both its attachment and
			// exact user-slot reference are protected home identity data, so the lean
			// home-pinned helper remains authoritative under a custom post data plane.
			if (dependencies.customMongoActive() && doc.attachmentPurpose !== 'profile') return fail(404, 'Attachment not found');
			const allowed =
				doc.attachmentPurpose === 'profile' && doc.targetId
					? await dependencies.canViewTarget(viewer, doc)
					: viewer?.id === doc.ownerId || (!!doc.targetId && (await dependencies.canViewTarget(viewer, doc)));
			if (!allowed) return fail(404, 'Attachment not found');

			// Linked attachments have no stored object and are NEVER served or
			// redirected through this endpoint: a 302 to crystal.url would turn the
			// first-party content URL into an open redirect to an attacker-chosen
			// origin (CWE-601). Renderers always use crystal.url directly.
			if (doc.attachmentLinked === true) return fail(404, 'Attachment not found');

			const s3 = dependencies.getS3();
			if (!doc.objectVersionId) {
				const recovered = await verifiedHeadForDoc(s3, doc);
				doc = await dependencies.store.setObjectVersionId(doc.ownerId, doc.shareId, recovered.versionId);
			}
			if (!isAttachmentObjectVersionId(doc.objectVersionId)) {
				return fail(404, 'Attachment not found');
			}
			const inline = !forceDownload && attachmentMayRenderInline(doc.crystal);
			const signed = await s3.signDownload({
				objectKey: doc.objectKey,
				versionId: doc.objectVersionId,
				contentDisposition: attachmentContentDisposition(doc.crystal.name, inline),
				contentType: inline ? doc.crystal.contentType : 'application/octet-stream'
			});
			return { ok: true, ...signed };
		} catch (error) {
			return knownFailure(error) || unavailable('download', error);
		}
	};

	type ContentAttachmentPurpose = Extract<AttachmentPurpose, 'post' | 'comment' | 'message' | 'emoji'>;
	type InspectedAttachments = {
		hasAny: boolean;
		hasVisual: boolean;
		attachments: AttachmentPublicMetadata[];
	};

	const inspectForPurpose = async (
		ownerId: string,
		attachmentIds: readonly unknown[],
		purpose: ContentAttachmentPurpose,
		maxAttachments = MAX_ATTACHMENTS_PER_TARGET,
		expectedTargetId?: unknown
	): Promise<AttachmentResult<InspectedAttachments>> => {
		try {
			if (dependencies.customMongoActive()) {
				return fail(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
			}
			const ids = attachmentIds.map(normalizeId);
			if (ids.some((id) => !id)) return fail(400, 'Invalid attachment id');
			const normalizedExpectedTargetId = expectedTargetId === undefined ? undefined : normalizeId(expectedTargetId);
			if (expectedTargetId !== undefined && !normalizedExpectedTargetId) return fail(400, 'Invalid attachment target id');
			const normalized = ids as string[];
			if (new Set(normalized).size !== normalized.length || normalized.length > maxAttachments) {
				return fail(400, `This ${purpose === 'emoji' ? 'custom emoji' : purpose} has too many attachments`);
			}
			if (!normalized.length) return { ok: true, hasAny: false, hasVisual: false, attachments: [] };
			const docs = await dependencies.store.getOwnedMany(ownerId, normalized);
			const now = dependencies.now().getTime();
			const byId = new Map(docs.map((doc) => [doc.shareId, doc]));
			const ordered = normalized.map((id) => byId.get(id)).filter((doc): doc is AttachmentDoc => !!doc);
			const bindingStates = new Set<'draft' | 'bound'>();
			if (
				ordered.length !== normalized.length ||
				ordered.some((doc) => {
					const draft = !doc.targetId && !!doc.attachmentExpiresAt && doc.attachmentExpiresAt.getTime() > now;
					const idempotentlyBound =
						!!normalizedExpectedTargetId && doc.targetId === normalizedExpectedTargetId && doc.attachmentExpiresAt === undefined;
					if (draft) bindingStates.add('draft');
					if (idempotentlyBound) bindingStates.add('bound');
					return (
						doc.attachmentState !== 'ready' ||
						(purpose === 'post' ? doc.attachmentPurpose !== undefined && doc.attachmentPurpose !== 'post' : doc.attachmentPurpose !== purpose) ||
						doc.attachmentProfileSlot !== undefined ||
						(!draft && !idempotentlyBound) ||
						!toAttachmentPublicMetadata(doc.shareId, doc.crystal)
					);
				}) ||
				bindingStates.size > 1
			) {
				return fail(409, 'One or more attachments are unavailable or already attached');
			}
			const projected = ordered.map((doc) => toAttachmentPublicMetadata(doc.shareId, doc.crystal));
			if (projected.some((attachment) => !attachment)) {
				return fail(409, 'One or more attachments failed metadata validation');
			}
			const attachments = projected as AttachmentPublicMetadata[];
			return {
				ok: true,
				hasAny: true,
				hasVisual: ordered.some((doc) => doc.crystal.mediaKind === 'image' || doc.crystal.mediaKind === 'video'),
				attachments
			};
		} catch (error) {
			return knownFailure(error) || unavailable('inspect', error);
		}
	};

	const inspectForPost = async (
		ownerId: string,
		attachmentIds: readonly unknown[]
	): Promise<AttachmentResult<{ hasAny: boolean; hasVisual: boolean }>> => {
		const inspected = await inspectForPurpose(ownerId, attachmentIds, 'post');
		return inspected.ok ? { ok: true, hasAny: inspected.hasAny, hasVisual: inspected.hasVisual } : inspected;
	};

	const inspectForComment = (ownerId: string, attachmentIds: readonly unknown[], expectedTargetId?: unknown) =>
		inspectForPurpose(ownerId, attachmentIds, 'comment', MAX_ATTACHMENTS_PER_TARGET, expectedTargetId);

	const inspectForMessage = (ownerId: string, attachmentIds: readonly unknown[], expectedTargetId?: unknown) =>
		inspectForPurpose(ownerId, attachmentIds, 'message', MAX_ATTACHMENTS_PER_TARGET, expectedTargetId);

	const inspectForEmoji = async (ownerId: string, attachmentIds: readonly unknown[], expectedTargetId?: unknown) => {
		if (attachmentIds.length !== 1) return fail(400, 'Choose exactly one custom emoji image');
		const inspected = await inspectForPurpose(ownerId, attachmentIds, 'emoji', 1, expectedTargetId);
		if (!inspected.ok) return inspected;
		const attachment = inspected.attachments[0];
		if (
			!attachment ||
			attachment.mediaKind !== 'image' ||
			attachment.size > MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES ||
			!CUSTOM_EMOJI_ATTACHMENT_CONTENT_TYPES.has(attachment.contentType)
		) {
			return fail(400, 'Custom emojis must be a GIF, PNG, JPEG, or WebP image up to 512 KiB');
		}
		return inspected;
	};

	const beforeCascade = async (root: { shareId: string; ownerId: string }): Promise<AttachmentResult> => {
		try {
			// A custom data-plane shareId can collide with a home post id. Those
			// roots cannot own private Thingtime S3 attachments and must never drive
			// a home-object query or deletion.
			if (dependencies.customMongoActive()) return { ok: true };
			const docs = await dependencies.store.listForTarget(root.ownerId, root.shareId);
			// resolved lazily so deleting a linked-only post never requires S3
			let s3: AttachmentS3 | null = null;
			const getS3 = () => (s3 ??= dependencies.getS3());
			for (const doc of docs) {
				const outcome = await cleanupClaimedDoc(getS3, doc, { kind: 'target', targetId: root.shareId });
				if (outcome.status === 'deferred') {
					throw new AttachmentServiceError(503, 'Attachment deletion is still settling — try again');
				}
				if (outcome.status === 'skipped') {
					const raced = await dependencies.store.getOwned(doc.ownerId, doc.shareId);
					if (raced?.targetId === root.shareId) {
						throw new AttachmentServiceError(409, 'Attachment deletion changed — try again');
					}
				}
			}
			return { ok: true };
		} catch (error) {
			return knownFailure(error) || unavailable('cascade preparation', error);
		}
	};

	return {
		start,
		signParts,
		complete,
		cancel,
		remove,
		download,
		inspectForPost,
		inspectForComment,
		inspectForMessage,
		inspectForEmoji,
		beforeCascade,
		beforeSessionReplacement,
		reapExpired,
		backfillDetectedTypes
	};
};

const service = createAttachmentService();

export const startAttachmentUpload = service.start;
export const signAttachmentUploadParts = service.signParts;
export const completeAttachmentUpload = service.complete;
export const cancelAttachmentUpload = service.cancel;
export const deleteAttachment = service.remove;
export const getAttachmentDownload = service.download;
export const inspectReadyAttachmentsForPost = service.inspectForPost;
export const inspectReadyAttachmentsForComment = service.inspectForComment;
export const inspectReadyAttachmentsForMessage = service.inspectForMessage;
export const inspectReadyAttachmentForEmoji = service.inspectForEmoji;
export const prepareAttachmentCascadeForThing = service.beforeCascade;
export const prepareUnboundAttachmentCleanupForSessionReplacement = service.beforeSessionReplacement;
export const reapExpiredAttachments = service.reapExpired;
export const backfillAttachmentDetectedTypes = service.backfillDetectedTypes;

export const createReadyAttachmentPostInsertHook =
	(attachmentIds: readonly string[], bind = bindReadyAttachmentsToTarget) =>
	async (doc: { shareId: string; ownerId: string }, session: any) => {
		await bind(doc.ownerId, attachmentIds, doc.shareId, session);
	};

// POST /api/v1/attachments/annotate — owner-authored display metadata on a
// ready attachment (draft or bound). The media's own Thing page and the post
// lightbox render these; binding, audience, and object bytes are untouched.
export const annotateAttachment = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ attachment: AttachmentPublicMetadata }>> => {
	try {
		if (isCustomMongoEndpointActive()) {
			return fail(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
		}
		const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
		if (Object.keys(record).some((key) => !['id', 'filenamePreview', 'title', 'description'].includes(key))) {
			return fail(400, 'Invalid attachment annotation request');
		}
		const id = normalizeId(record.id);
		if (!id) return fail(400, 'Invalid attachment id');
		const patchField = (value: unknown, label: string): string | null | undefined => {
			if (value === undefined) return undefined;
			if (value === null) return null;
			if (typeof value !== 'string') throw new AttachmentServiceError(400, `Attachment ${label} must be text`);
			return value;
		};
		const title = patchField(record.title, 'title');
		const description = patchField(record.description, 'description');
		const filenamePreview = patchField(record.filenamePreview, 'filename preview');
		if (title === undefined && description === undefined && filenamePreview === undefined) {
			return fail(400, 'Provide a filename preview, title or description to update');
		}
		const doc = await annotateOwnedAttachment(ownerId, id, { filenamePreview, title, description });
		const attachment = toAttachmentPublicMetadata(doc.shareId, doc.crystal);
		if (!attachment) return fail(409, 'Attachment metadata failed validation after update');
		return { ok: true, attachment };
	} catch (error) {
		return knownFailure(error) || unavailable('annotate', error);
	}
};

// POST /api/v1/attachments/link — mint a READY linked-attachment draft from an
// external media URL. It binds, orders, annotates, projects, and deletes like
// any uploaded attachment, but no bytes ever touch Thingtime storage: the
// crystal's url renders straight from the original site (img/video/anchor safe
// sinks; the server never fetches it, so there is no SSRF surface). Duplicate
// URLs are deliberately allowed — each mint is its own attachment thing.
// Unbound mints expire on the same 24h draft TTL as uploads.
export const linkAttachment = async (ownerId: string, input: unknown): Promise<AttachmentResult<{ attachment: AttachmentPublicMetadata }>> => {
	try {
		if (isCustomMongoEndpointActive()) {
			return fail(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
		}
		const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
		if (Object.keys(record).some((key) => !['url', 'purpose', 'mediaKind'].includes(key))) {
			return fail(400, 'Invalid linked media request');
		}
		const url = canonicalLinkedAttachmentUrl(record.url);
		if (!url) return fail(400, 'Linked media must be a plain http(s) URL of at most 2048 characters');
		const purpose = record.purpose === undefined ? 'post' : record.purpose;
		if (purpose !== 'post' && purpose !== 'comment') {
			return fail(400, 'Linked media is available on posts and comments');
		}
		const derived = linkedMediaTypeForUrl(url);
		// The declared kind is a render hint the client may DEMOTE (an
		// extensionless URL that failed an image probe becomes a plain file) but
		// never promote: a known file extension cannot claim a visual kind.
		let mediaKind = derived.mediaKind;
		if (record.mediaKind !== undefined) {
			if (!isLinkedAttachmentMediaKind(record.mediaKind)) return fail(400, 'Invalid linked media kind');
			if (record.mediaKind !== 'file' && record.mediaKind !== derived.mediaKind) {
				return fail(400, 'Linked media kind does not match the URL');
			}
			mediaKind = record.mediaKind;
		}
		const crystal: AttachmentCrystal = {
			name: linkedAttachmentNameForUrl(url),
			size: 0,
			contentType: derived.contentType,
			mediaKind,
			url
		};
		const doc = await attachmentStore.insertLinkedReady({
			id: randomUUID(),
			ownerId,
			crystal,
			purpose,
			expiresAt: new Date(Date.now() + ATTACHMENT_READY_DRAFT_TTL_MS)
		});
		const attachment = toAttachmentPublicMetadata(doc.shareId, doc.crystal, doc.moderation);
		if (!attachment) return fail(409, 'Linked media failed validation after creation');
		return { ok: true, attachment };
	} catch (error) {
		return knownFailure(error) || unavailable('link', error);
	}
};

// PATCH-time sync: re-stamp the display order of a target's bound attachments
// AND bind any newly uploaded ready drafts an edit appends. The store helper
// verifies target ownership, rejects removals (deletes stay their own
// operation), and claims additions with the same fences create-time binding
// uses — so this can never move an attachment onto a thing the editor does
// not own.
export const syncReadyAttachmentsForTarget = async (
	ownerId: string,
	targetId: unknown,
	attachmentIds: readonly unknown[]
): Promise<AttachmentResult> => {
	try {
		if (isCustomMongoEndpointActive()) {
			return fail(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
		}
		const normalizedTargetId = typeof targetId === 'string' ? targetId.trim() : '';
		if (!normalizedTargetId) return fail(400, 'Thing id is required');
		await syncBoundTargetAttachments(ownerId, normalizedTargetId, attachmentIds);
		return { ok: true };
	} catch (error) {
		return knownFailure(error) || unavailable('attachment update', error);
	}
};

const createReadyAttachmentInsertHook =
	(attachmentIds: readonly string[], bind: typeof bindReadyAttachmentsToTarget) =>
	async (doc: { shareId: string; ownerId: string }, session: any) => {
		await bind(doc.ownerId, attachmentIds, doc.shareId, session);
	};

export const createReadyAttachmentCommentInsertHook = (attachmentIds: readonly string[]) =>
	createReadyAttachmentInsertHook(attachmentIds, bindReadyCommentAttachmentsToTarget);

export const createReadyAttachmentMessageInsertHook = (attachmentIds: readonly string[]) =>
	createReadyAttachmentInsertHook(attachmentIds, bindReadyMessageAttachmentsToTarget);

export const createReadyAttachmentEmojiInsertHook = (attachmentIds: readonly string[]) =>
	createReadyAttachmentInsertHook(attachmentIds, bindReadyEmojiAttachmentToTarget);
