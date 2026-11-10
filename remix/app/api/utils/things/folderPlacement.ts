import { randomUUID } from 'node:crypto';
import { folderThingMatch } from '../../../schemas/folderThing';
import { StorageMutationError } from '../storage/storageCore';

export const MAX_FOLDER_DEPTH = 64;
const conflict = (message: string): never => { throw new StorageMutationError(409, 'storage_conflict', message); };

/** Call inside the placement transaction. Snapshot reads alone cannot prevent
 * deletion or two concurrent moves creating a cycle. Write every ancestor in
 * the destination path, then revalidate that path on any transaction retry.
 * This private fence is bookkeeping; it changes neither content nor updatedAt. */
export async function lockFolderDestination(things: any, ownerId: string, folderId: string | null, session: any, movingFolderId?: string): Promise<any | null> {
  if (!session) throw new Error('Folder placement requires a transaction');
  let current = folderId;
  let destination: any | null = null;
  const visited = new Set<string>();
  const token = randomUUID();
  while (current) {
    if (current.startsWith('timeline-')) conflict('The Timeline folder is managed through History');
    if (current === movingFolderId || visited.has(current) || visited.size >= MAX_FOLDER_DEPTH) {
      conflict('A folder cannot be moved into itself, its subfolders or an unresolved folder chain');
    }
    visited.add(current);
    const folder = await things.findOne({ shareId: current, ownerId, ...folderThingMatch() }, { session,
      projection: { _id: 1, shareId: 1, ownerId: 1, thingtime: 1, folderId: 1, updatedAt: 1,
        appId: 1, sandbox: 1, sandboxSpace: 1, 'crystal.kind': 1, 'crystal.type': 1 } });
    if (!folder) conflict('The destination folder changed or was deleted. Refresh and try again.');
    if (folder.folderId != null && (typeof folder.folderId !== 'string' || folder.folderId.length > 200)) conflict('The destination folder chain is invalid');
    destination ??= folder;
    const touched = await things.updateOne({ ...(folder._id ? { _id: folder._id } : {}), shareId: current, ownerId, ...folderThingMatch() },
      { $set: { folderMutationToken: token } }, { session });
    if (touched.matchedCount !== 1) conflict('The destination folder changed. Refresh and try again.');
    current = folder.folderId || null;
  }
  return destination;
}
