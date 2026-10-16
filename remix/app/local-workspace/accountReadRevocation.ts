import { WorkspaceError, WORKSPACE_LIMITS, type WorkspaceTransaction } from './storage';
import type { ThingTransfer } from '../utils/thingTransfer/format';
export const ACCOUNT_READ_COLLECTIONS = ['account-post-projections', 'account-discussion-projections'] as const;
export const ACCOUNT_EXPORT_SNAPSHOTS = 'thing-export-snapshots';
type Snapshot = { post: any | null; at: number; deniedAt?: number; parent?: string | null; root?: string | null };
export const pruneAccountConversation = (post: any, denied: (id: string) => boolean): any => ({
 ...post,
 comments: (post.comments || []).filter((row: any) => !denied(row.id)).map((row: any) => pruneAccountConversation(row, denied)),
 ...('shareOf' in post ? { shareOf: post.shareOf && !denied(post.shareOf.id) ? pruneAccountConversation(post.shareOf, denied) : null } : {}),
 ...(post.linkedThings ? { linkedThings: post.linkedThings.map((row: any) => denied(row.id) ? { ...row, thing: null } : row) } : {})
});
/** Both display projections share one atomic refusal boundary. Retained copies
 * and descendants must not survive via another permalink/cache shape. */
export async function forgetAccountConversation(tx: WorkspaceTransaction, id: string, at: number) {
 if (typeof id !== 'string' || !id || id.length > 200 || !Number.isFinite(at) || at < 0) throw new WorkspaceError('INVALID_READ_REFUSAL', 'Invalid account read refusal.', 400);
 const rows = (await Promise.all(ACCOUNT_READ_COLLECTIONS.map(async collection => (await tx.list<Snapshot>(collection)).map(row => ({ ...row, collection }))))).flat();
 const owned = (await tx.list<{state:string;base:unknown}>('thing-sync')).filter(row => row.value.state === 'synced' && row.value.base);
 const ownedBodies = await Promise.all(owned.map(async row => ({id:row.id,value:await tx.get<{targetId?:string}>('things',row.id)})));
 const exports = await tx.list<{manifest:ThingTransfer;references?:string[]}>(ACCOUNT_EXPORT_SNAPSHOTS);
 const children = new Map<string, string[]>();
 for (const row of ownedBodies) if (row.value?.targetId) { const values=children.get(row.value.targetId)||[];values.push(row.id);children.set(row.value.targetId,values); }
 for (const snapshot of exports) for (const row of snapshot.value.manifest.things) if (row.targetId) { const values=children.get(row.targetId)||[];values.push(row.id);children.set(row.targetId,values); }
 for (const row of rows) {
  for (const parent of [row.value.parent || row.value.post?.targetId, row.value.root]) if (typeof parent === 'string' && parent) { const values = children.get(parent) || []; values.push(row.id); children.set(parent, values); }
 }
 const denied = new Set([id]), pending = [id];
 while (pending.length) for (const child of children.get(pending.pop()!) || []) if (!denied.has(child)) { denied.add(child); pending.push(child); }
 // Retained bytes stay recoverable, but media views must recheck their access
 // watermark even when this refusal has no ordinary Thing projection.
 const files = await tx.list<{source?:string;remote?:{id:string}}>('account-files');
 let changed = files.some(row => row.value.source === 'account' && denied.has(row.value.remote?.id || ''));
 // Export-only dependencies are read caches too, never an enduring grant.
 // Remove the whole closure; pruning a fragment would advertise a partial ZIP.
 for (const row of exports) if (row.value.manifest.things.some(thing => denied.has(thing.id)) || row.value.references?.some(id=>denied.has(id))) { await tx.delete(ACCOUNT_EXPORT_SNAPSHOTS,row.id);changed=true; }
 // Synced owned rows are remote read caches too. Preserve unsynced authored
 // work, but do not resurrect deleted/refused comments through that cache.
 for (const row of ownedBodies) if (denied.has(row.id)) { await tx.delete('things',row.id);await tx.delete('thing-sync',row.id);changed=true; }
 for (const row of rows) {
  if (denied.has(row.id)) { changed ||= !!row.value.post; await tx.delete(row.collection, row.id); }
  else if (row.value.post) {
   const post = pruneAccountConversation(row.value.post, target => denied.has(target));
   if (JSON.stringify(post) !== JSON.stringify(row.value.post)) { changed = true; await tx.put(row.collection, row.id, { ...row.value, post }); }
  }
 }
 // Both formats consult the same refusal watermark; no duplicate records are needed.
 // Eviction, if necessary at the record cap, is limited to display snapshots.
 const writes = [...denied].map(target => ({ collection: ACCOUNT_READ_COLLECTIONS[0], target }));
 const index = new Map(rows.map(row => [JSON.stringify([row.collection,row.id]),row.value]));
 const watermarks = writes.map(({collection,target}) => {
  const old = index.get(JSON.stringify([collection,target])) || index.get(JSON.stringify([ACCOUNT_READ_COLLECTIONS[1],target]));
  return { collection, target, value: { post: null, parent: old?.parent || old?.post?.targetId || null, at: Math.max(at, old?.at || 0), deniedAt: Math.max(at, old?.deniedAt || 0) } };
 });
 const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
 const addedBytes = watermarks.reduce((sum,row) => sum+bytes(row.value),0), usage = await tx.usage();
 const evictable = rows.filter(row => !denied.has(row.id) && row.value.post).sort((a,b) => a.value.at-b.value.at);
 while (usage.records + watermarks.length > WORKSPACE_LIMITS.records || usage.bytes + addedBytes > WORKSPACE_LIMITS.bytes) {
  const row = evictable.shift();
  if (!row) throw new WorkspaceError('LOCAL_QUOTA','Cannot retain the account read refusal at the device limit.',413);
  const current = await tx.get(row.collection,row.id);
  if (current) { usage.records--; usage.bytes -= bytes(current); await tx.delete(row.collection,row.id); }
 }
 for (const { collection, target, value } of watermarks) await tx.put(collection, target, value);
 return changed;
}

export async function accountReadRefusals(tx: WorkspaceTransaction) {
 const refusals = new Map<string, { at: number; parent: string | null }>();
 for (const collection of ACCOUNT_READ_COLLECTIONS) for (const row of await tx.list<Snapshot>(collection)) {
  if (row.value.deniedAt === undefined) continue;
  if (!refusals.has(row.id) || refusals.get(row.id)!.at < row.value.deniedAt) refusals.set(row.id, { at: row.value.deniedAt, parent: row.value.parent || row.value.post?.targetId || null });
 }
 return refusals;
}
