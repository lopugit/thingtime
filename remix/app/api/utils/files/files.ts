import { createHash } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { attachmentIsBlocked } from '../moderation/moderationCore';
import { getAttachmentFingerprint } from '../attachments/attachments';
import { currentContentStorageSizeBytes, thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION, StorageMutationError } from '../storage/storageCore';
import { applyUserStorageDelta } from '../storage/userStorage';
import { lockFolderDestination } from '../things/folderPlacement';
import { appendTimelineEvent, readTimelineEntries } from '../timeline/repository';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { CLOUD_FILE_KIND, CLOUD_FILE_ADAPTER, parseCloudFile, parseCloudFileCommit, type CloudFile, type CloudFileCommit } from '../../../fileSync/cloudFile';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eventId = (ownerId: string, id: string, operationId: string) => `file-commit-${digest([ownerId, id, operationId])}`;
const failure = (status: number, error: string) => ({ ok: false as const, status, error });
const conflict = (message: string): never => { throw new StorageMutationError(409, 'storage_conflict', message); };
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const publicFile = (doc: any): CloudFile => parseCloudFile({ id: doc.shareId, revision: doc.timelineHeadId,
	name: doc.crystal?.name, folderId: doc.folderId ?? null, trashed: doc.crystal?.trashed, content: doc.crystal?.content });
const snapshot = (doc: any, requestHash: string | null) => ({ adapter: CLOUD_FILE_ADAPTER, version: 1,
	value: { ...publicFile(doc), requestHash } });

/** One canonical file identity; byte versions remain ordinary accounted
 * attachments. Timeline contains the durable operation receipt and history. */
