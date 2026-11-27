import { readOwnedSyncFolder, type ConfigurationEditorScope } from './configurationEditor';

// Folder placement/deletion must share the canonical transactional ancestry fence.
export const SYNC_CLOUD_DESTINATION_REQUIREMENTS = { 'api.things': '1.33.1' } as const;
export type NewSyncCloudDestination = {
	baseUpdatedAt: null;
	remoteFolderId: '';
	source: { name: string; sourcePath?: string };
};
export type SyncCloudDestinationCreate = {
	shareId: string;
	thingtime: ['folder'];
	crystal: { name: string };
	folderId: string | null;
	acl: ['tt:user'];
};
export type SyncCloudDestinationTransport = {
	assertCurrent(): void;
	negotiate(requirements: typeof SYNC_CLOUD_DESTINATION_REQUIREMENTS): Promise<void>;
	get(id: string): Promise<unknown>;
	create(input: SyncCloudDestinationCreate): Promise<unknown>;
};
const segment = (name: unknown): name is string =>
	typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\p{Cc}\p{Cf}/]/u.test(name);

/** Layout metadata only: never pass these segments to native file operations or
 * request access to a parent of the selected grant. Missing path metadata uses
 * the selected folder's name, with no guessed Home or device path. */
export function syncCloudDestinationSegments(source: NewSyncCloudDestination['source']): string[] {
	if (!source || !segment(source.name)) throw Error('The selected folder name is unavailable.');
	if (source.sourcePath === undefined) return [source.name];
	if (typeof source.sourcePath !== 'string' || !source.sourcePath.startsWith('/')) throw Error('The selected folder path is invalid.');
	if (source.sourcePath === '/') return [source.name];
	const parts = source.sourcePath.slice(1).split('/');
	if (!parts.every(segment) || parts.at(-1) !== source.name) throw Error('The selected folder path changed. Select it again.');
	return parts;
}

async function folderIdentity(scope: ConfigurationEditorScope, parentId: string | null, name: string): Promise<string> {
	// Device identity prevents different devices with identical physical paths
	// silently sharing a destination. No path is published in an API manifest.
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
		'thingtime-sync-destination-v1', scope.origin, scope.ownerId, scope.dataPlane, scope.deviceId, parentId, name
	]))));
	const bytes = digest.slice(0, 16);
	bytes[6] = (bytes[6] & 15) | 0x50;
	bytes[8] = (bytes[8] & 63) | 0x80;
	const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Explicit new-connection preparation only. Fixed identities permit retry
 * after lost replies and concurrent creation without upserting or retargeting.
 * Reuse requires exact owner/private/name/parent readback, never a label match
 * against an unrelated folder. Partial empty folders remain safe to resume. */
export async function prepareSyncCloudDestination(
	request: NewSyncCloudDestination,
	scope: ConfigurationEditorScope,
	api: SyncCloudDestinationTransport
): Promise<{ id: string; name: string }> {
	if (request.baseUpdatedAt !== null || request.remoteFolderId !== '') throw Error('Existing cloud destinations must be preserved.');
	if (![scope.origin, scope.ownerId, scope.dataPlane, scope.deviceId].every(value => typeof value === 'string' && value.length > 0))
		throw Error('The connection identity is unavailable.');
	const names = syncCloudDestinationSegments(request.source);
	api.assertCurrent();
	await api.negotiate(SYNC_CLOUD_DESTINATION_REQUIREMENTS);
	api.assertCurrent();
	let parentId: string | null = null;
	for (const name of names) {
		const expectedParentId: string | null = parentId;
		const id = await folderIdentity(scope, expectedParentId, name);
		api.assertCurrent();
		const read = async () => {
			api.assertCurrent();
			let value: unknown;
			try { value = await api.get(id); }
			catch (error) {
				api.assertCurrent();
				if ((error as { status?: number })?.status === 404) return null;
				throw error;
			}
			api.assertCurrent();
			const folder = readOwnedSyncFolder(value, scope.ownerId);
			const row = value as { appId?: unknown; thingtime: string[]; crystal?: { name?: unknown }; folderId?: unknown };
			if (folder.id !== id || row.appId != null || row.thingtime.length !== 1 || row.crystal?.name !== name || (row.folderId ?? null) !== expectedParentId)
				throw Error('The cloud folder hierarchy changed. Choose a destination explicitly.');
			return folder;
		};
		if (!await read()) {
			let failure: unknown;
			api.assertCurrent();
			try { await api.create({ shareId: id, thingtime: ['folder'], crystal: { name }, folderId: expectedParentId, acl: ['tt:user'] }); }
			catch (error) { failure = error; }
			api.assertCurrent();
			if (!await read()) throw failure ?? Error('The folder creation is not confirmed. Retry to check the same destination.');
		}
		parentId = id;
	}
	api.assertCurrent();
	return { id: parentId!, name: names[names.length - 1] };
}
