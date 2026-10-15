import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, WORKSPACE_LIMITS } from './storage';
import { LocalThings } from './things';
import { LocalInteractions, localInteractionState, localSavedPage } from './interactions';
import { localPostInput, localPostProjection } from './posts';
const scope = { kind: 'anonymous' as const }, lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const account = { kind: 'account' as const, origin: 'https://example.test', ownerId: 'someone', dataPlane: 'home' };
const fixture = () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory);
 return { factory, db, things: new LocalThings(db, scope, lease), interactions: new LocalInteractions(db, scope, lease) };
};

test('local reactions are independent relational slots, bounded, and excluded from portable content', async () => {
 const { db, things, interactions } = fixture();
 try {
  const post = await things.savePost(localPostInput({ type: 'text', text: 'Private local post' }));
  const before = await things.export([post.id]);
  const tokens = ['👍','❤️','🥰','🙌','💀','🌞','🌛','🌜','⭐','🌟','🔥','💧','🐱','🐶','🐭','🐹','🐰','🦊','🐻','🐼'];
  for (const token of tokens) await interactions.toggle('reaction', post.id, token);
  const state = await interactions.toggle('reaction', post.id, null);
  assert.deepEqual(state.viewerReactions.sort(), tokens.sort());
  assert.deepEqual(Object.values(state.reactionCounts), tokens.map(() => 1));
  await assert.rejects(interactions.toggle('reaction', post.id, '🦁'), /at most 20/);
  await assert.rejects(interactions.toggle('reaction', post.id, 'invalid text'), /Unsupported reaction/);
  assert.equal((await interactions.toggle('reaction', post.id, '👍')).reactionCounts['👍'], undefined);
  assert.equal((await interactions.toggle('reaction', post.id, '🦁')).reactionCounts['🦁'], 1);
  assert.equal((await things.get(post.id)).revision, post.revision);
  assert.equal((await things.list()).things.length, 1);
  assert.deepEqual((await things.export([post.id])).manifest, before.manifest);
  const reaction = (await things.snapshot()).find(row => row.thingtime.includes('reaction'))!;
  assert.equal(reaction.targetId, post.id); assert.equal('ownerId' in reaction, false); assert.equal('acl' in reaction, false);
  await assert.rejects(things.export([reaction.id]), /interaction/i);
  await assert.rejects(things.create({ thingtime: ['reaction'], crystal: { emoji: '👍' }, targetId: post.id }), /dedicated/);
  await assert.rejects(things.create({ thingtime: ['save'], crystal: {}, targetId: post.id }), /dedicated/);
  await assert.rejects(things.update({ id: reaction.id, crystal: { emoji: '🔥' } }), /dedicated/);
  await assert.rejects(things.import({ format: 'thingtime.transfer', version: 1, roots: ['r'], files: [], things: [
   { id: 'p', thingtime: ['data'], crystal: {} }, { id: 'r', thingtime: ['reaction'], crystal: { emoji: '👍' }, targetId: 'p' }
  ] }), /dedicated|managed|cannot.*import/i);
  await things.remove([post.id]); assert.deepEqual(await things.snapshot(), []);
 } finally { await db.close(); }
});

test('poll and up/down interactions use native toggle, flip, invalid-input and stale-option rules', async () => {
 const { db, things, interactions } = fixture();
 try {
  const post = await things.savePost(localPostInput({ type: 'thingtime', thing: { question: 'Pick a colour', options: ['Gold', 'Peach', 'Rose'] } }));
  const cast = await interactions.toggle('vote', post.id, 2);
  assert.deepEqual(cast.pollVotes, { counts: [0,0,1], totalVotes: 1, viewerVote: 2 });
  const voteId = (await things.snapshot()).find(row => row.thingtime.includes('vote'))!.id;
  assert.equal((await interactions.toggle('vote', post.id, 1)).pollVotes?.viewerVote, 1);
  assert.equal((await things.snapshot()).find(row => row.thingtime.includes('vote'))!.id, voteId);
  assert.equal((await interactions.toggle('vote', post.id, 1)).pollVotes?.totalVotes, 0);
  for (const value of [-1, 3, 0.5, 'no']) await assert.rejects(interactions.toggle('vote', post.id, value), /optionIndex/);
  await interactions.toggle('vote', post.id, 2);
  const edited = await things.savePost({ id: post.id, crystal: { thing: { question: 'Pick a colour', options: ['Gold','Peach'] } } }, true);
  assert.deepEqual(localPostProjection(edited, await things.snapshot(), 'workspace').pollVotes, { counts: [0,0], totalVotes: 0, viewerVote: null });
  assert.equal((await interactions.toggle('updown', post.id, 'up')).votes.score, 1);
  assert.equal((await interactions.toggle('updown', post.id, 'down')).votes.score, -1);
  assert.equal((await interactions.toggle('updown', post.id, 'down')).votes.score, 0);
  assert.equal((await interactions.toggle('updown', post.id, null)).votes.viewerVote, null);
  await assert.rejects(interactions.toggle('updown', post.id, 'sideways'), /direction/);
  const data = await things.create({ thingtime: ['data'], crystal: { question: 'Data poll', options: ['Yes','No'] } });
  assert.equal((await interactions.toggle('vote', data.id, 0)).pollVotes?.totalVotes, 1);
  await assert.rejects(interactions.toggle('updown', data.id, 'up'), /posts and comments/);
  const comment = await things.savePost({ ...localPostInput({ type: 'text', text: 'Child' }), thingtime: ['post','comment'], targetId: post.id });
  await interactions.toggle('updown', comment.id, 'up');
  assert.equal(localPostProjection(edited, await things.snapshot(), 'workspace', true).comments[0].votes?.score, 1);
  await things.remove([post.id, data.id]); assert.deepEqual(await things.snapshot(), []);
 } finally { await db.close(); }
});

