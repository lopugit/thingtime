import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { defineNativeThingsCollection } from '../documentStore/nativeThingsCollection';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence } from '../things/persistenceContext';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildUserSecure } from '../auth/users';
import { browseComponents } from './browse';
import { browseSchemas } from '../schemas/browse';
import type { CollectionProvider } from '../documentStore/collectionContract';
import type { ThingsReads } from '../things/persistence';
import { browseNativeCatalog } from '../things/nativeCatalogReads';

const ownerId = 'abcdef0123456789abcdef01', other = 'bbbbbbbbbbbbbbbbbbbbbbbb', at = new Date('2026-11-12T00:00:00Z');
const doc = (shareId: string, kind: string, crystal: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
 _id: shareId, shareId, ownerId, thingtime: [kind], acl: ['tt:user'], schemaVersion: 2, crystal, createdAt: at, updatedAt: at, ...extra
});
async function fixture(t: TestContext, rows: Record<string, unknown>[]) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-catalog-')), path = join(directory, 'catalog.sqlite');
 const providers: CollectionProvider[] = [], contexts: ReturnType<typeof createNativeThingsPersistenceContext>[] = [];
 const open = async () => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(path)); providers.push(provider);
  const auth = await createNativeHomeAuthRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home'); contexts.push(context);
  return { provider, run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
 };
 t.after(async () => { for (const context of contexts) context.close(); await Promise.all(providers.map(provider => provider.close())); await rm(directory, { recursive: true, force: true }); });
 const first = await open();
 await first.provider.transaction(collections => {
  defineNativeThingsCollection(collections); const things = collections.collection(physicalCollectionName('things'));
  for (const id of [ownerId, other]) things.insert(BSON.serialize(doc(id, 'user', {}, { ownerId: id, secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure })));
  // Isolated primitive fixtures, not application signup or production seeding.
  for (const row of rows) things.insert(BSON.serialize(row));
 });
 return { ...first, open };
}

