import { validateSyncRun, type SyncOperation, type SyncRun } from './execute';
import { validSyncEntry, type SyncEntry } from './reconcile';

export type LocalTrashContext = {
	parent?: { expected: SyncEntry; previousOperationId?: string };
	childrenOperationId?: string;
};
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');

/** Validate a retained receipt chain before passing it to a native adapter. */
export function parseLocalTrashContext(operation: SyncOperation, value?: LocalTrashContext): LocalTrashContext | undefined {
	if (value === undefined) return undefined;
	const m = operation.mutation, context = structuredClone(value);
	if (!context || typeof context !== 'object' || Array.isArray(context) || m.kind !== 'trash' || m.side !== 'local') throw Error('Invalid local Trash context.');
	const link = (id: unknown) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && id !== operation.id;
	if (context.parent && (!validSyncEntry(context.parent.expected) || context.parent.expected.kind !== 'folder' ||
		context.parent.expected.path !== parentPath(m.path) || (context.parent.previousOperationId !== undefined && !link(context.parent.previousOperationId)))) throw Error('Invalid local Trash parent receipt.');
	if (context.childrenOperationId !== undefined && (m.expected.kind !== 'folder' || !link(context.childrenOperationId) ||
		context.childrenOperationId === context.parent?.previousOperationId)) throw Error('Invalid local Trash child receipt.');
	return { ...(context.parent ? { parent: { expected: { path: context.parent.expected.path, id: context.parent.expected.id, version: context.parent.expected.version, kind: 'folder', size: 0, sha256: null },
		...(context.parent.previousOperationId ? { previousOperationId: context.parent.previousOperationId } : {}) } } : {}),
		...(context.childrenOperationId ? { childrenOperationId: context.childrenOperationId } : {}) };
}

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
