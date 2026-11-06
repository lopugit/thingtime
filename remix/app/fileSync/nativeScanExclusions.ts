import { MAX_SYNC_EXCLUSIONS } from './configuration';
import { syncPathKey, validSyncPath } from './reconcile';

/** Canonical policy identity shared by requests and response fencing. */
export function canonicalNativeScanExclusions(paths: unknown): string[] {
	if (!Array.isArray(paths) || paths.length > MAX_SYNC_EXCLUSIONS || paths.some(path => !validSyncPath(path)) ||
		paths.reduce((size, path) => size + new TextEncoder().encode(path).length, 0) > 16_384)
		throw Error('Invalid native scan exclusions.');
	const keys = paths.map(syncPathKey);
	if (new Set(keys).size !== keys.length) throw Error('Duplicate native scan exclusions.');
	return keys.sort();
}
export function isNativeScanExcluded(path: string, exclusions: readonly string[]): boolean {
	const key = syncPathKey(path);
	return exclusions.some(excluded => key === excluded || key.startsWith(excluded + '/'));
}