test('native component catalog reads real reactions/saves/visible versions and family designs after reopen', async t => {
 const shared = { componentKey: 'card', familyKey: 'button', category: 'input', render: { tag: 'button', children: 'Read' } };
 const f = await fixture(t, [
  doc('a', 'component', { ...shared, library: 'thingtime' }, { ownerId: other, acl: ['tt:all'], createdAt: new Date(+at + 10) }),
  doc('b', 'component', { ...shared, library: 'custom' }, { createdAt: new Date(+at + 20) }),
  doc('private', 'component', shared, { ownerId: other }),
  doc('blocked', 'component', shared, { ownerId: other, acl: ['tt:all'], moderation: { status: 'blocked' } }),
  doc('c', 'component', { componentKey: 'other', category: 'layout', library: 'custom' }, { createdAt: new Date(+at + 30) }),
  doc('r1', 'reaction', { emoji: '👍' }, { targetId: 'a' }),
  doc('r2', 'reaction', { emoji: '👍' }, { ownerId: other, targetId: 'a' }),
  doc('r3', 'reaction', { emoji: '🔥' }, { ownerId: other, targetId: 'a' }),
  doc('saved-a', 'save', {}, { targetId: 'a', createdAt: new Date(+at + 40) }),
  doc('saved-private', 'save', {}, { targetId: 'private', createdAt: new Date(+at + 50) })
 ]);
 const verify = async (run: typeof f.run) => run(async () => {
  const filtered = await browseComponents({ id: ownerId }, { lib: 'thingtime', category: 'input' }); assert.equal(filtered.ok, true); if (!filtered.ok) return;
  assert.deepEqual(filtered.components.map(row => row.id), ['a']);
  assert.deepEqual({ ...filtered.components[0].reactionCounts }, { '👍': 2, '🔥': 1 });
  assert.deepEqual(new Set(filtered.components[0].viewerReactions), new Set(['👍']));
  assert.equal(filtered.components[0].saved, true); assert.equal(filtered.components[0].usageCount, 1); assert.equal(filtered.total, 1);
  const popular = await browseComponents({ id: ownerId }, { sort: 'popular', limit: 1 }); assert.equal(popular.ok, true); if (!popular.ok) return;
  assert.equal(popular.components[0].id, 'a'); assert.equal(popular.nextCursor, '1');
  const second = await browseComponents({ id: ownerId }, { sort: 'popular', limit: 1, cursor: popular.nextCursor }); assert.equal(second.ok, true); if (second.ok) assert.equal(second.components[0].id, 'c');
  const families = await browseComponents({ id: ownerId }, { group: 'family' }); assert.equal(families.ok, true); if (families.ok) {
   assert.equal(families.total, 2); const card = families.components.find(row => row.id === 'a')!; assert.deepEqual(card.designs, [{ id: 'a', library: 'thingtime' }, { id: 'b', library: 'custom' }]);
  }
  const family = await browseComponents({ id: ownerId }, { family: 'card' }); assert.equal(family.ok, true); if (family.ok) assert.deepEqual(family.components.map(row => row.id), ['a', 'b']);
  const own = await browseComponents({ id: ownerId }, { mine: true, sort: 'oldest' }); assert.equal(own.ok, true); if (own.ok) assert.deepEqual(own.components.map(row => row.id), ['b', 'c']);
  const saved = await browseComponents({ id: ownerId }, { library: true, limit: 1 }); assert.equal(saved.ok, true); if (!saved.ok) return;
  assert.deepEqual(saved.components, []); assert.ok(saved.nextCursor);
  const savedNext = await browseComponents({ id: ownerId }, { library: true, limit: 1, cursor: saved.nextCursor }); assert.equal(savedNext.ok, true); if (savedNext.ok) assert.deepEqual(savedNext.components.map(row => row.id), ['a']);
  const anonymous = await browseComponents(null, {}); assert.equal(anonymous.ok, true); if (anonymous.ok) { assert.deepEqual(anonymous.components.map(row => row.id), ['a']); assert.equal(anonymous.components[0].usageCount, 0); }
 });
 await verify(f.run); await f.provider.close(); const reopened = await f.open(); await verify(reopened.run);
});

test('native schema usage binds stamped IDs and counts only authorized legacy-name instances', async t => {
 const f = await fixture(t, [
  doc('s1', 'schema', { name: 'Entry', fields: [] }, { ownerId: other, acl: ['tt:all'] }),
  doc('s2', 'schema', { name: 'Entry', fields: [] }, { createdAt: new Date(+at + 10) }),
  doc('d1', 'data', { schemaId: 's1' }), doc('d2', 'data', { schemaId: 's2' }, { ownerId: other, acl: ['tt:all'] }),
  doc('legacy', 'data', { schema: 'Entry' }, { ownerId: other, acl: ['tt:all'] }),
  doc('null-id', 'data', { schemaId: null, schema: 'Entry' }, { acl: ['tt:all'] }),
  doc('private-data', 'data', { schemaId: 's1' }, { ownerId: other }),
  doc('schema-reaction', 'reaction', { emoji: '💚' }, { targetId: 's1' }), doc('schema-save', 'save', {}, { targetId: 's1' })
 ]);
 await f.run(async () => {
  const all = await browseSchemas({ id: ownerId }, {}); assert.equal(all.ok, true); if (!all.ok) return;
  assert.deepEqual(all.schemas.map(row => [row.id, row.usageCount]), [['s2', 2], ['s1', 2]]);
  const schema = all.schemas.find(row => row.id === 's1')!; assert.deepEqual({ ...schema.reactionCounts }, { '💚': 1 }); assert.equal(schema.saved, true);
  const popular = await browseSchemas({ id: ownerId }, { sort: 'popular', limit: 1 }); assert.equal(popular.ok, true); if (popular.ok) assert.equal(popular.schemas[0].id, 's1');
  const mine = await browseSchemas({ id: ownerId }, { mine: true }); assert.equal(mine.ok, true); if (mine.ok) assert.deepEqual(mine.schemas.map(row => row.id), ['s2']);
  const anonymous = await browseSchemas(null, {}); assert.equal(anonymous.ok, true); if (anonymous.ok) { assert.deepEqual(anonymous.schemas.map(row => row.id), ['s1']); assert.equal(anonymous.schemas[0].usageCount, 1); }
  const q = await browseSchemas({ id: ownerId }, { q: 'Entry', sort: 'relevance' }); assert.equal(q.ok, false); if (!q.ok) assert.equal(q.status, 503);
  const wrongCursor = await browseSchemas({ id: ownerId }, { sort: 'popular', cursor: `${+at}_s1` }); assert.equal(wrongCursor.ok, false); if (!wrongCursor.ok) assert.equal(wrongCursor.status, 400);
 });
});

