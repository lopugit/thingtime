import { isDeepStrictEqual } from 'node:util';

import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore';
import { applyUserStorageDelta, markUserStorageNeedsReconcile } from '../storage/userStorage';
import { ACL_INHERIT, ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import {
	ATTACHMENT_ENVELOPE_VERSION,
	ATTACHMENT_THINGTIME,
	applyAttachmentAnnotationPatch,
	isAttachmentFinalizationLeaseId,
	isAttachmentObjectVersionId,
	planAttachmentReorder,
	planAttachmentSync,
	attachmentModerationHidesFromPublic,
	attachmentStoredSortValue,
	LINKED_ATTACHMENT_OBJECT_KEY_PREFIX,
	type AttachmentAnnotationPatch,
	type AttachmentCrystal,
	type AttachmentPurpose,
	type ProfileAttachmentSlot,
	type AttachmentState
} from './attachmentCore';

export const MAX_ATTACHMENTS_PER_TARGET = 25;
export const ATTACHMENT_FINALIZING_DELETE_GRACE_MS = 60 * 60 * 1000;
export const ATTACHMENT_FINALIZATION_LEASE_MS = 15 * 60 * 1000;
export const ATTACHMENT_DELETING_RETRY_DELAY_MS = 15 * 60 * 1000;
export const ATTACHMENT_UPLOAD_INITIALIZATION_LEASE_MS = 15 * 60 * 1000;
// S3 warns that an UploadPart already in flight can finish after Abort. Keep
// the reservation billed beyond the bucket's seven-day incomplete-MPU
// lifecycle window before repeated Abort/ListParts/HEAD can authorize refund.
export const ATTACHMENT_MPU_SETTLEMENT_MS = 8 * 24 * 60 * 60 * 1000;
export const ATTACHMENT_MPU_EMPTY_RECHECK_MS = 60 * 60 * 1000;
export const MAX_PROFILE_ATTACHMENT_BYTES = 64 * 1024 * 1024;
export const PROFILE_ATTACHMENT_CONTENT_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
export type { AttachmentPurpose, ProfileAttachmentSlot } from './attachmentCore';
export const attachmentDeletingRetryAt = (now = new Date()): Date => new Date(now.getTime() + ATTACHMENT_DELETING_RETRY_DELAY_MS);
export const attachmentMpuSettlementAt = (now = new Date()): Date => new Date(now.getTime() + ATTACHMENT_MPU_SETTLEMENT_MS);
export const attachmentDeletingRetryUpdate = (retryAt: Date, updatedAt = new Date()) => ({
	$max: { attachmentExpiresAt: retryAt },
	$set: { updatedAt }
});

export type AttachmentDoc = {
	_id?: unknown;
	shareId: string;
	schemaVersion: number;
	thingtime: [typeof ATTACHMENT_THINGTIME];
	crystal: AttachmentCrystal;
	extended: null;
	ownerId: string;
	acl: string[];
	targetId?: string;
	tags: [];
	storageClass: 'content';
	storageAccountingVersion: number;
	sizeBytes: number;
	attachmentEnvelopeVersion: typeof ATTACHMENT_ENVELOPE_VERSION;
	attachmentState: AttachmentState;
	objectSizeBytes: number;
	objectKey: string;
	objectVersionId?: string;
	attachmentRequestFingerprint?: string;
	attachmentPurpose?: AttachmentPurpose;
	attachmentProfileSlot?: ProfileAttachmentSlot;
	attachmentFinalizationLeaseId?: string;
	attachmentPartsIssuedAt?: Date;
	attachmentObjectlessDelete?: true;
	attachmentMpuEmptyVerifiedAt?: Date;
	uploadId?: string;
	attachmentExpiresAt?: Date;
	// true only on linked (external URL) attachments: no S3 object exists, the
	// crystal carries the url, and object bytes are always zero
	attachmentLinked?: true;
	// owner-chosen display position within the bound target (stamped at
	// bind/reorder time; legacy bound docs without it sort by createdAt)
	attachmentSortIndex?: number;
	// Protected moderation stamp (api/utils/moderation) — written only by the
	// server-side analysis pipeline and admin review, never by upload input.
	moderation?: {
		status: 'pending' | 'skipped' | 'clear' | 'nsfw' | 'blocked';
		categories?: string[];
		provider?: string;
		model?: string;
		analyzedAt?: Date;
		reason?: string;
		flagPending?: boolean;
	};
	createdAt: Date;
	updatedAt: Date;
};

type PendingInput = {
	id: string;
	ownerId: string;
	crystal: AttachmentCrystal;
	objectKey: string;
	requestFingerprint: string;
	purpose: AttachmentPurpose;
	profileSlot?: ProfileAttachmentSlot;
	expiresAt: Date;
};

type LinkedReadyInput = {
	id: string;
	ownerId: string;
	crystal: AttachmentCrystal;
	purpose: AttachmentPurpose;
	expiresAt: Date;
};

export type AttachmentDeleteClaimScope =
	| { kind: 'draft'; expiredAtOrBefore?: Date; finalizingUpdatedAtOrBefore?: Date }
	| { kind: 'target'; targetId: string };
export type AttachmentDraftDeleteClaimScope = Extract<AttachmentDeleteClaimScope, { kind: 'draft' }>;

export const attachmentDeleteClaimFence = (scope: AttachmentDeleteClaimScope): Record<string, unknown> => {
	if (scope.kind === 'target') return { targetId: scope.targetId };
	return {
		targetId: { $exists: false },
		...(scope.expiredAtOrBefore ? { attachmentExpiresAt: { $lte: scope.expiredAtOrBefore } } : {})
	};
};

export const attachmentObjectlessPendingDeleteFence = (scope: AttachmentDraftDeleteClaimScope): Record<string, unknown> => ({
	...attachmentDeleteClaimFence(scope),
	attachmentState: 'pending',
	uploadId: { $exists: false },
	objectVersionId: { $exists: false },
	attachmentObjectlessDelete: { $exists: false }
});

export class AttachmentStoreConflictError extends Error {
	constructor(message = 'Attachment changed while it was being updated') {
		super(message);
		this.name = 'AttachmentStoreConflictError';
	}
}

export class AttachmentBindingError extends StorageMutationError {
	constructor(status: number, message: string) {
		super(status, 'storage_conflict', message);
		this.name = 'AttachmentBindingError';
	}
}

const canonicalStoredBytes = (doc: AttachmentDoc): number => {
	const bytes = currentContentStorageSizeBytes(doc);
	if (bytes === null) {
		throw new StorageMutationError(409, 'storage_conflict', 'This attachment requires the current storage migration before it can be changed');
	}
	return bytes;
};

const attachmentMatch = (id: string) => ({ shareId: id, thingtime: ATTACHMENT_THINGTIME });

export type AttachmentStore = {
	reservePending(input: PendingInput): Promise<AttachmentDoc>;
	insertLinkedReady(input: LinkedReadyInput): Promise<AttachmentDoc>;
	claimUploadInitialization(ownerId: string, id: string, staleAtOrBefore: Date): Promise<AttachmentDoc | null>;
	setUploadId(ownerId: string, id: string, uploadId: string): Promise<AttachmentDoc>;
	markPartsIssued(ownerId: string, id: string, issuedAt: Date): Promise<AttachmentDoc>;
	getOwned(ownerId: string, id: string): Promise<AttachmentDoc | null>;
	getOwnedMany(ownerId: string, ids: readonly string[]): Promise<AttachmentDoc[]>;
	getById(id: string): Promise<AttachmentDoc | null>;
	listForTarget(ownerId: string, targetId: string): Promise<AttachmentDoc[]>;
	claimFinalizing(ownerId: string, id: string, leaseId: string): Promise<{ doc: AttachmentDoc; acquired: boolean } | null>;
	renewFinalizing(ownerId: string, id: string, leaseId: string): Promise<AttachmentDoc | null>;
	revertFinalizing(ownerId: string, id: string, leaseId: string): Promise<AttachmentDoc | null>;
	markReady(
		ownerId: string,
		id: string,
		crystal: AttachmentCrystal,
		objectVersionId: string,
		expiresAt: Date,
		leaseId: string
	): Promise<AttachmentDoc>;
	setObjectVersionId(ownerId: string, id: string, objectVersionId: string): Promise<AttachmentDoc>;
	claimObjectlessPendingDeleting(ownerId: string, id: string, scope: AttachmentDraftDeleteClaimScope): Promise<AttachmentDoc | null>;
	claimDeleting(ownerId: string, id: string, allowedStates: AttachmentState[], scope: AttachmentDeleteClaimScope): Promise<AttachmentDoc | null>;
	removeDeleting(ownerId: string, id: string): Promise<boolean>;
	recordMpuCleanupVerification(ownerId: string, id: string, emptyVerifiedAt: Date | null, retryAt: Date, partsIssuedAt?: Date): Promise<void>;
	deferDeletingRetry(ownerId: string, id: string, retryAt: Date): Promise<void>;
	listUnboundOwned(ownerId: string, limit: number): Promise<AttachmentDoc[]>;
	listExpiredOwned(ownerId: string, limit: number): Promise<AttachmentDoc[]>;
	listExpired(limit: number, expiredAtOrBefore: Date): Promise<AttachmentDoc[]>;
	listReadyUndetected(limit: number, afterId?: string): Promise<AttachmentDoc[]>;
	upgradeReadyCrystal(id: string, crystal: AttachmentCrystal, expectedObjectVersionId: string): Promise<AttachmentDoc>;
};

export const expiredAttachmentDraftFilter = (
	expiredAtOrBefore: Date,
	ownerId?: string,
	finalizingUpdatedAtOrBefore = expiredAtOrBefore
): Record<string, unknown> => ({
	...(ownerId ? { ownerId } : {}),
	thingtime: ATTACHMENT_THINGTIME,
	attachmentExpiresAt: { $lte: expiredAtOrBefore },
	$or: [
		{ targetId: { $exists: false }, attachmentState: { $in: ['pending', 'ready'] } },
		{
			targetId: { $exists: false },
			attachmentState: 'finalizing',
			updatedAt: { $lte: finalizingUpdatedAtOrBefore }
		},
		// A process may die after exact-version S3 deletion but before the
		// transactional refund. Keep that deleting intent globally retryable even
		// when it still carries its former targetId.
		{ attachmentState: 'deleting' }
	]
});

export const attachmentStore: AttachmentStore = {
	async reservePending({ id, ownerId, crystal, objectKey, requestFingerprint, purpose, profileSlot, expiresAt }) {
		const now = new Date();
		const unstamped = {
			shareId: id,
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: [ATTACHMENT_THINGTIME] as [typeof ATTACHMENT_THINGTIME],
			crystal,
			extended: null,
			ownerId,
			acl: [ACL_OWNER],
			tags: [] as [],
			storageClass: 'content' as const,
			storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
			attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION,
			attachmentState: 'pending' as const,
			objectSizeBytes: crystal.size,
			objectKey,
			attachmentRequestFingerprint: requestFingerprint,
			attachmentPurpose: purpose,
			...(profileSlot ? { attachmentProfileSlot: profileSlot } : {}),
			attachmentExpiresAt: expiresAt,
			createdAt: now,
			updatedAt: now
		};
		const doc: AttachmentDoc = { ...unstamped, sizeBytes: thingStorageSizeBytes(unstamped) };

		await withHomeMongoTransaction(async (session) => {
			await applyUserStorageDelta(ownerId, doc.sizeBytes, session);
			await (await getHomeThingsCollection()).insertOne(doc as any, { session });
		});
		return doc;
	},

	// A linked (external URL) attachment is born READY: there is no upload to
	// finalize and no object bytes to verify — the crystal's url IS the media.
	// It carries the same draft TTL as an uploaded ready draft, binds through
	// the same fences, and only its JSON payload bytes hit the owner's quota.
	// Moderation is stamped 'skipped' at mint: there are no stored bytes for
	// the analyzer to fetch, and an unstamped doc would loop the sweep forever.
	async insertLinkedReady({ id, ownerId, crystal, purpose, expiresAt }) {
		const now = new Date();
		const unstamped = {
			shareId: id,
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: [ATTACHMENT_THINGTIME] as [typeof ATTACHMENT_THINGTIME],
			crystal,
			extended: null,
			ownerId,
			acl: [ACL_OWNER],
			tags: [] as [],
			storageClass: 'content' as const,
			storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
			attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION,
			attachmentState: 'ready' as const,
			attachmentLinked: true as const,
			objectSizeBytes: 0,
			objectKey: `${LINKED_ATTACHMENT_OBJECT_KEY_PREFIX}${id}`,
			attachmentPurpose: purpose,
			attachmentExpiresAt: expiresAt,
			moderation: { status: 'skipped' as const, categories: ['external-url'], provider: 'linked', analyzedAt: now },
			createdAt: now,
			updatedAt: now
		};
		const doc: AttachmentDoc = { ...unstamped, sizeBytes: thingStorageSizeBytes(unstamped) };

		await withHomeMongoTransaction(async (session) => {
			await applyUserStorageDelta(ownerId, doc.sizeBytes, session);
			await (await getHomeThingsCollection()).insertOne(doc as any, { session });
		});
		return doc;
	},

	async claimUploadInitialization(ownerId, id, staleAtOrBefore) {
		return (await (
			await getHomeThingsCollection()
		).findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				targetId: { $exists: false },
				attachmentState: 'pending',
				uploadId: { $exists: false },
				attachmentObjectlessDelete: { $exists: false },
				updatedAt: { $lte: staleAtOrBefore }
			} as any,
			{ $set: { updatedAt: new Date() } },
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
	},

	async setUploadId(ownerId, id, uploadId) {
		const things = await getHomeThingsCollection();
		const updated = (await things.findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				attachmentState: 'pending',
				uploadId: { $exists: false }
			} as any,
			{ $set: { uploadId, updatedAt: new Date() } },
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
		if (!updated) {
			const existing = (await things.findOne({
				...attachmentMatch(id),
				ownerId,
				attachmentState: 'pending',
				uploadId: { $type: 'string' }
			} as any)) as any as AttachmentDoc | null;
			if (existing) return existing;
			throw new AttachmentStoreConflictError();
		}
		return updated;
	},

	async markPartsIssued(ownerId, id, issuedAt) {
		const things = await getHomeThingsCollection();
		const updated = (await things.findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				targetId: { $exists: false },
				attachmentState: 'pending',
				uploadId: { $type: 'string' },
				attachmentPartsIssuedAt: { $exists: false },
				attachmentExpiresAt: { $gt: issuedAt }
			} as any,
			{ $set: { attachmentPartsIssuedAt: issuedAt, updatedAt: issuedAt } },
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
		if (updated) return updated;
		const existing = (await things.findOne({
			...attachmentMatch(id),
			ownerId,
			targetId: { $exists: false },
			attachmentState: 'pending',
			uploadId: { $type: 'string' },
			attachmentPartsIssuedAt: { $type: 'date' },
			attachmentExpiresAt: { $gt: issuedAt }
		} as any)) as any as AttachmentDoc | null;
		if (existing) return existing;
		throw new AttachmentStoreConflictError();
	},

	async getOwned(ownerId, id) {
		return (await (await getHomeThingsCollection()).findOne({ ...attachmentMatch(id), ownerId } as any)) as any as AttachmentDoc | null;
	},

	async getOwnedMany(ownerId, ids) {
		if (!ids.length) return [];
		return (await (await getHomeThingsCollection())
			.find({ shareId: { $in: [...ids] }, ownerId, thingtime: ATTACHMENT_THINGTIME } as any)
			.toArray()) as any as AttachmentDoc[];
	},

	async getById(id) {
		return (await (await getHomeThingsCollection()).findOne(attachmentMatch(id) as any)) as any as AttachmentDoc | null;
	},

	async listForTarget(ownerId, targetId) {
		return (await (
			await getHomeThingsCollection()
		)
			.find({ ownerId, targetId, thingtime: ATTACHMENT_THINGTIME } as any)
			.sort({ createdAt: 1, shareId: 1 })
			.toArray()) as any as AttachmentDoc[];
	},

	async claimFinalizing(ownerId, id, leaseId) {
		if (!isAttachmentFinalizationLeaseId(leaseId)) {
			throw new AttachmentStoreConflictError('Invalid finalization lease');
		}
		const things = await getHomeThingsCollection();
		const now = new Date();
		const claimed = (await things.findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				attachmentState: 'pending',
				targetId: { $exists: false },
				attachmentExpiresAt: { $gt: now },
				uploadId: { $type: 'string' }
			} as any,
			{ $set: { attachmentState: 'finalizing', attachmentFinalizationLeaseId: leaseId, updatedAt: now } },
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
		if (claimed) return { doc: claimed, acquired: true };
		const ready = (await things.findOne({
			...attachmentMatch(id),
			ownerId,
			attachmentState: 'ready'
		} as any)) as any as AttachmentDoc | null;
		if (ready) return { doc: ready, acquired: false };

		const reclaimed = (await things.findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				targetId: { $exists: false },
				attachmentState: 'finalizing',
				updatedAt: { $lte: new Date(now.getTime() - ATTACHMENT_FINALIZATION_LEASE_MS) }
			} as any,
			{ $set: { attachmentFinalizationLeaseId: leaseId, updatedAt: now } },
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
		if (reclaimed) return { doc: reclaimed, acquired: true };

		const inProgress = (await things.findOne({
			...attachmentMatch(id),
			ownerId,
			attachmentState: 'finalizing'
		} as any)) as any as AttachmentDoc | null;
		return inProgress ? { doc: inProgress, acquired: false } : null;
	},

	async renewFinalizing(ownerId, id, leaseId) {
		if (!isAttachmentFinalizationLeaseId(leaseId)) return null;
		return (await (
			await getHomeThingsCollection()
		).findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				targetId: { $exists: false },
				attachmentState: 'finalizing',
				attachmentFinalizationLeaseId: leaseId
			} as any,
			{ $set: { updatedAt: new Date() } },
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
	},

	async revertFinalizing(ownerId, id, leaseId) {
		return (await (
			await getHomeThingsCollection()
		).findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				targetId: { $exists: false },
				attachmentState: 'finalizing',
				objectVersionId: { $exists: false },
				attachmentFinalizationLeaseId: leaseId
			} as any,
			{
				$set: { attachmentState: 'pending', updatedAt: new Date() },
				$unset: { attachmentFinalizationLeaseId: '' }
			},
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
	},

	async markReady(ownerId, id, crystal, objectVersionId, expiresAt, leaseId) {
		if (!isAttachmentObjectVersionId(objectVersionId)) throw new AttachmentStoreConflictError('Invalid object version');
		if (!isAttachmentFinalizationLeaseId(leaseId)) throw new AttachmentStoreConflictError('Invalid finalization lease');
		return withHomeMongoTransaction(async (session) => {
			const things = await getHomeThingsCollection();
			const before = (await things.findOne({ ...attachmentMatch(id), ownerId } as any, { session })) as any as AttachmentDoc | null;
			if (!before) throw new AttachmentStoreConflictError('Attachment not found');
			if (before.attachmentState === 'ready') {
				if (before.objectVersionId === objectVersionId) return before;
				throw new AttachmentStoreConflictError('Attachment object version changed');
			}
			if (before.attachmentState !== 'finalizing' || before.attachmentFinalizationLeaseId !== leaseId) {
				throw new AttachmentStoreConflictError();
			}

			const next = {
				...before,
				crystal,
				objectVersionId,
				attachmentState: 'ready' as const,
				// Quarantine every newly durable object until analysis either clears/
				// flags it or deliberately marks it skipped. This lands before complete
				// returns, so a fast bind cannot expose unscreened bytes during outage.
				moderation: { status: 'pending' as const },
				attachmentExpiresAt: expiresAt,
				updatedAt: new Date()
			};
			delete next.uploadId;
			delete next.attachmentFinalizationLeaseId;
			delete next.attachmentPartsIssuedAt;
			const nextSize = thingStorageSizeBytes(next);
			const deltaBytes = nextSize - canonicalStoredBytes(before);
			await applyUserStorageDelta(ownerId, deltaBytes, session);

			const write = await things.updateOne(
				{
					_id: before._id,
					ownerId,
					attachmentState: 'finalizing',
					attachmentFinalizationLeaseId: leaseId,
					updatedAt: before.updatedAt,
					sizeBytes: before.sizeBytes
				} as any,
				{
					$set: {
						crystal,
						objectVersionId,
						attachmentState: 'ready',
						moderation: { status: 'pending' },
						attachmentExpiresAt: expiresAt,
						sizeBytes: nextSize,
						updatedAt: next.updatedAt
					},
					$unset: { uploadId: '', attachmentFinalizationLeaseId: '', attachmentPartsIssuedAt: '' }
				},
				{ session }
			);
			if (!write.matchedCount) throw new AttachmentStoreConflictError();
			return { ...next, sizeBytes: nextSize };
		});
	},

	async setObjectVersionId(ownerId, id, objectVersionId) {
		if (!isAttachmentObjectVersionId(objectVersionId)) throw new AttachmentStoreConflictError('Invalid object version');
		return withHomeMongoTransaction(async (session) => {
			const things = await getHomeThingsCollection();
			const before = (await things.findOne({ ...attachmentMatch(id), ownerId } as any, { session })) as any as AttachmentDoc | null;
			if (!before) throw new AttachmentStoreConflictError('Attachment not found');
			if (before.objectVersionId === objectVersionId) return before;
			if (before.objectVersionId) throw new AttachmentStoreConflictError('Attachment object version changed');

			const next = { ...before, objectVersionId, updatedAt: new Date() };
			delete next.attachmentObjectlessDelete;
			const nextSize = thingStorageSizeBytes(next);
			const deltaBytes = nextSize - canonicalStoredBytes(before);
			await applyUserStorageDelta(ownerId, deltaBytes, session);
			const write = await things.updateOne(
				{
					_id: before._id,
					ownerId,
					objectVersionId: { $exists: false },
					updatedAt: before.updatedAt,
					sizeBytes: before.sizeBytes
				} as any,
				{
					$set: { objectVersionId, sizeBytes: nextSize, updatedAt: next.updatedAt },
					$unset: { attachmentObjectlessDelete: '' }
				},
				{ session }
			);
			if (!write.matchedCount) throw new AttachmentStoreConflictError();
			return { ...next, sizeBytes: nextSize };
		});
	},

	async claimObjectlessPendingDeleting(ownerId, id, scope) {
		const things = await getHomeThingsCollection();
		const now = new Date();
		const claimed = (await things.findOneAndUpdate(
			{
				...attachmentMatch(id),
				ownerId,
				...attachmentObjectlessPendingDeleteFence(scope)
			} as any,
			{
				$set: {
					attachmentState: 'deleting',
					attachmentObjectlessDelete: true,
					attachmentExpiresAt: attachmentDeletingRetryAt(now),
					updatedAt: now
				}
			},
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
		if (claimed) return claimed;
		return (await things.findOne({
			...attachmentMatch(id),
			ownerId,
			...attachmentDeleteClaimFence(scope),
			attachmentState: 'deleting',
			attachmentObjectlessDelete: true,
			uploadId: { $exists: false },
			objectVersionId: { $exists: false }
		} as any)) as any as AttachmentDoc | null;
	},

	async claimDeleting(ownerId, id, allowedStates, scope) {
		const things = await getHomeThingsCollection();
		const fence = attachmentDeleteClaimFence(scope);
		const now = new Date();
		const ordinaryStates = allowedStates.filter((state) => state !== 'deleting' && state !== 'finalizing');
		const stateClauses: Record<string, unknown>[] = ordinaryStates.length ? [{ attachmentState: { $in: ordinaryStates } }] : [];
		if (allowedStates.includes('finalizing') && scope.kind === 'draft' && scope.finalizingUpdatedAtOrBefore) {
			stateClauses.push({
				attachmentState: 'finalizing',
				updatedAt: { $lte: scope.finalizingUpdatedAtOrBefore }
			});
		}
		const claimed = stateClauses.length
			? ((await things.findOneAndUpdate(
					{
						...attachmentMatch(id),
						ownerId,
						...fence,
						$or: stateClauses
					} as any,
					[
						{
							$set: {
								attachmentState: 'deleting',
								attachmentExpiresAt: {
									$cond: [{ $eq: [{ $type: '$attachmentPartsIssuedAt' }, 'date'] }, attachmentMpuSettlementAt(now), attachmentDeletingRetryAt(now)]
								},
								updatedAt: now
							}
						},
						{ $unset: 'attachmentFinalizationLeaseId' }
					],
					{ returnDocument: 'after' }
			  )) as any as AttachmentDoc | null)
			: null;
		if (claimed) return claimed;
		if (!allowedStates.includes('deleting')) return null;
		return (await things.findOne({
			...attachmentMatch(id),
			ownerId,
			...fence,
			attachmentState: 'deleting'
		} as any)) as any as AttachmentDoc | null;
	},

	async removeDeleting(ownerId, id) {
		return withHomeMongoTransaction(async (session) => {
			const things = await getHomeThingsCollection();
			const removed = (await things.findOneAndDelete({ ...attachmentMatch(id), ownerId, attachmentState: 'deleting' } as any, {
				session
			})) as any as AttachmentDoc | null;
			if (!removed) return false;
			const bytes = currentContentStorageSizeBytes(removed);
			if (bytes === null) {
				await markUserStorageNeedsReconcile(ownerId, session);
			} else {
				await applyUserStorageDelta(ownerId, -bytes, session);
			}
			return true;
		});
	},

	async recordMpuCleanupVerification(ownerId, id, emptyVerifiedAt, retryAt, partsIssuedAt) {
		await (
			await getHomeThingsCollection()
		).updateOne(
			{
				...attachmentMatch(id),
				ownerId,
				attachmentState: 'deleting',
				uploadId: { $type: 'string' }
			} as any,
			{
				$set: {
					attachmentExpiresAt: retryAt,
					updatedAt: new Date(),
					...(partsIssuedAt ? { attachmentPartsIssuedAt: partsIssuedAt } : {}),
					...(emptyVerifiedAt ? { attachmentMpuEmptyVerifiedAt: emptyVerifiedAt } : {})
				},
				...(emptyVerifiedAt ? {} : { $unset: { attachmentMpuEmptyVerifiedAt: '' } })
			}
		);
	},

	async deferDeletingRetry(ownerId, id, retryAt) {
		await (
			await getHomeThingsCollection()
		).updateOne({ ...attachmentMatch(id), ownerId, attachmentState: 'deleting' } as any, attachmentDeletingRetryUpdate(retryAt));
	},

	async listUnboundOwned(ownerId, limit) {
		return (await (
			await getHomeThingsCollection()
		)
			.find({
				ownerId,
				thingtime: ATTACHMENT_THINGTIME,
				targetId: { $exists: false },
				attachmentState: { $in: ['pending', 'ready', 'deleting'] }
			} as any)
			.sort({ createdAt: 1, shareId: 1 })
			.limit(Math.max(1, Math.min(26, Math.floor(limit))))
			.toArray()) as any as AttachmentDoc[];
	},

	async listExpiredOwned(ownerId, limit) {
		const now = new Date();
		const finalizingBefore = new Date(now.getTime() - ATTACHMENT_FINALIZING_DELETE_GRACE_MS);
		return (await (
			await getHomeThingsCollection()
		)
			.find(expiredAttachmentDraftFilter(now, ownerId, finalizingBefore) as any)
			.sort({ attachmentExpiresAt: 1, shareId: 1 })
			.limit(Math.max(1, Math.min(10, Math.floor(limit))))
			.toArray()) as any as AttachmentDoc[];
	},

	async listExpired(limit, expiredAtOrBefore) {
		const finalizingBefore = new Date(expiredAtOrBefore.getTime() - ATTACHMENT_FINALIZING_DELETE_GRACE_MS);
		return (await (
			await getHomeThingsCollection()
		)
			.find(expiredAttachmentDraftFilter(expiredAtOrBefore, undefined, finalizingBefore) as any)
			.sort({ attachmentExpiresAt: 1, shareId: 1 })
			.limit(Math.max(1, Math.min(1001, Math.floor(limit))))
			.toArray()) as any as AttachmentDoc[];
	},

	// Ready rows finalized before server-side magic-byte detection existed:
	// opaque contentType with no sniffed label. shareId-ordered so a caller can
	// resume with the last id it saw even when a pass writes nothing (dry run,
	// undetectable bytes).
	async listReadyUndetected(limit, afterId) {
		return (await (
			await getHomeThingsCollection()
		)
			.find({
				thingtime: ATTACHMENT_THINGTIME,
				attachmentState: 'ready',
				'crystal.contentType': 'application/octet-stream',
				'crystal.detectedContentType': { $exists: false },
				...(afterId ? { shareId: { $gt: afterId } } : {})
			} as any)
			.sort({ shareId: 1 })
			.limit(Math.max(1, Math.min(1001, Math.floor(limit))))
			.toArray()) as any as AttachmentDoc[];
	},

	// Publish a re-detected crystal on an already-ready row. Only detection
	// metadata may change: name and size are immutable here so the object-byte
	// side of storage accounting cannot move, while the row's JSON payload delta
	// is still settled through the same transactional ledger markReady uses. The
	// write is fenced to the exact object version the caller detected against —
	// a concurrent delete, re-finalize, or version swap loses cleanly.
	async upgradeReadyCrystal(id, crystal, expectedObjectVersionId) {
		if (!isAttachmentObjectVersionId(expectedObjectVersionId)) throw new AttachmentStoreConflictError('Invalid object version');
		return withHomeMongoTransaction(async (session) => {
			const things = await getHomeThingsCollection();
			const before = (await things.findOne(attachmentMatch(id) as any, { session })) as any as AttachmentDoc | null;
			if (!before) throw new AttachmentStoreConflictError('Attachment not found');
			if (before.attachmentState !== 'ready') throw new AttachmentStoreConflictError('Attachment is not ready');
			if (before.objectVersionId !== expectedObjectVersionId) throw new AttachmentStoreConflictError('Attachment object version changed');
			if (before.crystal.name !== crystal.name || before.crystal.size !== crystal.size) {
				throw new AttachmentStoreConflictError('Attachment name and size cannot change during a crystal upgrade');
			}
			if (isDeepStrictEqual(before.crystal, crystal)) return before;

			const next = { ...before, crystal, updatedAt: new Date() };
			const nextSize = thingStorageSizeBytes(next);
			const deltaBytes = nextSize - canonicalStoredBytes(before);
			await applyUserStorageDelta(before.ownerId, deltaBytes, session);
			const write = await things.updateOne(
				{
					_id: before._id,
					ownerId: before.ownerId,
					attachmentState: 'ready',
					objectVersionId: expectedObjectVersionId,
					updatedAt: before.updatedAt,
					sizeBytes: before.sizeBytes
				} as any,
				{ $set: { crystal, sizeBytes: nextSize, updatedAt: next.updatedAt } },
				{ session }
			);
			if (!write.matchedCount) throw new AttachmentStoreConflictError();
			return { ...next, sizeBytes: nextSize };
		});
	}
};

type BindableAttachmentPurpose = Exclude<AttachmentPurpose, 'profile'>;

const attachmentPurposeLabel: Record<BindableAttachmentPurpose, string> = {
	post: 'post',
	comment: 'comment',
	message: 'message',
	emoji: 'custom emoji'
};

// Called by each content writer inside the SAME home-Mongo transaction as its
// target creation. This is the only supported transition from a private,
// unbound object to a relational child. Purpose is immutable: an upload plan
// minted for a DM cannot be replayed into a public post or custom emoji.
const bindReadyAttachmentsForPurpose = async (
	ownerId: string,
	attachmentIds: readonly string[],
	targetId: string,
	session: any,
	purpose: BindableAttachmentPurpose,
	maxAttachments = MAX_ATTACHMENTS_PER_TARGET
): Promise<void> => {
	if (isCustomMongoEndpointActive()) {
		throw new AttachmentBindingError(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
	}
	const ids = [
		...new Set(
			attachmentIds
				.map(String)
				.map((id) => id.trim())
				.filter(Boolean)
		)
	];
	if (ids.length !== attachmentIds.length || ids.length > maxAttachments) {
		throw new AttachmentBindingError(
			400,
			`A ${attachmentPurposeLabel[purpose]} can contain at most ${maxAttachments} unique attachment${maxAttachments === 1 ? '' : 's'}`
		);
	}
	if (!ids.length) return;
	if (!targetId.trim()) throw new AttachmentBindingError(400, 'Attachment target is required');

	const things = await getHomeThingsCollection();
	const now = new Date();
	const purposeFence =
		purpose === 'post' ? { $or: [{ attachmentPurpose: 'post' }, { attachmentPurpose: { $exists: false } }] } : { attachmentPurpose: purpose };
	const candidates = (await things
		.find(
			{
				shareId: { $in: ids },
				ownerId,
				thingtime: ATTACHMENT_THINGTIME,
				attachmentState: 'ready',
				$and: [
					purposeFence,
					{ attachmentProfileSlot: { $exists: false } },
					{
				$or: [
					{ targetId, attachmentExpiresAt: { $exists: false } },
					{ targetId: { $exists: false }, attachmentExpiresAt: { $gt: now } }
				]
					}
				]
			} as any,
			{ session, projection: { shareId: 1, targetId: 1 } }
		)
		.toArray()) as Array<{ shareId: string; targetId?: string }>;

	if (candidates.length !== ids.length || candidates.some((attachment) => attachment.targetId && attachment.targetId !== targetId)) {
		throw new AttachmentBindingError(409, 'One or more attachments are unavailable or already attached');
	}

	// One update per id so each doc gets its list position stamped — the id
	// order the client sent IS the display order the target renders.
	const write = await things.bulkWrite(
		ids.map((id, index) => ({
			updateOne: {
				filter: {
					shareId: id,
					ownerId,
					thingtime: ATTACHMENT_THINGTIME,
					attachmentState: 'ready',
					$and: [
						purposeFence,
						{ attachmentProfileSlot: { $exists: false } },
						{
							$or: [
								{ targetId, attachmentExpiresAt: { $exists: false } },
								{ targetId: { $exists: false }, attachmentExpiresAt: { $gt: now } }
							]
						}
					]
				},
				update: {
					$set: { targetId, acl: [ACL_INHERIT], attachmentPurpose: purpose, attachmentSortIndex: index, updatedAt: now },
					$unset: { attachmentExpiresAt: '', attachmentProfileSlot: '' }
				}
			}
		})) as any,
		{ session, ordered: true }
	);
	if (write.matchedCount !== ids.length) {
		throw new AttachmentBindingError(409, `One or more attachments changed while the ${attachmentPurposeLabel[purpose]} was being created`);
	}
};

// Owner-authored display metadata on a READY attachment. Ready-only on
// purpose: finalize (markReady) rebuilds the crystal from the verified S3
// object, so annotating an in-flight upload would be silently clobbered.
// Crystal bytes change, so the delta rides the same exact-accounting
// transaction markReady uses.
export const annotateOwnedAttachment = async (ownerId: string, id: string, patch: AttachmentAnnotationPatch): Promise<AttachmentDoc> =>
	withHomeMongoTransaction(async (session) => {
		const things = await getHomeThingsCollection();
		const before = (await things.findOne({ ...attachmentMatch(id), ownerId } as any, { session })) as any as AttachmentDoc | null;
		if (!before) throw new AttachmentBindingError(404, 'Attachment not found');
		if (before.attachmentState !== 'ready') {
			throw new AttachmentBindingError(409, 'This file is still uploading — try again once it is ready');
		}

		const annotated = applyAttachmentAnnotationPatch(before.crystal, patch);
		if (annotated.ok === false) throw new AttachmentBindingError(400, annotated.error);
		const nextCrystal: AttachmentCrystal = annotated.crystal;
		if (
			nextCrystal.filenamePreview === before.crystal.filenamePreview &&
			nextCrystal.title === before.crystal.title &&
			nextCrystal.description === before.crystal.description &&
			nextCrystal.name === before.crystal.name
		) {
			return before;
		}

		const next: AttachmentDoc = { ...before, crystal: nextCrystal, updatedAt: new Date() };
		const nextSize = thingStorageSizeBytes(next);
		const deltaBytes = nextSize - canonicalStoredBytes(before);
		if (deltaBytes !== 0) await applyUserStorageDelta(ownerId, deltaBytes, session);

		const write = await things.updateOne(
			{
				_id: before._id,
				ownerId,
				attachmentState: 'ready',
				updatedAt: before.updatedAt,
				sizeBytes: before.sizeBytes
			} as any,
			{ $set: { crystal: nextCrystal, sizeBytes: nextSize, updatedAt: next.updatedAt } },
			{ session }
		);
		if (write.matchedCount !== 1) {
			throw new AttachmentBindingError(409, 'Attachment changed while it was being updated — try again');
		}
		return { ...next, sizeBytes: nextSize };
	});

// Re-stamp the display order of the ready attachments already bound to one
// target. The requested list must be a pure permutation of the bound set —
// planAttachmentReorder rejects everything else, so a stale client can never
// half-apply an order after the post's attachments changed.
export const reorderBoundTargetAttachments = async (ownerId: string, targetId: string, requestedIds: readonly unknown[]): Promise<void> => {
	if (isCustomMongoEndpointActive()) {
		throw new AttachmentBindingError(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
	}
	if (!targetId.trim()) throw new AttachmentBindingError(400, 'Attachment target is required');
	const things = await getHomeThingsCollection();
	const fence = { ownerId, thingtime: ATTACHMENT_THINGTIME, attachmentState: 'ready', targetId };
	const bound = (await things.find(fence as any, { projection: { shareId: 1 } }).toArray()) as Array<{ shareId: string }>;
	const plan = planAttachmentReorder(
		requestedIds,
		bound.map((doc) => String(doc.shareId)),
		MAX_ATTACHMENTS_PER_TARGET
	);
	if (plan.ok === false) throw new AttachmentBindingError(plan.status, plan.error);
	if (!plan.orderedIds.length) return;
	const now = new Date();
	const write = await things.bulkWrite(
		plan.orderedIds.map((shareId, index) => ({
			updateOne: { filter: { ...fence, shareId }, update: { $set: { attachmentSortIndex: index, updatedAt: now } } }
		})) as any,
		{ ordered: true }
	);
	if (write.matchedCount !== plan.orderedIds.length) {
		throw new AttachmentBindingError(409, 'The attachments on this post changed — refresh and reorder again');
	}
};

// PATCH-time attachment sync: re-stamp display order AND bind any newly
// uploaded/linked ready drafts into an existing post/rich comment the owner
// is editing. The requested list is the full desired order — it must cover
// every VISIBLE bound id (planAttachmentSync rejects removals) and may append
// unbound ready drafts, which bindReadyAttachmentsForPurpose claims with the
// same fences create-time binding uses. Bound docs the projection HIDES
// (moderation pending the client predates, blocked) are exempt from the cover
// requirement — the client can never have seen them — and are re-stamped
// after the requested list so their binding and relative order survive the
// save. The target must be an owned post-family thing: binding to an
// arbitrary target id would let an edit deface another owner's thread with
// the editor's own inherit-acl media.
export const syncBoundTargetAttachments = async (ownerId: string, targetId: string, requestedIds: readonly unknown[]): Promise<void> => {
	if (isCustomMongoEndpointActive()) {
		throw new AttachmentBindingError(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
	}
	if (!targetId.trim()) throw new AttachmentBindingError(400, 'Attachment target is required');
	const things = await getHomeThingsCollection();
	// post-family only (posts, rich AND plain comments) — message, emoji and
	// profile targets keep their dedicated purpose-bound routes
	const target = (await things.findOne({ shareId: targetId, ownerId, thingtime: { $in: ['post', 'comment'] } } as any, {
		projection: { shareId: 1, thingtime: 1 }
	})) as { shareId: string; thingtime?: unknown } | null;
	if (!target) throw new AttachmentBindingError(404, 'Post not found');
	const bound = (await things
		.find({ ownerId, thingtime: ATTACHMENT_THINGTIME, attachmentState: 'ready', targetId } as any, {
			projection: { shareId: 1, moderation: 1, attachmentSortIndex: 1 }
		})
		.toArray()) as Array<{ shareId: string; moderation?: unknown; attachmentSortIndex?: unknown }>;
	const hiddenBound = bound
		.filter((doc) => attachmentModerationHidesFromPublic(doc.moderation))
		.sort((left, right) => attachmentStoredSortValue(left.attachmentSortIndex) - attachmentStoredSortValue(right.attachmentSortIndex));
	const plan = planAttachmentSync(
		requestedIds,
		bound.map((doc) => String(doc.shareId)),
		hiddenBound.map((doc) => String(doc.shareId)),
		MAX_ATTACHMENTS_PER_TARGET
	);
	if (plan.ok === false) throw new AttachmentBindingError(plan.status, plan.error);
	if (!plan.orderedIds.length && !plan.hiddenTrailingIds.length) return;
	const purpose: BindableAttachmentPurpose = Array.isArray(target.thingtime) && target.thingtime.includes('comment') ? 'comment' : 'post';
	await withHomeMongoTransaction(async (session) => {
		if (plan.orderedIds.length) {
			await bindReadyAttachmentsForPurpose(ownerId, plan.orderedIds, targetId, session, purpose);
		}
		if (plan.hiddenTrailingIds.length) {
			const now = new Date();
			const write = await things.bulkWrite(
				plan.hiddenTrailingIds.map((shareId, index) => ({
					updateOne: {
						filter: { ownerId, thingtime: ATTACHMENT_THINGTIME, attachmentState: 'ready', targetId, shareId },
						update: { $set: { attachmentSortIndex: plan.orderedIds.length + index, updatedAt: now } }
					}
				})) as any,
				{ session, ordered: true }
			);
			if (write.matchedCount !== plan.hiddenTrailingIds.length) {
				throw new AttachmentBindingError(409, 'The attachments on this post changed — refresh and try again');
			}
		}
	});
};

export const bindReadyAttachmentsToTarget = async (
	ownerId: string,
	attachmentIds: readonly string[],
	targetId: string,
	session: any
): Promise<void> => bindReadyAttachmentsForPurpose(ownerId, attachmentIds, targetId, session, 'post');

export const bindReadyCommentAttachmentsToTarget = async (
	ownerId: string,
	attachmentIds: readonly string[],
	targetId: string,
	session: any
): Promise<void> => bindReadyAttachmentsForPurpose(ownerId, attachmentIds, targetId, session, 'comment');

export const bindReadyMessageAttachmentsToTarget = async (
	ownerId: string,
	attachmentIds: readonly string[],
	targetId: string,
	session: any
): Promise<void> => bindReadyAttachmentsForPurpose(ownerId, attachmentIds, targetId, session, 'message');

export const bindReadyEmojiAttachmentToTarget = async (
	ownerId: string,
	attachmentIds: readonly string[],
	targetId: string,
	session: any
): Promise<void> => bindReadyAttachmentsForPurpose(ownerId, attachmentIds, targetId, session, 'emoji', 1);

export type ProfileAttachmentRefs = Record<ProfileAttachmentSlot, string | null>;

const exactAcl = (value: unknown, expected: string): boolean => Array.isArray(value) && value.length === 1 && value[0] === expected;

export const isBindableProfileAttachment = (
	doc: AttachmentDoc | null | undefined,
	ownerId: string,
	targetId: string,
	slot: ProfileAttachmentSlot,
	now: Date
): boolean => {
	if (
		!doc ||
		doc.ownerId !== ownerId ||
		ownerId !== targetId ||
		doc.attachmentState !== 'ready' ||
		doc.attachmentPurpose !== 'profile' ||
		doc.attachmentProfileSlot !== slot ||
		doc.crystal.mediaKind !== 'image' ||
		!PROFILE_ATTACHMENT_CONTENT_TYPES.has(doc.crystal.contentType) ||
		doc.crystal.size !== doc.objectSizeBytes ||
		doc.objectSizeBytes < 1 ||
		doc.objectSizeBytes > MAX_PROFILE_ATTACHMENT_BYTES ||
		!isAttachmentObjectVersionId(doc.objectVersionId)
	) {
		return false;
	}

	if (doc.targetId === targetId) {
		return doc.attachmentExpiresAt === undefined && exactAcl(doc.acl, ACL_INHERIT);
	}
	return doc.targetId === undefined && doc.attachmentExpiresAt instanceof Date && doc.attachmentExpiresAt > now && exactAcl(doc.acl, ACL_OWNER);
};

type ProfileAttachmentReconcilerDependencies = {
	getThings: typeof getHomeThingsCollection;
};

export const createProfileAttachmentReconciler = (overrides: Partial<ProfileAttachmentReconcilerDependencies> = {}) => {
	const dependencies: ProfileAttachmentReconcilerDependencies = {
		getThings: getHomeThingsCollection,
		...overrides
	};

	return async (input: {
		ownerId: string;
		targetId: string;
		current: ProfileAttachmentRefs;
		desired: ProfileAttachmentRefs;
		now: Date;
		session: any;
	}): Promise<void> => {
		const { ownerId, targetId, current, desired, now, session } = input;
		if (!ownerId || ownerId !== targetId) {
			throw new AttachmentBindingError(409, 'Profile attachments must belong to the profile owner');
		}
		if (desired.avatar && desired.avatar === desired.banner) {
			throw new AttachmentBindingError(400, 'Avatar and banner must use different attachments');
		}

		const ids = [...new Set([...Object.values(current), ...Object.values(desired)].filter((id): id is string => !!id))];
		if (!ids.length) return;
		const things = await dependencies.getThings();
		const docs = (await things
			.find({ shareId: { $in: ids }, ownerId, thingtime: ATTACHMENT_THINGTIME } as any, { session })
			.toArray()) as AttachmentDoc[];
		const byId = new Map(docs.map((doc) => [doc.shareId, doc]));

		for (const slot of ['avatar', 'banner'] as const) {
			const id = desired[slot];
			if (!id) continue;
			const doc = byId.get(id);
			if (!isBindableProfileAttachment(doc, ownerId, targetId, slot, now)) {
				throw new AttachmentBindingError(409, `The selected ${slot} attachment is unavailable`);
			}
		}

		for (const slot of ['avatar', 'banner'] as const) {
			const id = desired[slot];
			if (!id) continue;
			const before = byId.get(id)!;
			const identity = before._id === undefined ? { shareId: before.shareId } : { _id: before._id };
			const write = await things.updateOne(
				{
					...identity,
					ownerId,
					thingtime: ATTACHMENT_THINGTIME,
					attachmentState: 'ready',
					attachmentPurpose: 'profile',
					attachmentProfileSlot: slot,
					updatedAt: before.updatedAt,
					$or: [
						{ targetId, attachmentExpiresAt: { $exists: false }, acl: [ACL_INHERIT] },
						{ targetId: { $exists: false }, attachmentExpiresAt: { $gt: now }, acl: [ACL_OWNER] }
					]
				} as any,
				{
					$set: {
						targetId,
						acl: [ACL_INHERIT],
						attachmentPurpose: 'profile',
						attachmentProfileSlot: slot,
						updatedAt: now
					},
					$unset: { attachmentExpiresAt: '' }
				},
				{ session }
			);
			if (write.matchedCount !== 1) {
				throw new AttachmentBindingError(409, `The selected ${slot} attachment changed while the profile was being updated`);
			}
		}

		const desiredIds = new Set(Object.values(desired).filter((id): id is string => !!id));
		const released = new Set<string>();
		for (const slot of ['avatar', 'banner'] as const) {
			const id = current[slot];
			if (!id || desiredIds.has(id) || released.has(id)) continue;
			released.add(id);
			const before = byId.get(id);
			// A missing object row is already inaccessible and carries no storage row
			// to release. Clear the stale user reference without touching another row.
			if (!before) continue;
			if (
				before.ownerId !== ownerId ||
				before.targetId !== targetId ||
				before.attachmentState !== 'ready' ||
				before.attachmentPurpose !== 'profile' ||
				before.attachmentProfileSlot !== slot ||
				!exactAcl(before.acl, ACL_INHERIT)
			) {
				throw new AttachmentBindingError(409, `The current ${slot} attachment cannot be safely released`);
			}
			const identity = before._id === undefined ? { shareId: before.shareId } : { _id: before._id };
			const write = await things.updateOne(
				{
					...identity,
					ownerId,
					targetId,
					thingtime: ATTACHMENT_THINGTIME,
					attachmentState: 'ready',
					attachmentPurpose: 'profile',
					attachmentProfileSlot: slot,
					acl: [ACL_INHERIT],
					updatedAt: before.updatedAt
				} as any,
				{
					$set: { acl: [ACL_OWNER], attachmentExpiresAt: now, updatedAt: now },
					$unset: { targetId: '' }
				},
				{ session }
			);
			if (write.matchedCount !== 1) {
				throw new AttachmentBindingError(409, `The current ${slot} attachment changed while the profile was being updated`);
			}
		}
	};
};

export const reconcileReadyProfileAttachmentsToUser = createProfileAttachmentReconciler();
