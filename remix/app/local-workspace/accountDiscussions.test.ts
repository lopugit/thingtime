import { createQuotaFactory, TEST_STORAGE_CAPACITY } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { AccountDiscussionCache } from './accountDiscussions';
import { AccountPostCache, accountPostProjection } from './accountPosts';
import { WorkspaceDatabase } from './storage';
const scope = { kind: 'account' as const, origin: 'https://example.test', ownerId: 'viewer', dataPlane: 'home' };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const root = (id = 'root') => ({ id, thingtime: ['component'], text: 'A retained discussion', type: 'text', createdAt: '2026-10-17T00:00:00Z', author: { id: 'other', username: 'other' }, comments: [], repliesLoaded: false, linkKey: 'secret', attachments: [] });
const comment = (id: string, targetId = 'root') => ({ ...root(id), thingtime: ['post', 'comment'], targetId, text: id });
const fixture = () => { const db = new WorkspaceDatabase(createQuotaFactory(), undefined, undefined, IDBKeyRange); return { db, cache: new AccountDiscussionCache(db, scope, lease) }; };
test('generic discussions retain safe bounded display fields with explicit partial pages and preserved authors', async () => {
 const { db, cache } = fixture();
 try {
  await cache.remember(root(), 10); await cache.rememberPage('root', [comment('a'), comment('b')], 10);
  assert.equal((await cache.get('root'))?.author?.id, 'other');
  assert.equal(JSON.stringify(await cache.get('root')).includes('secret'), false);
  const first = await cache.comments('root', { limit: 1 });
  assert.equal(first.incomplete, true); assert.equal(first.comments[0].id, 'a');
  assert.equal((await cache.comments('root', { limit: 1, cursor: first.nextCursor! })).comments[0].id, 'b');
  await assert.rejects(cache.comments('another', { limit: 1, cursor: first.nextCursor! }, true), /cursor|filters/);
  assert.equal(await new AccountDiscussionCache(db, { ...scope, ownerId: 'other' }, lease).get('root'), null);
  assert.equal(await new AccountDiscussionCache(db, { ...scope, dataPlane: 'another' }, lease).get('root'), null);
  await db.transaction(scope, 'readonly', lease, async tx => { assert.deepEqual(await tx.list('things'), []); assert.deepEqual(await tx.list('thing-sync'), []); });
  assert.throws(() => accountPostProjection(root()), /Invalid account post snapshot/);
 } finally { await db.close(); }
});
test('malformed or cross-target pages fail atomically and unvisited discussions stay explicit', async () => {
 const { db, cache } = fixture();
 try {
  await assert.rejects(cache.remember({ ...root(), comments: [comment('nested')] }), /Invalid account discussion/);
  await assert.rejects(cache.rememberPage('root', [comment('valid'), comment('foreign', 'other')]), /requested discussion/);
  assert.equal(await cache.get('valid'), null);
  await assert.rejects(cache.comments('root'), /not saved on this device/);
  assert.equal((await cache.comments('root', {}, true)).incomplete, true);
  await assert.rejects(cache.rememberPage('root', Array.from({ length: 51 }, (_, i) => comment(String(i)))), /Invalid discussion page/);
 } finally { await db.close(); }
});
test('refusals remove descendants and fence late root, page and individual reply reads', async () => {
 const { db, cache } = fixture();
 try {
  await cache.remember(root(), 10); await cache.rememberPage('root', [comment('a')], 10); await cache.rememberPage('a', [comment('reply', 'a')], 10);
  await cache.remember({ ...comment('a'), targetId: undefined }, 11);
  assert.equal(await cache.forget('root', 20), true);
  for (const id of ['root', 'a', 'reply']) assert.equal(await cache.get(id), null);
  assert.equal(await cache.remember(root(), 19), false);
  assert.equal(await cache.rememberPage('root', [comment('late')], 19), false);
  assert.equal(await cache.remember(comment('unseen', 'a'), 19), false);
  await assert.rejects(cache.comments('root', {}, true), /not saved/);
  await cache.remember(root(), 21); await cache.rememberPage('root', [comment('new')], 21);
  assert.deepEqual((await cache.comments('root')).comments.map(post => post.id), ['new']);
 } finally { await db.close(); }
});
test('older reads cannot replace newer snapshots and retired leases cannot retain data', async () => {
 const { db, cache } = fixture();
 try {
  await cache.remember(root(), 20); assert.equal(await cache.remember({ ...root(), text: 'old' }, 19), false);
  assert.equal((await cache.get('root'))?.text, root().text);
  const retired = new AccountDiscussionCache(db, scope, { ...lease, assertCurrent() { throw new Error('retired'); } });
  await assert.rejects(retired.remember(root()), /retired/);
 } finally { await db.close(); }
});
test('revocation releases body quota before installing descendant refusal watermarks', async () => {
 const { db, cache } = fixture();
 try {
  await cache.remember(root(), 10); await cache.rememberPage('root', [comment('a')], 10);
  await db.transaction(scope, 'readwrite', lease, async tx => {
   let remaining = TEST_STORAGE_CAPACITY.bytes - (await tx.usage()).bytes;
   for (let i=0; remaining>0; i++) { const size=Math.min(remaining, TEST_STORAGE_CAPACITY.recordBytes); await tx.put('padding', String(i), 'x'.repeat(size-2)); remaining -= size; }
   assert.equal((await tx.usage()).bytes, TEST_STORAGE_CAPACITY.bytes);
  });
  assert.equal(await cache.forget('root', 20), true); assert.equal(await cache.get('root'), null); assert.equal(await cache.get('a'), null);
 } finally { await db.close(); }
});


test('refusal is atomic across post permalinks, discussion roots and nested or standalone replies', async () => {
 const { db, cache } = fixture(); const posts = new AccountPostCache(db, scope, lease);
 try {
  await cache.remember(root(), 10); await cache.rememberPage('root', [comment('a')], 10);
  await posts.remember([comment('a'), { ...comment('wrapper','other'), comments: [comment('a')] }, comment('reply','a')], 10);
  assert.equal(await cache.forget('root', 20), true);
  assert.equal(await posts.get('a'), null); assert.equal(await posts.get('reply'), null); assert.deepEqual((await posts.get('wrapper'))?.comments, []);
  await posts.remember([comment('late')], 19); assert.equal(await posts.get('late'), null);
  await cache.remember(root(), 21); await cache.rememberPage('root', [comment('a')], 21);
  await posts.forget('root', 30); assert.equal(await cache.get('root'), null); assert.equal(await cache.get('a'), null);
 } finally { await db.close(); }
});


test('shared refusal watermarks fit at the record cap without evicting authored content', async () => {
 const { db, cache } = fixture();
 try {
  await cache.remember(root(), 10); await cache.remember(root('other'), 10);
  await db.transaction(scope, 'readwrite', lease, async tx => {
   for(let i=2;i<TEST_STORAGE_CAPACITY.records;i++) await tx.put('authored',String(i),{ text:'Preserve' });
  });
  assert.equal(await cache.forget('root',20),true);
  assert.equal(await cache.get('root'),null); assert.ok(await cache.get('other'));
  await db.transaction(scope,'readonly',lease,async tx=>{assert.equal((await tx.list('authored')).length,TEST_STORAGE_CAPACITY.records-2);assert.equal((await tx.usage()).records,TEST_STORAGE_CAPACITY.records);});
 } finally { await db.close(); }
});
