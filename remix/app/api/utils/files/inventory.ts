import { openInventoryUniqueness } from './inventoryUniqueness';
import { cloudFolderMetadata } from './folderMetadata';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { isFolderThing, folderThingMatch } from '../../../schemas/folderThing';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { parseCloudInventory, inventorySyncEntry, MAX_CLOUD_INVENTORY_BYTES, type CloudInventoryNode } from '../../../fileSync/cloudInventory';
import { MAX_SYNC_SCAN_ENTRIES, validSyncPath, syncPathKey } from '../../../fileSync/reconcile';
import { parseCloudPathObservation } from '../../../fileSync/cloudPath';
import { parseCloudFile } from '../../../fileSync/cloudFile';
import { StorageMutationError } from '../storage/storageCore';

const fail = (status: number, message: string): never => {
	throw new StorageMutationError(status, 'storage_conflict', message);
};
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const projection = {
	_id: 0,
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	folderId: 1,
	targetId: 1,
	appId: 1,
	sandbox: 1,
	sandboxSpace: 1,
	acl: 1,
	updatedAt: 1,
	timelineHeadId: 1,
	'crystal.name': 1,
	'crystal.kind': 1,
	'crystal.type': 1,
	'crystal.trashed': 1,
	'crystal.content': 1
};
const owned = (doc: any, ownerId: string) =>
	doc &&
	identity(doc.shareId) &&
	!doc.shareId.startsWith('timeline-') &&
	doc.ownerId === ownerId &&
	doc.targetId == null &&
	doc.appId == null &&
	doc.sandbox == null &&
	doc.sandboxSpace == null;
const privateAudience = (doc: any, inherited: boolean) =>
	Array.isArray(doc.acl) && doc.acl.length === 1 && (doc.acl[0] === 'tt:user' || (inherited && doc.acl[0] === 'tt:inherit'));
const folderRevision = (doc: any) => cloudFolderMetadata(doc).revision;

/** Read one tree in a Mongo snapshot transaction. Each breadth level is one
 * indexed query, never one request per file/folder. Every failure discards the
 * whole observation, preserving the worker's last complete baseline. */
export function createCloudInventoryService(
	overrides: Partial<{
		collection: () => Promise<any>;
		transaction: (work: (session: any) => Promise<any>) => Promise<any>;
		customPlane: () => boolean;
		now: () => number;
		maxEntries: number;
	}> = {}
) {
	const deps = {
		collection: getHomeThingsCollection,
		transaction: withHomeMongoTransaction,
		customPlane: isCustomMongoEndpointActive,
		now: Date.now,
		maxEntries: MAX_SYNC_SCAN_ENTRIES,
		...overrides
	};
	const readPath = createCloudPathService(overrides);
	return async (ownerId: string, rootId: unknown, requestedPath?: string) => {
		if (requestedPath !== undefined) return readPath(ownerId, rootId, requestedPath);
		if (deps.customPlane()) return { ok: false as const, status: 409, error: 'Files currently require the home data plane' };
		if (!ownerId || !identity(rootId)) return { ok: false as const, status: 400, error: 'Choose a cloud folder root' };
		try {
			const started = deps.now(),
				things = await deps.collection();
			return await deps.transaction(async (session) => {
				if (!session) throw Error('Inventory requires a snapshot transaction');
				const budget = () => {
					const remaining = 20_000 - (deps.now() - started);
					if (remaining <= 0) fail(503, 'Cloud inventory timed out; keep the last complete scan.');
					return Math.min(remaining, 5000);
				};
				const root = await readCloudInventoryRoot(things, session, ownerId, rootId, budget);
				const paths = new Map<string, string>([[rootId, '']]),
					seen = new Set<string>([rootId]),
					nodes: CloudInventoryNode[] = [];
				let frontier = [rootId],
					depth = 0,
					observedBytes = 0;
				while (frontier.length) {
					if (++depth > MAX_FOLDER_DEPTH) fail(409, 'Cloud folder depth exceeds the inventory bound.');
					const cursor = things
						.find(
							{ ownerId, folderId: { $in: frontier }, $or: [...folderThingMatch().$or, { thingtime: 'file', 'crystal.trashed': { $ne: true } }] },
							{ session, projection, maxTimeMS: budget() }
						)
						.sort({ createdAt: -1, shareId: 1 })
						.limit(deps.maxEntries - nodes.length + 1)
						.batchSize(100);
					const docs: any[] = [];
					try {
						for await (const doc of cursor) {
							budget();
							observedBytes += Buffer.byteLength(JSON.stringify(doc));
							if (observedBytes > MAX_CLOUD_INVENTORY_BYTES)
								fail(413, 'Cloud folder exceeds the inventory response bound; no partial scan was returned.');
							docs.push(doc);
						}
					} finally {
						await cursor.close();
					}
					if (nodes.length + docs.length > deps.maxEntries) fail(413, 'Cloud folder exceeds the inventory bound; no partial scan was returned.');
					frontier = [];
					for (const doc of docs) {
						if (!owned(doc, ownerId) || !privateAudience(doc, true) || !identity(doc.folderId) || !paths.has(doc.folderId) || seen.has(doc.shareId))
							fail(409, 'Cloud inventory contains an inaccessible or ambiguous item.');
						seen.add(doc.shareId);
						const node = readCloudInventoryNode(doc, ownerId, doc.folderId, paths.get(doc.folderId)!, rootId);
						nodes.push(node);
						if (node.kind === 'folder') { paths.set(node.id, node.path); frontier.push(node.id); }
					}
				}
				budget();
				try {
					const inventory = parseCloudInventory({ version: 1, complete: true, rootId, rootRevision: folderRevision(root), nodes }, rootId);
					return { ok: true as const, inventory };
				} catch {
					return fail(409, 'Cloud folder paths or identities are ambiguous; review the folder before syncing.');
				}
			});
		} catch (error) {
			return error instanceof StorageMutationError
				? { ok: false as const, status: error.status, error: error.message }
				: { ok: false as const, status: 503, error: 'A complete cloud inventory is unavailable; keep the last complete scan.' };
		}
	};
}
export const readCloudInventory = createCloudInventoryService();

