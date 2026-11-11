import type { FileSyncConfiguration } from './configuration';
import type { SavedFileSyncConfiguration } from './configuredPlan';

/** Fresh plans may use new settings, but only for the same read-only Photos
 * grant. Scope, current authorization and live conditions are checked by the
 * caller. The old plan's operation IDs cannot authorize the new plan. */
export function samePhotoBackupSource(previous: FileSyncConfiguration, current: FileSyncConfiguration): boolean {
	return previous.sourceKind === 'photos' && current.sourceKind === 'photos' &&
		previous.mode === 'backup' && current.mode === 'backup' &&
		previous.propagateDeletes === false && current.propagateDeletes === false &&
		previous.localRootId === current.localRootId && previous.deviceId === current.deviceId && !current.paused;
}

export function photoSettingsChanged(previous: SavedFileSyncConfiguration, current: SavedFileSyncConfiguration): boolean {
	return previous.id === current.id && samePhotoBackupSource(previous.configuration, current.configuration) &&
		(previous.updatedAt !== current.updatedAt || JSON.stringify(previous.configuration) !== JSON.stringify(current.configuration));
}

/** Allows a saved policy-only edit during native work without changing its grant,
 * destination, deletion policy, source or network/security conditions. */
export function isPhotoAutomationOnlyEdit(previous: SavedFileSyncConfiguration, draft: {
 id: string; baseUpdatedAt: string | null; configuration: FileSyncConfiguration; exclusions: string;
}): boolean {
 if (previous.id !== draft.id || previous.updatedAt !== draft.baseUpdatedAt || previous.configuration.sourceKind !== 'photos' ||
     draft.configuration.sourceKind !== 'photos' || !draft.configuration.photoAutomation ||
     draft.exclusions !== previous.configuration.excludedPaths.join('\n')) return false;
 const unchanged = ({ configurationVersion: _version, photoAutomation: _policy, ...rest }: FileSyncConfiguration) => rest;
 return JSON.stringify(unchanged(previous.configuration)) === JSON.stringify(unchanged(draft.configuration));
}
