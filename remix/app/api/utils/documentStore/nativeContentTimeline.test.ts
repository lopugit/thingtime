import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BSON } from 'mongodb';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { applyUserStorageDelta } from '../storage/userStorage';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS, thingStorageSizeBytes } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { createNativeContentRepository } from './nativeContentRepository';
import { createNativeTimelinePersistence } from './nativeTimelinePersistence';
import { getThingsTransactionBinding, type StoredThing, type ThingsTransaction } from '../things/persistence';
import { newThingMutationCapture, recordThingMutation } from '../timeline/recordMutation';
import { readTimelinePage, timelineEventThingId } from '../timeline/repository';
import { readTimelineBranchHead } from '../timeline/branchEnvelope';
import type { CollectionProvider } from './collectionContract';
const ownerId = 'combined-synthetic-owner', now = new Date('2026-11-12T00:00:00.000Z');
const scope = { ownerId, homePlaneId: 'isolated-combined-profile', contentPlaneId: 'isolated-combined-profile' };
const namespace = physicalCollectionName('things'), ledgerId = subscriptionShareId('user', ownerId);
const version = (row: StoredThing) => ({ id: row.shareId, identity: row._id, updatedAt: row.updatedAt, headId: row.timelineHeadId ?? null, sizeBytes: row.sizeBytes });
const capture = () => ({ ...newThingMutationCapture(ownerId, 'api'), now });
const data = (id: string, text: string): StoredThing => {
 const row: StoredThing = { shareId: id, ownerId, thingtime: ['data'], acl: [ACL_OWNER], crystal: { text }, extended: null, tags: [], targetId: null, folderId: null,
  createdAt: now, updatedAt: now, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION };
 row.sizeBytes = thingStorageSizeBytes(row); return row;
};
const timeline = (transaction: ThingsTransaction) => {
 const binding = getThingsTransactionBinding(transaction, ownerId);
 assert.equal(binding.kind, 'native');
 if (binding.kind !== 'native') throw Error('Expected native transaction binding');
 return { port: createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session }), session: binding.session };
};

