import { attachmentBlobId, sameAttachmentBlobFingerprint, type AttachmentBlobData } from './attachmentBlobs';
import { randomUUID } from 'node:crypto';
import { validContentFingerprint, type ContentFingerprint } from '../../../fileSync/contentFingerprint';
import { parseFileSyncUploadOrigin, sameFileSyncUploadOrigin, type FileSyncUploadOrigin } from '../../../fileSync/uploadOrigin';
import { ownedMediaDraftIds } from '../drafts/media';
import { MAX_POST_ATTACHMENTS, attachmentCountLimit } from '../../../schemas/attachmentLimits';
import { isDeepStrictEqual } from 'node:util';
import { isDurableRecordingUpload, prepareRecordingImport } from './recordingImportCore';

import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore';
import { applyUserStorageDelta, markUserStorageNeedsReconcile } from '../storage/userStorage';
import { ACL_INHERIT, ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import {
	ATTACHMENT_ENVELOPE_VERSION,
  ATTACHMENT_BLOB_THINGTIME,
  EMPTY_ATTACHMENT_PURPOSES,
  attachmentPurposeAllowsEmpty,
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
	type AttachmentBlobRef,
	type AttachmentPurpose,
	type ProfileAttachmentSlot,
	type AttachmentState
} from './attachmentCore';

export { MAX_ATTACHMENTS_PER_TARGET } from '../../../schemas/attachmentLimits';
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
	folderId?: string;
	tags: [];
	storageClass: 'content';
	storageAccountingVersion: number;
	sizeBytes: number;
	attachmentEnvelopeVersion: typeof ATTACHMENT_ENVELOPE_VERSION;
	attachmentState: AttachmentState;
	objectSizeBytes: number;
	objectKey: string;
	objectVersionId?: string;
	attachmentExpectedFingerprint?: ContentFingerprint;
	attachmentBlob?: AttachmentBlobRef;
	// Null retains the billed old generation until a postcommit pass starts its URL drain.
	attachmentRedundantDeleteAfter?: Date | null;
	attachmentRequestFingerprint?: string;
	attachmentFileSyncOrigin?: FileSyncUploadOrigin;
	// Canonical scoped publication records the verified native source separately from reservation input.
	fileSyncSourceGrant?: { localRootId: string; grantRevision: string };
	attachmentPurpose?: AttachmentPurpose;
	// Protected password adapter relation, retained without secrets on cleanup.
	passwordFileParent?: string;
	// Server-only import lifecycle marker; never copied from portable content.
	attachmentImportDraft?: true;
	attachmentProfileSlot?: ProfileAttachmentSlot;
	attachmentFinalizationLeaseId?: string;
	attachmentPartsIssuedAt?: Date;
	attachmentObjectlessDelete?: true;
	attachmentCancellationRequested?: true;
	attachmentMpuEmptyVerifiedAt?: Date;
	uploadId?: string;
	attachmentExpiresAt?: Date;
	attachmentRetainUntil?: Date;
	attachmentRetentionClosed?: true;
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
	};
	createdAt: Date;
	updatedAt: Date;
};

type PendingInput = {
	fileSyncOrigin?: FileSyncUploadOrigin;
	expectedFingerprint?: ContentFingerprint;
	id: string;
	ownerId: string;
	crystal: AttachmentCrystal;
	objectKey: string;
	requestFingerprint: string;
	purpose: AttachmentPurpose;
	recordingImportDraft?: true;
	profileSlot?: ProfileAttachmentSlot;
	expiresAt: Date;
};

type LinkedReadyInput = {
	id: string;
	ownerId: string;
	crystal: AttachmentCrystal;
	purpose: AttachmentPurpose;
	expiresAt: Date;
	requestFingerprint?: string;
};

// Only server-minted request identities retain a replay fence after linked
// draft expiry, ordinary deletion, or parent cascade. Legacy random-ID links
// keep their existing lifecycle.
export const isIdempotentLinkedAttachment = (doc: AttachmentDoc): boolean =>
	doc.attachmentLinked === true && /^att_[a-f0-9]{64}$/.test(doc.shareId) &&
	/^[a-f0-9]{64}$/.test(doc.attachmentRequestFingerprint || '') &&
	(doc.attachmentPurpose === 'post' || doc.attachmentPurpose === 'comment');

export type AttachmentDeleteClaimScope = (
	| { kind: 'draft'; expiredAtOrBefore?: Date; finalizingUpdatedAtOrBefore?: Date; standalonePurpose?: 'file' | 'recording' }
	| { kind: 'target'; targetId: string }
) & { expectedUpdatedAt?: Date; retainCancellation?: true; contentPurpose?: 'post' | 'comment'; linkedRequestFingerprint?: string };
export type AttachmentDraftDeleteClaimScope = Extract<AttachmentDeleteClaimScope, { kind: 'draft' }>;

