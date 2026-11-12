import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence, withBoundTimelineRead, withBoundNativeCollectionsRead } from './persistenceContext';
import type { NativeCollection } from '../documentStore/collectionContract';
import { getThingsTransactionBinding, type ThingsPersistence } from './persistence';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { friendIdsOf, groupIdsOf } from '../users/social';
import { loadViewerSubspaceRoles } from '../subspaces/gate';
import { createNativeTimelinePersistence } from '../documentStore/nativeTimelinePersistence';
import { appendTimelineEvent, readTimelineEntries, timelineEventThingId } from '../timeline/repository';
import { eventFixture } from '../../../timeline/testFixtures';
import type { TimelinePersistence } from '../timeline/persistence';

const ownerId = 'transaction-owner', at = new Date('2026-11-12T00:00:00Z');
const row = (id: string, kind = 'data', crystal: Record<string, unknown> = {}, targetId: string | null = null) => ({
 _id: id, shareId: id, ownerId, thingtime: [kind], crystal, targetId, createdAt: at, updatedAt: at
});
async function fixture(t: TestContext) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-bound-transaction-'));
 const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'home.sqlite')));
 const auth = await createNativeHomeAuthRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home');
 t.after(async () => { context.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); });
 // Isolated primitive fixtures establish storage prerequisites, not API signup.
 await provider.transaction(collections => {
  const things = collections.collection(physicalCollectionName('things'));
  things.insert(BSON.serialize({ ...row(ownerId, 'user'), secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
  things.insert(BSON.serialize({ ...row(subscriptionShareId('user', ownerId), 'subscription'), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
   acl: [ACL_OWNER], tags: [], storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
   crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false,
    tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true,
    storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: at, storageUpdatedAt: at } }));
 });
 return { provider, run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
}

test('bound candidate reads and canonical audiences see uncommitted rows on the exact transaction', async t => {
 const f = await fixture(t);
 await f.run(async () => {
  const repository = getBoundThingsPersistence(ownerId)!, candidates = getBoundThingsPersistence(null)!;
  await repository.transaction('write', async tx => {
   const binding = getThingsTransactionBinding(tx, ownerId);
   await tx.insert(row('friend', 'friend', { status: 'accepted' }, 'friend-user'));
   await tx.insert(row('group', 'group-member', { groupId: 'group-id' }, ownerId));
   await tx.insert(row('space', 'subspace-member', { role: 'moderator' }, 'space-id'));
   assert.equal((await candidates.readExact('friend'))?.targetId, 'friend-user');
   assert.deepEqual((await candidates.readBatch(['group', 'friend'])).map(doc => doc.shareId), ['group', 'friend']);
   assert.equal((await repository.readWindow({ kinds: ['friend'], limit: 2 })).documents[0].shareId, 'friend');
   assert.deepEqual([...await friendIdsOf(ownerId)], ['friend-user']);
   assert.deepEqual([...await groupIdsOf(ownerId)], ['group-id']);
   assert.equal((await loadViewerSubspaceRoles(ownerId)).get('space-id')?.role, 'moderator');
   assert.equal(binding.kind, 'native'); if (binding.kind !== 'native') throw Error('Expected native binding');
   const history = createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session });
   await appendTimelineEvent(history, eventFixture('receipt', { ownerId, actorId: ownerId }), binding.session, { now: at });
   await withBoundTimelineRead(ownerId, async port => assert.equal((await readTimelineEntries(port, ownerId, ['receipt']))[0].event.id, 'receipt'));
   assert.equal(getThingsTransactionBinding(tx, ownerId), binding);
  });
 });
});

test('same-transaction receipt ports remain read-only and expire before their containing write ends', async t => {
 const f = await fixture(t);
 for (const mode of ['readonly', 'expired']) {
  await assert.rejects(f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
   await tx.insert(row(`rollback-${mode}`));
   const binding = getThingsTransactionBinding(tx, ownerId);
   assert.equal(binding.kind, 'native'); if (binding.kind !== 'native') throw Error('Expected native binding');
   const history = createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session });
   await appendTimelineEvent(history, eventFixture(mode, { ownerId, actorId: ownerId }), binding.session, { now: at });
   let escaped!: TimelinePersistence;
   const read = withBoundTimelineRead(ownerId, async port => {
    escaped = port; assert.equal((await readTimelineEntries(port, ownerId, [mode]))[0].event.id, mode);
    if (mode === 'readonly') await assert.rejects(port.insert([row('forbidden')]), /Read-only/);
   })!;
   if (mode === 'readonly') await assert.rejects(read, /Read-only/);
   else { await read; await assert.rejects(escaped.recordByIdentity('missing'), /request scope/); }
  })), mode === 'readonly' ? /Read-only/ : /request scope/);
  await f.run(async () => {
   const candidates = getBoundThingsPersistence(null)!;
   assert.equal(await candidates.readExact(`rollback-${mode}`), null);
   assert.equal(await candidates.readExact(timelineEventThingId(ownerId, mode)), null);
  });
 }
});

test('semantic collection reads share uncommitted content without acquiring mutation authority', async t => {
 const f = await fixture(t);
 await f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  await tx.insert(row('semantic-candidate'));
  await withBoundNativeCollectionsRead(async collections => {
   const rows = collections.collection(physicalCollectionName('things')).find({
    filter: { op: 'eq', path: ['shareId'], value: 'semantic-candidate' }, limit: 2
   }).documents;
   assert.equal(rows.length, 1);
   assert.equal(BSON.deserialize(rows[0]).ownerId, ownerId);
  });
 }));
 for (const operation of ['define', 'insert', 'update', 'delete']) {
  await assert.rejects(f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
   await tx.insert(row('readonly-rollback-' + operation));
   await assert.rejects(withBoundNativeCollectionsRead(async collections => {
    const records = collections.collection(physicalCollectionName('things'));
    assert.throws(() => {
     if (operation === 'define') collections.defineCollection('forbidden', { unique: [] });
     if (operation === 'insert') records.insert(BSON.serialize(row('forbidden')));
     if (operation === 'update') records.updateOne({ op: 'eq', path: ['shareId'], value: 'semantic-candidate' }, []);
     if (operation === 'delete') records.deleteOne({ op: 'eq', path: ['shareId'], value: 'semantic-candidate' });
    }, /read-only/);
   })!, /read-only/);
  })), /read-only/);
  await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('readonly-rollback-' + operation), null));
 }
});

