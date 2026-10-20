import { StorageMutationError } from '../storage/storageCore';
import { getHomeThingsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { readCloudInventoryRoot, readCloudInventoryNode, cloudInventoryAccess } from './inventory';
import { openInventoryUniqueness } from './inventoryUniqueness';
import { folderThingMatch } from '../../../schemas/folderThing';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { syncPathKey, validSyncPath, validateSyncScope } from '../../../fileSync/reconcile';
import { parseFileSyncConfiguration } from '../../../fileSync/configuration';
import { type CloudInventoryNode } from '../../../fileSync/cloudInventory';
import { UPLOAD_BATCH_METADATA_BYTES } from '../../../fileSync/uploadBatch';

class BatchObservationConflict extends Error {}
class BatchObservationAuthority extends Error {}
const closed = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => keys.includes(k));
export function parseBatchObserveRequest(v: any) {
	if (
		!closed(v, ['phase', 'scope', 'configuration', 'paths']) ||
		v.phase !== 'observe' ||
		!closed(v.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']) ||
		!closed(v.configuration, ['id', 'updatedAt', 'configuration']) ||
		Buffer.byteLength(JSON.stringify(v)) > UPLOAD_BATCH_METADATA_BYTES
	)
		throw Error('Invalid batch observation');
	validateSyncScope(v.scope);
	const c = parseFileSyncConfiguration(v.configuration.configuration);
	if (
		v.scope.dataPlane !== 'home' ||
		v.configuration.id !== v.scope.rootId ||
		typeof v.configuration.updatedAt !== 'string' ||
		!Number.isFinite(Date.parse(v.configuration.updatedAt)) ||
		c.deviceId !== v.scope.deviceId ||
		!['upload', 'backup'].includes(c.mode) ||
		c.paused ||
		c.propagateDeletes ||
		c.sourceKind === 'photos' ||
		!Array.isArray(v.paths) ||
		!v.paths.length ||
		v.paths.length > 256 ||
		v.paths.some((p: any) => typeof p !== 'string' || !validSyncPath(p) || p.split('/').length > MAX_FOLDER_DEPTH) ||
		new Set(v.paths.map(syncPathKey)).size !== v.paths.length
	)
		throw Error('Invalid batch observation');
	return { ...v, configuration: { ...v.configuration, configuration: c } };
}

/** One snapshot and one sibling cursor per depth, shared by every requested
 * prefix. Full sibling namespace validation uses the existing bounded disk
 * uniqueness gate; only the <=256 requested paths and ancestors stay in RAM. */
export function createBatchObserveService(
	overrides: Partial<{
		collection: typeof getHomeThingsCollection;
		snapshot: typeof withHomeMongoSnapshot;
		workspace: typeof openInventoryUniqueness;
		now: () => number;
	}> = {}
) {
	const deps = {
		collection: getHomeThingsCollection,
		snapshot: withHomeMongoSnapshot,
		workspace: openInventoryUniqueness,
		now: Date.now,
		...overrides
	};
	return async (owner: string, root: string, paths: string[], signal: AbortSignal) => {
		const started = deps.now();
		const budget = () => {
			signal.throwIfAborted();
			if (isCustomMongoEndpointActive()) throw new BatchObservationAuthority();
			if (deps.now() - started >= 20000) throw Error('Observation deadline');
			return Math.min(5000, 20000 - (deps.now() - started));
		};
		try {
			const things = await deps.collection();
			return await deps.snapshot(async (session) => {
				if (!session?.snapshotEnabled) throw Error('Observation requires a snapshot');
				try {
					await readCloudInventoryRoot(things, session, owner, root, budget, signal);
				} catch (error) {
					if (error instanceof StorageMutationError && (error.status === 404 || error.status === 409)) throw new BatchObservationAuthority();
					throw error;
				}
				const wanted = new Set<string>(),
					parents = new Set<string>();
				for (const path of paths) {
					const parts = path.split('/');
					for (let i = 1; i <= parts.length; i++) {
						const p = parts.slice(0, i).join('/');
						wanted.add(p);
						if (i < parts.length) parents.add(p);
					}
				}
				const exact = new Map<string, string>();
				for (const path of wanted) {
					const key = syncPathKey(path);
					if (exact.has(key) && exact.get(key) !== path) throw new BatchObservationConflict('Ambiguous requested ancestry');
					exact.set(key, path);
				}
				const folded = new Set([...wanted].map(syncPathKey)),
					found = new Map<string, CloudInventoryNode>();
				let frontier = new Map<string, string>([[root, '']]);
				const keys = await deps.workspace();
				try {
					await keys.add('id:' + root, budget);
					for (let depth = 0; frontier.size && depth < MAX_FOLDER_DEPTH; depth++) {
						const next = new Map<string, string>();
						const cursor = things
							.find(
								{
									ownerId: owner,
									folderId: { $in: [...frontier.keys()] },
									$or: [...folderThingMatch().$or, { thingtime: 'file', 'crystal.trashed': { $ne: true } }]
								},
								{ session, projection: cloudInventoryAccess.projection, maxTimeMS: budget(), signal, readPreference: 'primary' }
							)
							.batchSize(100);
						try {
							for await (const doc of cursor) {
								budget();
								const prefix = frontier.get(doc.folderId);
								if (prefix === undefined) throw new BatchObservationConflict('Unexpected folder');
								const node = readCloudInventoryNode(doc, owner, doc.folderId, prefix, root),
									key = syncPathKey(node.path);
								if (!(await keys.add('id:' + doc.shareId, budget)) || !(await keys.add('path:' + key, budget)))
									throw new BatchObservationConflict('Ambiguous cloud namespace');
								if (folded.has(key) && !wanted.has(node.path)) throw new BatchObservationConflict('Cloud path alias');
								if (wanted.has(node.path)) {
									found.set(node.path, node);
									if (parents.has(node.path)) {
										if (node.kind !== 'folder') throw new BatchObservationConflict('Cloud ancestor is a file');
										next.set(node.id, node.path);
									}
								}
							}
						} finally {
							await cursor.close();
						}
						frontier = next;
					}
					budget();
					const observations = paths.map((path) => {
						const prefix = path.split('/').slice(0, -1).join('/');
						return { path, node: found.get(path) ?? null, parent: prefix ? found.get(prefix) ?? null : null };
					});
					const response = { ok: true as const, version: 1 as const, observations };
					if (Buffer.byteLength(JSON.stringify(response)) > UPLOAD_BATCH_METADATA_BYTES)
						throw new BatchObservationConflict('Observation response exceeds bound');
					return response;
				} finally {
					await keys.close();
				}
			});
		} catch (error) {
			return {
				ok: false as const,
				status:
					error instanceof BatchObservationAuthority
						? 403
						: error instanceof BatchObservationConflict || error instanceof StorageMutationError
						? 409
						: 503,
				authorityChanged: error instanceof BatchObservationAuthority,
				error: 'A complete unambiguous batch observation is unavailable; retry or reconcile individually'
			};
		}
	};
}
export const observeBatchPaths = createBatchObserveService();
