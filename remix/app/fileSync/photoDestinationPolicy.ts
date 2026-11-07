import type { FileSyncConfiguration } from './configuration';

/** Only a fresh backup to another destination can leave an earlier Photos plan
 * behind. The source grant and every transfer policy stay the same. A name or
 * the explicit Start unpause has no bearing on where the originals may go. */
export function canReplacePhotoDestination(previous: FileSyncConfiguration, current: FileSyncConfiguration): boolean {
	if (previous.sourceKind !== 'photos' || current.sourceKind !== 'photos' ||
		previous.mode !== 'backup' || current.mode !== 'backup' ||
		previous.propagateDeletes !== false || current.propagateDeletes !== false ||
		current.paused || previous.remoteFolderId === current.remoteFolderId) return false;
	const policy = ({ name: _name, paused: _paused, remoteFolderId: _folder, ...settings }: FileSyncConfiguration) => settings;
	return JSON.stringify(policy(previous)) === JSON.stringify(policy(current));
}
