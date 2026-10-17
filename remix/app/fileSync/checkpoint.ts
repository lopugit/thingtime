import { planFileSync, sameSyncContent, sameSyncScope, type SyncBaseline, type SyncScan, type SyncScope } from './reconcile';
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
export function advanceSyncBaseline(previous: SyncBaseline, local: SyncScan, remote: SyncScan): SyncBaseline {
	planFileSync(local, remote, previous, { mode: 'backup', propagateDeletes: false });
	const pairs = new Map(previous.entries.map((e) => [e.path, e])),
		left = new Map(local.entries.map((e) => [e.path, e])),
		right = new Map(remote.entries.map((e) => [e.path, e]));
	for (const path of new Set([...pairs.keys(), ...left.keys(), ...right.keys()])) {
		const l = left.get(path),
			r = right.get(path);
		if (!l && !r) pairs.delete(path);
		else if (l && r && sameSyncContent(l, r)) pairs.set(path, { path, local: structuredClone(l), remote: structuredClone(r) });
	}
	const baseline = { scope: { ...local.scope }, entries: [...pairs.values()].sort((a, b) => a.path.localeCompare(b.path)) };
	planFileSync(local, remote, baseline, { mode: 'backup', propagateDeletes: false });
	return baseline;
}