test('escaped semantic collection handles expire before the containing transaction commits', async t => {
 const f = await fixture(t);
 await assert.rejects(f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  await tx.insert(row('escaped-collection-rollback'));
  let escaped!: NativeCollection;
  await withBoundNativeCollectionsRead(async collections => { escaped = collections.collection(physicalCollectionName('things')); });
  assert.throws(() => escaped.find({ limit: 1 }), /request scope/);
 })), /request scope/);
 await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('escaped-collection-rollback'), null));
});

test('candidate windows preserve their cursor namespace before, during and after a transaction', async t => {
 const f = await fixture(t);
 await f.run(async () => {
  const repository = getBoundThingsPersistence(ownerId)!, candidates = getBoundThingsPersistence(null)!;
  await repository.transaction('write', async tx => { for (const id of ['a', 'b', 'c']) await tx.insert(row(id)); });
  const selection = { kinds: ['data'], limit: 1 };
  const first = await candidates.readWindow(selection); assert.ok(first.nextCursor);
  let thirdCursor: string | null = null;
  await repository.transaction('write', async tx => {
   await tx.insert(row('d'));
   const second = await candidates.readWindow({ ...selection, cursor: first.nextCursor });
   assert.deepEqual(second.documents.map(doc => doc.shareId), ['b']); thirdCursor = second.nextCursor;
   assert.ok(thirdCursor);
   const third = await candidates.readWindow({ ...selection, cursor: thirdCursor });
   assert.deepEqual(third.documents.map(doc => doc.shareId), ['c']);
  });
  assert.deepEqual((await candidates.readWindow({ ...selection, cursor: thirdCursor })).documents.map(doc => doc.shareId), ['c']);
  await assert.rejects(repository.readWindow({ ...selection, cursor: first.nextCursor }), /cursor/);
 });
});

test('a caught receipt callback rejection with no Error value still aborts its containing transaction', async t => {
 const f = await fixture(t);
 await assert.rejects(f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  await tx.insert(row('undefined-rollback'));
  await assert.rejects(withBoundTimelineRead(ownerId, async () => Promise.reject())!);
 })));
 await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('undefined-rollback'), null));
});

test('caught malformed and foreign-scope cursors poison writes and suppress effects', async t => {
 const f = await fixture(t), effects: string[] = [];
 for (const cursor of ['invalid', 'foreign']) {
  await assert.rejects(f.run(async () => {
   const repository = getBoundThingsPersistence(ownerId)!, candidates = getBoundThingsPersistence(null)!;
   let input = cursor;
   if (cursor === 'foreign') {
    await repository.transaction('write', async tx => { for (const id of ['a', 'b']) if (!await tx.readExact(id)) await tx.insert(row(id)); });
    input = (await repository.readWindow({ kinds: ['data'], limit: 1 })).nextCursor!;
   }
   await repository.transaction('write', async tx => {
    await tx.insert(row(`rollback-${cursor}`)); tx.afterCommit(async () => { effects.push('bad'); });
    await assert.rejects(candidates.readWindow({ kinds: ['data'], limit: 1, cursor: input }), /cursor/);
   });
  }), /cursor/);
  await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact(`rollback-${cursor}`), null));
 }
 assert.deepEqual(effects, []);
});

test('afterCommit reads use the outer repository and escaped transaction descendants refuse', async t => {
 const f = await fixture(t); let release!: () => void, escaped!: Promise<unknown>;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await assert.rejects(f.run(async () => {
  const repository = getBoundThingsPersistence(ownerId)!, candidates = getBoundThingsPersistence(null)!;
  await repository.transaction('write', async tx => {
   await tx.insert(row('committed'));
   escaped = gate.then(() => candidates.readExact('committed'));
   tx.afterCommit(async () => assert.equal((await candidates.readExact('committed'))?.shareId, 'committed'));
  });
  release(); await assert.rejects(escaped, /request scope/);
 }), /request scope/);
 await f.run(async () => assert.equal((await getBoundThingsPersistence(null)!.readExact('committed'))?.shareId, 'committed'));
});

test('parallel request/provider scopes cannot borrow active candidates or uncommitted writes', async t => {
 const first = await fixture(t), second = await fixture(t); let borrowed!: ThingsPersistence, ready!: () => void, release!: () => void;
 const entered = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 const writing = first.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  borrowed = getBoundThingsPersistence(null)!; await tx.insert(row('uncommitted')); ready(); await gate;
  assert.equal((await borrowed.readExact('uncommitted'))?.shareId, 'uncommitted');
 }));
 await entered;
 try {
  await assert.rejects(second.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
   await tx.insert(row('second-rollback'));
   assert.equal(await getBoundThingsPersistence(null)!.readExact('uncommitted'), null);
   await assert.rejects(borrowed.readExact('uncommitted'), /request scope/);
  })), /request scope/);
 } finally { release(); }
 // A foreign-context use poisons the first request too, so its write rolls back.
 await assert.rejects(writing, /request scope/);
 await first.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('uncommitted'), null));
 await second.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('second-rollback'), null));
});
