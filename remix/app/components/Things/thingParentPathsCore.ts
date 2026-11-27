import { postThingReferences } from '../Feed/postThingReferences';
import { collectWebpageAttachmentIds } from '../Builder/webpageAttachmentRefs';
export type ParentPathThing = { id: string; thingtime: string[]; folderId?: string | null; targetId?: string | null; parentId?: string | null; crystal?: Record<string, any> };
export type ParentPathSegment = { id: string; name: string; href: string };
export type ParentIndex = Map<string, Set<string>>;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
export const directParentIds = (row: ParentPathThing): string[] => [...new Set([row.folderId, row.targetId, row.parentId, row.crystal?.parentId].filter(identifier))];
const add = (index: ParentIndex, child: unknown, parent: string) => {
  if (!identifier(child) || child === parent) return;
  if (!index.has(child)) index.set(child, new Set());
  index.get(child)!.add(parent);
};
/** Index only typed canonical references. No recursive string/name matching. */
export function typedReferencedIds(row: ParentPathThing): string[] {
  const ids = new Set<string>();
  if (row.thingtime.includes('file') && identifier(row.crystal?.content?.attachmentId)) ids.add(row.crystal!.content.attachmentId);
  if (row.thingtime.some(kind => ['post', 'comment'].includes(kind))) for (const reference of postThingReferences(row.crystal?.thing)) ids.add(reference.id);
  if (row.thingtime.includes('webpage')) for (const id of collectWebpageAttachmentIds(row.crystal)) ids.add(id);
  return [...ids];
}
export function indexParentReferences(index: ParentIndex, row: ParentPathThing) {
  for (const childId of typedReferencedIds(row)) add(index, childId, row.id);
}
const segment = (row: ParentPathThing): ParentPathSegment => ({ id: row.id, name: String(row.crystal?.title || row.crystal?.name || row.id), href: row.thingtime.includes('folder') ? `/things?${new URLSearchParams({ folder: row.id })}` : `/thing/${encodeURIComponent(row.id)}` });
export type ParentPathWork = { ids: string[]; segments: ParentPathSegment[]; via?: { childId: string; typed: boolean } }[];
/** The frontier holds unvalidated candidates; validation happens when popped.
 * Consequently each work unit performs at most one ACL read, even when a Thing
 * has many incoming references. Known path segments survive continuation. */
export async function parentPathPage(focusId: string, index: ParentIndex, read: (id: string) => Promise<ParentPathThing | null>, pending: ParentPathWork = [{ ids: [focusId], segments: [] }], pageSize = 20, workBudget = 200) {
  const frontier = pending.map(item => ({ ...item, ids: [...item.ids], segments: [...item.segments] }));
  const paths: ParentPathSegment[][] = [];
  let cycles = 0, unavailable = 0, work = 0;
  while (frontier.length && paths.length < pageSize && work++ < workBudget) {
    const item = frontier.pop()!, id = item.ids.at(-1)!;
    const row = await read(id);
    if (!row) { unavailable++; continue; }
    if (item.via?.typed && !typedReferencedIds(row).includes(item.via.childId)) continue;
    const segments = [...item.segments, segment(row)];
    const direct = new Set(directParentIds(row));
    const candidates = [...new Set([...direct, ...(index.get(id) ?? [])])];
    let traversable = false, broken = false;
    for (const parentId of candidates) {
      if (item.ids.includes(parentId)) { cycles++; broken = true; continue; }
      traversable = true;
      frontier.push({ ids: [...item.ids, parentId], segments, via: { childId: id, typed: !direct.has(parentId) } });
    }
    if (!traversable && !broken && item.ids.length > 1) paths.push(segments.reverse().slice(0, -1));
  }
  return { paths, pending: frontier, cycles, unavailable, reads: work > workBudget ? workBudget : work };
}
export async function scanParentReferenceBatch(list: (cursor?: string) => Promise<{ things: ParentPathThing[]; nextCursor?: string | null }>, index: ParentIndex, cursor?: string, maximumPages = 10, onPage?: (scanned: number, cursor: string | undefined, complete: boolean) => void) {
  let scanned = 0, next = cursor;
  const seen = new Set<string>();
  for (let page = 0; page < maximumPages; page++) {
    const result = await list(next);
    for (const row of result.things) { indexParentReferences(index, row); scanned++; }
    next = result.nextCursor || undefined;
    if (!next) { onPage?.(result.things.length, undefined, true); return { scanned, cursor: undefined, complete: true }; }
    if (seen.has(next) || next === cursor) throw Error('The reference scan repeated a page cursor.');
    seen.add(next);
    onPage?.(result.things.length, next, false);
  }
  return { scanned, cursor: next, complete: false };
}
