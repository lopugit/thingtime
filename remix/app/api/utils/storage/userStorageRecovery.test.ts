import assert from 'node:assert/strict';
import { before, beforeEach, mock, test } from 'node:test';
import type * as StorageModule from './userStorage';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry.ts';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity.ts';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS, currentContentStorageSizeBytes, thingStorageSizeBytes } from './storageCore.ts';
import { USER_STORAGE_PENDING_LIMIT_BYTES } from './storagePending.ts';
const session = { transaction: 'synthetic-storage-recovery' };
let ledger: any, source: any, receipts: any[], jobs: number, aggregates: number;
const statusMatches = (query: any) => ledger && (!query['crystal.storageLedgerStatus'] || ledger.crystal.storageLedgerStatus === query['crystal.storageLedgerStatus']);
const set = (fields: any) => { for (const [key, value] of Object.entries(fields)) ledger.crystal[key.slice(8)] = value; };
const collection = {
  findOne: async (query: any, options: any = {}) => {
    if (typeof query.shareId === 'string' && query.shareId.startsWith('subscription-')) { assert.equal(options.session, session); return statusMatches(query) ? ledger : null; }
    if (query._id) return source;
    if (query.shareId?.$gt) return null;
    return source && currentContentStorageSizeBytes(source) === null ? source : null;
  },
  find: () => { const cursor = { sort: () => cursor, limit: () => cursor, maxTimeMS: () => cursor, toArray: async () => source ? [source] : [] }; return cursor; },
  findOneAndUpdate: async (query: any, update: any, options: any) => {
    assert.equal(options.session, session);
    assert.ok(query.$and?.[0]?.$expr?.$and, 'reservation retains the strict identity and pending-state proof');
    if (!statusMatches(query)) return null;
    if (Array.isArray(update)) {
      const growth = update[0].$set['crystal.storagePendingBytes'].$add[1];
      if ((ledger.crystal.storagePendingBytes || 0) + growth > USER_STORAGE_PENDING_LIMIT_BYTES) return null;
      ledger.crystal.storagePendingBytes = (ledger.crystal.storagePendingBytes || 0) + growth;
      ledger.crystal.storagePendingCount = (ledger.crystal.storagePendingCount || 0) + 1;
      ledger.crystal.storagePendingSince ||= new Date(); return ledger;
    }
    if (update.$inc) {
      const delta = update.$inc['crystal.storageUsedBytes'];
      const cap = ledger.crystal.tierQuotas.userStorageBytes;
      if (ledger.crystal.storagePendingCount || (cap !== null && ledger.crystal.storageUsedBytes + delta > cap) || ledger.crystal.storageUsedBytes + delta < 0) return null;
      ledger.crystal.storageUsedBytes += delta; return ledger;
    }
    set(update.$set);
    for (const key of Object.keys(update.$unset || {})) delete ledger.crystal[key.slice(8)];
    return ledger;
  },
  updateOne: async (query: any, update: any, options: any) => {
    assert.equal(options.session, session);
    if (query._id) { assert.ok(query.$expr.$eq, 'repair uses canonical full-preimage CAS'); Object.assign(source, update.$set); }
    else { if (!statusMatches(query)) return { matchedCount: 0, modifiedCount: 0 }; set(update.$set); }
    return { matchedCount: 1, modifiedCount: 1 };
  },
  insertOne: async (doc: any, options: any) => { assert.equal(options.session, session); receipts.push(doc); return { insertedId: doc.shareId }; },
  deleteMany: async (_query: any, options: any) => { assert.equal(options.session, session); receipts = []; return { deletedCount: 1 }; },
  aggregate: (_pipeline: any, options: any) => {
    assert.equal(options.session, session); assert.equal(options.maxTimeMS, 5000); aggregates += 1;
    return { toArray: async () => [{ all: [{ count: source ? 1 : 0 }], valid: [{ count: source && currentContentStorageSizeBytes(source) === null ? 0 : source ? 1 : 0, bytes: source?.sizeBytes || 0 }] }] };
  }
};
mock.module('../mongodb/collections', { namedExports: {
  getHomeThingsCollection: async () => collection,
  withHomeMongoTransaction: async (run: (session: any) => unknown) => {
    const snapshot = structuredClone({ ledger, source, receipts, jobs });
    try { return await run(session); } catch (error) { ({ ledger, source, receipts, jobs } = snapshot); throw error; }
  }
} });
mock.module('../auth/characterEntitlements', { namedExports: {
  synchronizeCharacterStorageTier: async (_id: string, active: any) => assert.equal(active, session),
  characterEntitlementSource: async () => null, characterEntitlementSources: async () => new Map(), withCharacterEntitlement: (doc: any) => doc
} });
mock.module('./userStorageRecovery', { namedExports: { ensureUserStorageRecoveryJob: async (_id: string, active: any) => { assert.equal(active, session); jobs += 1; } } });
let applyUserStorageDelta: typeof StorageModule.applyUserStorageDelta;
let recoverUserStorageAccounting: typeof StorageModule.recoverUserStorageAccounting;
let retainDeletedThingStorage: typeof StorageModule.retainDeletedThingStorage;
before(async () => { ({ applyUserStorageDelta, recoverUserStorageAccounting, retainDeletedThingStorage } = await import('./userStorage.ts')); });
const lease = async (active: any) => assert.equal(active, session);
const recovering = () => { ledger.crystal.storageLedgerStatus = USER_STORAGE_STATUS.needsReconcile; ledger.crystal.tierQuotas.userStorageBytes = null; };
beforeEach(() => {
  const now = new Date('2026-10-29T00:00:00Z');
  ledger = {
    shareId: subscriptionShareId('user', 'owner'), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['subscription'],
    ownerId: 'owner', acl: [ACL_OWNER], targetId: null, tags: [], storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION, createdAt: now, updatedAt: now,
    crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: 'owner', tier: 'free', tierVersionId: 'free-v1', tierVersion: 1,
      tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 100, userStorageBytes: 100, maxApps: 1, maxPats: 1 }, overrides: null,
      note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: 100, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      storageLedgerStatus: USER_STORAGE_STATUS.ready, storageUpdatedAt: now }
  };
  source = null; receipts = []; jobs = 0; aggregates = 0;
});
test('quota rejection preserves507 and never performs an inline source census', async () => {
  await assert.rejects(applyUserStorageDelta('owner', 1, session), (error: any) => error.status === 507 && error.code === 'quota_exceeded');
  assert.equal(aggregates, 0);
});
test('finite unknown, initializing, foreign and missing ledgers cannot queue growth', async () => {
  for (const status of [USER_STORAGE_STATUS.initializing, USER_STORAGE_STATUS.needsReconcile]) {
    ledger.crystal.storageLedgerStatus = status; await assert.rejects(applyUserStorageDelta('owner', 1, session));
  }
  recovering(); ledger.acl = ['tt:all']; await assert.rejects(applyUserStorageDelta('owner', 1, session));
  ledger = null; await assert.rejects(applyUserStorageDelta('owner', 1, session));
  assert.equal(receipts.length, 0); assert.equal(aggregates, 0);
});
test('unlimited recovery accepts exactly100MiB across distinct durable operation receipts', async () => {
  recovering(); await applyUserStorageDelta('owner', USER_STORAGE_PENDING_LIMIT_BYTES - 1, session); await applyUserStorageDelta('owner', 1, session);
  await assert.rejects(applyUserStorageDelta('owner', 1, session), /recovery is busy/);
  assert.equal(ledger.crystal.storagePendingBytes, USER_STORAGE_PENDING_LIMIT_BYTES); assert.equal(receipts.length, 2); assert.equal(jobs, 2);
  assert.equal(new Set(receipts.map(row => row.crystal.operationId)).size, 2);
  assert.ok(receipts.every(row => row.shareId === `storage-pending-${row.crystal.operationId}` && row.storageClass === 'control' && row.acl[0] === ACL_OWNER));
});
test('deferred deletes journal without refunding usage or reopening positive pending budget', async () => {
  recovering(); await applyUserStorageDelta('owner', USER_STORAGE_PENDING_LIMIT_BYTES, session); await applyUserStorageDelta('owner', -10, session);
  assert.equal(ledger.crystal.storagePendingBytes, USER_STORAGE_PENDING_LIMIT_BYTES); assert.equal(ledger.crystal.storageUsedBytes, 100);
  assert.equal(receipts.at(-1).crystal.deltaBytes, -10); await assert.rejects(applyUserStorageDelta('owner', 1, session), /recovery is busy/);
});
test('healthy unlimited writes larger than100MiB retain normal exact admission', async () => {
  ledger.crystal.tierQuotas.userStorageBytes = null; await applyUserStorageDelta('owner', USER_STORAGE_PENDING_LIMIT_BYTES + 1, session);
  assert.equal(receipts.length, 0); assert.equal(ledger.crystal.storageUsedBytes, USER_STORAGE_PENDING_LIMIT_BYTES + 101);
});
test('separate recovery remeasures stale stamps and never double-charges an already-applied source UPDATE', async () => {
  recovering(); source = { _id: 'one', shareId: 'one', schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, ownerId: 'owner', thingtime: ['data'], crystal: { text: 'updated' }, tags: [], storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sizeBytes: 1 };
  await applyUserStorageDelta('owner', 7, session); const exact = thingStorageSizeBytes(source);
  assert.deepEqual(await recoverUserStorageAccounting('owner', { assertLease: lease }), { state: 'ready', stamped: 1 });
  assert.equal(ledger.crystal.storageUsedBytes, exact); assert.equal(receipts.length, 0); assert.equal(ledger.crystal.storagePendingCount, undefined);
  await recoverUserStorageAccounting('owner', { assertLease: lease }); assert.equal(ledger.crystal.storageUsedBytes, exact);
});
test('legacy source schemas and expired leases cannot be silently blessed or drain queued receipts', async () => {
  recovering(); source = { _id: 'old', shareId: 'old', ownerId: 'owner', thingtime: ['data'], schemaVersion: 1, crystal: { text: 'preserved' } };
  await applyUserStorageDelta('owner', 3, session);
  assert.deepEqual(await recoverUserStorageAccounting('owner', { assertLease: lease }), { state: 'blocked', stamped: 0, reason: 'schema-migration-required' });
  assert.equal(source.schemaVersion, 1); assert.equal(receipts.length, 1);
  await assert.rejects(recoverUserStorageAccounting('owner', { assertLease: async () => { throw new Error('Lease expired'); } }), /Lease expired/);
  assert.equal(receipts.length, 1);
});


test('retained deletion history remains available at a full pending budget without granting growth credit', async () => {
  recovering(); await applyUserStorageDelta('owner', USER_STORAGE_PENDING_LIMIT_BYTES, session);
  await retainDeletedThingStorage('owner', 1234, session);
  assert.equal(ledger.crystal.storagePendingBytes, USER_STORAGE_PENDING_LIMIT_BYTES);
  assert.equal(receipts.at(-1).crystal.reason, 'deletion-retention');
  assert.equal(receipts.at(-1).crystal.positiveBytes, 0);
  assert.equal(receipts.at(-1).crystal.deltaBytes, 1234);
});

test('inactive sessions cannot persist deferred accounting outside the content transaction', async () => {
  recovering();
  await assert.rejects(applyUserStorageDelta('owner', 1, { inTransaction: () => false }), /require the content transaction/);
  await assert.rejects(retainDeletedThingStorage('owner', 1, { inTransaction: () => false }), /Invalid retained deletion storage/);
  assert.equal(receipts.length, 0);
});