/** A fresh snapshot of one path. Missing roots/root ancestors, authorization failures
 * and bounded-read failures are errors, never evidence of absence. */
export function createCloudPathService(overrides: Parameters<typeof createCloudInventoryService>[0] & { workspace?: typeof openInventoryUniqueness } = {}) {
	const deps = { collection: getHomeThingsCollection, transaction: withHomeMongoTransaction,
		customPlane: isCustomMongoEndpointActive, now: Date.now, workspace: openInventoryUniqueness, ...overrides };
	let active = 0;
	return async (ownerId: string, rootId: unknown, requestedPath: unknown, signal?: AbortSignal) => {
		if (deps.customPlane()) return { ok: false as const, status: 409, error: 'Files currently require the home data plane' };
		if (!ownerId || !identity(rootId)) return { ok: false as const, status: 400, error: 'Choose a cloud folder root' };
		if (typeof requestedPath !== 'string' || !validSyncPath(requestedPath) || requestedPath.split('/').length > MAX_FOLDER_DEPTH)
			return { ok: false as const, status: 400, error: 'Choose a supported relative cloud path' };
		if (active >= 2) return { ok: false as const, status: 503, error: 'Cloud path capacity is busy; retry later.' };
		active++;
		const started = deps.now();
		const budget = () => {
			signal?.throwIfAborted();
			if (deps.customPlane()) fail(409, 'Cloud inventory data plane changed');
			const remaining = 20_000 - (deps.now() - started);
			if (remaining <= 0) fail(503, 'Cloud inventory timed out; keep the last complete scan.');
			return Math.min(remaining, 5000);
		};
		try {
			budget(); const things = await deps.collection();
			const result = await deps.transaction(async session => {
				if (!session) throw Error('Path observation requires a snapshot transaction');
				const root = await readCloudInventoryRoot(things, session, ownerId, rootId, budget, signal);
				// Each transaction retry owns a new index; a failed attempt cannot make
				// the next attempt appear to contain duplicate records.
				const keys = await deps.workspace();
				try {
					await keys.add('id:' + rootId, budget);
					let parentId = rootId, prefix = '', found: CloudInventoryNode | null = null;
					const parts = requestedPath.split('/');
					for (let depth = 0; depth < parts.length; depth++) {
						const expected = prefix ? prefix + '/' + parts[depth] : parts[depth];
						const expectedKey = syncPathKey(expected);
						found = null;
						const cursor = things.find({ ownerId, folderId: { $in: [parentId] },
							$or: [...folderThingMatch().$or, { thingtime: 'file', 'crystal.trashed': { $ne: true } }] },
							{ session, projection, maxTimeMS: budget(), signal, readPreference: 'primary' })
							.batchSize(100); // Uniqueness does not require a database-wide sibling sort.
						try {
							for await (const doc of cursor) {
								budget();
								const node = readCloudInventoryNode(doc, ownerId, parentId, prefix, rootId), key = syncPathKey(node.path);
								if (!await keys.add('id:' + doc.shareId, budget) || !await keys.add('path:' + key, budget))
									fail(409, 'Cloud folder paths or identities are ambiguous; review the folder before syncing.');
								if (key === expectedKey && node.path !== expected) fail(409, 'A cloud path has a case or Unicode alias; review it before syncing.');
								if (node.path === expected) found = node;
							}
						} finally { await cursor.close(); }
						budget();
						if (!found) break;
						if (depth + 1 < parts.length) {
							if (found.kind === 'folder') { parentId = found.id; prefix = found.path; }
							else fail(409, 'A cloud path ancestor is now a file.');
						}
					}
					budget();
					return { ok: true as const, observation: parseCloudPathObservation({ version: 1, complete: true, rootId,
						rootRevision: folderRevision(root), path: requestedPath, entry: found ? inventorySyncEntry(found) : null }, rootId, requestedPath) };
				} finally { await keys.close(); }
			});
			budget(); return result;
		} catch (error) {
			return error instanceof StorageMutationError ? { ok: false as const, status: error.status, error: error.message }
				: { ok: false as const, status: 503, error: 'A complete cloud path observation is unavailable; keep the last complete scan.' };
		} finally { active--; }
	};
}
export const readCloudPath = createCloudPathService();

