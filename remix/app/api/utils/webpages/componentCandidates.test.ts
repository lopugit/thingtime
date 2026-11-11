import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { defineNativeThingsCollection } from '../documentStore/nativeThingsCollection';
import { createNativeAccountCreationRepositories } from '../documentStore/nativeAccountCreation';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence } from '../things/persistenceContext';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { resolveBlockComponents, resolvePageComponentCapture, resolveWebpage } from './webpages';

test('actual SQLite resolves paginated local definitions with canonical audience and capture projection after reopen', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-component-candidates-'));
 const path = join(directory, 'home.sqlite');
 let provider = createCollectionProvider(await openSqliteDocumentStore(path));
 const at = new Date('2026-11-12T00:00:00Z');
 const component = (shareId: string, ownerId: string, crystal: Record<string, unknown>, acl = ['tt:user']) => ({
  _id: shareId, shareId, ownerId, thingtime: ['component'], acl, crystal, createdAt: at, updatedAt: at, schemaVersion: 2
 });
 const page = { _id: 'page', shareId: 'page', ownerId: 'owner', thingtime: ['webpage'], acl: ['tt:user'], schemaVersion: 2,
  crystal: { pageKey: 'fixture-page', blocks: ['card', 'priority', 'exact', 'foreign-private', 'foreign-public', 'blocked', 'missing'].map(ref => ({ type: 'component', component: ref })) },
  createdAt: at, updatedAt: at };
 try {
  await provider.transaction(collections => {
   defineNativeThingsCollection(collections);
   const collection = collections.collection(physicalCollectionName('things'));
   const insert = (row: Record<string, unknown>) => collection.insert(BSON.serialize(row));
   for (let index = 0; index < 160; index++) insert(component(`card-${index}`, 'owner', { componentKey: 'card', version: index, render: { tag: 'p', children: `${index}` } }));
   insert(component('component-priority', 'system', { render: { tag: 'p', children: 'System' } }, ['tt:all']));
   insert(component('priority-local', 'owner', { componentKey: 'priority', version: 999 }));
   insert(component('exact', 'owner', { render: { tag: 'p', children: 'Exact' } }));
   insert(component('component-exact', 'system', { render: { tag: 'p', children: 'Seed' } }, ['tt:all']));
   insert(component('foreign-private', 'other', { render: { tag: 'p', children: 'Private' } }));
   insert(component('foreign-public', 'other', { render: { tag: 'p', children: 'Public' } }, ['tt:all']));
   insert(component('blocked-old', 'owner', { componentKey: 'blocked', version: 1 }));
   insert({ ...component('blocked-latest', 'owner', { componentKey: 'blocked', version: 2 }), moderation: { status: 'blocked' } });
   insert(page);
   insert({ ...page, _id: 'unlisted-page', shareId: 'unlisted-page', acl: ['tt:hidden', 'tt:user'], linkKey: 'synthetic-unlisted-key',
    crystal: { pageKey: 'unlisted-key', siteRoute: '/unlisted-fixture', blocks: ['exact', 'foreign-private'].map(ref => ({ type: 'component', component: ref })) } });
  });
  const verify = async () => {
   const auth = await createNativeAccountCreationRepositories(provider, 'home');
   const context = createNativeThingsPersistenceContext(provider, 'home');
   try {
    await auth.run(() => context.run(async () => {
     const captured = await resolvePageComponentCapture(null, null, page as any, getBoundThingsPersistence(null)!);
     assert.deepEqual({ ...captured.refs }, { card: 'card-159', priority: 'component-priority', exact: 'exact', 'foreign-private': null, 'foreign-public': 'foreign-public', blocked: null, missing: null });
     for (const row of captured.components) assert.deepEqual(Object.keys(row).sort(), ['crystal', 'id']);
     assert.equal(JSON.stringify(captured).includes('Private'), false);
     const visible = await resolveWebpage({ id: 'owner' }, { id: 'page' });
     assert.equal(visible.ok, true);
     if (visible.ok) assert.equal(visible.refs.card, 'card-159');
     const keyed = await resolveWebpage({ id: 'owner' }, { id: 'fixture-page' });
     assert.equal(keyed.ok, true);
     if (keyed.ok) assert.equal(keyed.page?.id, 'page');
     const refused = await resolveWebpage({ id: 'other' }, { id: 'page' });
     assert.equal(refused.ok, false);
     // Exact canonical permalinks delegate only the stored root's audience.
     // They do not turn an author-local key, route or draft block into a grant.
     for (const viewer of [null, { id: 'other' }]) {
      const unlisted = await resolveWebpage(viewer, { id: 'unlisted-page' });
      assert.equal(unlisted.ok, true);
      if (unlisted.ok) {
       assert.equal(unlisted.refs.exact, 'exact');
       assert.equal(unlisted.refs['foreign-private'], viewer?.id === 'other' ? 'foreign-private' : null);
       assert.equal(unlisted.components.find(row => row.id === 'exact')?.crystal.render.children, 'Exact');
       assert.equal(unlisted.page?.linkKey, undefined);
       assert.equal(unlisted.components.some(row => row.linkKey || row.tokenAcl?.length), false);
      }
      assert.equal((await resolveWebpage(viewer, { id: 'unlisted-key' })).ok, false);
      const route = await resolveWebpage(viewer, { path: '/unlisted-fixture' });
      assert.equal(route.ok && route.page !== null, false);
      const draft = await resolveBlockComponents(viewer, [{ type: 'component', component: 'exact' }]);
      assert.equal(draft.refs.exact, 'component-exact');
      assert.equal(draft.components.some(row => row.id === 'exact'), false);
     }
    }));
   } finally { context.close(); }
  };
  await verify(); await provider.close(); provider = createCollectionProvider(await openSqliteDocumentStore(path)); await verify();
 } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});
