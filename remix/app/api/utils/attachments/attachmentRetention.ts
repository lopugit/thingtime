import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { currentContentStorageSizeBytes, StorageMutationError } from '../storage/storageCore';
import { attachmentContentVersion } from './contentFingerprint';
import { isAttachmentObjectVersionId } from './attachmentCore';
import type { AttachmentDoc } from './attachmentStore';

// A bounded aggregate deadline, not a per-job array. Renewals only extend it;
// finishing one backup cannot release another backup's hold. Existing object
// bytes remain billed until canonical deletion succeeds. No new byte allocation.
export const ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_RETENTION_BATCH = 64;
export type AttachmentVersion = { id: string; version: string };
const conflict = (message: string): never => {
	throw new StorageMutationError(409, 'storage_conflict', message);
};
export function activeAttachmentRetention(doc: Partial<AttachmentDoc>, now: Date): boolean {
	return (
		doc.attachmentRetentionClosed !== true &&
		doc.attachmentRetainUntil instanceof Date &&
		Number.isFinite(doc.attachmentRetainUntil.getTime()) &&
		doc.attachmentRetainUntil > now
	);
}
export function parseAttachmentRetention(input: unknown): AttachmentVersion[] {
	const v = input as any;
	if (
		!v ||
		Array.isArray(v) ||
		Object.keys(v).length !== 1 ||
		!Array.isArray(v.versions) ||
		v.versions.length < 1 ||
		v.versions.length > ATTACHMENT_RETENTION_BATCH
	)
		throw Error('Invalid retention request');
	const seen = new Set<string>();
	return v.versions.map((entry: any) => {
		if (
			!entry ||
			Array.isArray(entry) ||
			Object.keys(entry).sort().join(',') !== 'id,version' ||
			typeof entry.id !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.id) ||
			typeof entry.version !== 'string' ||
			!/^[a-f0-9]{64}$/.test(entry.version) ||
			seen.has(entry.id)
		)
			throw Error('Invalid retention request');
		seen.add(entry.id);
		return { id: entry.id, version: entry.version };
	});
}
export function createAttachmentRetention(
	overrides: Partial<{
		collection: () => Promise<any>;
		transaction: <T>(work: (session: any) => Promise<T>) => Promise<T>;
		customPlane: () => boolean;
		now: () => Date;
	}> = {}
) {
	const deps = {
		collection: getHomeThingsCollection,
		transaction: withHomeMongoTransaction,
		customPlane: isCustomMongoEndpointActive,
		now: () => new Date(),
		...overrides
	};
	return {
		async retain(ownerId: string, input: unknown) {
			let versions: AttachmentVersion[];
			try {
				versions = parseAttachmentRetention(input);
			} catch {
				return { ok: false as const, status: 400, error: 'Invalid retention request' };
			}
			if (!ownerId) return { ok: false as const, status: 401, error: 'Unauthorized' };
			if (deps.customPlane()) return { ok: false as const, status: 409, error: 'Attachment retention requires home storage' };
			try {
				return await deps.transaction(async (session) => {
					const things = await deps.collection(),
						now = deps.now(),
						until = new Date(now.getTime() + ATTACHMENT_RETENTION_MS);
					const docs = await things.find({ ownerId, shareId: { $in: versions.map((v) => v.id) }, thingtime: 'attachment' }, { session }).toArray();
					if (docs.length !== versions.length) conflict('One or more attachment versions are unavailable');
					const byId = new Map<string, any>(docs.map((doc: any) => [doc.shareId, doc]));
					for (const item of versions) {
						const doc = byId.get(item.id),
							held = activeAttachmentRetention(doc ?? {}, now);
						const durable = ['file', 'recording'].includes(doc?.attachmentPurpose) && !doc.attachmentImportDraft && !doc.attachmentProfileSlot;
						if (
							!doc ||
							doc.thingtime?.length !== 1 ||
							doc.ownerId !== ownerId ||
							doc.appId != null ||
							doc.sandbox != null ||
							doc.sandboxSpace != null ||
							doc.attachmentLinked ||
							doc.moderation?.status === 'blocked' ||
							doc.attachmentRetentionClosed === true ||
							!isAttachmentObjectVersionId(doc.objectVersionId) ||
							currentContentStorageSizeBytes(doc) === null ||
							attachmentContentVersion(doc.shareId, doc.objectKey, doc.objectVersionId) !== item.version ||
							(doc.attachmentRetainUntil !== undefined &&
								(!(doc.attachmentRetainUntil instanceof Date) || !Number.isFinite(doc.attachmentRetainUntil.getTime()))) ||
							(doc.attachmentState !== 'ready' && !(doc.attachmentState === 'deleting' && held)) ||
							(!held &&
								!doc.targetId &&
								!(durable && doc.attachmentExpiresAt == null) &&
								(!(doc.attachmentExpiresAt instanceof Date) || !(doc.attachmentExpiresAt > now)))
						)
							conflict('One or more attachment versions are unavailable');
						// The same document is written by deletion, binding and final purge.
						// Mongo retries conflicting transactions; an expired deleting hold
						// cannot be revived after purge has acquired its durable fence.
						const result = await things.updateOne(
							{
								_id: doc._id,
								ownerId,
								attachmentState: doc.attachmentState,
								objectVersionId: doc.objectVersionId,
								attachmentRetentionClosed: { $ne: true }
							},
							{ $max: { attachmentRetainUntil: until }, $set: { attachmentRetentionToken: randomUUID() } },
							{ session }
						);
						if (result.matchedCount !== 1) conflict('Attachment changed during retention');
					}
					return { ok: true as const, versions, retainedUntil: until.toISOString(), serverTime: now.toISOString() };
				});
			} catch (error) {
				return {
					ok: false as const,
					status: error instanceof StorageMutationError ? error.status : 503,
					error: error instanceof StorageMutationError ? error.message : 'Attachment retention is temporarily unavailable'
				};
			}
		},
		async closeForDeletion(ownerId: string, id: string): Promise<AttachmentDoc | null> {
			return deps.transaction(async (session) => {
				const things = await deps.collection();
				const doc = await things.findOne({ ownerId, shareId: id, thingtime: 'attachment', attachmentState: 'deleting' }, { session });
				if (!doc) return null;
				if (!(doc.attachmentRetainUntil instanceof Date) || !Number.isFinite(doc.attachmentRetainUntil.getTime()))
					conflict('Attachment retention needs reconciliation');
				if (activeAttachmentRetention(doc, deps.now())) return doc;
				await things.updateOne({ _id: doc._id, ownerId, attachmentState: 'deleting' }, { $set: { attachmentRetentionClosed: true } }, { session });
				return { ...doc, attachmentRetentionClosed: true };
			});
		}
	};
}
export const attachmentRetention = createAttachmentRetention();
