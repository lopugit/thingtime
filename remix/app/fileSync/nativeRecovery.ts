import { validateSyncRun } from './execute';
import { validSyncEntry, type SyncEntry } from './reconcile';
import type { MobileTrashRequest } from './mobileFolders.client';

export type NativeRestore = { path: string; expected: SyncEntry };
export type NativeRecoveryItem = {
	request: MobileTrashRequest;
	kind: 'file' | 'folder' | 'other';
	size: number;
	state: 'retained' | 'needs-review' | 'restoring';
	restore?: NativeRestore;
};
export type NativeRecoveryPage = { items: NativeRecoveryItem[]; nextCursor: string | null };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function validNativeRestore(value: any, sourcePath: string): value is NativeRestore {
	return !!value && validSyncEntry(value.expected) && value.expected.path === sourcePath && validSyncEntry({ ...value.expected, path: value.path });
}

/** Recovery may outlive a connection or pairing. Ownership, origin and the
 * surviving native picker grant still have to match exactly. */
export function parseNativeRecoveryPage(value: any, owner: { ownerId: string; origin: string }, rootId: string): NativeRecoveryPage {
	if (
		!value ||
		!Array.isArray(value.items) ||
		value.items.length > 20 ||
		(value.nextCursor != null && (typeof value.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(value.nextCursor)))
	)
		throw Error('Invalid native recovery page.');
	const ids = new Set<string>();
	for (const item of value.items) {
		const r = item?.request,
			m = r?.operation?.mutation;
		if (
			!r ||
			r.rootId !== rootId ||
			r.scope?.ownerId !== owner.ownerId ||
			r.scope?.origin !== owner.origin ||
			r.scope?.dataPlane !== 'home' ||
			!uuid(r.operation?.id) ||
			m?.kind !== 'trash' ||
			m.side !== 'local' ||
			!['file', 'folder', 'other'].includes(item.kind) ||
			!Number.isSafeInteger(item.size) ||
			item.size < 0 ||
			!['retained', 'needs-review', 'restoring'].includes(item.state)
		)
			throw Error('Native recovery ownership or item changed.');
		validateSyncRun({ version: 1, id: 'native-recovery-page', scope: r.scope, operations: [r.operation] });
		const key = JSON.stringify([r.scope, r.operation.id]);
		if (ids.has(key)) throw Error('Duplicate native recovery item.');
		ids.add(key);
		if (
			(r.childrenOperationId != null && (m.expected.kind !== 'folder' || !uuid(r.childrenOperationId) || r.childrenOperationId === r.operation.id)) ||
			(r.parent != null &&
				(!validSyncEntry(r.parent.expected) ||
					r.parent.expected.kind !== 'folder' ||
					r.parent.expected.path !== m.path.split('/').slice(0, -1).join('/') ||
					(r.parent.previousOperationId != null && (!uuid(r.parent.previousOperationId) || r.parent.previousOperationId === r.operation.id))))
		)
			throw Error('Invalid native recovery receipt links.');
		if ((item.restore != null && !validNativeRestore(item.restore, m.path)) || (item.state === 'restoring') !== (item.restore != null))
			throw Error('Invalid native restoration intent.');
	}
	return { items: structuredClone(value.items), nextCursor: value.nextCursor ?? null };
}
