import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BSON } from 'mongodb';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import { createNativeTimelinePersistence } from './nativeTimelinePersistence';
import { withNativeHomeStorageTransaction, withNativeHomeDeletionStorageTransaction, withNativeStorageOperation, type NativeUserStorageSession } from './nativeUserStorage';
import { buildUserSecure } from '../auth/users';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { applyUserStorageDelta } from '../storage/userStorage';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS, thingStorageSizeBytes } from '../storage/storageCore';
import { appendTimelineEvent, readTimelineEntries, readTimelinePage, readTimelineNodes, timelineEventThingId, timelineFolderId } from '../timeline/repository';
import { newThingMutationCapture, recordThingMutation } from '../timeline/recordMutation';
import { readTimelineBranchHead } from '../timeline/branchEnvelope';
import { readTimelineSnapshot } from '../timeline/snapshotParts';
import { eventFixture } from '../../../timeline/testFixtures';
import { LOPU_USER_VAULT_SYSTEM_TYPE } from '../lopu/userVaultModel';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';
import type { TimelinePersistence } from '../timeline/persistence';
const ownerId = 'user-1', namespace = physicalCollectionName('things');
const binding = { ownerId, homePlaneId: 'isolated-native-history', contentPlaneId: 'isolated-native-history' };
const eq = (path: string[], value: any) => ({ op: 'eq' as const, path, value });
const code = (value: string) => (error: unknown) => (error as any)?.code === value;
const now = new Date('2026-11-12T00:00:00.000Z');
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-timeline-')), handles: CollectionProvider[] = [];
 const open = async () => { const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'history.sqlite'))); handles.push(provider); return provider; };
 t.after(async () => { await Promise.all(handles.map(provider => provider.close())); await rm(directory, { recursive: true, force: true }); });
 const provider = await open(), ledgerId = subscriptionShareId('user', ownerId);
 await provider.transaction(collections => {
  defineNativeThingsCollection(collections); const things = collections.collection(namespace);
  // Isolated module fixtures, not API signup or normal application seeding.
  things.insert(BSON.serialize({ _id: 'user', shareId: ownerId, ownerId, thingtime: ['user'], secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
  things.insert(BSON.serialize({ _id: 'ledger', shareId: ledgerId, ownerId, thingtime: ['subscription'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
   acl: [ACL_OWNER], targetId: null, tags: [], createdAt: now, updatedAt: now, storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
   crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false,
    tierQuotas: { appStorageBytes: 1, userStorageBytes: 20_000_000, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true,
    storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: now, storageUpdatedAt: now } }));
 });
 const read = (shareId: string) => provider.transaction(collections => { const bytes = collections.collection(namespace).find({ filter: eq(['shareId'], shareId), limit: 1 }).documents[0]; return bytes ? BSON.deserialize(bytes) : null; });
 const history = <T>(work: (port: TimelinePersistence) => Promise<T>) => provider.transaction(collections => work(createNativeTimelinePersistence(collections, { ownerId })));
 const transaction = <T>(work: (port: TimelinePersistence, session: NativeUserStorageSession, collections: CollectionTransaction) => Promise<T>) =>
  withNativeHomeStorageTransaction(provider, binding, (session, collections) => work(createNativeTimelinePersistence(collections, { ownerId, session }), session, collections));
 return { provider, open, read, history, transaction, ledgerId };
};
const data = (text: string, extra: Record<string, any> = {}) => {
 const row: any = { _id: 'content', shareId: 'content', ownerId, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['data'], acl: ['tt:user'], crystal: { text }, extended: null, tags: [], folderId: null, targetId: null, ...extra, storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION };
 row.sizeBytes = thingStorageSizeBytes(row); return row;
};
const append = (port: TimelinePersistence, session: NativeUserStorageSession, id: string, overrides = {}) => appendTimelineEvent(port, eventFixture(id, { ownerId, actorId: ownerId, ...overrides }), session, { now });
const capture = () => ({ ...newThingMutationCapture(ownerId, 'api'), now });

test('canonical creation/update/deletion, Published heads and exact accounting commit together and survive reopen', async t => {
 const h = await fixture(t), first = data('中文 before'), a = capture();
 await h.transaction(async (port, session, collections) => {
  await applyUserStorageDelta(ownerId, thingStorageSizeBytes(first), session); collections.collection(namespace).insert(BSON.serialize(first));
  await recordThingMutation(port, null, first, a, session);
 });
 const created = await h.read('content'); assert.equal(created.timelineHeadId, a.id);
 const second = data('after', { timelineHeadId: created.timelineHeadId }), b = capture();
 await h.transaction(async (port, session, collections) => {
  await applyUserStorageDelta(ownerId, thingStorageSizeBytes(second) - thingStorageSizeBytes(created), session);
  collections.collection(namespace).updateOne(eq(['shareId'], 'content'), [{ op: 'set', path: ['crystal'], value: second.crystal }, { op: 'set', path: ['sizeBytes'], value: second.sizeBytes }]);
  await recordThingMutation(port, created, second, b, session);
 });
 const saved = await h.read('content'), expected = thingStorageSizeBytes(saved) + thingStorageSizeBytes(await h.read(timelineEventThingId(ownerId, a.id))) + thingStorageSizeBytes(await h.read(timelineEventThingId(ownerId, b.id)));
 assert.equal((await h.read(h.ledgerId)).crystal.storageUsedBytes, expected);
 const c = capture();
 await withNativeHomeDeletionStorageTransaction(h.provider, binding, async (session, collections) => {
  const port = createNativeTimelinePersistence(collections, { ownerId, session });
  await applyUserStorageDelta(ownerId, -thingStorageSizeBytes(saved), session); collections.collection(namespace).deleteOne(eq(['shareId'], 'content'));
  await recordThingMutation(port, saved, null, c, session); assert.equal((await readTimelineBranchHead(port, ownerId, 'main', 'content', session))?.eventId, c.id);
 });
 assert.equal(await h.read('content'), null); assert.equal((await h.read(h.ledgerId)).crystal.storageUsedBytes, expected);
 await h.provider.close(); const reopened = await h.open();
 await reopened.transaction(async collections => {
  const port = createNativeTimelinePersistence(collections, { ownerId });
  const page = await readTimelinePage(port, ownerId, { thingId: 'content', before: null, after: null, limit: 40 });
  assert.deepEqual(page.entries.map(entry => entry.event.id), [c.id, b.id, a.id]); assert.equal((await readTimelineBranchHead(port, ownerId, 'main', 'content'))?.revision, 3);
 });
});

test('immutable replay and parent/dependency/owner validation poison caught failures and roll back', async t => {
 const h = await fixture(t); await h.transaction((p, s) => append(p, s, 'base')); await h.transaction((p, s) => append(p, s, 'dependency', { thingId: 'component' }));
 const refs = { parentIds: ['base'], dependencies: [{ thingId: 'component', eventId: 'dependency' }] };
 const result = await h.transaction((p, s) => append(p, s, 'child', refs)), used = (await h.read(h.ledgerId)).crystal.storageUsedBytes;
 assert.deepEqual(await h.transaction((p, s) => append(p, s, 'child', refs)), result); assert.equal((await h.read(h.ledgerId)).crystal.storageUsedBytes, used);
 for (const overrides of [{ label: 'changed replay' }, { parentIds: ['absent'] }, { parentIds: ['dependency'] }, { dependencies: [{ thingId: 'wrong', eventId: 'dependency' }] }, { ownerId: 'foreign' }]) {
  await assert.rejects(h.transaction(async (port, session, collections) => {
   collections.collection(namespace).insert(BSON.serialize(data('rollback', { shareId: 'sentinel', _id: 'sentinel' })));
   await assert.rejects(append(port, session, overrides.label ? 'child' : 'bad', overrides));
  })); assert.equal(await h.read('sentinel'), null);
 }
 await h.history(async port => assert.deepEqual((await readTimelineNodes(port, ownerId, ['child']))[0].parentIds, ['base']));
});

test('equal clocks preserve cursor order across handles; read-only history needs no ready ledger', async t => {
 const h = await fixture(t), second = await h.open();
 const receipts = await Promise.all(Array.from({ length: 4 }, (_, index) => withNativeHomeStorageTransaction(index % 2 ? second : h.provider, binding,
  (session, collections) => append(createNativeTimelinePersistence(collections, { ownerId, session }), session, `clock-${index}`))));
 assert.deepEqual(receipts.map(entry => entry.receipt.position), receipts.map((_, index) => now.getTime() + index));
 await h.provider.transaction(collections => { collections.collection(namespace).updateOne(eq(['shareId'], h.ledgerId), [{ op: 'set', path: ['crystal', 'storageLedgerStatus'], value: USER_STORAGE_STATUS.needsReconcile }]); });
 await h.history(async port => {
  const first = await readTimelinePage(port, ownerId, { thingId: null, before: null, after: null, limit: 2 }); assert.deepEqual(first.entries.map(e => e.event.id), ['clock-3', 'clock-2']);
  const older = await readTimelinePage(port, ownerId, { thingId: null, before: first.nextBefore, after: null, limit: 2 }); assert.deepEqual(older.entries.map(e => e.event.id), ['clock-1', 'clock-0']);
  const newer = await readTimelinePage(port, ownerId, { thingId: null, before: null, after: receipts[0].receipt.position, limit: 2 }); assert.deepEqual(newer.entries.map(e => e.event.id), ['clock-1', 'clock-2']);
  await assert.rejects(append(port, {} as NativeUserStorageSession, 'denied'), /Read-only/); await assert.rejects(readTimelineEntries(port, 'foreign', ['clock-0']), /owner mismatch/);
 });
});

test('head failure, parse refusal and unavailable page captures roll back all prior content/history/accounting even when caught', async t => {
 const h = await fixture(t);
 for (const failure of ['head', 'parse', 'webpage']) {
  const row = data('rollback', failure === 'webpage' ? { thingtime: ['webpage'] } : {}), c = capture();
  await assert.rejects(h.transaction(async (port, session, collections) => {
   await applyUserStorageDelta(ownerId, thingStorageSizeBytes(row), session); collections.collection(namespace).insert(BSON.serialize(row));
   const selected = failure === 'head' ? { ...port, setThingHead: async () => false } : port;
   if (failure === 'parse') await assert.rejects(appendTimelineEvent(port, { invalid: true, ownerId } as any, session));
   else await assert.rejects(recordThingMutation(selected, null, row, c, session), failure === 'webpage' ? /component captures/ : /lost its Thing/);
  }));
  assert.equal(await h.read('content'), null); assert.equal(await h.read(timelineEventThingId(ownerId, c.id)), null); assert.equal(await h.read(timelineFolderId(ownerId)), null); assert.equal((await h.read(h.ledgerId)).crystal.storageUsedBytes, 0);
 }
});

test('large canonical snapshot parts reconstruct exact ordered escaped content from SQLite', async t => {
 const h = await fixture(t), row = data('x'.repeat(2_200_000) + ' escaped \\ 🦋'), c = capture();
 await h.transaction(async (port, session, collections) => { collections.collection(namespace).insert(BSON.serialize(row)); await recordThingMutation(port, null, row, c, session); });
 await h.history(async port => {
  const entry = (await readTimelineEntries(port, ownerId, [c.id]))[0]; assert.match(entry.event.after!.adapter, /parts/);
  const snapshot = await readTimelineSnapshot(port, ownerId, c.id, 'after', entry.event.after); assert.deepEqual((snapshot?.value as any).crystal, row.crystal);
 });
});

test('canonical vault parent integrity and creation epoch use semantic native operations', async t => {
 const h = await fixture(t), root = data('root', { shareId: 'root', _id: 'root', creationCheckpoint: { binding: 'a'.repeat(64), operationId: 'creation', phase: 'planning', contentEpoch: 0 } });
 await h.provider.transaction(collections => collections.collection(namespace).insert(BSON.serialize(root)));
 const held = data('held', { executionHold: { version: 1, rootId: 'root', binding: 'a'.repeat(64), operationId: 'creation', completionEventId: 'completed' } });
 await h.transaction(async (port, session, collections) => { collections.collection(namespace).insert(BSON.serialize(held)); await recordThingMutation(port, null, held, capture(), session); });
 assert.equal((await h.read('root')).creationCheckpoint.contentEpoch, 1);
 const bad = data('bad', { shareId: 'bad-vault', _id: 'bad-vault', crystal: { systemType: LOPU_USER_VAULT_SYSTEM_TYPE, recordKind: 'secret', groupId: 'missing-group' } });
 await assert.rejects(h.transaction(async (port, session, collections) => { collections.collection(namespace).insert(BSON.serialize(bad)); await recordThingMutation(port, null, bad, capture(), session); }), /environment was not found/);
 assert.equal(await h.read('bad-vault'), null);
});

test('exact storage operation guard refuses foreign transactions, expired handles and asynchronous borrowing', async t => {
 const h = await fixture(t); let escaped!: NativeUserStorageSession, escapedCollections!: CollectionTransaction;
 await h.transaction(async (_port, session, collections) => { escaped = session; escapedCollections = collections; });
 await assert.rejects(withNativeStorageOperation(ownerId, escaped, escapedCollections, () => 1), code('storage_invariant'));
 await assert.rejects(h.transaction(async (_port, session, collections) => {
  collections.collection(namespace).insert(BSON.serialize(data('rollback'))); await assert.rejects(withNativeStorageOperation(ownerId, session, {} as CollectionTransaction, () => 1), code('storage_invariant'));
 }), code('storage_invariant')); assert.equal(await h.read('content'), null);
});

test('an active native storage operation cannot be borrowed outside its asynchronous owner scope', async t => {
 const h = await fixture(t); let session!: NativeUserStorageSession, collections!: CollectionTransaction, release!: () => void, signal!: () => void;
 const ready = new Promise<void>(resolve => { signal = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 const active = h.transaction(async (_port, current, scope) => { session = current; collections = scope; signal(); await gate; });
 const rejected = assert.rejects(active, code('TRANSACTION_OWNERSHIP'));
 await ready;
 try { await assert.rejects(withNativeStorageOperation(ownerId, session, collections, () => 1), code('TRANSACTION_OWNERSHIP')); } finally { release(); }
 await rejected;
});
