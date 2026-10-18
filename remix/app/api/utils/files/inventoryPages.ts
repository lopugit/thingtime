import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { isFolderThing, folderThingMatch } from '../../../schemas/folderThing';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { StorageMutationError } from '../storage/storageCore';
import { parseCloudFile } from '../../../fileSync/cloudFile';
import { validSyncPath } from '../../../fileSync/reconcile';
import { parseCloudInventoryRoot, type CloudInventoryNode } from '../../../fileSync/cloudInventory';
import { CLOUD_INVENTORY_PAGE_BYTES, CLOUD_INVENTORY_PAGE_ENTRIES, CLOUD_INVENTORY_TIMEOUT_MS,
	parseCloudInventoryPage, type CloudInventoryPage } from '../../../fileSync/cloudInventoryPages';
import { cloudInventoryAccess as access, readCloudInventoryRoot } from './inventory';
import { openInventoryQueue } from './inventoryQueue';

/** One read-only Mongo snapshot, with backpressure all the way from the client
 * to the cursor. This is a fresh observation, not a durable server job. Expired
 * Mongo history, cancellation or process loss invalidates the entire capture. */
export function createCloudInventoryPagesService(overrides: Partial<{
	collection(): Promise<any>;
	snapshot<T>(work: (session: any) => Promise<T>): Promise<T>;
	workspace: typeof openInventoryQueue;
	customPlane(): boolean;
	now(): number;
}> = {}) {
	const deps = { collection: getHomeThingsCollection, snapshot: withHomeMongoSnapshot,
		workspace: openInventoryQueue, customPlane: isCustomMongoEndpointActive, now: Date.now, ...overrides };
	let active = 0;
	return async (ownerId: string, rootId: unknown, emit: (page: CloudInventoryPage) => Promise<void>, signal?: AbortSignal) => {
		const fail = (status: number, message: string): never => { throw new StorageMutationError(status, 'storage_conflict', message); };
		if (!access.identity(ownerId) || !access.identity(rootId)) fail(400, 'Choose a cloud folder root');
		if (deps.customPlane()) fail(409, 'Files currently require the home data plane');
		const started = deps.now();
		const check = () => {
			signal?.throwIfAborted();
			if (deps.customPlane()) fail(409, 'Cloud inventory data plane changed');
			if (deps.now() - started >= CLOUD_INVENTORY_TIMEOUT_MS) fail(503, 'Cloud inventory timed out; keep the last complete scan.');
		};
		const budget = () => { check(); return Math.min(5000, CLOUD_INVENTORY_TIMEOUT_MS - (deps.now() - started)); };
		check();
		if (active >= 2) fail(503, 'Cloud inventory capacity is busy; retry later.');
		active++;
		try {
			const queue = await deps.workspace();
			let terminal: CloudInventoryPage;
			try {
				const things = await deps.collection();
				terminal = await deps.snapshot(async session => {
					if (!session?.snapshotEnabled || session.inTransaction()) throw Error('Inventory requires a read-only snapshot session');
					const root = await readCloudInventoryRoot(things, session, ownerId, rootId as string, budget, signal);
					const timestamp = session.snapshotTime;
					if (!timestamp || typeof timestamp.getHighBitsUnsigned !== 'function' || typeof timestamp.getLowBitsUnsigned !== 'function')
						throw Error('Cloud inventory snapshot time is unavailable');
					const identity = { ...parseCloudInventoryRoot({ rootId: rootId as string, rootRevision: access.folderRevision(root) }),
						version: 1 as const, generation: `${timestamp.getHighBitsUnsigned()}.${timestamp.getLowBitsUnsigned()}.${randomUUID()}` };
					let nodes: CloudInventoryNode[] = [], bytes = 4096, ordinal = 0, count = 0;
					const flush = async () => {
						check(); await emit(parseCloudInventoryPage({ ...identity, ordinal, nodes }, identity.rootId)); check();
						ordinal++; nodes = []; bytes = 4096;
					};
					await queue.append({ id: identity.rootId, path: '', depth: 0 });
					for (;;) {
						check(); const parents = await queue.read(CLOUD_INVENTORY_PAGE_ENTRIES);
						if (!parents.length) break;
						const paths = new Map(parents.map(parent => [parent.id, parent]));
						if (paths.size !== parents.length) fail(409, 'Cloud folder identities are ambiguous');
						const cursor = things.find({ ownerId, folderId: { $in: [...paths.keys()] },
							$or: [...folderThingMatch().$or, { thingtime: 'file', 'crystal.trashed': { $ne: true } }] },
							{ session, projection: access.projection, maxTimeMS: budget(), signal, readPreference: 'primary' })
							.sort({ createdAt: -1, shareId: 1 }).batchSize(CLOUD_INVENTORY_PAGE_ENTRIES);
						try {
							for await (const doc of cursor) {
								check(); const parent = paths.get(doc.folderId);
								if (!parent || !access.owned(doc, ownerId) || !access.privateAudience(doc, true) || doc.shareId === rootId)
									fail(409, 'Cloud inventory contains an inaccessible or ambiguous item');
								if (parent.depth >= MAX_FOLDER_DEPTH) fail(409, 'Cloud folder depth exceeds the inventory bound');
								const name = doc.crystal?.name;
								if (typeof name !== 'string' || name.includes('/') || !validSyncPath(name)) fail(409, 'A cloud file or folder has an invalid name');
								const path = parent.path ? parent.path + '/' + name : name;
								if (!validSyncPath(path)) fail(409, 'A cloud path exceeds the supported bounds');
								let node: CloudInventoryNode;
								if (isFolderThing(doc)) {
									if (doc.thingtime?.includes('file') || doc.crystal?.trashed === true) fail(409, 'A cloud folder has an ambiguous kind');
									node = { kind: 'folder', path, id: doc.shareId, folderId: doc.folderId, revision: access.folderRevision(doc) };
									await queue.append({ id: doc.shareId, path, depth: parent.depth + 1 });
								} else {
									if (doc.thingtime?.length !== 1 || doc.thingtime[0] !== 'file') fail(409, 'A cloud file has an ambiguous kind');
									node = { kind: 'file', path, file: parseCloudFile({ id: doc.shareId, revision: doc.timelineHeadId,
										name, folderId: doc.folderId, trashed: doc.crystal.trashed, content: doc.crystal.content }) };
								}
								const length = Buffer.byteLength(JSON.stringify(node)) + 1;
								if (length + 4096 > CLOUD_INVENTORY_PAGE_BYTES) fail(413, 'Cloud inventory row exceeds its byte bound');
								if (nodes.length && (nodes.length >= CLOUD_INVENTORY_PAGE_ENTRIES || bytes + length > CLOUD_INVENTORY_PAGE_BYTES)) await flush();
								nodes.push(node); bytes += length; count++;
								if (!Number.isSafeInteger(count)) fail(413, 'Cloud inventory count exceeds its bound');
							}
						} finally { await cursor.close(); }
					}
					check(); return parseCloudInventoryPage({ ...identity, ordinal, nodes, totalEntries: count }, identity.rootId);
				});
			} finally { await queue.close(); }
			// Publish completion only after the source session and scratch queue close.
			check(); await emit(terminal); check();
		} finally { active--; }
	};
}
export const streamCloudInventoryPages = createCloudInventoryPagesService();
