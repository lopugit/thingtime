import type { TimelineSnapshot } from './contract.ts';

export const FOLDER_PLACEMENT_ADAPTER = 'folder-placement';
export const MANAGED_FOLDER_PLACEMENT_ADAPTER = 'managed-folder-placement';
export function folderPlacementValue(snapshot: TimelineSnapshot): { folderId: string | null } {
  const value = snapshot.value as any;
  if (![FOLDER_PLACEMENT_ADAPTER, MANAGED_FOLDER_PLACEMENT_ADAPTER].includes(snapshot.adapter) || snapshot.version !== 1 || !value ||
    typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'folderId') ||
    (value.folderId !== null && (typeof value.folderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value.folderId)))) {
    throw new Error('Invalid folder placement version');
  }
  return { folderId: value.folderId };
}
export const folderPlacementSnapshot = (folderId: string | null, managed = false): TimelineSnapshot => {
  const snapshot = { adapter: managed ? MANAGED_FOLDER_PLACEMENT_ADAPTER : FOLDER_PLACEMENT_ADAPTER, version: 1, value: { folderId } };
  folderPlacementValue(snapshot);
  return snapshot;
};