test('real SQLite content repository and canonical Timeline share content, head, accounting, rollback and afterCommit boundaries across reopen', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-content-timeline-')), providers: CollectionProvider[] = [];
 const open = async () => { const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'combined.sqlite'))); providers.push(provider); return provider; };
 t.after(async () => { await Promise.all(providers.map(provider => provider.close())); await rm(directory, { recursive: true, force: true }); });
 const provider = await open();
 await provider.transaction(collections => {
  defineNativeThingsCollection(collections); const collection = collections.collection(namespace);
  // Primitive isolated module fixtures establish account/ledger prerequisites.
  // The operations below exercise repository composition, not HTTP activation.
  collection.insert(BSON.serialize({ _id: 'user', shareId: ownerId, ownerId, thingtime: ['user'], secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
  collection.insert(BSON.serialize({ _id: 'ledger', shareId: ledgerId, ownerId, thingtime: ['subscription'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER], targetId: null, tags: [], createdAt: now, updatedAt: now, storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
   crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false,
    tierQuotas: { appStorageBytes: 1, userStorageBytes: 1_000_000, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true,
    storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: now, storageUpdatedAt: now } }));
 });
 const repository = createNativeContentRepository(provider, scope), effects: string[] = [], positions: number[] = [];
 const createdCapture = capture(), updatedCapture = capture(), deletedCapture = capture();
 await repository.transaction('write', async transaction => {
  const { port, session } = timeline(transaction), row = data('content', 'Original 中文');
  await applyUserStorageDelta(ownerId, row.sizeBytes, session);
  const inserted = await transaction.insert(row);
  positions.push((await recordThingMutation(port, null, inserted, createdCapture, session))!.receipt.position);
  transaction.afterCommit(async () => { effects.push('created'); });
 });
 const created = (await repository.readExact('content'))!;
 assert.equal(created.timelineHeadId, createdCapture.id);
 assert.equal((await repository.readExact(ledgerId))!.crystal.storageUsedBytes,
  created.sizeBytes + thingStorageSizeBytes((await repository.readExact(timelineEventThingId(ownerId, createdCapture.id)))!));
 await repository.transaction('write', async transaction => {
  const { port, session } = timeline(transaction), before = (await transaction.readExact('content'))!;
  const after: StoredThing = { ...before, crystal: { text: 'Updated 🦋' }, updatedAt: new Date(+now + 1) }; after.sizeBytes = thingStorageSizeBytes(after);
  await applyUserStorageDelta(ownerId, after.sizeBytes - before.sizeBytes, session);
  assert.equal(await transaction.compareAndSwap(version(before), after), true);
  positions.push((await recordThingMutation(port, before, after, updatedCapture, session))!.receipt.position);
  transaction.afterCommit(async () => { effects.push('updated'); });
 });
 const updated = (await repository.readExact('content'))!;
 assert.equal(updated.timelineHeadId, updatedCapture.id); assert.deepEqual(updated.crystal, { text: 'Updated 🦋' });
 const retainedBytes = thingStorageSizeBytes((await repository.readExact(timelineEventThingId(ownerId, createdCapture.id)))!) + thingStorageSizeBytes((await repository.readExact(timelineEventThingId(ownerId, updatedCapture.id)))!);
 const beforeDeleteBytes = updated.sizeBytes + retainedBytes;
 assert.equal((await repository.readExact(ledgerId))!.crystal.storageUsedBytes, beforeDeleteBytes);
 await repository.transaction('delete', async transaction => {
  const { port, session } = timeline(transaction), before = (await transaction.readExact('content'))!;
  assert.deepEqual(await transaction.remove(version(before)), before);
  await applyUserStorageDelta(ownerId, -before.sizeBytes, session);
  positions.push((await recordThingMutation(port, before, null, deletedCapture, session))!.receipt.position);
  transaction.afterCommit(async () => { effects.push('deleted'); });
 });
 assert.equal(await repository.readExact('content'), null);
 assert.equal((await repository.readExact(ledgerId))!.crystal.storageUsedBytes, beforeDeleteBytes);
 assert.deepEqual(effects, ['created', 'updated', 'deleted']);
 const refusedCapture = { ...capture(), parentIds: ['missing-parent'] };
 await assert.rejects(repository.transaction('write', async transaction => {
  const { port, session } = timeline(transaction), row = data('rollback', 'Must not survive');
  await applyUserStorageDelta(ownerId, row.sizeBytes, session);
  const inserted = await transaction.insert(row);
  transaction.afterCommit(async () => { effects.push('must-not-run'); });
  await assert.rejects(recordThingMutation(port, null, inserted, refusedCapture, session), /earlier changes/);
 }), /earlier changes/);
 assert.equal(await repository.readExact('rollback'), null);
 assert.equal(await repository.readExact(timelineEventThingId(ownerId, refusedCapture.id)), null);
 assert.equal((await repository.readExact(ledgerId))!.crystal.storageUsedBytes, beforeDeleteBytes);
 assert.deepEqual(effects, ['created', 'updated', 'deleted']);
 repository.close(); await provider.close();
 const reopenedProvider = await open(), reopened = createNativeContentRepository(reopenedProvider, scope);
 assert.equal(await reopened.readExact('content'), null); assert.equal(await reopened.readExact('rollback'), null);
 assert.equal((await reopened.readExact(ledgerId))!.crystal.storageUsedBytes, beforeDeleteBytes);
 await reopenedProvider.transaction(async collections => {
  const port = createNativeTimelinePersistence(collections, { ownerId });
  const page = await readTimelinePage(port, ownerId, { thingId: 'content', before: null, after: null, limit: 40 });
  assert.deepEqual(page.entries.map(entry => entry.event.id), [deletedCapture.id, updatedCapture.id, createdCapture.id]);
  assert.deepEqual(page.entries.map(entry => entry.event.parentIds), [[updatedCapture.id], [createdCapture.id], []]);
  assert.deepEqual(page.entries.map(entry => entry.receipt.position), [...positions].reverse());
  assert.equal(positions.every((position, index) => Number.isSafeInteger(position) && (!index || position > positions[index - 1])), true);
  const head = (await readTimelineBranchHead(port, ownerId, 'main', 'content'))!;
  assert.equal(head.eventId, deletedCapture.id); assert.equal(head.revision, 3);
 });
 reopened.close();
});