/** Shared authorization for complete and streamed cloud observations. */
export async function readCloudInventoryRoot(things: any, session: any, ownerId: string, rootId: string, budget: () => number, signal?: AbortSignal) {
	let ancestorId: string | null = rootId,
		root: any = null;
	const ancestors = new Set<string>();
	while (ancestorId) {
		if (ancestors.has(ancestorId) || ancestors.size >= MAX_FOLDER_DEPTH || ancestorId.startsWith('timeline-'))
			fail(409, 'Cloud folder ancestry is invalid.');
		ancestors.add(ancestorId);
		const doc = await things.findOne({ shareId: ancestorId, ownerId, ...folderThingMatch() }, { session, projection, maxTimeMS: budget(), signal, readPreference: 'primary' });
		if (!owned(doc, ownerId) || !isFolderThing(doc) || doc.thingtime?.includes('file') || doc.crystal?.trashed === true)
			fail(404, 'Cloud folder not found');
		if (!root) {
			if (!privateAudience(doc, false)) fail(409, 'Choose a private cloud folder.');
			root = doc;
		}
		if (doc.folderId != null && !identity(doc.folderId)) fail(409, 'Cloud folder ancestry is invalid.');
		ancestorId = doc.folderId ?? null;
	}
	return root;
}

export const cloudInventoryAccess = { projection, identity, owned, privateAudience, folderRevision };

/** Identical row, private audience and path validation for JSON inventories,
 * paged captures and single-path observations. Cross-row uniqueness is checked
 * by the complete inventory parser, sealed journal or request-owned disk index. */
export function readCloudInventoryNode(doc: any, ownerId: string, parentId: string, prefix: string, rootId: string): CloudInventoryNode {
	if (!owned(doc, ownerId) || !privateAudience(doc, true) || doc.folderId !== parentId || doc.shareId === rootId)
		fail(409, 'Cloud inventory contains an inaccessible or ambiguous item.');
	const name = doc.crystal?.name;
	if (typeof name !== 'string' || name.includes('/') || !validSyncPath(name)) fail(409, 'A cloud file or folder has an invalid name.');
	const path = prefix ? prefix + '/' + name : name;
	if (!validSyncPath(path)) fail(409, 'A cloud path exceeds the supported bounds.');
	if (isFolderThing(doc)) {
		if (doc.thingtime?.includes('file') || doc.crystal?.trashed === true) fail(409, 'A cloud folder has an ambiguous kind.');
		return { kind: 'folder', path, id: doc.shareId, folderId: parentId, revision: folderRevision(doc) };
	}
	if (doc.thingtime?.length !== 1 || doc.thingtime[0] !== 'file') fail(409, 'A cloud file has an ambiguous kind.');
	try { return { kind: 'file', path, file: parseCloudFile({ id: doc.shareId, revision: doc.timelineHeadId,
		name, folderId: parentId, trashed: doc.crystal.trashed, content: doc.crystal.content }) }; }
	catch { return fail(409, 'A cloud file has invalid content metadata; no partial scan was returned.'); }
}
