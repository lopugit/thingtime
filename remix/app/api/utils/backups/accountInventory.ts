import {
	backupDraftProjection,
	backupDraftFromDoc,
	retainBackupDraft,
	backupDraftAttachmentReferences,
	verifyBackupDraftAttachment,
	type BackupDraftAttachmentReference
} from './draftRecords';
import { retainBackupThingSnapshot } from './thingSnapshots';
import { backupThemeProjection, backupThemeSnapshotFromDoc, retainBackupThemeSnapshot } from './themeSnapshots';
import {
	backupAttachmentProjection,
	backupAttachmentFromDoc,
	backupAttachmentItem,
	backupFileReferences,
	verifyBackupFileReference,
	validateBackupAttachmentDoc
} from './attachmentRecords';
import { getPrivateS3, type AttachmentObjectHead } from '../attachments/privateS3';
import { type CloudFileContent } from '../../../fileSync/cloudFile';
import { isAccountTimelineKind, timelineBackupProjection, timelineBackupRecordFromDoc, retainTimelineBackupRecord } from './timelineRecords';
import { getHomeThingsCollection, withHomeMongoSnapshot, THINGS_OWNER_IDENTITY_INDEX } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { isProtectedThingtime, MESSENGER_THINGTIME } from '../../../schemas/registry';
import { CLOUD_FILE_ADAPTER, parseCloudFile } from '../../../fileSync/cloudFile';
import { timelineScopeKey } from '../../../timeline/contract';
import { BACKUP_FORMAT, BACKUP_METADATA_BYTES, backupId, backupJson, parseBackupItem, type BackupItem } from '../../../backups/manifest';
import { prepareBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';

export const ACCOUNT_INVENTORY_PAGE_SIZE = 128;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
// Census reads never fetch crystal, secure, tokens, grants or private envelopes.
// Only the dedicated Timeline family decodes its canonical history envelope.
const censusProjection = { _id: 0, shareId: 1, ownerId: 1, thingtime: 1 };
const contentProjection = {
	...censusProjection,
	crystal: 1,
	extended: 1,
	tags: 1,
	acl: 1,
	folderId: 1,
	targetId: 1,
	geo: 1,
	timelineHeadId: 1
};
const fileProjection = {
	...censusProjection,
	timelineHeadId: 1,
	folderId: 1,
	'crystal.name': 1,
	'crystal.trashed': 1,
	'crystal.content': 1
};
type Census = { shareId: string; ownerId: string; thingtime: string[] };
type Family = 'content' | 'file' | 'timeline' | 'attachment' | 'draft' | 'theme';
type AttachmentReference = { fileId: string; content: CloudFileContent } | BackupDraftAttachmentReference;
function family(doc: Census): Family {
	if (
		!Array.isArray(doc.thingtime) ||
		!doc.thingtime.length ||
		doc.thingtime.length > 64 ||
		doc.thingtime.some((kind) => typeof kind !== 'string' || !id(kind))
	)
		throw Error('Invalid account inventory kind');
	if (doc.thingtime.length === 1 && doc.thingtime[0] === 'draft') return 'draft';
	if (doc.thingtime.length === 1 && doc.thingtime[0] === 'theme') return 'theme';
	if (doc.thingtime.length === 1 && doc.thingtime[0] === 'file') return 'file';
	if (doc.thingtime.length === 1 && doc.thingtime[0] === 'attachment') return 'attachment';
	if (doc.thingtime.length === 1 && isAccountTimelineKind(doc.thingtime[0])) return 'timeline';
	if (isProtectedThingtime(doc.thingtime) || doc.thingtime.some((kind) => (MESSENGER_THINGTIME as readonly string[]).includes(kind)))
		throw Error('Account snapshot needs a dedicated adapter for a managed Thing; no complete inventory was published');
	return 'content';
}
function fileItem(doc: any, ordinal: number): BackupItem {
	const file = parseCloudFile({
		id: doc.shareId,
		revision: doc.timelineHeadId,
		folderId: doc.folderId ?? null,
		name: doc.crystal?.name,
		trashed: doc.crystal?.trashed,
		content: doc.crystal?.content
	});
	return parseBackupItem({
		ordinal,
		thingId: doc.shareId,
		revision: file.revision,
		snapshot: { adapter: CLOUD_FILE_ADAPTER, version: 1, value: file },
		// The separately inventoried attachment owns these bytes.
		content: null
	});
}

/** Internal worker producer, not a public route or complete account-backup API.
 * Enumerates ALL owner rows at one Mongo snapshot. Unsupported managed families
 * fail the plan, never disappear from it. Approved projections use the existing
 * Timeline schemas. No user credentials or native paths enter this producer.
 * Byte capture follows the durable plan and can outlive Mongo's history window;
 * interrupted enumeration itself requires a new snapshot ID/session. */
export function createAccountInventoryProducer(
	overrides: Partial<{
		collection(): Promise<any>;
		snapshot<T>(work: (session: any) => Promise<T>): Promise<T>;
		customPlane(): boolean;
		attachmentHead(input: { objectKey: string; versionId: string }): Promise<AttachmentObjectHead>;
	}> = {}
) {
	const deps = {
		collection: getHomeThingsCollection,
		snapshot: withHomeMongoSnapshot,
		customPlane: isCustomMongoEndpointActive,
		attachmentHead: (input: { objectKey: string; versionId: string }) => getPrivateS3().headObject(input),
		...overrides
	};
	return async (store: BackupObjectStore, snapshotId: string, access: BackupAccess) => {
		const scope = { ...access.scope },
			scopeKey = timelineScopeKey(scope);
		if (!backupId(snapshotId) || !id(scope.ownerId) || scope.dataPlane !== 'home' || deps.customPlane())
			throw Error('Account snapshots require an identified home account');
		const check = async () => {
			access.signal?.throwIfAborted();
			if (deps.customPlane()) throw Error('Account snapshots require home storage');
			if (timelineScopeKey(access.scope) !== scopeKey) throw Error('Backup account or origin changed');
			await access.authorize();
			access.signal?.throwIfAborted();
			if (deps.customPlane() || timelineScopeKey(access.scope) !== scopeKey) throw Error('Backup account or origin changed');
		};
		await check();
		if (await store.read(`snapshots/${snapshotId}/header.json`, BACKUP_METADATA_BYTES))
			throw Error('Account inventory already started; do not rebuild it from live data');
		// Bounded immutable-object HEAD cache; no per-attachment database lookup.
		const heads = new Map<string, AttachmentObjectHead>();
		const readAttachmentHead = async (doc: any) => {
			await check();
			const key = JSON.stringify([doc.shareId, doc.objectKey, doc.objectVersionId, doc.objectSizeBytes]);
			if (heads.has(key)) return heads.get(key)!;
			const value = await deps.attachmentHead({ objectKey: doc.objectKey, versionId: doc.objectVersionId });
			await check();
			if (heads.size >= ACCOUNT_INVENTORY_PAGE_SIZE) heads.delete(heads.keys().next().value!);
			heads.set(key, value);
			return value;
		};
		const collection = await deps.collection();
		return deps.snapshot(async (session) => {
			if (!session?.snapshotEnabled || session.inTransaction()) throw Error('Account inventory requires a read-only snapshot session');
			const queryRows = async function* (
				filter: Record<string, unknown>,
				projection: Record<string, number>,
				limit = ACCOUNT_INVENTORY_PAGE_SIZE,
				timeline = false
			) {
				await check();
				const cursor = collection
					.find(
						{ ...filter, ownerId: scope.ownerId },
						{
							session,
							projection,
							readPreference: 'primary',
							collation: { locale: 'simple' },
							// Missing index is an error, never a cross-account scan fallback.
							hint: THINGS_OWNER_IDENTITY_INDEX,
							maxTimeMS: 10_000,
							signal: access.signal
						}
					)
					.sort({ shareId: 1 })
					.limit(limit)
					.batchSize(limit);
				let count = 0;
				try {
					for await (const row of cursor) {
						access.signal?.throwIfAborted();
						if (count++ >= limit) throw Error('Account inventory page exceeds its bound');
						// Bound projected metadata before retaining an entire page. The driver
						// still owns its bounded wire batch; no oversized row reaches the plan.
						if (timeline) timelineBackupRecordFromDoc(row);
						else if (projection === backupDraftProjection) backupDraftFromDoc(row);
						else if (projection === backupThemeProjection) backupThemeSnapshotFromDoc(row);
						else if (projection !== contentProjection) {
							const bounded = projection === backupAttachmentProjection ? { ...row } : row;
							if (projection === backupAttachmentProjection) {
								for (const key of ['attachmentExpiresAt', 'attachmentPartsIssuedAt', 'attachmentMpuEmptyVerifiedAt']) {
									if (bounded[key] instanceof Date) bounded[key] = bounded[key].toISOString();
								}
							}
							backupJson(bounded, BACKUP_METADATA_BYTES + 8192);
						}
						yield row;
					}
				} finally {
					await cursor.close();
				}
				await check();
			};
			const query = async (...args: Parameters<typeof queryRows>) => {
				const result: any[] = [];
				for await (const row of queryRows(...args)) result.push(row);
				return result;
			};
			let page = await query({}, censusProjection);
			const timestamp = session.snapshotTime;
			if (!timestamp || typeof timestamp.getHighBitsUnsigned !== 'function' || typeof timestamp.getLowBitsUnsigned !== 'function')
				throw Error('The server did not supply an account snapshot boundary');
			const seconds = timestamp.getHighBitsUnsigned(),
				increment = timestamp.getLowBitsUnsigned();
			if (![seconds, increment].every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff))
				throw Error('Invalid account snapshot boundary');
			const token = `mongo:${seconds}:${increment}`,
				occurredAt = new Date(seconds * 1000).toISOString();
			const boundary = () => {
				if (session.snapshotTime?.getHighBitsUnsigned() !== seconds || session.snapshotTime?.getLowBitsUnsigned() !== increment)
					throw Error('Account snapshot boundary changed');
			};
			const readAttachments = async (docs: any[]) => {
				// Validate the whole owner batch before any storage request. Eight
				// concurrent immutable HEADs bound both provider load and snapshot time.
				for (const doc of docs) validateBackupAttachmentDoc(doc, scope.ownerId, Date.parse(occurredAt));
				const records = new Map<string, Awaited<ReturnType<typeof backupAttachmentFromDoc>>>();
				for (let at = 0; at < docs.length; at += 8) {
					const batch = docs.slice(at, at + 8);
					const results = await Promise.allSettled(
						batch.map((doc) => backupAttachmentFromDoc(doc, scope.ownerId, Date.parse(occurredAt), readAttachmentHead))
					);
					await check();
					boundary();
					for (let index = 0; index < results.length; index++) {
						const result = results[index];
						if (result.status === 'rejected') throw result.reason;
						records.set(batch[index].shareId, result.value);
					}
				}
				return records;
			};
			const verifyReferences = async (references: AttachmentReference[]) => {
				const byId = new Map<string, AttachmentReference[]>();
				for (const ref of references) {
					const id = 'content' in ref ? ref.content.attachmentId : ref.attachmentId;
					const group = byId.get(id) ?? [];
					group.push(ref);
					byId.set(id, group);
				}
				const ids = [...byId.keys()];
				for (let offset = 0; offset < ids.length; offset += ACCOUNT_INVENTORY_PAGE_SIZE) {
					const batch = ids.slice(offset, offset + ACCOUNT_INVENTORY_PAGE_SIZE),
						expectedIds = new Set(batch);
					const found = await query({ shareId: { $in: batch } }, backupAttachmentProjection);
					boundary();
					if (
						found.length !== batch.length ||
						new Set(found.map((doc) => doc.shareId)).size !== batch.length ||
						found.some((doc) => !expectedIds.has(doc.shareId))
					)
						throw Error('Historical or draft attachment is missing or changed');
					const attachments = await readAttachments(found);
					for (const doc of found)
						for (const ref of byId.get(doc.shareId)!) {
							if ('content' in ref) verifyBackupFileReference(ref.content, ref.fileId, attachments.get(doc.shareId)!);
							else {
								if (doc.attachmentExpiresAt != null || doc.attachmentImportDraft) throw Error('Draft attachment is not durably bound');
								verifyBackupDraftAttachment(ref, attachments.get(doc.shareId)!);
							}
						}
				}
			};
			const sameRow = (doc: any, head: Census | undefined, kind: Family) => {
				if (
					!head ||
					doc.ownerId !== scope.ownerId ||
					doc.shareId !== head.shareId ||
					JSON.stringify(doc.thingtime) !== JSON.stringify(head.thingtime) ||
					family(doc) !== kind
				)
					throw Error('Account snapshot content changed');
			};

			async function* rows() {
				let last = '',
					ordinal = 0;
				while (page.length) {
					boundary();
					const groups = new Map<Family, Census[]>();
					for (const row of page) {
						if (!id(row.shareId) || row.shareId <= last || row.ownerId !== scope.ownerId) throw Error('Account inventory identity is ambiguous');
						last = row.shareId;
						const kind = family(row),
							group = groups.get(kind) ?? [];
						group.push(row);
						groups.set(kind, group);
					}
					const projected = new Map<string, BackupItem>();
					const references: { fileId: string; content: CloudFileContent }[] = [];
					const pageOrdinal = ordinal;
					const ordinals = new Map(page.map((row, index) => [row.shareId, pageOrdinal + index]));
					// Bounded family batches, never a payload query per Thing. Large
					// Timeline/draft envelopes use eight rows (at most ~32 MiB of content).
					for (const [kind, group] of groups) {
						const batchSize = kind === 'timeline' || kind === 'draft' ? 8 : ACCOUNT_INVENTORY_PAGE_SIZE;
						for (let offset = 0; offset < group.length; offset += batchSize) {
							const expected = group.slice(offset, offset + batchSize);
							if (kind === 'content' || kind === 'theme') {
								// Process one large canonical record at a time. Never collect 128
								// potentially large payloads in addition to the driver's wire batch.
								let count = 0;
								for await (const doc of queryRows(
									{ shareId: { $in: expected.map((row) => row.shareId) } },
									kind === 'theme' ? backupThemeProjection : contentProjection,
									batchSize
								)) {
									await check();
									boundary();
									sameRow(doc, expected[count++], kind);
									const retain = kind === 'theme' ? retainBackupThemeSnapshot : retainBackupThingSnapshot;
									const entry = await retain(store, snapshotId, ordinals.get(doc.shareId)!, doc, {
										...access,
										scope,
										authorize: check
									});
									boundary();
									projected.set(doc.shareId, entry);
								}
								if (count !== expected.length) throw Error('Account snapshot content is incomplete');
								continue;
							}

							const found = await query(
								{ shareId: { $in: expected.map((row) => row.shareId) } },
								kind === 'draft'
									? backupDraftProjection
									: kind === 'timeline'
									? timelineBackupProjection
									: kind === 'attachment'
									? backupAttachmentProjection
									: kind === 'file'
									? fileProjection
									: contentProjection,
								batchSize,
								kind === 'timeline'
							);
							boundary();
							if (found.length !== expected.length) throw Error('Account snapshot content is incomplete');
							const attachments = kind === 'attachment' ? await readAttachments(found) : null;
							const drafts = kind === 'draft' ? found.map(backupDraftFromDoc) : null;
							if (drafts) await verifyReferences(drafts.flatMap(backupDraftAttachmentReferences));
							for (let index = 0; index < found.length; index++) {
								const doc = found[index],
									head = expected[index];
								sameRow(doc, head, kind);
								const entry =
									kind === 'draft'
										? await retainBackupDraft(store, snapshotId, ordinals.get(doc.shareId)!, drafts![index], { ...access, scope, authorize: check })
										: kind === 'timeline'
										? await retainTimelineBackupRecord(store, snapshotId, ordinals.get(doc.shareId)!, doc, { ...access, scope, authorize: check })
										: kind === 'attachment'
										? backupAttachmentItem(attachments!.get(doc.shareId)!, 0)
										: fileItem(doc, 0);
								if (kind === 'file')
									references.push(...backupFileReferences(entry.snapshot, doc.shareId).map((content) => ({ fileId: doc.shareId, content })));
								if (kind === 'timeline') {
									const record = timelineBackupRecordFromDoc(doc);
									if (record.kind === 'timeline-event') {
										const event = (record.value as any).event;
										for (const snapshot of [event.before, event.after])
											references.push(...backupFileReferences(snapshot, event.thingId).map((content) => ({ fileId: event.thingId, content })));
									}
								}
								boundary();
								projected.set(doc.shareId, entry);
							}
						}
					}
					// Resolve file/history byte dependencies in bounded owner-indexed
					// queries at this SAME database timestamp. Never silently retain a
					// pointer to missing, foreign or changed historical file bytes.
					await verifyReferences(references);
					for (const row of page) {
						await check();
						boundary();
						yield { ...projected.get(row.shareId)!, ordinal: ordinal++ };
					}
					page = await query({ shareId: { $gt: last } }, censusProjection);
				}
				boundary();
				await check();
			}
			return prepareBackup(
				store,
				{
					format: BACKUP_FORMAT,
					snapshotId,
					scope,
					boundary: { kind: 'point-in-time', token, startedAt: occurredAt, completedAt: occurredAt },
					coverage: {
						selectionId: `owned-things:${scope.ownerId}`,
						description:
							'All owned Things in home storage at one database snapshot; unsupported managed families refuse the entire inventory. Account settings outside this collection and other devices require separate producers.'
					}
				},
				rows(),
				{ ...access, scope, authorize: check }
			);
		});
	};
}
