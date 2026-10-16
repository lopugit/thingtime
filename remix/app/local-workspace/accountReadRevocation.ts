import { WorkspaceError, WORKSPACE_LIMITS, type WorkspaceTransaction } from './storage';
export const ACCOUNT_READ_COLLECTIONS = ['account-post-projections', 'account-discussion-projections'] as const;
type Snapshot = { post: any | null; at: number; deniedAt?: number; parent?: string | null };
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
 const children = new Map<string, string[]>();
 for (const row of rows) {
  const parent = row.value.parent || row.value.post?.targetId;
  if (typeof parent === 'string' && parent) { const values = children.get(parent) || []; values.push(row.id); children.set(parent, values); }
 }
 const denied = new Set([id]), pending = [id];
 while (pending.length) for (const child of children.get(pending.pop()!) || []) if (!denied.has(child)) { denied.add(child); pending.push(child); }
 let changed = false;
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
