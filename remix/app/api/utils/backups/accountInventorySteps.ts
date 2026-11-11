import { attachmentPhysicalObject } from '../attachments/attachmentBlobs';
import { createHash } from 'node:crypto';
import { Timestamp } from 'mongodb';
import { getHomeThingsCollection, getHomeThingtimeDb, THINGS_OWNER_IDENTITY_INDEX } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { timelineScopeKey } from '../../../timeline/contract';
import {
	BACKUP_FORMAT,
	BACKUP_METADATA_BYTES,
	BACKUP_PAGE_BYTES,
	backupId,
	backupDigest,
	backupJson,
	parseBackupHeader,
	parseBackupItem,
	parseBackupPage,
	parseBackupPlan,
	type BackupItem,
	type BackupPlan
} from '../../../backups/manifest';
import { type BackupAccess, type BackupObjectStore } from './portableBackup';
import { censusProjection, contentProjection, fileProjection, family, fileItem, type Census } from './accountInventory';
import {
	backupAccountProjection,
	backupAccountSnapshotFromDoc,
	retainBackupAccountContent,
	backupProfileAttachmentReferences,
	verifyBackupProfileAttachment
} from './accountSnapshots';
import {
	backupDraftProjection,
	backupDraftFromDoc,
	retainBackupDraft,
	backupDraftAttachmentReferences,
	verifyBackupDraftAttachment
} from './draftRecords';
import { backupThemeProjection, retainBackupThemeSnapshot } from './themeSnapshots';
import { backupNotificationProjection, retainBackupNotification } from './notificationSnapshots';
import { retainBackupThingSnapshot } from './thingSnapshots';
import { timelineBackupProjection, timelineBackupRecordFromDoc, retainTimelineBackupRecord } from './timelineRecords';
import {
	backupAttachmentProjection,
	backupAttachmentFromDoc,
	backupAttachmentItem,
	backupFileReferences,
	verifyBackupFileReference
} from './attachmentRecords';
import { openAccountInventoryReferences } from './accountInventoryReferences';
import { accountContentValue } from '../../../timeline/accountContent';
import { getPrivateS3, type AttachmentObjectHead } from '../attachments/privateS3';
import {
	BACKUP_SOURCE_EXCLUSION_ADAPTER,
	parseBackupSourceExclusion,
	BACKUP_REFERENCE_COVERAGE_ADAPTER,
	parseBackupReferenceEvidence
} from './storedReferences';

/** Fixed-size durable continuation. No driver session, cursor, catalogue or
 * reference-index state survives a unit. The engine commits it with lease CAS. */
export type AccountInventoryCursor = {
	seconds: number | null;
	increment: number | null;
	lastThingId: string | null;
	nextOrdinal: number;
	pages: number;
	previousHash: string | null;
	bytes: string;
	excluded: number;
	referenceStateHash: string | null;
};
export const initialAccountInventoryCursor = (): AccountInventoryCursor => ({
	seconds: null,
	increment: null,
	lastThingId: null,
	nextOrdinal: 0,
	pages: 0,
	previousHash: null,
	bytes: '0',
	excluded: 0,
	referenceStateHash: null
});
export const ACCOUNT_INVENTORY_STEP_RECORDS = 128;
const hash = (v: unknown) => createHash('sha256').update(backupJson(v)).digest('hex');
const uint32 = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 0xffffffff;
const identity = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const scalarCount = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export class AccountInventorySnapshotExpiredError extends Error {
	readonly code = 'snapshot-expired';
	readonly recoverable = true;
	constructor() {
		super('The pinned account snapshot is no longer available; start a new backup inventory');
		this.name = 'AccountInventorySnapshotExpiredError';
	}
}
export class AccountInventorySnapshotUnavailableError extends Error {
	readonly code = 'snapshot-unavailable';
	readonly recoverable = true;
	readonly retrySameTimestamp = true;
	constructor() {
		super('The pinned account snapshot is temporarily unavailable; retry this exact continuation');
		this.name = 'AccountInventorySnapshotUnavailableError';
	}
}
const expired = (error: any) => error?.code === 239 || error?.code === 250 || ['SnapshotTooOld', 'StaleChunkHistory'].includes(error?.codeName);
const unavailable = (error: any) => error?.code === 246 || error?.codeName === 'SnapshotUnavailable';
function validateCursor(cursor: AccountInventoryCursor) {
	if (
		!cursor ||
		Object.keys(cursor).sort().join(',') !== 'bytes,excluded,increment,lastThingId,nextOrdinal,pages,previousHash,referenceStateHash,seconds' ||
		![cursor.nextOrdinal, cursor.pages, cursor.excluded].every(scalarCount) ||
		!/^(0|[1-9][0-9]{0,39})$/.test(cursor.bytes) ||
		(cursor.referenceStateHash !== null && !backupDigest(cursor.referenceStateHash)) ||
		(cursor.lastThingId !== null && !identity(cursor.lastThingId)) ||
		(cursor.previousHash !== null && !backupDigest(cursor.previousHash)) ||
		(cursor.seconds === null) !== (cursor.increment === null) ||
		(cursor.seconds !== null && (!uint32(cursor.seconds) || !uint32(cursor.increment))) ||
		(cursor.pages === 0
			? cursor.previousHash !== null || cursor.nextOrdinal !== 0 || cursor.lastThingId !== null || cursor.bytes !== '0' || cursor.excluded !== 0
			: cursor.previousHash === null ||
			  cursor.referenceStateHash === null ||
			  cursor.nextOrdinal < cursor.pages ||
			  cursor.nextOrdinal > cursor.pages * 128) ||
		cursor.excluded > cursor.nextOrdinal ||
		(cursor.seconds === null && backupJson(cursor) !== backupJson(initialAccountInventoryCursor()))
	)
		throw Error('Invalid account inventory continuation');
}

