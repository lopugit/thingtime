import { validSyncEntry, validSyncPath, type SyncEntry } from './reconcile';

export const CLOUD_PATH_REQUIREMENTS = { 'api.files': '1.4.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' } as const;
export type CloudPathObservation = {
	version: 1;
	complete: true;
	rootId: string;
	rootRevision: string;
	path: string;
	entry: SyncEntry | null;
};
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

/** Null is explicit, successful absence inside the selected root. A missing
 * response, root, permission or failed read must never be converted to null. */
export function parseCloudPathObservation(value: unknown, rootId: string, path: string): CloudPathObservation {
	const row = value as CloudPathObservation;
	if (!identifier(rootId) || !validSyncPath(path) || !row || row.version !== 1 || row.complete !== true ||
		row.rootId !== rootId || row.path !== path || !identifier(row.rootRevision) ||
		(row.entry !== null && (!validSyncEntry(row.entry) || row.entry.path !== path || !identifier(row.entry.id) ||
			!identifier(row.entry.version) || row.entry.id === rootId || (row.entry.kind === 'file' && !row.entry.fingerprint))))
		throw Error('A complete observation of this cloud path was not returned.');
	return { version: 1, complete: true, rootId, rootRevision: row.rootRevision, path, entry: row.entry === null ? null : structuredClone(row.entry) };
}