test('native chronological catalog pagination traverses every internal batch without a catalog-size ceiling', async t => {
 const rows = Array.from({ length: 140 }, (_, index) => doc(`component-${String(index).padStart(3, '0')}`, 'component', { componentKey: `key-${index}`, library: 'custom' }, { createdAt: new Date(+at + index) }));
 const f = await fixture(t, rows);
 await f.run(async () => {
  const ids: string[] = []; let cursor: string | null = null;
  do {
   const page = await browseComponents({ id: ownerId }, { mine: true, limit: 50, cursor }); assert.equal(page.ok, true); if (!page.ok) return;
   ids.push(...page.components.map(row => row.id)); cursor = page.nextCursor;
   if (ids.length === 50) assert.equal(page.total, 140);
  } while (cursor);
  assert.equal(ids.length, 140); assert.equal(new Set(ids).size, 140); assert.equal(ids[0], 'component-139'); assert.equal(ids.at(-1), 'component-000');
 });
});

test('native family rosters and real reaction counts cross internal batches without truncation', async t => {
 const rows = Array.from({ length: 18 }, (_, index) => doc(`design-${String(index).padStart(2, '0')}`, 'component', { componentKey: `design-${index}`, familyKey: 'large-family', library: index === 0 ? 'thingtime' : 'custom' }));
 rows.push(doc('denied-house', 'component', { familyKey: 'private-family', library: 'thingtime' }, { ownerId: other, acl: ['tt:all', '-tt:user/catalog-viewer'] }));
 rows.push(doc('visible-sibling', 'component', { familyKey: 'private-family', library: 'custom' }, { ownerId: other, acl: ['tt:all'] }));
 for (let index = 0; index < 270; index++) rows.push(doc(`reaction-${index}`, 'reaction', { emoji: '⭐' }, { ownerId: index ? other : ownerId, targetId: 'design-00' }));
 const f = await fixture(t, rows);
 await f.run(async () => {
  const family = await browseComponents({ id: ownerId }, { family: 'large-family' }); assert.equal(family.ok, true); if (family.ok) assert.equal(family.components.length, 18);
  const grouped = await browseComponents({ id: ownerId, username: 'catalog-viewer' }, { group: 'family' }); assert.equal(grouped.ok, true); if (!grouped.ok) return;
  assert.equal(grouped.total, 2); assert.equal(grouped.components.some(row => row.id === 'denied-house'), false);
  const designs = grouped.components.find(row => row.id === 'design-00')!; assert.equal(designs.designs?.length, 18);
  assert.deepEqual({ ...designs.reactionCounts }, { '⭐': 270 }); assert.deepEqual(designs.viewerReactions, ['⭐']);
  assert.equal(grouped.components.some(row => row.id === 'visible-sibling'), true);
 });
});

