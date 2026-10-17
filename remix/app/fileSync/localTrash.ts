import { validateSyncRun, type SyncOperation, type SyncRun } from './execute';
import type { SyncEntry } from './reconcile';

export type LocalTrashContext = {
	parent?: { expected: SyncEntry; previousOperationId?: string };
	childrenOperationId?: string;
};
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');

/** Derived only from the immutable run, never a later scan. Each operation
 * carries at most two receipt links, including for wide or deeply nested trees. */
export function localTrashContexts(run: SyncRun): Map<string, LocalTrashContext> {
	validateSyncRun(run);
	const folders = new Map(
		run.operations.flatMap((op) =>
			op.mutation.kind === 'trash' && op.mutation.side === 'local' && op.mutation.expected.kind === 'folder'
				? [[op.mutation.path, op.mutation.expected] as const]
				: []
		)
	);
	const previous = new Map<string, string>(),
		result = new Map<string, LocalTrashContext>();
	for (const op of run.operations) {
		const m = op.mutation;
		if (m.kind !== 'trash' || m.side !== 'local') continue;
		const parent = parentPath(m.path),
			expected = folders.get(parent),
			childrenOperationId = previous.get(m.path);
		result.set(op.id, {
			...(expected
				? { parent: { expected: structuredClone(expected), ...(previous.has(parent) ? { previousOperationId: previous.get(parent)! } : {}) } }
				: {}),
			...(childrenOperationId ? { childrenOperationId } : {})
		});
		previous.set(parent, op.id);
	}
	return result;
}

export { validateTrashExpected } from './execute';