test('Saved paginates only live posts, persists on reopen and unsaves without editing content', async () => {
 const { db, factory, things } = fixture(); let tick = 0;
 const interactions = new LocalInteractions(db, scope, lease, () => crypto.randomUUID(), () => new Date(++tick * 1000).toISOString());
 try {
  const posts = [];
  for (let i = 0; i < 3; i++) {
   const row = await things.savePost(localPostInput({ type: 'text', text: `Post ${i}` })); posts.push(row);
   assert.equal((await interactions.toggle('save', row.id)).saved, true);
  }
  const data = await things.create({ thingtime: ['data'], crystal: {} }); await interactions.toggle('save', data.id);
  const all = await things.snapshot(), first = localSavedPage(all, undefined, 2), next = localSavedPage(all, first.nextCursor!, 2);
  assert.deepEqual(first.things.map(row => row.id), [posts[2].id, posts[1].id]);
  assert.deepEqual(next.things.map(row => row.id), [posts[0].id]); assert.equal(next.nextCursor, null);
  assert.throws(() => localSavedPage(all, 'missing'), /Refresh/);
  await db.close();
  const reopened = new WorkspaceDatabase(factory), restored = new LocalThings(reopened, scope, lease);
  assert.equal(localSavedPage(await restored.snapshot()).things.length, 3); await reopened.close();
  assert.equal((await interactions.toggle('save', posts[1].id)).saved, false);
  assert.equal((await things.get(posts[1].id)).revision, posts[1].revision);
  await things.remove([posts[2].id]); assert.deepEqual(localSavedPage(await things.snapshot()).things.map(row => row.id), [posts[0].id]);
 } finally { await db.close(); }
});

test('separate tabs serialize local toggles and retired/account callers cannot mutate slots', async () => {
 const { db, factory, things, interactions } = fixture(), second = new WorkspaceDatabase(factory);
 try {
  const post = await things.savePost(localPostInput({ type: 'text', text: 'Concurrent' }));
  const other = new LocalInteractions(second, scope, lease);
  await Promise.all([interactions.toggle('reaction', post.id, '👍'), other.toggle('reaction', post.id, '👍')]);
  assert.equal((await things.snapshot()).filter(row => row.thingtime.includes('reaction')).length, 0);
  await Promise.all([interactions.toggle('updown', post.id, 'up'), other.toggle('updown', post.id, 'down')]);
  assert.equal((await things.snapshot()).filter(row => row.thingtime.includes('updown')).length, 1);
  await assert.rejects(new LocalInteractions(db, account, lease).toggle('save', post.id), /sync adapter/);
  await assert.rejects(interactions.toggle('save', 'remote-private-id'), /device workspace/);
  await assert.rejects(interactions.toggle('save', 'local-absent'), /not available/);
  const retired = new LocalInteractions(db, scope, { ...lease, assertCurrent() { throw new Error('Workspace changed'); } });
  await assert.rejects(retired.toggle('save', post.id), /Workspace changed/);
  assert.deepEqual(await db.transaction(account, 'readonly', lease, tx => tx.list('things')), []);
 } finally { await db.close(); await second.close(); }
});

test('failed replacement rolls back the prior interaction atomically', async () => {
 const { db, things, interactions } = fixture();
 try {
  const post = await things.savePost(localPostInput({ type: 'text', text: 'Quota' }));
  await interactions.toggle('updown', post.id, 'up');
  // Oversized replacement fails after the existing child was deleted, so this
  // proves rollback restores the old slot rather than losing the prior vote.
  const oversized = new LocalInteractions(db, scope, lease, () => crypto.randomUUID(), () => 'x'.repeat(WORKSPACE_LIMITS.recordBytes));
  await assert.rejects(oversized.toggle('updown', post.id, 'down'), /exceeds 1 MB/);
  const rows = (await things.snapshot()).filter(row => row.targetId === post.id);
  assert.deepEqual(localInteractionState(post, rows).votes, { up: 1, down: 0, score: 1, viewerVote: 'up' });
 } finally { await db.close(); }
});
