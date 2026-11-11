import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import * as originals from '../mongodb/collections.ts';

let mongoCalls = 0, allowMongo = false;
let mongoRows: any[] = [];
const forbidden = () => { mongoCalls++; throw Error('Native execution gate attempted Mongo'); };
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { defaultExport: {}, namedExports: {
 ...originals,
 ...Object.fromEntries(Object.entries(originals).filter(([name, value]) => typeof value === 'function' &&
  (/^get.*Collection$/.test(name) || /Mongo.*Transaction/.test(name))).map(([name]) => [name, forbidden])),
 getThingsCollection: async () => {
  if (!allowMongo) return forbidden();
  mongoCalls++;
  return { find: (filter: any) => {
   let count = Infinity;
   return { limit(value: number) { count = value; return this; }, sort() { return this; },
    toArray: async () => mongoRows.filter(row => row.ownerId === filter.ownerId && row.thingtime.includes(filter.thingtime) &&
     (!filter.shareId || filter.shareId.$in.includes(row.shareId)) && (!filter.targetId || filter.targetId.$in.includes(row.targetId))).slice(0, count) };
  } };
 }
} });

const { createCollectionProvider } = await import('../documentStore/collectionProvider.ts');
const { openSqliteDocumentStore } = await import('../documentStore/sqliteStore.ts');
const { defineNativeThingsCollection } = await import('../documentStore/nativeThingsCollection.ts');
const { createNativeHomeAuthRepositories } = await import('../documentStore/nativeUserIdentities.ts');
const { createNativeThingsPersistenceContext } = await import('./persistenceContext.ts');
const { withNativeHomeStorageTransaction } = await import('../documentStore/nativeUserStorage.ts');
const { createNativeTimelinePersistence } = await import('../documentStore/nativeTimelinePersistence.ts');
const { buildUserSecure } = await import('../auth/users.ts');
const { physicalCollectionName } = await import('../mongodb/collectionNames.ts');
const { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } = await import('../../../schemas/registry.ts');
const { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } = await import('../storage/storageCore.ts');
const { subscriptionShareId } = await import('../subscriptions/subscriptionIdentity.ts');
const { appendTimelineEvent } = await import('../timeline/repository.ts');
const { eventFixture } = await import('../../../timeline/testFixtures.ts');
const { contentExecutionHeld, contentExecutionStates, CREATION_COMPLETION_ADAPTER } = await import('./contentExecutionGate.ts');
const directory = await mkdtemp(join(tmpdir(), 'tt-native-execution-gate-'));
const handles: ReturnType<typeof createCollectionProvider>[] = [];
const contexts: ReturnType<typeof createNativeThingsPersistenceContext>[] = [];
const homePlaneId = 'execution-fixture', namespace = physicalCollectionName('things'), at = new Date('2026-11-12T00:00:00Z');
const open = async () => {
 const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'content.sqlite'))); handles.push(provider);
 const auth = await createNativeHomeAuthRepositories(provider, homePlaneId), context = createNativeThingsPersistenceContext(provider, homePlaneId); contexts.push(context);
 return { provider, context, run: <T>(work: () => Promise<T>) => auth.run(() => context.run(work)) };
};
const hold = (ownerId: string) => ({ version: 1 as const, rootId: `root-${ownerId}`, operationId: `operation-${ownerId}`,
 completionEventId: `complete-${ownerId}`, binding: 'a'.repeat(64) });
const doc = (ownerId: string) => ({ shareId: `content-${ownerId}`, ownerId, executionHold: hold(ownerId) });
try {
 const first = await open();
 // Primitive-level isolated test setup, not API signup or application seeding.
 await first.provider.transaction(collections => {
  defineNativeThingsCollection(collections); const collection = collections.collection(namespace);
  for (const ownerId of ['one', 'two']) {
   collection.insert(BSON.serialize({ _id: `user-${ownerId}`, shareId: ownerId, ownerId, thingtime: ['user'],
    secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
   collection.insert(BSON.serialize({ _id: `ledger-${ownerId}`, shareId: subscriptionShareId('user', ownerId), ownerId,
    thingtime: ['subscription'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER], targetId: null, tags: [], createdAt: at, updatedAt: at,
    storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
    crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1,
     tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 },
     overrides: null, note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: 0,
     storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready,
     storageReconciledAt: at, storageUpdatedAt: at } }));
  }
 });
 for (const ownerId of ['one', 'two']) await withNativeHomeStorageTransaction(first.provider,
  { ownerId, homePlaneId, contentPlaneId: homePlaneId }, async (session, collections) => {
   const h = hold(ownerId), port = createNativeTimelinePersistence(collections, { ownerId, session });
   await appendTimelineEvent(port, eventFixture(h.completionEventId, { ownerId, actorId: ownerId, source: 'api', clientId: null,
    thingId: h.rootId, operationId: h.operationId, mode: 'effect', operation: 'effect',
    after: { adapter: CREATION_COMPLETION_ADAPTER, version: 1, value: { binding: ownerId === 'one' ? h.binding : 'b'.repeat(64), count: 2 } } }), session, { now: at });
  });
 await first.run(async () => {
  assert.equal(await contentExecutionHeld(doc('one')), false);
  assert.equal(await contentExecutionHeld(doc('two')), true);
  assert.equal(await contentExecutionHeld(doc('missing')), true);
  assert.equal(await contentExecutionHeld({ ownerId: 'one' }), false);
  assert.deepEqual([...await contentExecutionStates([doc('one'), doc('two'), doc('missing'), { ...doc('one'), shareId: 'second-one' }])],
   [['content-one', false], ['second-one', false], ['content-two', true], ['content-missing', true]]);
  await assert.rejects(contentExecutionHeld({ ...doc('one'), executionHold: { ...hold('one'), binding: 'invalid' } }));
 });
 assert.equal(mongoCalls, 0);
 first.context.close(); await first.provider.close();
 const reopened = await open();
 await reopened.run(async () => assert.equal(await contentExecutionHeld(doc('one')), false));
 let release!: () => void, pending!: Promise<unknown>;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await reopened.run(async () => { pending = gate.then(() => contentExecutionHeld(doc('one'))); });
 const rejection = assert.rejects(pending); release(); await rejection; assert.equal(mongoCalls, 0);
 mongoRows = await reopened.provider.transaction(collections => collections.collection(namespace).find({ limit: 128 }).documents.map(bytes => BSON.deserialize(bytes)));
 allowMongo = true;
 assert.equal(await contentExecutionHeld(doc('one')), false);
 assert.equal(await contentExecutionHeld(doc('two')), true);
 assert.equal(mongoCalls, 2);
 console.log('native-execution-gates: passed');
} finally {
 for (const context of contexts) context.close();
 await Promise.all(handles.map(provider => provider.close()));
 await rm(directory, { recursive: true, force: true });
}