export const attachmentDeleteClaimFence = (scope: AttachmentDeleteClaimScope): Record<string, unknown> => {
	return {
		...(scope.kind === 'target' ? { targetId: scope.targetId } : {
			targetId: { $exists: false },
			...(scope.standalonePurpose ? {
				attachmentPurpose: scope.standalonePurpose, attachmentLinked: { $ne: true },
				attachmentImportDraft: { $ne: true }, attachmentProfileSlot: { $exists: false },
				// Ready import drafts are excluded; already-claimed deletion has
				// its own cleanup deadline and must remain retryable.
				$and: [{ $or: [{ attachmentState: 'deleting' }, { attachmentExpiresAt: { $exists: false } }] }]
			} : {}),
			...(scope.expiredAtOrBefore ? { attachmentExpiresAt: { $lte: scope.expiredAtOrBefore } } : {})
		}),
		...(scope.contentPurpose ? { attachmentPurpose: scope.contentPurpose,
			...(scope.linkedRequestFingerprint ? { attachmentLinked: true, attachmentRequestFingerprint: scope.linkedRequestFingerprint } : { attachmentLinked: { $ne: true } }),
			attachmentImportDraft: { $ne: true }, attachmentProfileSlot: { $exists: false } } : {}),
		...(scope.expectedUpdatedAt ? { updatedAt: scope.expectedUpdatedAt } : {})
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

export class AttachmentBlobBusyError extends Error {
  constructor() { super('Identical file bytes are still being stored or released. Retry the same request.'); this.name = 'AttachmentBlobBusyError'; }
}

const canonicalStoredBytes = (doc: Parameters<typeof currentContentStorageSizeBytes>[0]): number => {
	const bytes = currentContentStorageSizeBytes(doc);
	if (bytes === null) {
		throw new StorageMutationError(409, 'storage_conflict', 'This attachment requires the current storage migration before it can be changed');
	}
	return bytes;
};

const attachmentMatch = (id: string) => ({ shareId: id, thingtime: ATTACHMENT_THINGTIME });

const blobMatch = (ownerId: string, id: string) => ({ ownerId, shareId: id, thingtime: [ATTACHMENT_BLOB_THINGTIME] });
type BlobDoc = ReturnType<typeof blobMatch> & {
  _id?: unknown; objectSizeBytes: number; attachmentBlobData: AttachmentBlobData;
  schemaVersion: number; storageClass: 'content'; storageAccountingVersion: number; sizeBytes: number;
  crystal: Record<string, never>; extended: null; tags: []; acl: string[]; createdAt: Date; updatedAt: Date;
  detected?: Pick<AttachmentCrystal, 'contentType' | 'mediaKind' | 'detectedContentType'>;
};
const matchAttachedBlob = (blob: BlobDoc | null, attachment: AttachmentDoc): blob is BlobDoc =>
  !!blob && blob.ownerId === attachment.ownerId && blob.objectSizeBytes === attachment.objectSizeBytes &&
  blob.shareId === attachment.attachmentBlob?.id &&
  blob.attachmentBlobData.originAttachmentId === attachment.attachmentBlob?.objectAttachmentId &&
  blob.attachmentBlobData.objectVersionId === attachment.attachmentBlob?.objectVersionId &&
  canonicalStoredBytes(blob) === blob.objectSizeBytes;

export type AttachmentStore = {
	reservePending(input: PendingInput): Promise<AttachmentDoc>;
	reserveCancellation(ownerId: string, id: string): Promise<AttachmentDoc>;
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
		leaseId: string,
    verifiedFingerprint?: ContentFingerprint
	): Promise<AttachmentDoc>;
	setObjectVersionId(ownerId: string, id: string, objectVersionId: string): Promise<AttachmentDoc>;
	claimObjectlessPendingDeleting(ownerId: string, id: string, scope: AttachmentDraftDeleteClaimScope): Promise<AttachmentDoc | null>;
	claimDeleting(ownerId: string, id: string, allowedStates: AttachmentState[], scope: AttachmentDeleteClaimScope): Promise<AttachmentDoc | null>;
	prepareBlobDeletion?(ownerId: string, id: string): Promise<'deleted' | 'last' | 'skipped'>;
	removeDeleting(ownerId: string, id: string): Promise<boolean>;
	recordMpuCleanupVerification(ownerId: string, id: string, emptyVerifiedAt: Date | null, retryAt: Date, partsIssuedAt?: Date): Promise<void>;
	deferDeletingRetry(ownerId: string, id: string, retryAt: Date): Promise<void>;
	listBrowserDrafts(ownerId: string, limit: number): Promise<AttachmentDoc[]>;
	listExpiredOwned(ownerId: string, limit: number): Promise<AttachmentDoc[]>;
	listExpired(limit: number, expiredAtOrBefore: Date): Promise<AttachmentDoc[]>;
	listReadyUndetected(limit: number, afterId?: string): Promise<AttachmentDoc[]>;
	upgradeReadyCrystal(id: string, crystal: AttachmentCrystal, expectedObjectVersionId: string): Promise<AttachmentDoc>;
};

/** Resolve a maintenance candidate without exposing any locator to clients. */
export async function findVerifiedBlobCandidate(ownerId: string, size: number, fingerprint: ContentFingerprint): Promise<AttachmentBlobRef | null> {
  const id = attachmentBlobId(ownerId, size, fingerprint);
  const row = await (await getHomeThingsCollection()).findOne(blobMatch(ownerId, id)) as BlobDoc | null;
  if (!row || canonicalStoredBytes(row) !== size || row.attachmentBlobData.phase !== 'ready') return null;
  return { id, objectAttachmentId: row.attachmentBlobData.originAttachmentId, objectVersionId: row.attachmentBlobData.objectVersionId! };
}

/** Install a physical alias only after the maintenance caller checked the exact
 * original HEAD. The original logical locator and content version stay fixed. */
export const consolidateLegacySyncAttachment = async (
  observed: AttachmentDoc, fingerprint: ContentFingerprint, verifiedReplacement: AttachmentBlobRef | null, assertLease?: () => Promise<void>
): Promise<'adopted' | 'aliased' | 'skipped'> => {
  const { ownerId, shareId: id, objectSizeBytes: size, objectVersionId, objectKey } = observed;
  if (!validContentFingerprint(fingerprint, size) || !isAttachmentObjectVersionId(objectVersionId) ||
    objectKey !== 'objects/' + id || !observed.attachmentFileSyncOrigin || observed.attachmentBlob ||
    observed.attachmentPurpose !== 'file' || observed.attachmentState !== 'ready' || observed.attachmentImportDraft ||
    observed.attachmentLinked || observed.moderation?.status === 'blocked') return 'skipped';

  const attempt = () => withHomeMongoTransaction(async (session) => {
    const things = await getHomeThingsCollection();
    const fence = { ...attachmentMatch(id), ownerId, attachmentState: 'ready', attachmentPurpose: 'file',
      objectKey, objectVersionId, updatedAt: observed.updatedAt, sizeBytes: observed.sizeBytes, attachmentBlob: { $exists: false } };
    const before = await things.findOne(fence, { session }) as AttachmentDoc | null;
    if (!before) return 'skipped';
    const blobId = attachmentBlobId(ownerId, size, fingerprint);
    const filter = blobMatch(ownerId, blobId);
    const blob = await things.findOne(filter, { session }) as BlobDoc | null;
    const now = new Date();
    let attachmentBlob: AttachmentBlobRef;
    if (blob) {
      const data = blob.attachmentBlobData;
      if (canonicalStoredBytes(blob) !== size || data.phase !== 'ready' || data.references === Number.MAX_SAFE_INTEGER || !data.objectVersionId || data.originAttachmentId === id ||
        verifiedReplacement?.id !== blobId || verifiedReplacement.objectVersionId !== data.objectVersionId ||
        verifiedReplacement.objectAttachmentId !== data.originAttachmentId ||
        !sameAttachmentBlobFingerprint(fingerprint, data.fingerprint, size)) return 'skipped';
      attachmentBlob = { id: blobId, objectAttachmentId: data.originAttachmentId, objectVersionId: data.objectVersionId };
      const increased = await things.updateOne(filter, { $inc: { 'attachmentBlobData.references': 1 }, $set: { updatedAt: now } }, { session });
      if (increased.matchedCount !== 1) throw new AttachmentStoreConflictError();
    } else {
      if (verifiedReplacement) return 'skipped';
      attachmentBlob = { id: blobId, objectAttachmentId: id, objectVersionId };
      const data: AttachmentBlobData = { fingerprint, phase: 'ready', originAttachmentId: id, objectVersionId, references: 1 };
      const detected = { contentType: before.crystal.contentType, mediaKind: before.crystal.mediaKind,
        ...(before.crystal.detectedContentType ? { detectedContentType: before.crystal.detectedContentType } : {}) };
      const fresh: BlobDoc = { ...filter, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, storageClass: 'content',
        storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sizeBytes: size, objectSizeBytes: size, crystal: {},
        extended: null, tags: [], acl: [ACL_OWNER], createdAt: now, updatedAt: now, attachmentBlobData: data, detected };
      await things.insertOne(fresh as any, { session });
    }
    const changed = { attachmentBlob, attachmentExpectedFingerprint: fingerprint, ...(blob ? { attachmentRedundantDeleteAfter: null } : {}) };
    const sizeBytes = thingStorageSizeBytes({ ...before, ...changed });
    // Conversion is byte-neutral; a redundant object remains fully accounted
    // until the exact version is physically removed after URL expiry.
    if (sizeBytes + (blob ? 0 : size) !== canonicalStoredBytes(before)) throw new AttachmentStoreConflictError('Sync consolidation storage changed');
    const written = await things.updateOne(fence, { $set: { ...changed, sizeBytes, updatedAt: now } }, { session });
    if (written.matchedCount !== 1) throw new AttachmentStoreConflictError();
    await assertLease?.();
    return blob ? 'aliased' : 'adopted';
  });
  try { return await attempt(); }
  catch (error) {
    if (Number((error as any)?.code) !== 11000) throw error;
    return attempt();
  }
};

export async function beginRedundantAttachmentDrain(observed: AttachmentDoc, drainMs: number): Promise<Date | null> {
  const { ownerId, shareId, objectKey, objectVersionId, attachmentBlob } = observed;
  if (observed.attachmentRedundantDeleteAfter !== null || !attachmentBlob || !isAttachmentObjectVersionId(objectVersionId)) return null;
  const things = await getHomeThingsCollection();
  const fence = { ...attachmentMatch(shareId), ownerId, objectKey, objectVersionId, attachmentBlob };
  const projection = { attachmentRedundantDeleteAfter: 1 };
  // This update can only observe a committed alias. Use the database clock so
  // an earlier migration snapshot or transaction retry cannot shorten the drain.
  const started = await things.findOneAndUpdate(
    { ...fence, attachmentRedundantDeleteAfter: { $type: 'null' } },
    [{ $set: { attachmentRedundantDeleteAfter: { $add: ['$$NOW', drainMs] } } }],
    { returnDocument: 'after', projection }
  );
  const current = started ?? await things.findOne({ ...fence, attachmentRedundantDeleteAfter: { $type: 'date' } }, { projection });
  return current?.attachmentRedundantDeleteAfter instanceof Date ? current.attachmentRedundantDeleteAfter : null;
}

export const refundRedundantAttachmentObject = async (observed: AttachmentDoc): Promise<boolean> => withHomeMongoTransaction(async (session) => {
  const { ownerId, shareId, objectKey, objectVersionId, attachmentBlob, attachmentRedundantDeleteAfter } = observed;
  if (!attachmentBlob || !attachmentRedundantDeleteAfter) return false;
  const things = await getHomeThingsCollection();
  const fence = { ...attachmentMatch(shareId), ownerId, objectKey, objectVersionId, attachmentBlob, attachmentRedundantDeleteAfter };
  const before = await things.findOne(fence, { session }) as AttachmentDoc | null;
  if (!before) return false;
  const sizeBytes = thingStorageSizeBytes({ ...before, attachmentRedundantDeleteAfter: undefined });
  if (canonicalStoredBytes(before) - sizeBytes !== before.objectSizeBytes) throw new AttachmentStoreConflictError('Sync consolidation storage changed');
  const written = await things.updateOne(fence, { $set: { sizeBytes, updatedAt: new Date() }, $unset: { attachmentRedundantDeleteAfter: '' } }, { session });
  if (written.matchedCount !== 1) throw new AttachmentStoreConflictError();
  await applyUserStorageDelta(ownerId, -before.objectSizeBytes, session);
  return true;
});

export const expiredAttachmentDraftFilter = (
	expiredAtOrBefore: Date,
	ownerId?: string,
	finalizingUpdatedAtOrBefore = expiredAtOrBefore
): Record<string, unknown> => ({
	...(ownerId ? { ownerId } : {}),
	thingtime: ATTACHMENT_THINGTIME,
	attachmentExpiresAt: { $lte: expiredAtOrBefore },
	$or: [
		{ targetId: { $exists: false }, attachmentState: 'pending' },
		{ targetId: { $exists: false }, attachmentState: 'ready', $or: [{ attachmentPurpose: { $nin: ['recording', 'file'] } }, { attachmentPurpose: { $in: ['recording', 'file'] }, attachmentImportDraft: true }] },
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

// This tiny accounted receipt occupies the same unique attachment request identity forever.
// Expiring it would allow a delayed original upload or link request to resurrect content.
export const cancelledAttachmentReceipt = (ownerId: string, id: string, now = new Date(), source?: Pick<AttachmentDoc, 'attachmentPurpose' | 'passwordFileParent'>): AttachmentDoc => {
	const doc = {
		shareId: id, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [ATTACHMENT_THINGTIME] as [typeof ATTACHMENT_THINGTIME],
		crystal: { name: 'Cancelled upload', size: 0, contentType: 'application/octet-stream', mediaKind: 'file' as const },
		extended: null, ownerId, acl: [ACL_OWNER], tags: [] as [],
		storageClass: 'content' as const, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
		attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION, attachmentState: 'cancelled' as const,
		attachmentCancellationRequested: true as const, objectSizeBytes: 0, objectKey: `objects/${id}`,
		...(source?.attachmentPurpose === 'password' && source.passwordFileParent ? { attachmentPurpose: 'password' as const, passwordFileParent: source.passwordFileParent } : {}),
		createdAt: now, updatedAt: now
	};
	return { ...doc, sizeBytes: thingStorageSizeBytes(doc) };
};

export const attachmentStore: AttachmentStore = {
	async reserveCancellation(ownerId, id) {
		return withHomeMongoTransaction(async session => {
			const things = await getHomeThingsCollection();
			const existing = await things.findOne(attachmentMatch(id) as any, { session }) as any as AttachmentDoc | null;
			if (existing) {
				if (existing.ownerId !== ownerId) throw new AttachmentStoreConflictError();
				return existing;
			}
			const receipt = cancelledAttachmentReceipt(ownerId, id);
			await applyUserStorageDelta(ownerId, receipt.sizeBytes, session);
			await things.insertOne(receipt as any, { session });
			return receipt;
		});
	},

	async reservePending({ id, ownerId, crystal, objectKey, requestFingerprint, purpose, profileSlot, expiresAt, recordingImportDraft }) {
		if (recordingImportDraft && (!['recording', 'file'].includes(purpose) || profileSlot)) throw new AttachmentBindingError(400, 'Recording import drafts must retain recording purpose');
    if (expectedFingerprint && (!fileSyncOrigin || !validContentFingerprint(expectedFingerprint, crystal.size)))
      throw new AttachmentBindingError(400, 'Invalid sync upload fingerprint');
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
      ...(expectedFingerprint ? { attachmentExpectedFingerprint: expectedFingerprint } : {}),
			attachmentRequestFingerprint: requestFingerprint,
			...(fileSyncOrigin ? { attachmentFileSyncOrigin: parseFileSyncUploadOrigin(fileSyncOrigin) } : {}),
			attachmentPurpose: purpose,
			...(recordingImportDraft ? { attachmentImportDraft: true as const } : {}),
			...(profileSlot ? { attachmentProfileSlot: profileSlot } : {}),
			attachmentExpiresAt: expiresAt,
			createdAt: now,
			updatedAt: now
		};
    const reserve = async () => withHomeMongoTransaction(async (session) => {
      const things = await getHomeThingsCollection();
      let pending: Omit<AttachmentDoc, 'sizeBytes'> = unstamped;
      if (expectedFingerprint) {
        const blobId = attachmentBlobId(ownerId, crystal.size, expectedFingerprint);
        const filter = blobMatch(ownerId, blobId);
        const existing = await things.findOne(filter, { session }) as BlobDoc | null;
        if (existing) {
          const data = existing.attachmentBlobData;
          if (!sameAttachmentBlobFingerprint(expectedFingerprint, data.fingerprint, crystal.size) ||
            existing.objectSizeBytes !== crystal.size || canonicalStoredBytes(existing) !== crystal.size ||
            data.phase !== 'ready' || data.references === Number.MAX_SAFE_INTEGER || !data.objectVersionId || !existing.detected) throw new AttachmentBlobBusyError();
          const attachmentBlob = { id: blobId, objectAttachmentId: data.originAttachmentId, objectVersionId: data.objectVersionId };
          const readable = {
            thingtime: ATTACHMENT_THINGTIME, ownerId, attachmentBlob, attachmentPurpose: 'file', attachmentState: 'ready',
            attachmentLinked: { $ne: true }, attachmentImportDraft: { $ne: true }, 'moderation.status': { $ne: 'blocked' },
            $or: [{ targetId: { $type: 'string', $ne: '' } }, { attachmentExpiresAt: { $exists: false } },
              { attachmentExpiresAt: { $gt: new Date() } }]
          };
          // The common path is the indexed original ID. A remaining owner-
          // readable alias can authorize reuse after that reference is removed.
          const options = { session, projection: { _id: 1 } };
          const source = await things.findOne({ ...readable, shareId: data.originAttachmentId }, options) ??
            await things.findOne(readable, options);
          if (source) {
            // Write the exact witness so concurrent moderation or deletion
            // conflicts with this transaction before a new readable alias lands.
            const witness = await things.updateOne({ ...readable, _id: source._id },
              { $set: { attachmentBlobReuseFence: randomUUID() } }, { session });
            if (witness.matchedCount !== 1) throw new AttachmentStoreConflictError();
            pending = { ...unstamped, crystal: { ...crystal, ...existing.detected }, attachmentState: 'ready', attachmentBlob,
              objectVersionId: data.objectVersionId,
              moderation: crystal.size === 0 ? { status: 'skipped', provider: 'verified-empty-object', categories: ['empty-content'], analyzedAt: now } : { status: 'pending' } };
            if (isDurableRecordingUpload(pending)) delete pending.attachmentExpiresAt;
            const ref = await things.updateOne(filter, { $inc: { 'attachmentBlobData.references': 1 }, $set: { updatedAt: now } }, { session });
            if (ref.matchedCount !== 1) throw new AttachmentStoreConflictError();
          }
        } else {
          const blob: BlobDoc = {
            ...filter, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, storageClass: 'content',
            storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sizeBytes: 0, objectSizeBytes: crystal.size,
            crystal: {}, extended: null, tags: [], acl: [ACL_OWNER], createdAt: now, updatedAt: now,
            attachmentBlobData: { fingerprint: expectedFingerprint, originAttachmentId: id, phase: 'staging', references: 0 }
          };
          await things.insertOne(blob as any, { session });
        }
      }
      const doc: AttachmentDoc = { ...pending, sizeBytes: thingStorageSizeBytes(pending) };
      await applyUserStorageDelta(ownerId, doc.sizeBytes, session);
      await things.insertOne(doc as any, { session });
      return doc;
    });
    try { return await reserve(); }
    catch (error) {
      // Competing first reservations may both see an empty slot under snapshot
      // isolation. Re-read the winner once; the unique shareId fences insertion.
      if (!expectedFingerprint || Number((error as any)?.code) !== 11000) throw error;
      return reserve();
    }
	},

	// A linked (external URL) attachment is born READY: there is no upload to
	// finalize and no object bytes to verify — the crystal's url IS the media.
	// It carries the same draft TTL as an uploaded ready draft, binds through
	// the same fences, and only its JSON payload bytes hit the owner's quota.
	// Moderation is stamped 'skipped' at mint: there are no stored bytes for
	// the analyzer to fetch, and an unstamped doc would loop the sweep forever.
	async insertLinkedReady({ id, ownerId, crystal, purpose, expiresAt, requestFingerprint }) {
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
			...(requestFingerprint ? { attachmentRequestFingerprint: requestFingerprint } : {}),
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
				$or: [{ uploadId: { $type: 'string' } }, { objectSizeBytes: 0, attachmentPurpose: { $in: [...EMPTY_ATTACHMENT_PURPOSES] } }]
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

	async markReady(ownerId, id, crystal, objectVersionId, expiresAt, leaseId, verifiedFingerprint) {
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
				moderation: before.objectSizeBytes === 0 && attachmentPurposeAllowsEmpty(before.attachmentPurpose)
                    ? { status: 'skipped' as const, provider: 'verified-empty-object', categories: ['empty-content'], analyzedAt: new Date() }
                    : { status: before.attachmentPurpose === 'password' ? 'skipped' as const : 'pending' as const },
				attachmentExpiresAt: expiresAt,
				updatedAt: new Date()
			};
			// A completed recording is an owner-private library Thing, not a draft.
			if (isDurableRecordingUpload(before)) delete next.attachmentExpiresAt;
			delete next.uploadId;
			delete next.attachmentFinalizationLeaseId;
			delete next.attachmentPartsIssuedAt;
      let blobBytes = 0;
      let attachmentBlob: AttachmentBlobRef | undefined;
      if (before.attachmentExpectedFingerprint) {
        if (!sameAttachmentBlobFingerprint(before.attachmentExpectedFingerprint, verifiedFingerprint, before.objectSizeBytes))
          throw new AttachmentStoreConflictError('Verified sync content fingerprint is required');
        const blobId = attachmentBlobId(ownerId, before.objectSizeBytes, before.attachmentExpectedFingerprint);
        const filter = { ...blobMatch(ownerId, blobId), 'attachmentBlobData.phase': 'staging', 'attachmentBlobData.originAttachmentId': id };
        const blob = await things.findOne(filter, { session }) as BlobDoc | null;
        // A reservation without a readable reuse witness uploads and verifies
        // its own bytes. Only the reservation owning the staging blob may
        // promote it. All other verified uploads retain their own payload charge.
        if (blob) {
          if (canonicalStoredBytes(blob) !== 0 || blob.objectSizeBytes !== before.objectSizeBytes ||
            !sameAttachmentBlobFingerprint(before.attachmentExpectedFingerprint, blob.attachmentBlobData.fingerprint, before.objectSizeBytes))
            throw new AttachmentStoreConflictError('Sync content reservation changed');
          const data: AttachmentBlobData = { ...blob.attachmentBlobData, phase: 'ready', references: 1, objectVersionId };
          const detected: NonNullable<BlobDoc['detected']> = { contentType: crystal.contentType, mediaKind: crystal.mediaKind,
            ...(crystal.detectedContentType ? { detectedContentType: crystal.detectedContentType } : {}) };
          blobBytes = thingStorageSizeBytes({ ...blob, attachmentBlobData: data });
          const stored = await things.updateOne(filter, { $set: { attachmentBlobData: data, detected, sizeBytes: blobBytes, updatedAt: next.updatedAt } }, { session });
          if (stored.matchedCount !== 1) throw new AttachmentStoreConflictError();
          attachmentBlob = { id: blobId, objectAttachmentId: id, objectVersionId };
        }
      }
      const ready = { ...next, ...(attachmentBlob ? { attachmentBlob } : {}) };
			const nextSize = thingStorageSizeBytes(ready);
			const deltaBytes = nextSize + blobBytes - canonicalStoredBytes(before);
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
            ...(attachmentBlob ? { attachmentBlob } : {}),
						attachmentState: 'ready',
						moderation: next.moderation,
						...(isDurableRecordingUpload(before) ? {} : { attachmentExpiresAt: expiresAt }),
						sizeBytes: nextSize,
						updatedAt: next.updatedAt
					},
					$unset: { uploadId: '', attachmentFinalizationLeaseId: '', attachmentPartsIssuedAt: '', ...(isDurableRecordingUpload(before) ? { attachmentExpiresAt: '' } : {}) }
				},
				{ session }
			);
			if (!write.matchedCount) throw new AttachmentStoreConflictError();
			return { ...ready, sizeBytes: nextSize };
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
					...(scope.retainCancellation ? { attachmentCancellationRequested: true } : {}),
					attachmentExpiresAt: attachmentDeletingRetryAt(now),
					updatedAt: now
				}
			},
			{ returnDocument: 'after' }
		)) as any as AttachmentDoc | null;
		if (claimed) return claimed;
		const retryFilter = {
			...attachmentMatch(id),
			ownerId,
			// A previous claim already made deletion irreversible and advanced updatedAt.
			// Resume its cleanup without requiring the pre-claim content version.
			...attachmentDeleteClaimFence({ ...scope, expectedUpdatedAt: undefined }),
			attachmentState: 'deleting',
			attachmentObjectlessDelete: true,
			uploadId: { $exists: false },
			objectVersionId: { $exists: false }
		};
		return (scope.retainCancellation
			? await things.findOneAndUpdate(retryFilter as any, { $set: { attachmentCancellationRequested: true } }, { returnDocument: 'after' })
			: await things.findOne(retryFilter as any)) as any as AttachmentDoc | null;
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
								...(scope.retainCancellation ? { attachmentCancellationRequested: true } : {}),
								attachmentExpiresAt: {
									$max: [
										{ $cond: [{ $eq: [{ $type: '$attachmentPartsIssuedAt' }, 'date'] }, attachmentMpuSettlementAt(now), attachmentDeletingRetryAt(now)] },
										{ $ifNull: ['$attachmentRetainUntil', attachmentDeletingRetryAt(now)] }
									]
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
		const retryFilter = {
			...attachmentMatch(id),
			ownerId,
			// Retry only the already-claimed deletion; retain owner/target/expiry fences.
			...attachmentDeleteClaimFence({ ...scope, expectedUpdatedAt: undefined }),
			attachmentState: 'deleting'
		};
		return (scope.retainCancellation
			? await things.findOneAndUpdate(retryFilter as any, { $set: { attachmentCancellationRequested: true } }, { returnDocument: 'after' })
			: await things.findOne(retryFilter as any)) as any as AttachmentDoc | null;
	},

  async prepareBlobDeletion(ownerId, id) {
    return withHomeMongoTransaction(async (session) => {
      const things = await getHomeThingsCollection();
      const attachment = await things.findOne({ ...attachmentMatch(id), ownerId, attachmentState: 'deleting' }, { session }) as AttachmentDoc | null;
      if (!attachment?.attachmentBlob) return 'skipped';
      if (attachment.attachmentRedundantDeleteAfter !== undefined)
        throw new AttachmentStoreConflictError('Superseded file bytes still require cleanup');
      const filter = blobMatch(ownerId, attachment.attachmentBlob.id);
      const blob = await things.findOne(filter, { session }) as BlobDoc | null;
      if (!matchAttachedBlob(blob, attachment)) throw new AttachmentStoreConflictError('Sync content reference changed');
      const data = blob.attachmentBlobData;
      if (data.phase === 'deleting' && data.deletingAttachmentId === id) return 'last';
      if (data.phase !== 'ready') throw new AttachmentStoreConflictError('Sync content is already releasing');
      if (data.references === 1) {
        const written = await things.updateOne(filter, { $set: { 'attachmentBlobData.phase': 'deleting', 'attachmentBlobData.deletingAttachmentId': id, updatedAt: new Date() } }, { session });
        if (written.matchedCount !== 1) throw new AttachmentStoreConflictError();
        return 'last';
      }
      const written = await things.updateOne(filter, { $inc: { 'attachmentBlobData.references': -1 }, $set: { updatedAt: new Date() } }, { session });
      const removed = await things.deleteOne({ ...attachmentMatch(id), ownerId, attachmentState: 'deleting' }, { session });
      if (written.matchedCount !== 1 || removed.deletedCount !== 1) throw new AttachmentStoreConflictError();
      await applyUserStorageDelta(ownerId, -canonicalStoredBytes(attachment), session);
      return 'deleted';
    });
  },

	async removeDeleting(ownerId, id) {
		return withHomeMongoTransaction(async (session) => {
			const things = await getHomeThingsCollection();
			const filter = { ...attachmentMatch(id), ownerId, attachmentState: 'deleting' };
			const removed = await things.findOne(filter as any, { session }) as any as AttachmentDoc | null;
			if (!removed) return false;
			const receipt = removed.attachmentCancellationRequested || isIdempotentLinkedAttachment(removed)
				? cancelledAttachmentReceipt(ownerId, id, new Date(), removed) : null;
			if (receipt) await things.replaceOne(filter as any, receipt as any, { session });
			else await things.deleteOne(filter as any, { session });
			const bytes = currentContentStorageSizeBytes(removed);
			if (bytes === null) await markUserStorageNeedsReconcile(ownerId, session);
			else await applyUserStorageDelta(ownerId, (receipt?.sizeBytes ?? 0) - bytes, session);
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

	async listBrowserDrafts(ownerId, limit) {
		return (await (
			await getHomeThingsCollection()
		)
			.find({
				ownerId,
				thingtime: ATTACHMENT_THINGTIME,
				...attachmentDeleteClaimFence({ kind: 'draft', browserOnly: true }),
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
				attachmentPurpose: { $ne: 'password' },
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

type BindableAttachmentPurpose = Exclude<AttachmentPurpose, 'profile' | 'recording' | 'file' | 'password'>;

const attachmentPurposeLabel: Record<BindableAttachmentPurpose, string> = {
	post: 'post',
	comment: 'comment',
	message: 'message',
	emoji: 'custom emoji',
	'subspace-icon': 'subspace icon',
	'subspace-banner': 'subspace banner'
};

// Called by each content writer inside the SAME home-Mongo transaction as its
// target creation. This is the only supported transition from a private,
// unbound object to a relational child. Purpose is immutable: an upload plan
// minted for a DM cannot be replayed into a public post or custom emoji.
export const bindReadyAttachmentsForPurpose = async (
	ownerId: string,
	attachmentIds: readonly string[],
	targetId: string,
	session: any,
	purpose: BindableAttachmentPurpose,
	maxAttachments = attachmentCountLimit(purpose)
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
  const sourceRows = await things.find({ shareId: { $in: ids }, ownerId, thingtime: ATTACHMENT_THINGTIME }, { session, projection: { targetId: 1 } }).toArray();
  const sources = await ownedMediaDraftIds(ownerId, sourceRows.map(row => row.targetId).filter((id): id is string => typeof id === 'string' && id !== targetId), session);
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
					{ targetId: { $in: [targetId, ...sources] }, attachmentExpiresAt: { $exists: false } },
					{ targetId: { $exists: false }, attachmentExpiresAt: { $gt: now } }
				]
					}
				]
			} as any,
			{ session, projection: { shareId: 1, targetId: 1 } }
		)
		.toArray()) as Array<{ shareId: string; targetId?: string }>;

	if (candidates.length !== ids.length || candidates.some((attachment) => attachment.targetId && attachment.targetId !== targetId && !sources.includes(attachment.targetId))) {
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
								{ targetId: { $in: [targetId, ...sources] }, attachmentExpiresAt: { $exists: false } },
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
export const assertUnboundPostAnnotation = (doc: AttachmentDoc, now = new Date()) => {
  if (doc.targetId || (doc.attachmentPurpose && doc.attachmentPurpose !== 'post') || doc.attachmentProfileSlot || !(doc.attachmentExpiresAt instanceof Date) || !Number.isFinite(doc.attachmentExpiresAt.getTime()) || doc.attachmentExpiresAt <= now) {
    throw new AttachmentBindingError(409, 'Import annotations require a fresh unbound post attachment');
  }
};

/** Server-only final step for recording imports. Upload approval, byte
 * verification and moderation remain the normal upload pipeline's job.
 * This cannot mint media, change purpose, or reuse an existing recording. */
export const commitRecordingImport = async (ownerId: string, id: string, expectedBytes: number, patch: AttachmentAnnotationPatch = {}): Promise<AttachmentDoc> => {
  if (isCustomMongoEndpointActive()) throw new AttachmentBindingError(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
  return withHomeMongoTransaction(async (session) => {
    const things = await getHomeThingsCollection();
    const before = await things.findOne({ ...attachmentMatch(id), ownerId } as any, { session }) as unknown as AttachmentDoc | null;
    if (!before) throw new AttachmentBindingError(404, 'Attachment not found');
    let next: AttachmentDoc;
    try { next = prepareRecordingImport(before, ownerId, expectedBytes, patch); }
    catch (error) { throw new AttachmentBindingError(409, error instanceof Error ? error.message : 'Invalid recording import'); }
    const sizeBytes = thingStorageSizeBytes(next);
    await applyUserStorageDelta(ownerId, sizeBytes - canonicalStoredBytes(before), session);
    const write = await things.updateOne({
      _id: before._id, ownerId, attachmentState: 'ready', attachmentPurpose: before.attachmentPurpose, attachmentImportDraft: true,
      updatedAt: before.updatedAt, sizeBytes: before.sizeBytes
    } as any, {
      $set: { crystal: next.crystal, acl: [ACL_OWNER], updatedAt: next.updatedAt, sizeBytes },
      $unset: { attachmentImportDraft: '', attachmentExpiresAt: '' }
    }, { session });
    if (write.matchedCount !== 1) throw new AttachmentBindingError(409, 'Recording changed during import');
    return { ...next, sizeBytes };
  });
};

export const annotateOwnedAttachment = async (ownerId: string, id: string, patch: AttachmentAnnotationPatch, options: { unboundPostOnly?: boolean; expectedUpdatedAt?: string } = {}): Promise<AttachmentDoc> =>
	withHomeMongoTransaction(async (session) => {
		const things = await getHomeThingsCollection();
		const before = (await things.findOne({ ...attachmentMatch(id), ownerId } as any, { session })) as any as AttachmentDoc | null;
		if (!before) throw new AttachmentBindingError(404, 'Attachment not found');
		if (options.expectedUpdatedAt !== undefined && new Date(options.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
			throw new AttachmentBindingError(409, 'Attachment changed before this edit. Refresh and compare your changes.');
		}
		if (before.attachmentState !== 'ready') {
			throw new AttachmentBindingError(409, 'This file is still uploading — try again once it is ready');
		}
		// Checked inside the same transaction as the metadata write. A concurrent
		// bind retries against the new target and cannot alter an existing gallery.
		if (options.unboundPostOnly) assertUnboundPostAnnotation(before);

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

		const next: AttachmentDoc = { ...before, crystal: nextCrystal, updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)) };
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
		MAX_POST_ATTACHMENTS
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
export const syncBoundTargetAttachments = async (ownerId: string, targetId: string, requestedIds: readonly unknown[], transactionSession?: any): Promise<void> => {
	if (isCustomMongoEndpointActive()) {
		throw new AttachmentBindingError(400, 'Private attachments are unavailable with a custom MongoDB endpoint');
	}
	if (!targetId.trim()) throw new AttachmentBindingError(400, 'Attachment target is required');
	const run = async (session: any) => {
		const things = await getHomeThingsCollection();
		// post-family only (posts, rich AND plain comments) — message, emoji and
		// profile targets keep their dedicated purpose-bound routes
		const target = (await things.findOne({ shareId: targetId, ownerId, thingtime: { $in: ['post', 'comment'] } } as any, {
			session, projection: { shareId: 1, thingtime: 1 }
		})) as { shareId: string; thingtime?: unknown } | null;
		if (!target) throw new AttachmentBindingError(404, 'Post not found');
		const bound = (await things
			.find({ ownerId, thingtime: ATTACHMENT_THINGTIME, attachmentState: 'ready', targetId } as any, {
				session, projection: { shareId: 1, moderation: 1, attachmentSortIndex: 1 }
			})
			.toArray()) as Array<{ shareId: string; moderation?: unknown; attachmentSortIndex?: unknown }>;
		const hiddenBound = bound
			.filter((doc) => attachmentModerationHidesFromPublic(doc.moderation))
			.sort((left, right) => attachmentStoredSortValue(left.attachmentSortIndex) - attachmentStoredSortValue(right.attachmentSortIndex));
		const purpose: BindableAttachmentPurpose = Array.isArray(target.thingtime) && target.thingtime.includes('comment') ? 'comment' : 'post';
		const plan = planAttachmentSync(
			requestedIds,
			bound.map((doc) => String(doc.shareId)),
			hiddenBound.map((doc) => String(doc.shareId)),
			attachmentCountLimit(purpose)
		);
		if (plan.ok === false) throw new AttachmentBindingError(plan.status, plan.error);
		if (!plan.orderedIds.length && !plan.hiddenTrailingIds.length) return;
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
	};
	if (transactionSession) await run(transactionSession); else await withHomeMongoTransaction(run);
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
