import { readOwnedSyncFolder } from './configurationEditor';
export type CloudFolderPath = { id: string; name: string; path: string };
class InvalidFolderPath extends Error {}
/** Cache shared ancestors and process at most four paths concurrently. This is
 * a work budget, not a path/item cap. Transport failures remain retryable. */
export async function cloudFolderPaths(rows: unknown[], ownerId: string, get: (id: string) => Promise<unknown>, assertCurrent: () => void = () => {}): Promise<CloudFolderPath[]> {
 const cache = new Map<string, Promise<any>>();
 for (const row of rows as any[]) if (row?.id) cache.set(row.id, Promise.resolve(row));
 const read = async (id: string) => {
  assertCurrent();
  let value = cache.get(id);
  if (!value) { value = get(id); cache.set(id, value); }
  try { const row = await value; assertCurrent(); return row; }
  catch (cause) { assertCurrent(); if ([403,404].includes((cause as { status?: number })?.status)) throw new InvalidFolderPath('Folder ancestry is unavailable'); throw cause; }
 };
 const owned = (row: unknown) => { try { return readOwnedSyncFolder(row, ownerId); } catch { throw new InvalidFolderPath('Invalid folder'); } };
 const result: CloudFolderPath[] = [];
 let next = 0;
 const worker = async () => {
  while (next < rows.length) {
   assertCurrent(); const value = rows[next++];
   try {
    const folder = owned(value), names = [folder.name], seen = new Set([folder.id]);
    let parent = (value as any).folderId;
    while (parent) {
     if (typeof parent !== 'string' || seen.has(parent)) throw new InvalidFolderPath('Folder ancestry is invalid');
     seen.add(parent);
     const row = await read(parent), ancestor = owned(row);
     if (ancestor.id !== parent) throw new InvalidFolderPath('Folder identity changed');
     names.unshift(ancestor.name); parent = row.folderId;
    }
    assertCurrent(); result.push({ ...folder, path: names.join(' / ') });
   } catch (cause) { if (!(cause instanceof InvalidFolderPath)) throw cause; }
  }
 };
 await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker));
 assertCurrent(); return result.sort((a,b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
}
