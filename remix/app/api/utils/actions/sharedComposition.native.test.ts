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
import { createNativeThingsPersistenceContext } from '../things/persistenceContext';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { withFriendIds, isFail, type ThingDoc } from '../things/things';
import { resolveSharedComposition, validateSharedReferenceAdditions } from './sharedComposition';

test('actual SQLite shared composition keeps stored contexts, foreign boundaries and live revocation across reopen', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-shared-composition-')), path = join(directory, 'home.sqlite');
 let provider = createCollectionProvider(await openSqliteDocumentStore(path));
 const at = new Date('2026-11-12T00:00:00Z');
 const row = (shareId: string, kind: string, crystal: Record<string, unknown>, ownerId = 'author', acl = ['tt:user']) => ({
  _id: shareId, shareId, ownerId, thingtime: [kind], schemaVersion: 2, acl, crystal, createdAt: at, updatedAt: at
 });
 const card = row('card', 'component', { componentKey: 'card-key', args: [{ name: 'action', type: 'string', default: 'default-action' }], savedArgs: { action: 'saved-action' },
  render: { children: [{ ttAction: '{action}' }, { ttIf: { arg: 'query.show', then: { ttAction: 'inactive-action' }, else: { ttAction: 'visible-action' } } }] } });
 const page = row('page', 'webpage', { blocks: [
  { type: 'component', component: 'card-key', args: { action: 'instance-one' } },
  { type: 'component', component: 'card-key', args: { action: 'instance-two' } },
  { type: 'component', component: 'default-card' }, { type: 'component', component: 'foreign-public' },
  { type: 'component', component: 'priority' }, { type: 'component', component: 'exact-component' }
 ] }, 'author', ['tt:all']);
 const namespace = physicalCollectionName('things');
 const replace = async (document: Record<string, unknown>) => provider.transaction(collections => {
  const collection = collections.collection(namespace);
  collection.updateOne({ op: 'eq', path: ['shareId'], value: document.shareId as string }, [{ op: 'set', path: ['acl'], value: document.acl }]);
 });
 try {
  await provider.transaction(collections => {
   defineNativeThingsCollection(collections); const collection = collections.collection(namespace);
   const insert = (document: Record<string, unknown>) => collection.insert(BSON.serialize(document));
   insert(page); insert(card);
   insert(row('component-priority', 'component', { render: {} }, 'system', ['tt:all']));
   insert(row('priority-local', 'component', { componentKey: 'priority', version: 999, render: {} }));
   insert(row('exact-component', 'component', { render: {} }));
   insert(row('exact-key-local', 'component', { componentKey: 'exact-component', version: 999, render: {} }));
   insert(row('default-card', 'component', { args: [{ name: 'action', type: 'string', default: 'default-action' }], render: { ttAction: '{action}' } }));
   for (const id of ['default-action', 'saved-action', 'instance-one', 'instance-two', 'inactive-action', 'visible-action', 'unrelated-secret'])
    insert(row(id, 'action', { actionKey: id, steps: id === 'saved-action' ? [{ op: 'things.get', id: 'data' }, { op: 'things.search', schema: 'Record' }, { op: 'actions.invoke', action: 'child-action' }] : [{ op: 'return', value: id }] }));
   insert(row('child-action', 'action', { actionKey: 'child-action', steps: [{ op: 'return', value: 'Child' }] }));
   insert(row('data', 'data', { schemaId: 'schema-159' }));
   for (let index = 0; index < 160; index++) insert(row(`schema-${index}`, 'schema', { name: 'Record', version: index }));
   insert(row('foreign-public', 'component', { savedArgs: { action: 'foreign-child' }, render: { ttAction: '{action}' } }, 'foreign', ['tt:all']));
   insert(row('foreign-child', 'action', { steps: [{ op: 'return', value: 'Foreign child' }] }, 'foreign'));
   insert(row('foreign-secret', 'action', { steps: [{ op: 'return', value: 'Unrelated' }] }, 'foreign'));
  });
  const verify = async () => {
   const auth = await createNativeAccountCreationRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home');
   try {
    await auth.run(() => context.run(async () => {
     const viewer = await withFriendIds({ id: 'reader', username: 'reader' });
     const composition = await resolveSharedComposition(viewer, 'page');
     assert.equal(isFail(composition), false);
     if (isFail(composition)) return;
     for (const id of ['card', 'default-action', 'saved-action', 'instance-one', 'instance-two', 'inactive-action', 'visible-action', 'child-action', 'data', 'schema-159', 'foreign-child']) assert.equal(composition.docs.has(id), true, id);
     assert.equal(composition.docs.has('unrelated-secret'), false);
     assert.equal(composition.docs.has('foreign-secret'), false);
     assert.equal(composition.contexts.get('card')?.length, 3);
     assert.equal(composition.references.get('page:component:priority')?.shareId, 'component-priority');
     assert.equal(composition.references.get('page:component:exact-component')?.shareId, 'exact-component');
     assert.equal(composition.boundaries.get('foreign-child')?.has(composition.docs.get('foreign-public')!), true);
     assert.equal(await validateSharedReferenceAdditions(viewer, page as unknown as ThingDoc, page.crystal), null);
     const override = { blocks: [{ type: 'component', component: 'card-key', args: { action: 'unrelated-secret' } }] };
     assert.equal((await validateSharedReferenceAdditions(viewer, page as unknown as ThingDoc, override))?.status, 403);
     const foreignOverride = { blocks: [{ type: 'component', component: 'foreign-public', args: { action: 'foreign-secret' } }] };
     assert.equal((await validateSharedReferenceAdditions(viewer, page as unknown as ThingDoc, foreignOverride))?.status, 403);
     const inactive = { ...card.crystal, render: { ttIf: { arg: 'query.show', then: { ttAction: 'unrelated-secret' }, else: { ttAction: 'visible-action' } } } };
     assert.equal((await validateSharedReferenceAdditions(viewer, card as unknown as ThingDoc, inactive))?.status, 403);
    }));
   } finally { context.close(); }
  };
  await verify(); await provider.close(); provider = createCollectionProvider(await openSqliteDocumentStore(path)); await verify();
  await replace({ ...row('foreign-public', 'component', { savedArgs: { action: 'foreign-child' }, render: { ttAction: '{action}' } }, 'foreign'), acl: ['tt:user'] });
  const auth = await createNativeAccountCreationRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home');
  try { await auth.run(() => context.run(async () => {
   const composition = await resolveSharedComposition(await withFriendIds({ id: 'reader' }), 'page');
   assert.equal(isFail(composition), false);
   if (!isFail(composition)) { assert.equal(composition.docs.has('foreign-public'), false); assert.equal(composition.docs.has('foreign-child'), false); }
  })); } finally { context.close(); }
  await replace({ ...page, acl: ['tt:user'] });
  const revokedContext = createNativeThingsPersistenceContext(provider, 'home');
  try { await auth.run(() => revokedContext.run(async () => {
   const composition = await resolveSharedComposition(await withFriendIds({ id: 'reader' }), 'page');
   assert.equal(isFail(composition) && composition.status, 404);
  })); } finally { revokedContext.close(); }
 } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});
