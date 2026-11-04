import { validSyncPath } from './reconcile';

export const CLOUD_SYNC_DESTINATION_REQUIREMENTS = { 'api.files': '1.10.0' } as const;
export type CloudSyncDestination = { rootId: string; path: string };

export function parseCloudSyncDestination(value: unknown, name: string): CloudSyncDestination {
	const row = value as CloudSyncDestination;
	if (!row || typeof row !== 'object' || Object.keys(row).some(k => k !== 'rootId' && k !== 'path') ||
		typeof row.rootId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.rootId) ||
		!validSyncPath(row.path) || row.path.split('/').at(-1) !== name)
		throw Error('Invalid exact sync destination.');
	return { rootId: row.rootId, path: row.path };
}

export const SYNC_DESTINATION_CHANGED = 'sync_destination_changed' as const;
export class ExactCloudSyncDestinationChanged extends Error {
	constructor() { super('The exact sync destination changed before publication.'); }
}
