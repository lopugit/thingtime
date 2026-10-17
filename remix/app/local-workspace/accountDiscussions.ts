import { localPostProjection, localTargetIndex, postThreadContext } from './posts';
import type { LocalThing } from './things';
import { ACCOUNT_READ_COLLECTIONS, accountReadRefusals, forgetAccountConversation } from './accountReadRevocation';
import type { PublicPost } from '../components/Feed/feedTypes';
import { accountDiscussionProjection } from './accountPosts';
import { searchLocalThings } from './structuredSearch';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const COLLECTION = 'account-discussion-projections';
type Snapshot = { post: PublicPost | null; at: number; deniedAt?: number; parent: string | null; root?: string | null };
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
 /** Read context and its refusal/deletion fences in one scoped revision. */
 async threadContext(id: string, author: PublicPost['author']) {
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const all = (await tx.list<LocalThing>('things')).map(row=>row.value), byId = new Map(all.map(row=>[row.id,row])), byTarget=localTargetIndex(all);
   const states = new Map((await tx.list<{state:string;deleted?:unknown;audience:{acl:string[];visibility:PublicPost['visibility']}}>('thing-sync')).map(row=>[row.id,row.value]));
   const snapshots = new Map<string,Snapshot>(), threadRoots = new Map<string,string>();
   for (const collection of ACCOUNT_READ_COLLECTIONS) for (const row of await tx.list<Snapshot>(collection)) {
    if (row.value.root) threadRoots.set(row.id,row.value.root);
    if (!snapshots.has(row.id) || snapshots.get(row.id)!.at < row.value.at) snapshots.set(row.id,row.value);
   }
   const refusals = await accountReadRefusals(tx), blocked = new Set([...states].filter(([,state])=>state.deleted).map(([key])=>key));
   for (const [key,refusal] of refusals) if ((!byId.has(key) || states.get(key)?.state!=='synced') && (!snapshots.get(key)?.post || snapshots.get(key)!.at<=refusal.at)) blocked.add(key);
   const children=new Map<string,Set<string>>();
   for(const key of new Set([...byId.keys(),...snapshots.keys()])) for(const parent of [byId.get(key)?.targetId,snapshots.get(key)?.parent,(snapshots.get(key)?.post as any)?.targetId,threadRoots.get(key)]) if(parent){const ids=children.get(parent)||new Set<string>();ids.add(key);children.set(parent,ids);}
   const pending=[...blocked];while(pending.length)for(const child of children.get(pending.pop()!)||[])if(!blocked.has(child)){blocked.add(child);pending.push(child);}
   const projected = new Map<string,PublicPost & {targetId?:string|null}>();
   const lookup = (target: string) => {
    if (projected.has(target)) return projected.get(target)!;
    const state=states.get(target), local=byId.get(target), snapshot=snapshots.get(target);
    if (blocked.has(target)) return null;
    // Known refusals remove synced owned rows atomically. Pending authored work
    // remains recoverable but cannot supply refused conversation context.
    const post = local && state ? { ...localPostProjection(local,all,this.scope.kind==='account'?this.scope.ownerId:'',false,byTarget), ...state.audience, author, localOnly:false, localWorkspace:true } : snapshot?.post;
    if (!post) return null;
    const withTarget = {...post,targetId:(post as any).targetId || snapshot?.parent || null};
    projected.set(target,withTarget);return withTarget;
   };
   const row=lookup(id);if(!row)return {parent:null,root:null};
   const context=postThreadContext(row,lookup), rootId=threadRoots.get(id);
   return {...context,root:context.root || (rootId && rootId!==id ? lookup(rootId) : null)};
  });
 }
 async comments(target: string, args: { cursor?: string; limit?: number } = {}, knownLocalTarget = false, authored: PublicPost[] = []) {
  if (!validId(target)) throw missing();
  const rows = await this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const root = await tx.get<Snapshot>(COLLECTION, target);
   if (!root?.post && !knownLocalTarget) throw missing();
   const refusal = (await accountReadRefusals(tx)).get(target);
   if (refusal && (!root?.post || root.at <= refusal.at)) throw missing();
   return (await tx.list<Snapshot>(COLLECTION)).filter(row => row.value.post?.thingtime.includes('comment') && row.value.parent === target);
  });
  const byId = new Map(rows.map(row => [row.id, row.value.post!]));
  for (const post of authored) if (post.thingtime.includes('comment') && (post as any).targetId === target) byId.set(post.id, !post.author?.username && byId.get(post.id)?.author?.id === post.author?.id ? { ...post, author: byId.get(post.id)!.author } : post);
  const page = await searchLocalThings([...byId.values()].map(post => ({ id: post.id, thingtime: ['post'], crystal: { text: post.text }, createdAt: post.createdAt, updatedAt: post.createdAt, revision: 0 })),
   { ...args, sort: 'oldest' }, `${workspaceScopeKey(this.scope)}:discussion:${target}`);
  return { ok: true, comments: page.things.map(row => byId.get(row.id)!), nextCursor: page.nextCursor, localWorkspace: true, incomplete: true };
 }
 async forget(id: string, at = Date.now()) {
  return this.db.transaction(this.scope, 'readwrite', this.lease, tx => forgetAccountConversation(tx, id, at));
 }
}
