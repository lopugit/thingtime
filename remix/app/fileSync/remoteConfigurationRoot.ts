import type { FileSyncConfiguration } from './configuration';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { MobileFolder } from './mobileFolders.client';

/** Existing account settings remain editable while the device is offline.
 * Reusing a saved binding grants no native access; every execution reauthorizes
 * the real device. New bindings require a current device folder response. */
export function hasSavedDeviceRoot(previous: SavedFileSyncConfiguration | null, next: FileSyncConfiguration, deviceId: string): boolean {
	return !!previous && previous.configuration.deviceId === deviceId && next.deviceId === deviceId &&
		previous.configuration.localRootId === next.localRootId && previous.configuration.sourceKind === next.sourceKind;
}
export function assertRemoteDeviceRoot(roots: MobileFolder[], configuration: FileSyncConfiguration, deviceId: string) {
	const root = roots.find(value => value.id === configuration.localRootId);
	if (configuration.deviceId !== deviceId || !root || (root.sourceKind ?? 'folder') !== (configuration.sourceKind ?? 'folder'))
		throw Error('Connect this device and choose an available folder before saving a new folder connection.');
}
