import type { SyncOperation } from './execute';
import type { ForegroundSyncProgress } from './foregroundSync';
import { parsePagedRunSpec, type PagedRunSpec } from './pagedRunJournal';
import { sameSyncScope, syncPathKey, validSyncPath, validateSyncScope, type SyncEntry, type SyncScope } from './reconcile';

/** Serializable references into the existing journal, never a second journal
 * or a retained tree. The owner/generation guard is supplied by the viewer. */
export type SyncProgressDescriptor = { scope: SyncScope; run: PagedRunSpec };
export function parseSyncProgressDescriptor(value: unknown): SyncProgressDescriptor {
	const input = value as Partial<SyncProgressDescriptor> | null;
	if (!input || typeof input !== 'object' || !input.scope || !input.run) throw Error('Invalid saved sync progress descriptor.');
	validateSyncScope(input.scope);
	const run = parsePagedRunSpec(input.run);
	if (run.configuration && run.configuration.deviceId !== input.scope.deviceId) throw Error('Saved sync progress device changed.');
	return { scope: structuredClone(input.scope), run };
}
export type SyncProgressState = 'running' | 'paused' | 'cancelled' | 'error' | 'complete';
export type SyncProgressRow = { entry: SyncEntry; operation: SyncOperation | null; excluded?: boolean };
export type SyncProgressTotals = {
	path: string; kind: 'file' | 'folder'; files: number; folders: number; indexedBytes: number; excluded: number;
	unchanged: number; operations: number; confirmed: number; transferFiles: number; confirmedFiles: number;
	bytesTotal: number; bytesConfirmed: number;
	/** Only the exact pending source inspected for this display refresh. */
	activeFile?: { path: string; size: number };
};
export type SyncProgressPage = { parent: SyncProgressTotals; rows: SyncProgressTotals[]; after: string | null; next: string | null };
export const SYNC_PROGRESS_PAGE_SIZE = 32;
export type SyncProgressRequest = { parent?: string; after?: string | null; activePath?: string; signal?: AbortSignal };
export type SyncProgressSource = { rows(signal?: AbortSignal): AsyncIterable<SyncProgressRow> };
const totals = (path: string, kind: 'file' | 'folder'): SyncProgressTotals => ({ path, kind, files: 0, folders: 0, indexedBytes: 0,
	excluded: 0, unchanged: 0, operations: 0, confirmed: 0, transferFiles: 0, confirmedFiles: 0, bytesTotal: 0, bytesConfirmed: 0 });
const contains = (parent: string, path: string) => !parent || path === parent || path.startsWith(`${parent}/`);
const safeAdd = (a: number, b: number) => { const sum = a + b; if (!Number.isSafeInteger(sum)) throw new RangeError('Sync progress byte totals exceed the supported safe range.'); return sum; };
const add = (target: SyncProgressTotals, row: SyncProgressRow, activePath?: string) => {
	const { entry, operation } = row;
	if (entry.kind === 'file') { target.files++; target.indexedBytes = safeAdd(target.indexedBytes, entry.size); } else target.folders++;
	if (row.excluded) { target.excluded++; return; }
	if (!operation) { target.unchanged++; return; }
	target.operations++; if (operation.confirmed) target.confirmed++;
	if (operation.mutation.kind === 'copy' && operation.mutation.source.kind === 'file') {
		target.transferFiles++; target.bytesTotal = safeAdd(target.bytesTotal, operation.mutation.source.size);
		if (operation.confirmed) { target.confirmedFiles++; target.bytesConfirmed = safeAdd(target.bytesConfirmed, operation.mutation.source.size); }
		else if (operation.mutation.path === activePath) target.activeFile = { path: activePath, size: operation.mutation.source.size };
	}
};

/** Stream immutable inventory pages. Keep only one parent and at most 32 child
 * aggregates, including all descendants, regardless of folder size/depth.
 * A page is published atomically; cancellation never publishes partial totals. */
export async function projectSyncProgress(source: SyncProgressSource, request: SyncProgressRequest = {}): Promise<SyncProgressPage> {
	const parent = request.parent ?? '', after = request.after ?? null;
	if ((parent && !validSyncPath(parent)) || (after !== null && !validSyncPath(after))) throw Error('Invalid progress folder.');
	const summary = totals(parent, 'folder'), children = new Map<string, SyncProgressTotals>();
	let more = false, previous: string | null = null;
	for await (const row of source.rows(request.signal)) {
		request.signal?.throwIfAborted();
		const key = syncPathKey(row.entry.path);
		if (previous !== null && key <= previous) throw Error('Sync progress inventory order changed.');
		previous = key;
		if (!contains(parent, row.entry.path)) continue;
		add(summary, row, request.activePath);
		if (row.entry.path === parent) continue;
		const relative = parent ? row.entry.path.slice(parent.length + 1) : row.entry.path;
		const child = `${parent ? `${parent}/` : ''}${relative.split('/')[0]}`;
		if (after && syncPathKey(child) <= syncPathKey(after)) continue;
		let aggregate = children.get(child);
		if (!aggregate) {
			if (children.size === SYNC_PROGRESS_PAGE_SIZE) { more = true; continue; }
			if (child !== row.entry.path) throw Error('Sync progress folder ancestor is missing.');
			aggregate = totals(child, row.entry.kind); children.set(child, aggregate);
		}
		add(aggregate, row, request.activePath);
	}
	request.signal?.throwIfAborted();
	const rows = [...children.values()];
	return { parent: summary, rows, after, next: more ? rows.at(-1)!.path : null };
}

/** Bytes only belong to file copy operations. An active byte callback is
 * optimistic display evidence, never a durable receipt or a second increment.
 * Files that already existed are reported separately from copied files. */
export function syncProgressMetrics(value: SyncProgressTotals, progress?: ForegroundSyncProgress, state: SyncProgressState = 'running') {
	const pending = value.activeFile ?? (value.kind === 'file' && value.operations === 1 && value.confirmed === 0
		? { path: value.path, size: value.bytesTotal } : undefined);
	const active = !!progress?.path && pending?.path === progress.path && progress.size === pending.size &&
		['transferring', 'retaining'].includes(progress.stage) && value.confirmed < value.operations;
	const activeBytes = active && Number.isFinite(progress?.bytes) && Number.isFinite(progress?.size)
		? Math.max(0, Math.min(progress!.bytes!, progress!.size!, value.bytesTotal - value.bytesConfirmed)) : 0;
	const bytes = value.bytesConfirmed + activeBytes, finished = value.confirmed === value.operations;
	const excludedOnly = value.excluded > 0 && value.excluded === value.files + value.folders;
	const percent = excludedOnly ? null : finished ? 100 : Math.min(99.9, value.bytesTotal > 0
		? 100 * bytes / value.bytesTotal : 100 * value.confirmed / value.operations);
	const status = excludedOnly ? 'Excluded' : finished ? value.operations ? 'Complete' : 'Up to date'
		: state === 'error' ? 'Error' : state === 'cancelled' ? 'Cancelled' : state === 'paused' ? 'Paused' : active ? 'Uploading' : 'Pending';
	return { bytes, percent, status, active };
}

export function assertProgressScope(descriptor: SyncProgressDescriptor, currentScope: () => SyncScope) {
	if (!sameSyncScope(descriptor.scope, currentScope())) throw Error('Sync progress account or folder changed.');
}
