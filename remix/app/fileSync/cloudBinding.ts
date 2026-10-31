import { prepareCloudInventoryWrite, type CloudWrite } from './cloudWrite';
import type { CloudInventoryNode } from './cloudInventory';
import { parseLocalTrashContext, type LocalTrashContext } from './localTrash';
import type { SyncOperation } from './execute';
import type { SyncScope } from './reconcile';

export type CloudOperationBinding = { write: CloudWrite; trashContext?: LocalTrashContext };

/** Resolve only indexed, immutable preparation data. Live authorization remains
 * the responsibility of the shared transport immediately before each effect. */
export async function prepareCloudOperationBinding(operation: SyncOperation, scope: SyncScope, rootId: string, input: {
	node(path: string): Promise<CloudInventoryNode | null>;
	operation(path: string): Promise<SyncOperation | null>;
	previousTrash(parent: string): Promise<string | undefined>;
}): Promise<CloudOperationBinding> {
	const m = operation.mutation, parent = m.path.split('/').slice(0, -1).join('/');
	const before = await input.node(m.path);
	if (m.kind === 'trash' && m.side === 'local') {
		const parentOp = parent ? await input.operation(parent) : null;
		const pm = parentOp?.mutation;
		const expected = pm?.kind === 'trash' && pm.side === 'local' && pm.expected.kind === 'folder' ? pm.expected : null;
		const previousOperationId = expected ? await input.previousTrash(parent) : undefined;
		const childrenOperationId = m.expected.kind === 'folder' ? await input.previousTrash(m.path) : undefined;
		const trashContext = parseLocalTrashContext(operation, {
			...(expected ? { parent: { expected, ...(previousOperationId ? { previousOperationId } : {}) } } : {}),
			...(childrenOperationId ? { childrenOperationId } : {})
		});
		return { write: prepareCloudInventoryWrite(operation, scope, rootId, before, null), trashContext };
	}
	let folderId: string | null = rootId;
	if (parent) {
		const node = await input.node(parent);
		if (node) {
			if (node.kind !== 'folder') throw Error('Cloud parent is not a folder.');
			folderId = node.id;
		} else {
			const op = await input.operation(parent), pm = op?.mutation;
			folderId = op && pm?.kind === 'copy' && pm.from === 'local' && pm.source.kind === 'folder' && pm.expectedTarget === null ? op.id : null;
		}
	}
	return { write: prepareCloudInventoryWrite(operation, scope, rootId, before, folderId) };
}
