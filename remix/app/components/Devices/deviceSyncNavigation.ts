import { readOwnedFileSyncConfiguration } from '~/fileSync/configuredPlan';
export const deviceSyncedFilesHref = (deviceId: string) => `/things?${new URLSearchParams({ deviceFiles: deviceId })}`;
export type DeviceSyncFolder = { id: string; name: string; href: string; mode: string; paused: boolean };
/** Connection metadata is a navigation hint, never proof of payload completion
 * or local access. The ordinary Things folder route independently checks ACLs. */
export function deviceSyncFolders(rows: unknown[], ownerId: string, deviceId: string): DeviceSyncFolder[] {
	const folders = new Map<string, DeviceSyncFolder>();
	for (const row of rows) {
		try {
			const saved = readOwnedFileSyncConfiguration(row, ownerId),
				c = saved.configuration;
			if (c.deviceId !== deviceId || folders.has(c.remoteFolderId)) continue;
			folders.set(c.remoteFolderId, {
				id: c.remoteFolderId,
				name: c.name,
				href: `/things?${new URLSearchParams({ folder: c.remoteFolderId, deviceFiles: deviceId })}`,
				mode: c.mode === 'backup' ? 'Backup' : c.mode === 'upload' ? 'Upload' : c.mode === 'download' ? 'Download' : 'Two-way sync',
				paused: c.paused
			});
		} catch {
			/* Invalid, shared or other-owner records cannot grant navigation. */
		}
	}
	return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