export function createCloudFileService(overrides: Partial<{
	collection: () => Promise<any>; transaction: (work: (session: any) => Promise<any>) => Promise<any>;
	customPlane: () => boolean; fingerprint: typeof getAttachmentFingerprint;
	append: typeof appendTimelineEvent; entries: typeof readTimelineEntries; debit: typeof applyUserStorageDelta;
	lockFolder: typeof lockFolderDestination; now: () => Date;
}> = {}) {
	const deps = { collection: getHomeThingsCollection, transaction: withHomeMongoTransaction, customPlane: isCustomMongoEndpointActive,
		fingerprint: getAttachmentFingerprint, append: appendTimelineEvent, entries: readTimelineEntries,
		debit: applyUserStorageDelta, lockFolder: lockFolderDestination, now: () => new Date(), ...overrides };
	const owned = async (things: any, ownerId: string, id: string, session?: any) => {
		const doc = await things.findOne({ shareId: id }, session ? { session } : {});
		if (doc && (doc.ownerId !== ownerId || doc.thingtime?.length !== 1 || doc.thingtime[0] !== CLOUD_FILE_KIND || doc.appId != null || doc.sandbox != null || doc.sandboxSpace != null || doc.targetId != null))
			throw new StorageMutationError(404, 'storage_conflict', 'File not found');
		return doc;
	};
	const receipt = async (things: any, ownerId: string, id: string, operationId: string, session?: any) => {
		const eid = eventId(ownerId, id, operationId);
		const entry = (await deps.entries(things, ownerId, [eid], session))[0];
		if (!entry) return null;
		const e = entry.event;
		if (e.id !== eid || e.ownerId !== ownerId || e.actorId !== ownerId || e.thingId !== id || e.operationId !== operationId ||
			e.source !== 'api' || e.mode !== 'revision' || e.branchId !== 'main' || e.after?.adapter !== CLOUD_FILE_ADAPTER || e.after.version !== 1)
			conflict('File operation identity is already occupied');
		const value = e.after!.value as any;
		if (typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)) conflict('File operation receipt is invalid');
		const file = parseCloudFile(value);
		if (file.id !== id || file.revision !== eid) conflict('File operation receipt changed identity');
		return { file, requestHash: value.requestHash as string };
	};
	const errorResult = (error: unknown) => error instanceof StorageMutationError ? failure(error.status, error.message) :
		(error as any)?.code === 11000 ? failure(409, 'File changed before publication; reconcile and retry with the original operation') : failure(503, 'File storage is temporarily unavailable');
	return {
		async read(ownerId: string, id: unknown, operationId?: unknown) {
			if (deps.customPlane()) return failure(409, 'Files currently require the home data plane');
			if (!ownerId || !identity(id) || (operationId !== undefined && !identity(operationId))) return failure(400, 'Invalid file identity');
			try {
				const things = await deps.collection(); const doc = await owned(things, ownerId, id);
				if (operationId !== undefined) {
					const saved = await receipt(things, ownerId, id, operationId as string);
					return { ok: true as const, receipt: saved ? { file: saved.file } : null };
				}
				return doc ? { ok: true as const, file: publicFile(doc) } : failure(404, 'File not found');
			} catch (error) { return errorResult(error); }
		},
		async commit(ownerId: string, value: unknown) {
			if (deps.customPlane()) return failure(409, 'Files currently require the home data plane');
			if (!ownerId) return failure(401, 'Unauthorized');
			let input: CloudFileCommit;
			try { input = parseCloudFileCommit(value); } catch { return failure(400, 'Invalid file commit'); }
			const requestHash = digest(input), eid = eventId(ownerId, input.id, input.operationId), now = deps.now();
			const replay = (saved: { file: CloudFile; requestHash: string }) => {
				if (saved.requestHash !== requestHash) conflict('File operation was reused with different content');
				return { ok: true as const, file: saved.file, replayed: true };
			};
			try {
				const things = await deps.collection(); await owned(things, ownerId, input.id);
				const prior = await receipt(things, ownerId, input.id, input.operationId); if (prior) return replay(prior);
				const verified = await deps.fingerprint({ id: ownerId }, input.attachmentId);
				if (verified.ok === false) return verified;
				if (verified.version !== input.contentVersion) conflict('File bytes changed before commit');
				return await deps.transaction(async session => {
					const before = await owned(things, ownerId, input.id, session);
					const saved = await receipt(things, ownerId, input.id, input.operationId, session); if (saved) return replay(saved);
					if ((before?.timelineHeadId ?? null) !== input.expectedRevision) conflict('File changed; preserve both versions and reconcile');
					if (before && currentContentStorageSizeBytes(before) === null) conflict('File storage requires reconciliation');
					const attachment = await things.findOne({ shareId: input.attachmentId, ownerId, thingtime: 'attachment' }, { session });
					if (!attachment || attachment.thingtime?.length !== 1 || attachment.thingtime[0] !== 'attachment' || attachment.attachmentState !== 'ready' || attachment.attachmentPurpose !== 'file' || attachment.attachmentLinked ||
						attachmentIsBlocked(attachment) || attachment.attachmentImportDraft || attachment.attachmentExpiresAt != null || attachment.appId != null || attachment.sandbox != null || attachment.sandboxSpace != null ||
						(attachment.targetId != null && attachment.targetId !== input.id) || currentContentStorageSizeBytes(attachment) === null ||
						attachment.objectSizeBytes !== verified.size || attachmentContentVersion(attachment.shareId, attachment.objectKey, attachment.objectVersionId) !== verified.version)
						conflict('Use an owned, ready file upload or a retained version of this file');
					await deps.lockFolder(things, ownerId, input.folderId, session);
					// Binding writes the attachment even on restore: cleanup and content
					// publication cannot both win a concurrent transaction.
					const bound = await things.updateOne({ _id: attachment._id, ownerId, attachmentState: 'ready', objectVersionId: attachment.objectVersionId,
						...(attachment.targetId == null ? { targetId: { $in: [null] } } : { targetId: input.id }) },
						{ $set: { targetId: input.id, parentId: input.id, folderId: null, acl: ['tt:inherit'], updatedAt: now, fileBindingToken: eid } }, { session });
					if (bound.matchedCount !== 1) conflict('File upload changed before publication');
					const crystal = { name: input.name, trashed: input.trashed, content: { attachmentId: verified.id, version: verified.version, size: verified.size, fingerprint: verified.fingerprint } };
					const next: any = { ...(before ?? {}), shareId: input.id, ownerId, thingtime: [CLOUD_FILE_KIND], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
						crystal, extended: null, tags: [], acl: ['tt:user'], targetId: null, folderId: input.folderId, timelineHeadId: eid,
						storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, createdAt: before?.createdAt ?? now, updatedAt: now };
					next.sizeBytes = thingStorageSizeBytes(next);
					await deps.debit(ownerId, next.sizeBytes - (before?.sizeBytes ?? 0), session);
					if (before) {
						const { _id, ...fields } = next;
						const updated = await things.updateOne({ _id, ownerId, timelineHeadId: input.expectedRevision, updatedAt: before.updatedAt }, { $set: fields }, { session });
						if (updated.matchedCount !== 1) conflict('File changed before publication');
					} else await things.insertOne(next, { session });
					const event = parseTimelineEvent({ formatVersion: 1, id: eid, ownerId, thingId: input.id, branchId: 'main', parentIds: before?.timelineHeadId ? [before.timelineHeadId] : [],
						operationId: input.operationId, actorId: ownerId, source: 'api', clientId: null, occurredAt: now.toISOString(), mode: 'revision',
						operation: before ? 'update' : 'create', label: input.trashed ? 'Moved file to Trash' : before?.crystal?.trashed ? 'Restored file' : before ? 'Updated file' : 'Created file',
						before: before ? snapshot(before, null) : null, after: snapshot(next, requestHash), dependencies: [] } as TimelineEvent);
					await deps.append(things, event, session, { plane: 'home' });
					return { ok: true as const, file: publicFile(next), replayed: false };
				});
			} catch (error) { return errorResult(error); }
		}
	};
}
export const cloudFiles = createCloudFileService();
