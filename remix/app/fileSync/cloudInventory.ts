import { parseCloudFile, cloudFileSyncEntry, type CloudFile } from './cloudFile';
import { MAX_SYNC_SCAN_ENTRIES, planFileSync, validSyncPath, type SyncEntry, type SyncScope } from './reconcile';

export const CLOUD_INVENTORY_REQUIREMENTS = { 'api.files': '1.1.0' } as const;
export const MAX_CLOUD_INVENTORY_BYTES = 8 * 1024 * 1024;
export type CloudInventoryNode =
	| { kind: 'file'; path: string; file: CloudFile }
	| { kind: 'folder'; path: string; id: string; folderId: string; revision: string };
export type CloudInventory = { version: 1; complete: true; rootId: string; rootRevision: string; nodes: CloudInventoryNode[] };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export function inventorySyncEntry(node: CloudInventoryNode): SyncEntry {
	return node.kind === 'file'
		? cloudFileSyncEntry(node.file, node.path)
		: { path: node.path, id: node.id, version: node.revision, kind: 'folder', size: 0, sha256: null };
}
/** A complete observation of one explicit root, never a paginated subset. Both
 * the server and worker validate ancestry/identity/path collisions. Ordinary
 * non-filesystem Things are outside this inventory; errors never mean empty. */
export function parseCloudInventory(value: unknown, rootId: string): CloudInventory {
	const input = value as CloudInventory;
	if (
		!input ||
		input.version !== 1 ||
		input.complete !== true ||
		input.rootId !== rootId ||
		!identifier(rootId) ||
		!identifier(input.rootRevision) ||
		!Array.isArray(input.nodes) ||
		input.nodes.length > MAX_SYNC_SCAN_ENTRIES
	)
		throw Error('Cloud folder inventory is incomplete or belongs to another root.');
	const nodes: CloudInventoryNode[] = input.nodes.map((node) => {
		if (!node || !validSyncPath(node.path)) throw Error('Cloud folder contains an invalid path.');
		if (node.kind === 'file') {
			const file = parseCloudFile(node.file);
			if (file.trashed || file.name !== node.path.split('/').at(-1)) throw Error('Cloud file does not match its inventory path.');
			return { kind: 'file', path: node.path, file };
		}
		if (node.kind !== 'folder' || !identifier(node.id) || !identifier(node.folderId) || !identifier(node.revision))
			throw Error('Invalid cloud folder identity.');
		return { kind: 'folder', path: node.path, id: node.id, folderId: node.folderId, revision: node.revision };
	});
	const parents = new Map(
		nodes.filter((node): node is Extract<CloudInventoryNode, { kind: 'folder' }> => node.kind === 'folder').map((node) => [node.path, node.id])
	);
	for (const node of nodes) {
		const parentPath = node.path.split('/').slice(0, -1).join('/'),
			parent = parentPath ? parents.get(parentPath) : rootId;
		if (!parent || (node.kind === 'file' ? node.file.folderId !== parent || node.file.id === rootId : node.folderId !== parent || node.id === rootId))
			throw Error('Cloud inventory ancestry changed.');
	}
	const scope: SyncScope = { origin: 'https://inventory.invalid', ownerId: 'validation', dataPlane: 'home', deviceId: 'validation', rootId };
	const entries = nodes.map(inventorySyncEntry);
	planFileSync(
		{ scope, complete: true, entries },
		{ scope, complete: true, entries: [] },
		{ scope, entries: [] },
		{ mode: 'backup', propagateDeletes: false }
	);
	const result: CloudInventory = { version: 1, complete: true, rootId, rootRevision: input.rootRevision, nodes };
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_CLOUD_INVENTORY_BYTES)
		throw Error('Cloud inventory exceeds the bounded response size.');
	return result;
}
