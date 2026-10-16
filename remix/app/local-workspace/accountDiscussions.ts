import { accountReadRefusals, forgetAccountConversation } from './accountReadRevocation';
import type { PublicPost } from '../components/Feed/feedTypes';
import { accountDiscussionProjection } from './accountPosts';
import { searchLocalThings } from './structuredSearch';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const COLLECTION = 'account-discussion-projections';
type Snapshot = { post: PublicPost | null; at: number; deniedAt?: number; parent: string | null };
const validId = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 200;
const missing = () => new WorkspaceError('LOCAL_DISCUSSION_MISSING', 'This discussion is not saved on this device. Open it online to retain it.', 409);

/** Read snapshots only: neither ownership nor permission to write follows from
 * retaining a discussion. Every comment is a separate scoped record. */
export class AccountDiscussionCache {
 constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease) {
  if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Account discussions require their original workspace.', 403);
 }
 async remember(root: unknown, startedAt = Date.now()) {
  const post = accountDiscussionProjection(root);
  return this.save([post], startedAt);
 }
 async rememberPage(target: string, comments: unknown[], startedAt = Date.now()) {
  if (!validId(target) || !Array.isArray(comments) || comments.length > 50) throw new WorkspaceError('INVALID_DISCUSSION_CACHE', 'Invalid discussion page.', 502);
  const posts = comments.map(accountDiscussionProjection);
  if (posts.some(post => !post.thingtime.includes('comment') || (post as any).targetId !== target || post.id === target) || new Set(posts.map(post => post.id)).size !== posts.length)
   throw new WorkspaceError('INVALID_DISCUSSION_CACHE', 'Comments must belong to the requested discussion.', 502);
  return this.save(posts, startedAt, target);
 }
 private async save(posts: PublicPost[], at: number, target?: string) {
  if (!Number.isFinite(at) || at < 0) throw new WorkspaceError('INVALID_DISCUSSION_CACHE', 'Invalid discussion read time.', 502);
  return this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
   const snapshots = new Map((await tx.list<Snapshot>(COLLECTION)).map(row => [row.id, row.value])), refusals = await accountReadRefusals(tx);
   const denied = (id: string | null): boolean => {
    const seen = new Set<string>();
    while (id) {
     if (seen.has(id)) return true;
     seen.add(id); const row = snapshots.get(id);
     if (Math.max(row?.deniedAt ?? -Infinity, refusals.get(id)?.at ?? -Infinity) >= at) return true;
     id = row?.parent || refusals.get(id)?.parent || null;
    }
    return false;
   };
   if (target && denied(target)) return false;
   let changed = false;
   for (const post of posts) {
    const old = snapshots.get(post.id);
    const parent = validId((post as any).targetId) ? (post as any).targetId as string : old?.parent || null;
    if (denied(post.id) || denied(parent) || (old && old.at > at)) continue;
    const next: Snapshot = { post, at, parent, ...(old?.deniedAt !== undefined ? { deniedAt: old.deniedAt } : {}) };
    changed ||= JSON.stringify(old?.post) !== JSON.stringify(post);
    await tx.put(COLLECTION, post.id, next); snapshots.set(post.id, next);
   }
   return changed;
  });
 }
 async get(id: string) {
  if (!validId(id)) throw missing();
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => (await tx.get<Snapshot>(COLLECTION, id))?.post || null);
 }
 async comments(target: string, args: { cursor?: string; limit?: number } = {}, knownLocalTarget = false) {
  if (!validId(target)) throw missing();
  const rows = await this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const root = await tx.get<Snapshot>(COLLECTION, target);
   if (!root?.post && !knownLocalTarget) throw missing();
   const refusal = (await accountReadRefusals(tx)).get(target);
   if (refusal && (!root?.post || root.at <= refusal.at)) throw missing();
   return (await tx.list<Snapshot>(COLLECTION)).filter(row => row.value.post?.thingtime.includes('comment') && row.value.parent === target);
  });
  const byId = new Map(rows.map(row => [row.id, row.value.post!]));
  const page = await searchLocalThings(rows.map(row => ({ id: row.id, thingtime: ['post'], crystal: { text: row.value.post!.text }, createdAt: row.value.post!.createdAt, updatedAt: row.value.post!.createdAt, revision: 0 })),
   { ...args, sort: 'oldest' }, `${workspaceScopeKey(this.scope)}:discussion:${target}`);
  return { ok: true, comments: page.things.map(row => byId.get(row.id)!), nextCursor: page.nextCursor, localWorkspace: true, incomplete: true };
 }
 async forget(id: string, at = Date.now()) {
  return this.db.transaction(this.scope, 'readwrite', this.lease, tx => forgetAccountConversation(tx, id, at));
 }
}
