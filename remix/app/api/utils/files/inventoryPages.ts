import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { folderThingMatch } from '../../../schemas/folderThing';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { StorageMutationError } from '../storage/storageCore';
import { parseCloudInventoryRoot, type CloudInventoryNode } from '../../../fileSync/cloudInventory';
import { CLOUD_INVENTORY_PAGE_BYTES, CLOUD_INVENTORY_PAGE_ENTRIES, CLOUD_INVENTORY_TIMEOUT_MS,
	parseCloudInventoryPage, type CloudInventoryPage } from '../../../fileSync/cloudInventoryPages';
import { cloudInventoryAccess as access, readCloudInventoryRoot, readCloudInventoryNode } from './inventory';
import { openInventoryQueue } from './inventoryQueue';
import { resolveCloudChangeTarget } from './inventoryChanges';

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
	return async (ownerId: string, rootId: unknown, emit: (page: CloudInventoryPage) => Promise<void>, signal?: AbortSignal, subtreeId?: string) => {
		const fail = (status: number, message: string): never => { throw new StorageMutationError(status, 'storage_conflict', message); };
		if (!access.identity(ownerId) || !access.identity(rootId) || (subtreeId !== undefined && !access.identity(subtreeId))) fail(400, 'Choose a cloud folder root');
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
					if (subtreeId !== undefined) {
                        const subtree = await resolveCloudChangeTarget(things, session, ownerId, identity.rootId, subtreeId, budget, signal);
                        if (!subtree || subtree.node.kind !== 'folder') fail(409, 'The changed subtree is unavailable; retry reconciliation.');
                        await queue.append({ id: subtreeId, path: subtree.node.path, depth: subtree.node.path.split('/').length });
                    } else await queue.append({ id: identity.rootId, path: '', depth: 0 });
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
								const node = readCloudInventoryNode(doc, ownerId, parent.id, parent.path, rootId as string);
								if (node.kind === 'folder') await queue.append({ id: node.id, path: node.path, depth: parent.depth + 1 });
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