/** Public MongoDB contract: snapshot find + explicit atClusterTime, singleBatch
 * closes every server cursor. The first response supplies cursor.atClusterTime.
 * https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/
 * Missing/out-of-window history never downgrades to an interval/live scan. */
export function createAccountInventoryStepper(
	overrides: Partial<{
		collection(): Promise<any>;
		database(): Promise<any>;
		customPlane(): boolean;
		attachmentHead(input: { objectKey: string; versionId: string }): Promise<AttachmentObjectHead>;
	}> = {}
) {
	const deps = {
		collection: getHomeThingsCollection,
		database: getHomeThingtimeDb,
		customPlane: isCustomMongoEndpointActive,
		attachmentHead: (input: { objectKey: string; versionId: string }) => getPrivateS3().headObject(input),
		...overrides
	};
	return async function advance(
		store: BackupObjectStore,
		snapshotId: string,
		access: BackupAccess,
		input: AccountInventoryCursor
	): Promise<{ cursor: AccountInventoryCursor; complete: boolean; plan: BackupPlan | null }> {
		validateCursor(input);
		const cursor = { ...input },
			scope = { ...access.scope },
			scopeKey = timelineScopeKey(scope),
			deadline = Date.now() + 45_000;
		if (!backupId(snapshotId) || !identity(scope.ownerId) || scope.dataPlane !== 'home')
			throw Error('Account snapshots require an identified home account');
		const tick = () => {
			access.signal?.throwIfAborted();
			if (Date.now() >= deadline) throw Error('Account inventory unit deadline exceeded');
			if (deps.customPlane() || timelineScopeKey(access.scope) !== scopeKey) throw Error('Backup account or origin changed');
		};
		const check = async () => {
			tick();
			await access.authorize();
			tick();
		};
		await check();
		let db: any, collection: any;
		const query = async (filter: Record<string, unknown>, projection: Record<string, number>, limit: number) => {
			await check();
			db ??= await deps.database();
			collection ??= await deps.collection();
			let response;
			try {
				response = await db.command(
					{
						find: collection.collectionName,
						filter: { ...filter, ownerId: scope.ownerId },
						projection,
						sort: { shareId: 1 },
						collation: { locale: 'simple' },
						hint: THINGS_OWNER_IDENTITY_INDEX,
						limit,
						batchSize: limit,
						singleBatch: true,
						maxTimeMS: Math.max(1, Math.min(10_000, deadline - Date.now())),
						readConcern: {
							level: 'snapshot',
							...(cursor.seconds !== null ? { atClusterTime: new Timestamp({ t: cursor.seconds, i: cursor.increment! }) } : {})
						}
					},
					{ readPreference: 'primary', ...(access.signal ? { signal: access.signal } : {}) }
				);
			} catch (error) {
				if (expired(error)) throw new AccountInventorySnapshotExpiredError();
				if (unavailable(error)) throw new AccountInventorySnapshotUnavailableError();
				throw error;
			}
			await check();
			if (
				!response?.cursor ||
				!Array.isArray(response.cursor.firstBatch) ||
				response.cursor.firstBatch.length > limit ||
				(response.cursor.id?.toString?.() ?? '0') !== '0'
			)
				throw Error('Invalid bounded account snapshot response');
			const selected = response.cursor.atClusterTime ?? response.atClusterTime;
			if (cursor.seconds === null) {
				if (!selected || !uint32(selected.getHighBitsUnsigned?.()) || !uint32(selected.getLowBitsUnsigned?.()))
					throw Error('The server did not supply an account snapshot boundary');
				cursor.seconds = selected.getHighBitsUnsigned();
				cursor.increment = selected.getLowBitsUnsigned();
			} else if (selected && (selected.getHighBitsUnsigned?.() !== cursor.seconds || selected.getLowBitsUnsigned?.() !== cursor.increment))
				throw Error('Account snapshot boundary changed');
			return response.cursor.firstBatch as any[];
		};
		if (cursor.seconds === null) {
			await query({}, censusProjection, 1);
			// No immutable writes until the engine durably CASes this timestamp.
			return { cursor, complete: false, plan: null };
		}
		const timestamp = new Date(cursor.seconds * 1000).toISOString(),
			root = `snapshots/${snapshotId}`;
		const header = parseBackupHeader({
			format: BACKUP_FORMAT,
			snapshotId,
			scope,
			boundary: { kind: 'point-in-time', token: `mongo:${cursor.seconds}:${cursor.increment}`, startedAt: timestamp, completedAt: timestamp },
			coverage: {
				selectionId: `supported-owned-things:${scope.ownerId}`,
				description:
					'Explicit supported-content selection: owned home Things at one pinned database timestamp. Unsupported managed families retain typed exclusion metadata only. Exact-version file/history/draft/profile attachment closure is checked. Manifest-bound composition and account-selection evidence distinguishes closed, unresolved and unsupported traversal; no whole-account functional restore coverage. Credentials, security state, external settings and device-local state require separate producers.'
			}
		});
		const put = async (key: string, value: unknown) => {
			await check();
			await store.put(key, new TextEncoder().encode(backupJson(value)));
			await check();
		};
		await put(`${root}/header.json`, header);
		const guarded = { ...access, scope, authorize: check };
		const readExact = async (thingId: string, projection: Record<string, number>) => {
			const found = await query({ shareId: thingId }, projection, 2);
			if (found.length !== 1 || found[0].shareId !== thingId || found[0].ownerId !== scope.ownerId)
				throw Error('Pinned account dependency is missing or ambiguous');
			return found[0];
		};
		const attachment = async (doc: any) =>
			backupAttachmentFromDoc(doc, scope.ownerId, Date.parse(timestamp), async (value: any) => {
				await check();
				const physical = attachmentPhysicalObject(value);
        const head = await deps.attachmentHead({ objectKey: physical.objectKey, versionId: physical.versionId! });
				await check();
				return head;
			});
		const verify = async (references: any[]) => {
			for (const ref of references) {
				const attachmentId = 'content' in ref ? ref.content.attachmentId : ref.attachmentId;
				const doc = await readExact(attachmentId, backupAttachmentProjection),
					record = await attachment(doc);
				if ('content' in ref) verifyBackupFileReference(ref.content, ref.fileId, record);
				else {
					if (doc.attachmentExpiresAt != null || doc.attachmentImportDraft) throw Error('Backup attachment is not durably bound');
					if ('profileSlot' in ref) verifyBackupProfileAttachment(ref, record);
					else verifyBackupDraftAttachment(ref, record);
				}
			}
		};
		const receiptKey = `${root}/inventory-receipts/${hash(input)}.json`;
		const receipt = await store.read(receiptKey, BACKUP_PAGE_BYTES);
		await check();
		const publish = async (page: ReturnType<typeof parseBackupPage> | null, complete: boolean) => {
			const plan = complete
				? parseBackupPlan({
						format: BACKUP_FORMAT,
						snapshotId,
						headerHash: hash(header),
						pages: cursor.pages,
						headHash: cursor.previousHash,
						items: cursor.nextOrdinal,
						bytes: cursor.bytes
				  })
				: null;
			await put(receiptKey, { inputHash: hash(input), cursor, complete, page, plan });
			if (page) await put(`${root}/plan/${page.ordinal}.json`, page);
			if (plan) await put(`${root}/plan.json`, plan);
			return { cursor, complete, plan };
		};
		if (receipt) {
			const text = new TextDecoder('utf8', { fatal: true }).decode(receipt),
				saved = JSON.parse(text);
			if (
				backupJson(saved) !== text ||
				Object.keys(saved).sort().join(',') !== 'complete,cursor,inputHash,page,plan' ||
				saved.inputHash !== hash(input) ||
				typeof saved.complete !== 'boolean'
			)
				throw Error('Retained account inventory receipt changed');
			validateCursor(saved.cursor);
			if (saved.cursor.seconds !== input.seconds || saved.cursor.increment !== input.increment) throw Error('Retained account snapshot changed');
			if (saved.page) {
				const page = parseBackupPage(saved.page);
				if (
					page.snapshotId !== snapshotId ||
					page.ordinal !== input.pages ||
					page.previous !== input.previousHash ||
					saved.cursor.pages !== input.pages + 1 ||
					hash(page) !== saved.cursor.previousHash
				)
					throw Error('Retained account inventory receipt changed');
				await put(`${root}/plan/${page.ordinal}.json`, page);
			} else if (
				saved.cursor.pages !== input.pages ||
				saved.cursor.previousHash !== input.previousHash ||
				saved.cursor.nextOrdinal !== input.nextOrdinal
			)
				throw Error('Retained account continuation changed');
			if (saved.complete) {
				const plan = parseBackupPlan(saved.plan);
				if (
					plan.snapshotId !== snapshotId ||
					plan.headerHash !== hash(header) ||
					plan.pages !== saved.cursor.pages ||
					plan.headHash !== saved.cursor.previousHash ||
					plan.items !== saved.cursor.nextOrdinal ||
					plan.bytes !== saved.cursor.bytes
				)
					throw Error('Retained account plan changed');
				await put(`${root}/plan.json`, plan);
			} else if (saved.plan !== null) throw Error('Premature account plan seal');
			return { cursor: saved.cursor, complete: saved.complete, plan: saved.plan };
		}
		const references = await openAccountInventoryReferences(
			store,
			snapshotId,
			scope.ownerId,
			cursor.referenceStateHash,
			check,
			tick,
			hash({ snapshotId, scope, cursor: input })
		);
		const finishReferenceUnit = async () => {
			const evidence = await references.advance();
			let page: ReturnType<typeof parseBackupPage> | null = null;
			if (evidence) {
				const snapshot = { adapter: BACKUP_REFERENCE_COVERAGE_ADAPTER, version: 1, value: evidence };
				parseBackupReferenceEvidence(snapshot);
				const item = parseBackupItem({
					ordinal: cursor.nextOrdinal++,
					thingId: `~.backup-coverage:${snapshotId}:${String(evidence.page).padStart(16, '0')}`,
					revision: `snapshot-${hash(snapshot)}`,
					snapshot,
					content: null
				});
				page = parseBackupPage({ format: BACKUP_FORMAT, snapshotId, ordinal: cursor.pages++, previous: cursor.previousHash, items: [item] });
				cursor.previousHash = hash(page);
			}
			cursor.referenceStateHash = await references.save();
			return publish(page, references.phase() === 'done');
		};
		if (references.phase() !== 'build') return finishReferenceUnit();
		const rows = await query(
			cursor.lastThingId === null ? {} : { shareId: { $gt: cursor.lastThingId } },
			censusProjection,
			ACCOUNT_INVENTORY_STEP_RECORDS
		);
		const items: BackupItem[] = [];
		let pageBytes = 1024;
		for (const row of rows as Census[]) {
			await check();
			if (!identity(row.shareId) || row.ownerId !== scope.ownerId || (cursor.lastThingId !== null && row.shareId <= cursor.lastThingId))
				throw Error('Account inventory identity is ambiguous');
			await references.identity(row.shareId, row.thingtime);
			const kind = family(row, true),
				ordinal = cursor.nextOrdinal;
			let item: BackupItem;
			if (kind === 'excluded-authority') {
				const excludedFamily = row.thingtime.join('+'),
					legacy = excludedFamily === 'subscription';
				const snapshot = {
					adapter: BACKUP_SOURCE_EXCLUSION_ADAPTER,
					version: legacy ? 1 : 2,
					value: {
						family: excludedFamily,
						reason: legacy
							? 'live-entitlement-authority'
							: ['backup-job', 'backup-job-event'].includes(excludedFamily)
							? 'live-worker-authority'
							: 'unsupported-managed-adapter'
					}
				};
				parseBackupSourceExclusion(snapshot);
				await references.excluded(row.shareId, excludedFamily);
				item = parseBackupItem({ ordinal, thingId: row.shareId, revision: `excluded-${hash(snapshot)}`, snapshot, content: null });
				cursor.excluded++;
			} else {
				const projection =
					kind === 'account'
						? backupAccountProjection
						: kind === 'draft'
						? backupDraftProjection
						: kind === 'theme'
						? backupThemeProjection
						: kind === 'notification'
						? backupNotificationProjection
						: kind === 'timeline'
						? timelineBackupProjection
						: kind === 'attachment'
						? backupAttachmentProjection
						: kind === 'file'
						? fileProjection
						: contentProjection;
				const doc = await readExact(row.shareId, projection);
				if (backupJson(doc.thingtime) !== backupJson(row.thingtime) || family(doc, true) !== kind) throw Error('Account snapshot content changed');
				if (kind === 'content' || kind === 'file') await references.presentation(doc);
				if (kind === 'account') {
					const snapshot = backupAccountSnapshotFromDoc(doc),
						account = accountContentValue(snapshot);
					await references.selection(scope.ownerId, 'theme', account.preferences.activeThemeId);
					await references.selection(scope.ownerId, 'feed-algorithm', account.preferences.activeFeedAlgorithmId);
					await verify(backupProfileAttachmentReferences(snapshot));
					item = await retainBackupAccountContent(store, snapshotId, ordinal, snapshot, guarded);
				} else if (kind === 'draft') {
					const draft = backupDraftFromDoc(doc);
					await verify(backupDraftAttachmentReferences(draft));
					item = await retainBackupDraft(store, snapshotId, ordinal, draft, guarded);
				} else if (kind === 'attachment') {
					const value = await attachment(doc);
					await references.attachment(value, doc.attachmentExpiresAt == null && !doc.attachmentImportDraft);
					item = { ...backupAttachmentItem(value, ordinal), ordinal };
				} else if (kind === 'file') {
					item = fileItem(doc, ordinal);
					await verify(backupFileReferences(item.snapshot, doc.shareId).map((content) => ({ fileId: doc.shareId, content })));
				} else if (kind === 'timeline') {
					const record = timelineBackupRecordFromDoc(doc);
					if (record.kind === 'timeline-event') {
						const event = (record.value as any).event;
						for (const snapshot of [event.before, event.after])
							await verify(backupFileReferences(snapshot, event.thingId).map((content) => ({ fileId: event.thingId, content })));
					}
					item = await retainTimelineBackupRecord(store, snapshotId, ordinal, doc, guarded);
				} else {
					if (kind === 'content') await references.content(doc);
					item = await (kind === 'theme'
						? retainBackupThemeSnapshot
						: kind === 'notification'
						? retainBackupNotification
						: retainBackupThingSnapshot)(store, snapshotId, ordinal, doc, guarded);
				}
			}
			items.push(parseBackupItem(item));
			cursor.lastThingId = row.shareId;
			cursor.nextOrdinal++;
			cursor.bytes = (BigInt(cursor.bytes) + BigInt(item.content?.size ?? 0)).toString();
			pageBytes += Buffer.byteLength(backupJson(item));
			// Flush between records by time and metadata size; the census batch is
			// a processing window, never a maximum account size.
			if (Date.now() >= deadline - 30_000 || pageBytes + BACKUP_METADATA_BYTES + 1024 > BACKUP_PAGE_BYTES) break;
		}
		if (rows.length === 0) {
			await references.closeCensus();
			return finishReferenceUnit();
		}
		const page = parseBackupPage({ format: BACKUP_FORMAT, snapshotId, ordinal: cursor.pages, previous: cursor.previousHash, items });
		backupJson(page, BACKUP_PAGE_BYTES);
		cursor.pages++;
		cursor.previousHash = hash(page);
		cursor.referenceStateHash = await references.save();
		return publish(page, false);
	};
}
export const advanceAccountInventory = createAccountInventoryStepper();
