import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence, withBoundTimelineRead } from './persistenceContext';
import { getThingsTransactionBinding, type ThingsPersistence, type ThingsTransaction } from './persistence';
import type { TimelinePersistence } from '../timeline/persistence';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';

const ownerId = 'request-owner', at = new Date('2026-11-12T00:00:00Z');
const document = (id: string) => ({ _id: id, shareId: id, ownerId, thingtime: ['data'], crystal: {}, createdAt: at, updatedAt: at });
async function fixture(t: TestContext) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-things-request-'));
 const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'home.sqlite')));
 const auth = await createNativeHomeAuthRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home');
 t.after(async () => { context.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); });
 await provider.transaction(collections => {
  const things = collections.collection(physicalCollectionName('things'));
  things.insert(BSON.serialize({ _id: 'user', shareId: ownerId, ownerId, thingtime: ['user'], secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
  things.insert(BSON.serialize({ _id: 'ledger', shareId: subscriptionShareId('user', ownerId), ownerId, thingtime: ['subscription'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER], targetId: null, tags: [], createdAt: at, updatedAt: at, storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
   crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: at, storageUpdatedAt: at } }));
 });
 return { provider, auth, context, run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
}

test('real SQLite request selection preserves exact transaction binding and expires cached handles', async t => {
 const f = await fixture(t); let repository!: ThingsPersistence, transaction!: ThingsTransaction;
 await f.run(async () => {
  repository = getBoundThingsPersistence(ownerId)!;
  assert.equal(getBoundThingsPersistence(ownerId), repository);
  assert.equal(repository.scope.homePlaneId, 'home'); assert.equal(repository.scope.contentPlaneId, 'home');
  const candidates = getBoundThingsPersistence(null)!;
  await assert.rejects(candidates.transaction('write', async () => {}), /authenticated owner/);
  await repository.transaction('write', async tx => {
   transaction = tx; assert.equal(getThingsTransactionBinding(tx, ownerId).kind, 'native'); await tx.insert(document('saved'));
  });
  assert.equal((await candidates.readExact('saved'))?.shareId, 'saved');
 });
 await assert.rejects(repository.readExact('saved'), /request scope/);
 await assert.rejects(transaction.readExact('saved'), /request scope/);
 await assert.rejects(f.run(() => repository.readExact('saved')), /request scope/);
 await f.run(async () => assert.equal((await getBoundThingsPersistence(null)!.readExact('saved'))?.shareId, 'saved'));
});

test('foreign owner selection poisons caught errors and rolls back content', async t => {
 const f = await fixture(t);
 await assert.rejects(f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  await tx.insert(document('rollback'));
  assert.throws(() => getBoundThingsPersistence('foreign'), /request scope/);
 })), /request scope/);
 await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('rollback'), null));
});

test('provider, plane, missing native scope and bootstrap lifetime fail closed without Mongo', async t => {
 const f = await fixture(t);
 assert.equal(getBoundThingsPersistence(ownerId), null);
 assert.equal(withBoundTimelineRead(ownerId, async () => true), null);
 await assert.rejects(f.context.run(() => true), /request scope/);
 const wrongPlane = createNativeThingsPersistenceContext(f.provider, 'foreign');
 await assert.rejects(f.auth.run(() => wrongPlane.run(() => true)), /request scope/);
 const foreignProvider = { transaction: () => { throw new Error('Forbidden foreign provider'); }, close: async () => {} };
 const wrongProvider = createNativeThingsPersistenceContext(foreignProvider, 'home');
 await assert.rejects(f.auth.run(() => wrongProvider.run(() => true)), /registered provider/);
 await assert.rejects(f.auth.run(() => Promise.resolve(getBoundThingsPersistence(null))), /request scope/);
 const previous = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 try { assert.throws(() => getBoundThingsPersistence(null), /request scope/); assert.throws(() => withBoundTimelineRead(ownerId, async () => true), /request scope/); }
 finally { if (previous) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, previous); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY); }
 f.context.close(); await assert.rejects(f.auth.run(() => f.context.run(() => true)), /request scope/);
});

test('readonly Timeline ports retain author identity and expire within a live request', async t => {
 const f = await fixture(t); let escaped!: TimelinePersistence;
 await f.run(async () => {
  getBoundThingsPersistence(ownerId);
  await withBoundTimelineRead(ownerId, async port => {
   escaped = port;
   assert.equal(await port.recordByIdentity('missing'), null);
   await assert.rejects(port.insert([document('forbidden')]), /Read-only/);
   await assert.rejects(port.records('foreign', 'timeline-event', []), /owner mismatch/);
  });
  // Receipt-author selection must not replace the canonical mutation actor.
  await withBoundTimelineRead('foreign', async port => assert.equal(await port.recordByIdentity('missing'), null));
  assert.equal(getBoundThingsPersistence(ownerId)!.scope.ownerId, ownerId);
 });
 await assert.rejects(escaped.recordByIdentity('missing'), /request scope/);
});

test('closing bootstrap during content callback prevents a caught-error commit', async t => {
 const f = await fixture(t);
 await assert.rejects(f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  await tx.insert(document('closed-write')); f.context.close();
  await assert.rejects(tx.readExact('closed-write'), /request scope/);
 })), /request scope|closed/);
 await f.provider.transaction(collections => assert.equal(collections.collection(physicalCollectionName('things')).find({ filter: { op: 'eq', path: ['shareId'], value: 'closed-write' }, limit: 1 }).documents.length, 0));
});

test('expired async descendants cannot acquire a replacement repository or borrow Mongo', async t => {
 const f = await fixture(t); let resume!: () => void, descendant!: Promise<unknown>;
 const release = new Promise<void>(resolve => { resume = resolve; });
 await f.run(() => { descendant = release.then(() => getBoundThingsPersistence(null)); });
 resume(); await assert.rejects(descendant, /request scope/);
});

test('a leaked readonly Timeline port is expired even while its parent request remains active', async t => {
 const f = await fixture(t); let escaped!: TimelinePersistence;
 await assert.rejects(f.run(async () => {
  await withBoundTimelineRead(ownerId, async port => { escaped = port; });
  await assert.rejects(escaped.recordByIdentity('missing'), /request scope/);
 }), /request scope/);
});
