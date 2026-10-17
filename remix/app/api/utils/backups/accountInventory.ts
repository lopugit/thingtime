import { createHash } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoSnapshot, THINGS_OWNER_IDENTITY_INDEX } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { isProtectedThingtime } from '../../../schemas/registry';
import { thingContentSnapshot } from '../timeline/recordMutation';
import { CLOUD_FILE_ADAPTER, parseCloudFile } from '../../../fileSync/cloudFile';
import { timelineScopeKey } from '../../../timeline/contract';
import { BACKUP_FORMAT, BACKUP_METADATA_BYTES, backupId, backupJson, parseBackupItem, type BackupItem } from '../../../backups/manifest';
import { prepareBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';

export const ACCOUNT_INVENTORY_PAGE_SIZE = 128;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
// Census reads never fetch crystal, secure, tokens, grants or private envelopes.
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
type Family = 'content' | 'file';
function family(doc: Census): Family {
	if (
		!Array.isArray(doc.thingtime) ||
		!doc.thingtime.length ||
		doc.thingtime.length > 64 ||
		doc.thingtime.some((kind) => typeof kind !== 'string' || !id(kind))
	)
		throw Error('Invalid account inventory kind');
	if (doc.thingtime.length === 1 && doc.thingtime[0] === 'file') return 'file';
	if (isProtectedThingtime(doc.thingtime))
		throw Error('Account snapshot needs a dedicated adapter for a managed Thing; no complete inventory was published');
	return 'content';
}
function item(doc: any, ordinal: number, kind: Family): BackupItem {
	if (kind === 'file') {
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
			content: { size: file.content.size, fingerprint: file.content.fingerprint }
		});
	}
	const snapshot = thingContentSnapshot(doc)!;
	const revision = doc.timelineHeadId ?? 'snapshot-' + createHash('sha256').update(backupJson(snapshot, BACKUP_METADATA_BYTES)).digest('hex');
	return parseBackupItem({ ordinal, thingId: doc.shareId, revision, snapshot, content: null });
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
	}> = {}
) {
	const deps = { collection: getHomeThingsCollection, snapshot: withHomeMongoSnapshot, customPlane: isCustomMongoEndpointActive, ...overrides };
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
		const collection = await deps.collection();
		return deps.snapshot(async (session) => {
			if (!session?.snapshotEnabled || session.inTransaction()) throw Error('Account inventory requires a read-only snapshot session');
			const query = async (filter: Record<string, unknown>, projection: Record<string, number>) => {
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
					.limit(ACCOUNT_INVENTORY_PAGE_SIZE)
					.batchSize(ACCOUNT_INVENTORY_PAGE_SIZE);
				const rows: any[] = [];
				try {
					for await (const row of cursor) {
						access.signal?.throwIfAborted();
						if (rows.length >= ACCOUNT_INVENTORY_PAGE_SIZE) throw Error('Account inventory page exceeds its bound');
						// Bound projected metadata before retaining an entire page. The driver
						// still owns its bounded wire batch; no oversized row reaches the plan.
						backupJson(row, BACKUP_METADATA_BYTES + 8192);
						rows.push(row);
					}
				} finally {
					await cursor.close();
				}
				await check();
				return rows;
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
					// One bounded payload query per supported family, never per Thing.
					for (const [kind, expected] of groups) {
						const found = await query({ shareId: { $in: expected.map((row) => row.shareId) } }, kind === 'file' ? fileProjection : contentProjection);
						boundary();
						if (found.length !== expected.length) throw Error('Account snapshot content is incomplete');
						for (let index = 0; index < found.length; index++) {
							const doc = found[index],
								head = expected[index];
							if (
								doc.ownerId !== scope.ownerId ||
								doc.shareId !== head.shareId ||
								JSON.stringify(doc.thingtime) !== JSON.stringify(head.thingtime) ||
								family(doc) !== kind
							)
								throw Error('Account snapshot content changed');
							projected.set(doc.shareId, item(doc, 0, kind));
						}
					}
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
