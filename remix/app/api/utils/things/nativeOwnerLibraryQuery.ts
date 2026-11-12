import type { StoredThing } from './persistence';

/** Semantic counterpart of ownerLibraryMatch/ownerLibraryRootMatch. Keep the
 * managed singleton exceptions: protected metadata is excluded, but a visible
 * unsupported library family must cause admission refusal rather than count0. */
export function nativeOwnerLibraryIncludes(row: StoredThing, excludedKinds: readonly string[], includeArchives: boolean, root: boolean): boolean {
 const kinds = Array.isArray(row.thingtime) ? row.thingtime : [];
 if (row.thingtime === undefined && row.kind !== 'post') return false;
 const singleton = (kind: string) => kinds.length === 1 && kinds[0] === kind;
 const ordinary = !kinds.some(kind => excludedKinds.includes(kind));
 const managed = singleton('theme') || (singleton('file') && row.crystal?.trashed === false) || singleton('feed-algorithm') ||
  (singleton('custom-emoji') && row.targetId == null) ||
  (includeArchives && singleton('chat-archive') && row.archiveVersion === 1 && (row.archiveDeleting == null || row.archiveDeleting === false) &&
   row.targetId == null && row.appId == null && row.sandbox == null && row.sandboxSpace == null && row.archiveRootId === row.shareId) ||
  (singleton('attachment') && ['recording', 'file'].includes(row.attachmentPurpose) && row.attachmentState === 'ready' && row.attachmentExpiresAt == null &&
   row.attachmentImportDraft !== true && !Object.prototype.hasOwnProperty.call(row, 'targetId'));
 if (!ordinary && !managed) return false;
 return !root || (row.folderId == null && row.parentId == null && row.targetId == null && row.crystal?.parentId == null && !kinds.includes('file-sync') && !kinds.includes('attachment'));
}
