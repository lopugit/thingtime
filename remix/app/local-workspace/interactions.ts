import { pollShapeOfCrystal, tallyPollVotes, voteKeyOf } from '../api/utils/things/pollCore';
import { parseUpdownDirection, tallyUpdown, updownKeyOf, type UpdownDirection } from '../api/utils/things/updownCore';
import { sanitizeReactionToken, MAX_REACTIONS_PER_USER_PER_POST } from '../utils/reactionTokens';
import { isProtectedThingtime } from '../schemas/registry';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';
import type { LocalThing } from './things';

export const LOCAL_INTERACTION_KINDS = ['reaction', 'save', 'vote', 'updown'] as const;
export const isLocalInteraction = (row: Pick<LocalThing, 'thingtime'>) => row.thingtime.some(kind => (LOCAL_INTERACTION_KINDS as readonly string[]).includes(kind));
const fail = (message: string, status = 400): never => { throw new WorkspaceError('LOCAL_INTERACTION_ERROR', message, status); };

/** Every row comes from one isolated workspace. Projection identity is a label,
 * never a remote account grant. Reuse the normal poll and up/down tally rules. */
export function localInteractionState(target: LocalThing, children: LocalThing[], viewer = 'workspace') {
 const reactions = children.filter(row => row.thingtime.includes('reaction')).map(row => sanitizeReactionToken(row.crystal.emoji)).filter((token): token is string => token !== null);
 const viewerReactions = [...new Set(reactions)];
 const poll = pollShapeOfCrystal(target.crystal);
 return {
  reactionCounts: Object.fromEntries(viewerReactions.map(token => [token, 1])), viewerReactions,
  viewerSaved: children.some(row => row.thingtime.includes('save')),
  votes: tallyUpdown(children.filter(row => row.thingtime.includes('updown')).map(row => ({ userId: viewer, direction: row.crystal.direction as UpdownDirection })), viewer),
  ...(poll ? { pollVotes: tallyPollVotes(poll.optionCount, children.filter(row => row.thingtime.includes('vote')).map(row => ({ userId: viewer, optionIndex: Number(row.crystal.optionIndex) })), viewer) } : {})
 };
}

/** Page through saved post references, never through another workspace's data. */
export function localSavedPage(all: LocalThing[], cursor?: string, limit = 30) {
 const byId = new Map(all.map(row => [row.id, row]));
 const saves = all.filter(row => row.thingtime.includes('save') && byId.get(row.targetId || '')?.thingtime.includes('post'))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
 const start = cursor ? saves.findIndex(row => row.id === cursor) + 1 : 0;
 if (cursor && !start) throw new WorkspaceError('INVALID_CURSOR', 'Saved items changed. Refresh to continue.');
 const size = Math.max(1, Math.min(50, Math.floor(Number(limit) || 30))), page = saves.slice(start, start + size);
 return { things: page.map(save => byId.get(save.targetId!)!), nextCursor: saves.length > start + size ? page.at(-1)!.id : null };
}

/** Dedicated local writer for relational interactions. Generic CRUD/import
 * cannot mint these slots. The scoped transaction serializes toggles and quota. */
export class LocalInteractions {
 constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease, private uuid = () => crypto.randomUUID(), private now = () => new Date().toISOString()) {}
 async toggle(kind: typeof LOCAL_INTERACTION_KINDS[number], id: unknown, value?: unknown) {
  this.lease.assertCurrent();
  if (this.scope.kind !== 'anonymous') return fail('Account interactions require their dedicated sync adapter', 403);
  if (!LOCAL_INTERACTION_KINDS.includes(kind) || typeof id !== 'string' || !id || id.length > 200) return fail('Select a Thing in this device workspace', 404);
  const token = kind === 'reaction' ? sanitizeReactionToken(value) : null;
  if (kind === 'reaction' && value !== null && !token) return fail('Unsupported reaction');
  const direction = kind === 'updown' ? parseUpdownDirection(value) : null;
  if (direction?.ok === false) return fail(direction.error);
  return this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
   const target = await tx.get<LocalThing>('things', id);
   if (!target || isLocalInteraction(target) || (isProtectedThingtime(target.thingtime) && !target.thingtime.includes('attachment'))) return fail('Thing is not available for local interactions', 404);
   const children = (await tx.list<LocalThing>('things')).map(row => row.value).filter(row => row.targetId === id && isLocalInteraction(row));
   const existing = children.filter(row => row.thingtime.includes(kind) && (kind !== 'reaction' || row.crystal.emoji === token));
   let crystal: LocalThing['crystal'] = {}, remove = existing.length > 0;
   if (kind === 'reaction') {
    // Null is the normal reaction endpoint's read/reconciliation operation.
    if (value === null) { const state = localInteractionState(target, children); return { ok: true, ...state, saved: state.viewerSaved, direction: state.votes.viewerVote }; }
    if (!remove && children.filter(row => row.thingtime.includes('reaction')).length >= MAX_REACTIONS_PER_USER_PER_POST) return fail(`You can add at most ${MAX_REACTIONS_PER_USER_PER_POST} reactions to a post`);
    crystal = { emoji: token! };
   } else if (kind === 'vote') {
    const poll = pollShapeOfCrystal(target.crystal), optionIndex = Number(value);
    if (!poll) return fail('That Thing is not a poll');
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.optionCount) return fail(`optionIndex must be an integer between 0 and ${poll.optionCount - 1}`);
    crystal = { optionIndex, voteKey: voteKeyOf(id, workspaceScopeKey(this.scope)) };
    remove = existing.some(row => row.crystal.optionIndex === optionIndex);
   } else if (kind === 'updown') {
    if (!target.thingtime.some(kind => kind === 'post' || kind === 'comment')) return fail('You can only upvote or downvote posts and comments');
    const next = direction?.ok ? direction.direction : null;
    remove = next === null || existing.some(row => row.crystal.direction === next);
    crystal = { direction: next, updownKey: updownKeyOf(id, workspaceScopeKey(this.scope)) };
   }
   for (const row of existing) await tx.delete('things', row.id);
   const remaining = children.filter(row => !existing.some(previous => previous.id === row.id));
   if (!remove) {
    const previous = existing[0], stamp = this.now();
    const row: LocalThing = { id: previous?.id || `local-${kind}-${this.uuid()}`, thingtime: [kind], targetId: id, crystal,
     createdAt: previous?.createdAt || stamp, updatedAt: stamp, revision: (previous?.revision || 0) + 1 };
    await tx.put('things', row.id, row); remaining.push(row);
   }
   const state = localInteractionState(target, remaining);
   return { ok: true, ...state, saved: state.viewerSaved, direction: state.votes.viewerVote };
  });
 }
}
