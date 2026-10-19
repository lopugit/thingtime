import { equalContentFingerprints, validContentFingerprint, type ContentFingerprint } from './contentFingerprint';
/** Transport-independent reconciliation for the native and cloud file adapters.
 * Observations are not authority: executors must condition writes on the exact
 * source and destination stamps and use canonical upload/ACL/quota writers.
 */
export type SyncSide = 'local' | 'remote';
export type SyncMode = 'two-way' | 'upload' | 'download' | 'backup';
export type SyncScope = { origin: string; ownerId: string; dataPlane: string; rootId: string; deviceId: string };
export type SyncEntry = {
	path: string;
	id: string;
	version: string;
	kind: 'file' | 'folder';
	size: number;
	sha256: string | null;
	fingerprint?: ContentFingerprint;
};
export type SyncScan = { scope: SyncScope; complete: boolean; entries: readonly SyncEntry[] };
export type SyncBaseline = { scope: SyncScope; entries: readonly { path: string; local: SyncEntry; remote: SyncEntry }[] };
export type SyncPolicy = { mode: SyncMode; propagateDeletes: boolean };
export type SyncDecision =
	| { kind: 'copy'; path: string; from: SyncSide; source: SyncEntry; expectedTarget: SyncEntry | null }
	| { kind: 'trash'; path: string; side: SyncSide; expected: SyncEntry }
	| { kind: 'conflict'; path: string; reason: 'both-changed' | 'type-changed' | 'delete-edit' | 'deletion-disabled' | 'destination-changed' | 'excluded-descendants'; local: SyncEntry | null; remote: SyncEntry | null }
	| { kind: 'settled'; path: string; local: SyncEntry | null; remote: SyncEntry | null };
export type SyncPlan = { scope: SyncScope; decisions: SyncDecision[] };

// Legacy whole-tree bound. Individual inventory pages are not independent
// partitions: cross-page ancestry and deletion safety must be checked first.
export const MAX_SYNC_SCAN_ENTRIES = 10_000;
const digestPattern = /^[a-f0-9]{64}$/;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const syncPathKey = (path: string): string => path.normalize('NFC').toLowerCase();
/** A folded index key is not a filesystem path: Unicode lowercasing can expand
 * a valid 255-character segment (for example capital dotted I). */
export const validSyncPathKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= 8192 && syncPathKey(key) === key;

export const validSyncPath = (path: unknown): path is string => {
	if (typeof path !== 'string' || !path || path.length > 4096 || /[\\\p{Cc}\p{Cf}]/u.test(path)) return false;
	const parts = path.split('/');
	return parts.length <= 128 && parts.every(part => part.length > 0 && part.length <= 255 && part !== '.' && part !== '..');
};

export const sameSyncScope = (a: SyncScope, b: SyncScope): boolean =>
	a.origin === b.origin && a.ownerId === b.ownerId && a.dataPlane === b.dataPlane && a.rootId === b.rootId && a.deviceId === b.deviceId;

/** A digest is byte equality, never a substitute for an exact mutation guard. */
export const sameSyncContent = (a: SyncEntry | null, b: SyncEntry | null): boolean =>
	a === null || b === null ? a === b : a.kind === b.kind && (a.kind === 'folder' || (a.size === b.size && (
		a.fingerprint && b.fingerprint ? equalContentFingerprints(a.fingerprint, b.fingerprint) :
		!a.fingerprint && !b.fingerprint && typeof a.sha256 === 'string' && a.sha256 === b.sha256)));

export const sameSyncStamp = (a: SyncEntry | null, b: SyncEntry | null): boolean =>
	a === null || b === null ? a === b : a.path === b.path && a.id === b.id && a.version === b.version && sameSyncContent(a, b);

export const validSyncEntry = (entry: SyncEntry): boolean => Boolean(entry) && validSyncPath(entry.path) &&
	typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 512 &&
	typeof entry.version === 'string' && entry.version.length > 0 && entry.version.length <= 512 &&
	Number.isSafeInteger(entry.size) && entry.size >= 0 &&
	(entry.kind === 'folder' ? entry.sha256 === null && entry.size === 0 && entry.fingerprint === undefined : entry.kind === 'file' && (
		entry.fingerprint === undefined ? typeof entry.sha256 === 'string' && digestPattern.test(entry.sha256) :
		entry.sha256 === null && validContentFingerprint(entry.fingerprint, entry.size)));

const entryMap = (entries: readonly SyncEntry[]): Map<string, SyncEntry> => {
	if (entries.length > MAX_SYNC_SCAN_ENTRIES) throw new Error('Sync scan exceeds its bounded partition.');
	const map = new Map<string, SyncEntry>();
	const identities = new Set<string>();
	for (const entry of entries) {
		if (!validSyncEntry(entry) || map.has(entry.path) || identities.has(entry.id)) throw new Error('Invalid or duplicate sync entry.');
		map.set(entry.path, { ...entry }); identities.add(entry.id);
	}
	return map;
};

