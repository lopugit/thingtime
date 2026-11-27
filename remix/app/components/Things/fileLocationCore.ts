import { parseFileSyncUploadOrigin, type FileSyncUploadOrigin } from '~/fileSync/uploadOrigin';
export type LocationThing = { id: string; thingtime: string[]; targetId?: string | null; folderId?: string | null; crystal?: Record<string, any>; fileSyncOrigin?: FileSyncUploadOrigin };
export type FileLocation = { state: 'recorded' | 'origin' | 'unrecorded' | 'unavailable'; segments: { id: string; name: string; href: string }[] };
/** Follow stored identity/containment only. Every lookup must enforce current
 * viewer ACLs. An unbound storage attachment has no inferable filesystem path. */
export async function resolveFileLocation(thing: LocationThing, read: (id: string) => Promise<LocationThing | null>): Promise<FileLocation> {
  let file = thing;
  if (thing.thingtime.includes('attachment')) {
    if (!thing.targetId && !thing.folderId) {
      if (thing.fileSyncOrigin) {
        const origin = parseFileSyncUploadOrigin(thing.fileSyncOrigin);
        return { state: 'origin', segments: [{ id: origin.fileId, name: origin.path, href: origin.folderId ? `/things?${new URLSearchParams({ folder: origin.folderId })}` : '/things' }] };
      }
      return { state: 'unrecorded', segments: [] };
    }
    if (thing.targetId) {
      const target = await read(thing.targetId);
      if (!target) return { state: 'unavailable', segments: [] };
      if (!target.thingtime.includes('file')) return { state: 'unrecorded', segments: [] };
      file = target;
    }
  }
  if (!file.thingtime.includes('file') && !(file.thingtime.includes('attachment') && file.folderId)) return { state: 'unrecorded', segments: [] };
  const segments = [{ id: file.id, name: String(file.crystal?.name || file.id), href: `/thing/${encodeURIComponent(file.id)}` }];
  const seen = new Set([file.id]);
  let folderId = file.folderId;
  while (folderId) {
    if (seen.has(folderId)) return { state: 'unavailable', segments: [] };
    seen.add(folderId);
    const folder = await read(folderId);
    if (!folder || !folder.thingtime.includes('folder')) return { state: 'unavailable', segments: [] };
    segments.unshift({ id: folder.id, name: String(folder.crystal?.title || folder.crystal?.name || folder.id), href: `/things?${new URLSearchParams({ folder: folder.id })}` });
    folderId = folder.folderId;
  }
  return { state: 'recorded', segments };
}

export const isUnfiledAttachment = (thing: LocationThing) =>
  thing.thingtime.includes('attachment') && !thing.targetId && !thing.folderId;
