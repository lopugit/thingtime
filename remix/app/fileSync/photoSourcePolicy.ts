import type { FileSyncConfiguration } from './configuration';
import type { MobileFolder } from './mobileFolders.client';

/** Saved Things express intent; fresh native roots determine actual source access. */
export function assertPhotoSourcePolicy(configuration: FileSyncConfiguration, roots: MobileFolder[]): void {
 const root = roots.find(root => root.id === configuration.localRootId);
 if (!root) throw Error('Folder access is missing. Choose the source again.');
 if (configuration.sourceKind === 'photos' && root.sourceKind !== 'photos') throw Error('The selected photo source changed. Review this connection.');
 if (root.sourceKind !== 'photos') return;
 if (configuration.mode !== 'backup' || configuration.propagateDeletes) throw Error('Photo libraries require backup mode with saved cloud copies retained.');
 if (root.photoAccess === 'unavailable') throw Error('Photo access is unavailable. Choose photo access again.');
}

export function photoAccessDescription(root: MobileFolder): string {
 return root.photoAccess === 'unavailable' ? 'Photo access unavailable · choose photo access again'
  : root.photoAccess === 'limited' ? 'Selected photos/videos only · originals · saved cloud copies are kept'
  : 'Photos and videos · originals · saved cloud copies are kept';
}
