import { planFileSync, sameSyncContent, sameSyncScope, type SyncBaseline, type SyncScan, type SyncScope } from './reconcile';
import { inventoryIdentity, type InventoryIdentity } from './inventoryJournal';
export const PAGED_CHECKPOINT_HEADS = 'sync-paged-checkpoint-heads';
export type PagedCheckpointHead = { version: 1; scope: string; instance: string; runId: string; localRootId: string; remoteFolderId: string;
	baseline: { local: InventoryIdentity; remote: InventoryIdentity } };
export function validatePagedCheckpointHead(head: PagedCheckpointHead, key: string) {
	if (!head || head.version !== 1 || head.scope !== key || !head.baseline ||
		![head.instance, head.runId, head.localRootId, head.remoteFolderId].every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) ||
		inventoryIdentity(head.baseline.local).source !== 'local' || inventoryIdentity(head.baseline.remote).source !== 'remote') throw Error('Invalid paged sync checkpoint.');
}
export type SyncBaselinePair = SyncBaseline['entries'][number];
/** Shared rule for both whole-tree and paged checkpoints. */
export function advanceSyncBaselinePair(previous: SyncBaselinePair | null, local: SyncBaselinePair['local'] | null, remote: SyncBaselinePair['remote'] | null): SyncBaselinePair | null {
	if (!local && !remote) return null;
	if (local && remote && sameSyncContent(local, remote)) return { path: local.path, local: structuredClone(local), remote: structuredClone(remote) };
	return previous;
}
export type SyncCheckpoint = { version: 1; runId: string; localRootId: string; remoteFolderId: string; baseline: SyncBaseline };
export function validateSyncCheckpoint(value: SyncCheckpoint, scope: SyncScope) {
	if (
		!value ||
		value.version !== 1 ||
		typeof value.runId !== 'string' ||
		!value.runId ||
		value.runId.length > 128 ||
		![value.localRootId, value.remoteFolderId].every((id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) ||
		!sameSyncScope(value.baseline.scope, scope)
	)
		throw Error('Invalid sync completion checkpoint.');
	planFileSync(
		{ scope, complete: true, entries: value.baseline.entries.map((e) => e.local) },
		{ scope, complete: true, entries: value.baseline.entries.map((e) => e.remote) },
		value.baseline,
		{ mode: 'backup', propagateDeletes: false }
	);
}
/** Advance only observed agreement; preserve prior evidence for conflicts. A
 * failed or partial scan never erases the common baseline. */
export function advanceSyncBaseline(previous: SyncBaseline, local: SyncScan, remote: SyncScan, preserve?: (path: string, kind: 'file' | 'folder') => boolean): SyncBaseline {
	planFileSync(local, remote, previous, { mode: 'backup', propagateDeletes: false });
	const pairs = new Map(previous.entries.map((e) => [e.path, e])),
		left = new Map(local.entries.map((e) => [e.path, e])),
		right = new Map(remote.entries.map((e) => [e.path, e]));
	const protectedAncestors = new Set<string>();
	if (preserve) for (const pair of previous.entries) if (preserve(pair.path, pair.local.kind)) {
		const parts = pair.path.split('/'); for (let n = 1; n < parts.length; n++) protectedAncestors.add(parts.slice(0, n).join('/'));
	}
	for (const path of new Set([...pairs.keys(), ...left.keys(), ...right.keys()])) {
		const l = left.get(path),
			r = right.get(path);
		const prior = pairs.get(path) ?? null;
		if (preserve?.(path, (l ?? r ?? prior?.local)!.kind) || (prior && protectedAncestors.has(path))) continue;
		const next = advanceSyncBaselinePair(prior, l ?? null, r ?? null);
		if (next) pairs.set(path, next); else pairs.delete(path);
	}
	const baseline = { scope: { ...local.scope }, entries: [...pairs.values()].sort((a, b) => a.path.localeCompare(b.path)) };
	planFileSync(local, remote, baseline, { mode: 'backup', propagateDeletes: false });
	return baseline;
}