export const validateSyncScope = (scope: SyncScope) => {
	if (!scope || Object.values(scope).some(value => typeof value !== 'string' || !value || value.length > 4096)) throw new Error('Invalid sync scope.');
	for (const field of ['ownerId', 'dataPlane', 'rootId', 'deviceId'] as const) if (!scope[field]) throw new Error('Invalid sync scope.');
	const origin = new URL(scope.origin);
	if (origin.origin !== scope.origin || !['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Sync origin must be canonical.');
};

export const syncScopeKey = (scope: SyncScope): string => {
	validateSyncScope(scope);
	return JSON.stringify([scope.origin, scope.ownerId, scope.dataPlane, scope.rootId, scope.deviceId]);
};

export const planFileSync = (local: SyncScan, remote: SyncScan, baseline: SyncBaseline, policy: SyncPolicy): SyncPlan => {
	validateSyncScope(local.scope);
	if (!sameSyncScope(local.scope, remote.scope) || !sameSyncScope(local.scope, baseline.scope)) throw new Error('Sync account, origin, data plane, root or device changed.');
	if (!local.complete || !remote.complete) throw new Error('Both sync scans must finish before reconciliation.');
	if (!['two-way', 'upload', 'download', 'backup'].includes(policy.mode) || typeof policy.propagateDeletes !== 'boolean') throw new Error('Invalid sync policy.');
	const left = entryMap(local.entries), right = entryMap(remote.entries);
	const oldLeft = entryMap(baseline.entries.map(entry => entry.local));
	const oldRight = entryMap(baseline.entries.map(entry => entry.remote));
	for (const entry of baseline.entries) {
		if (entry.path !== entry.local.path || entry.path !== entry.remote.path || !sameSyncContent(entry.local, entry.remote)) throw new Error('Sync baseline must contain confirmed matching content.');
	}
	const paths = [...new Set([...left.keys(), ...right.keys(), ...oldLeft.keys(), ...oldRight.keys()])].sort(compare);
	if (paths.length > MAX_SYNC_SCAN_ENTRIES) throw new Error('Combined sync scan exceeds its bounded partition.');
	const aliases = new Map<string, string>();
	for (const path of paths) {
		const key = syncPathKey(path);
		if (aliases.has(key) && aliases.get(key) !== path) throw new Error('Case or Unicode filename collision requires review.');
		aliases.set(key, path);
		// Never plan child writes beneath a file, including a file/folder conflict
		// on the other replica. Every ancestor must be represented in a scan.
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) {
			const parent = parts.slice(0, i).join('/');
			for (const map of [left, right, oldLeft, oldRight]) {
				if (map.has(path) && map.get(parent)?.kind !== 'folder') throw new Error('Missing or non-folder sync ancestor.');
			}
		}
	}
	const changedAncestors = (current: Map<string, SyncEntry>, before: Map<string, SyncEntry>): Set<string> => {
		const changed = new Set<string>();
		for (const entry of current.values()) {
			if (sameSyncStamp(entry, before.get(entry.path) ?? null)) continue;
			const parts = entry.path.split('/');
			for (let i = 1; i < parts.length; i++) changed.add(parts.slice(0, i).join('/'));
		}
		return changed;
	};
	const leftChangedBelow = changedAncestors(left, oldLeft), rightChangedBelow = changedAncestors(right, oldRight);
	const decisions = paths.map(path => decideSyncPath({ path,
		local: left.get(path) ?? null, remote: right.get(path) ?? null,
		beforeLocal: oldLeft.get(path) ?? null, beforeRemote: oldRight.get(path) ?? null
	}, policy, leftChangedBelow.has(path), rightChangedBelow.has(path)));
	return { scope: { ...local.scope }, decisions };
};

export type SyncPathObservation = { path: string; local: SyncEntry | null; remote: SyncEntry | null; beforeLocal: SyncEntry | null; beforeRemote: SyncEntry | null };
/** Shared decision policy after whole-inventory validation. The paged planner
 * computes descendant flags durably before calling the same policy as above. */
export function decideSyncPath(row: SyncPathObservation, policy: SyncPolicy, localChangedBelow: boolean, remoteChangedBelow: boolean): SyncDecision {
	const { path, local: l, remote: r, beforeLocal: bl, beforeRemote: br } = row;
	const settled = (): SyncDecision => ({ kind: 'settled', path, local: l, remote: r });
	const conflict = (reason: Extract<SyncDecision, { kind: 'conflict' }>['reason']): SyncDecision => ({ kind: 'conflict', path, reason, local: l, remote: r });
	if (sameSyncContent(l, r)) return settled();
	if (l && r && l.kind !== r.kind) return conflict('type-changed');
	// Folder revisions need not change when a child changes on a replica.
	if (((!l && r?.kind === 'folder' && bl) || (!r && l?.kind === 'folder' && br)) && (l ? localChangedBelow : remoteChangedBelow)) return conflict('delete-edit');
	const localChanged = !sameSyncStamp(l, bl), remoteChanged = !sameSyncStamp(r, br);
	let from: SyncSide;
	if (policy.mode === 'two-way') {
		if (localChanged && remoteChanged) return conflict(!l || !r ? 'delete-edit' : 'both-changed');
		from = localChanged ? 'local' : 'remote';
	} else {
		from = policy.mode === 'download' ? 'remote' : 'local';
		const source = from === 'local' ? l : r, target = from === 'local' ? r : l;
		const targetChanged = from === 'local' ? remoteChanged : localChanged;
		if (policy.mode === 'backup' && !source) return settled();
		if (target && targetChanged) return conflict('destination-changed');
	}
	const source = from === 'local' ? l : r, target = from === 'local' ? r : l;
	if (source) return { kind: 'copy', path, from, source, expectedTarget: target };
	if (!target) return settled();
	if (!policy.propagateDeletes || policy.mode === 'backup') return conflict('deletion-disabled');
	return { kind: 'trash', path, side: from === 'local' ? 'remote' : 'local', expected: target };
}
