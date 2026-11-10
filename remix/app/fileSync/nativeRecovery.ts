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

export type NativeVersion = { versionId: string; entry: SyncEntry; capturedAt: number | null };
export type NativeVersionPage = { items: NativeVersion[]; nextCursor: string | null };
export type NativeVersionRestore = NativeRestore & { versionId: string; operationId: string };
export function parseNativeVersionPage(value: any): NativeVersionPage {
	if (!value || !Array.isArray(value.items) || value.items.length > 20 || (value.nextCursor != null && !uuid(value.nextCursor)))
		throw Error('Invalid native version page.');
	const ids = new Set<string>();
	const items = value.items.map((item: any) => {
		if (
			!uuid(item?.versionId) ||
			ids.has(item.versionId) ||
			!validSyncEntry(item.entry) ||
			item.entry.kind !== 'file' ||
			(item.capturedAt !== null && (!Number.isSafeInteger(item.capturedAt) || item.capturedAt < 0 || item.capturedAt > 8_640_000_000_000_000))
		)
			throw Error('Invalid retained native version.');
		ids.add(item.versionId);
		return { versionId: item.versionId, entry: structuredClone(item.entry), capturedAt: item.capturedAt };
	});
	return { items, nextCursor: value.nextCursor ?? null };
}

export function readNativeVersionRestore(raw: string | null): NativeVersionRestore | null {
	if (raw === null) return null;
	if (raw.length > 65536) throw Error('Saved version restore is invalid.');
	const value = JSON.parse(raw);
	const versionId = value?.versionId,
		operationId = value?.operationId;
	if (!uuid(value?.versionId) || !uuid(value?.operationId) || value.expected?.kind !== 'file' || !validNativeRestore(value, value.expected.path))
		throw Error('Saved version restore is invalid.');
	return { versionId, operationId, path: value.path, expected: structuredClone(value.expected) };
}