test('native popularity offset windows do not impose the hosted 500-result ceiling', async t => {
 const rows = Array.from({ length: 520 }, (_, index) => doc(`rank-${String(index).padStart(3, '0')}`, 'component', {}, { createdAt: new Date(+at + index) }));
 const f = await fixture(t, rows);
 await f.run(async () => {
  const page = await browseComponents({ id: ownerId }, { sort: 'popular', cursor: '510', limit: 2 }); assert.equal(page.ok, true); if (!page.ok) return;
  assert.deepEqual(page.components.map(row => row.id), ['rank-009', 'rank-008']); assert.equal(page.nextCursor, '512');
 });
});

test('native family grouping batches real read calls and preserves keyed/share-identity collisions', async t => {
 const rows = Array.from({ length: 270 }, (_, index) => doc(`plain-${String(index).padStart(3, '0')}`, 'component', { library: 'custom' }));
 const f = await fixture(t, rows);
 const first = await f.run(async () => {
  const bound = getBoundThingsPersistence(null)!; let calls = 0;
  const reads: ThingsReads = { readExact: id => bound.readExact(id), readBatch: ids => bound.readBatch(ids), readWindow: selection => { calls++; return bound.readWindow(selection); } };
  const page = await browseNativeCatalog(reads, { id: ownerId }, 'component', { mode: 'visible', sort: 'newest', groupFamilies: true, limit: 50 });
  if ('ok' in page) assert.fail(page.error);
  assert.equal(page.total, 270); assert.equal(page.things.length, 50); assert.equal(page.nextCursor, '50');
  assert.deepEqual(page.things.map(row => row.id), rows.slice(0, 50).map(row => row.shareId));
  assert.ok(calls <= 16, `unkeyed catalog made ${calls} readWindow calls`);
  return calls;
 });
 assert.ok(first > 0);
 t.diagnostic(`270 unkeyed families: ${first} actual readWindow calls`);
 // A keyed family can collide with an otherwise-unkeyed component identity in
 // another source batch. They must become one group, not duplicate cards.
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize(doc('collision-design', 'component', { familyKey: 'plain-269', library: 'thingtime' }))));
 await f.run(async () => {
  const bound = getBoundThingsPersistence(null)!; let calls = 0;
  const reads: ThingsReads = { readExact: id => bound.readExact(id), readBatch: ids => bound.readBatch(ids), readWindow: selection => { calls++; return bound.readWindow(selection); } };
  const options = { mode: 'visible' as const, sort: 'newest' as const, groupFamilies: true, limit: 50 };
  const page = await browseNativeCatalog(reads, { id: ownerId }, 'component', options);
  if ('ok' in page) assert.fail(page.error);
  assert.equal(page.total, 270); assert.ok(calls <= 24, `window-grouped catalog made ${calls} readWindow calls`);
  t.diagnostic(`271 components with a cross-batch family collision: ${calls} actual readWindow calls`);
  const end = await browseNativeCatalog(reads, { id: ownerId }, 'component', { ...options, cursor: '250' });
  if ('ok' in end) assert.fail(end.error);
  assert.equal(end.things.length, 20); assert.equal(end.nextCursor, null);
  const collision = end.things.find(row => row.id === 'collision-design')!;
  assert.deepEqual(collision.designs, [{ id: 'collision-design', library: 'thingtime' }, { id: 'plain-269', library: 'custom' }]);
  assert.equal(end.things.some(row => row.id === 'plain-269'), false);
 });
});

test('native equal-timestamp catalog cursors preserve binary chronology across every page', async t => {
 const ids = ['a_first', 'z', '\ue000', '\u{10000}'];
 const f = await fixture(t, ids.map(id => doc(id, 'component')));
 await f.run(async () => {
  for (const sort of ['newest', 'oldest']) {
   const found: string[] = []; let cursor: string | null = null;
   do {
    const page = await browseComponents({ id: ownerId }, { mine: true, sort, limit: 1, cursor }); assert.equal(page.ok, true); if (!page.ok) return;
    found.push(...page.components.map(row => row.id)); cursor = page.nextCursor;
   } while (cursor);
   assert.deepEqual(found, ids);
  }
 });
});
