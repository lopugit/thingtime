import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BSON } from 'mongodb';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { createNativeContentRepository } from './nativeContentRepository';
import { getThingsTransactionBinding, type ThingsTransaction, type StoredThing } from '../things/persistence';
const owner = 'owner', at = new Date('2026-11-12T00:00:00Z');
const scope = { ownerId: owner, homePlaneId: 'home', contentPlaneId: 'home', providerId: 'fixture' };
const document = (id: string, extra: StoredThing = {}): StoredThing => ({ _id: id, shareId: id, ownerId: owner, thingtime: ['data'], crystal: {}, folderId: null, acl: [ACL_OWNER], createdAt: at, updatedAt: at, ...extra });
const version = (row: StoredThing) => ({ id: row.shareId, identity: row._id, updatedAt: row.updatedAt });
async function fixture(t: TestContext, ready = true) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-content-persistence-')), path = join(directory, 'content.sqlite');
 const providers: ReturnType<typeof createCollectionProvider>[] = [];
 const open = async () => { const provider = createCollectionProvider(await openSqliteDocumentStore(path)); providers.push(provider); return provider; };
 t.after(async () => { await Promise.all(providers.map(provider => provider.close())); await rm(directory, { recursive: true, force: true }); });
 const provider = await open();
 await provider.transaction(collections => {
  defineNativeThingsCollection(collections); const collection = collections.collection(physicalCollectionName('things'));
  collection.insert(BSON.serialize({ _id: 'user', shareId: owner, ownerId: owner, thingtime: ['user'], createdAt: at, updatedAt: at, secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
  if (ready) collection.insert(BSON.serialize({ _id: 'ledger', shareId: subscriptionShareId('user', owner), ownerId: owner, thingtime: ['subscription'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER], targetId: null, tags: [], createdAt: at, updatedAt: at, storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
   crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: owner, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: at, storageUpdatedAt: at } }));
 });
 return { provider, open, repository: createNativeContentRepository(provider, scope) };
}

test('actual SQLite chronological windows, selection-bound cursors and reopen retain exact content', async t => {
 const { provider, repository, open } = await fixture(t);
 await repository.transaction('write', async tx => {
  // More than a collection scan batch, with identity order opposite chronology.
  for (let index = 0; index < 270; index++) await tx.insert(document(`row-${String(index).padStart(3, '0')}`, { createdAt: new Date(+at + index), folderId: index % 2 ? 'folder' : null }));
  await tx.insert(document('different-physical', { _id: 'actual-identity', createdAt: new Date(+at - 1) }));
  await tx.insert(document('same-a', { createdAt: new Date(+at + 999) }));
  await tx.insert(document('same-b', { createdAt: new Date(+at + 999) }));
 });
 let cursor: string | null = null; const ids: string[] = [];
 do { const page = await repository.readWindow({ ownerId: owner, kinds: ['data'], limit: 17, cursor }); ids.push(...page.documents.map(row => row.shareId)); cursor = page.nextCursor; } while (cursor);
 assert.deepEqual((await repository.readBatch(['same-b', 'same-a', 'same-b', 'absent'])).map(row => row.shareId), ['same-b', 'same-a']);
 assert.equal(ids.length, 273); assert.equal(new Set(ids).size, 273); assert.deepEqual(ids.slice(0, 3), ['same-a', 'same-b', 'row-269']);
 const first = await repository.readWindow({ ownerId: owner, kinds: ['data'], limit: 17 });
 await assert.rejects(repository.readWindow({ ownerId: owner, kinds: ['data'], folder: { kind: 'root' }, limit: 17, cursor: first.nextCursor }), /cursor/);
 const otherScope = createNativeContentRepository(provider, { ...scope, ownerId: 'other-owner' });
 const separateHandle = createNativeContentRepository(await open(), scope);
 await assert.rejects(separateHandle.readWindow({ ownerId: owner, kinds: ['data'], limit: 17, cursor: first.nextCursor }), /cursor/);
 await assert.rejects(otherScope.readWindow({ ownerId: owner, kinds: ['data'], limit: 17, cursor: first.nextCursor }), /cursor/);
 assert.equal((await repository.readWindow({ ownerId: owner, kinds: ['data'], folder: { kind: 'id', id: 'folder' }, limit: 300 })).documents.length, 135);
 await provider.close(); const next = createNativeContentRepository(await open(), scope);
 assert.equal((await next.readExact('same-a'))?.shareId, 'same-a');
});

test('CAS identity/version, native bindings, transaction lifetime, caught errors and effects', async t => {
 const { repository } = await fixture(t); let escaped!: ThingsTransaction; const effects: string[] = [];
 await repository.transaction('write', async tx => { escaped = tx; await tx.insert(document('a')); const binding = getThingsTransactionBinding(tx, owner); assert.equal(binding.kind, 'native'); tx.afterCommit(async () => { effects.push('committed'); }); });
 assert.deepEqual(effects, ['committed']); await assert.rejects(escaped.readExact('a'), /expired/);
 await repository.transaction('write', async tx => {
  const row = (await tx.readExact('a'))!;
  assert.equal(await tx.compareAndSwap({ ...version(row), updatedAt: new Date(+at - 1) }, row), false);
  assert.equal(await tx.compareAndSwap(version(row), { ...row, updatedAt: new Date(+at + 1), crystal: { saved: true } }), true);
 });
 await assert.rejects(repository.transaction('write', async tx => {
  await tx.insert(document('rollback'));
  await assert.rejects(tx.insert(document('foreign', { ownerId: 'other' })), /owner mismatch/);
  tx.afterCommit(async () => { effects.push('bad'); });
 }), /owner mismatch/);
 await assert.rejects(repository.transaction('write', async tx => {
  await tx.insert(document('wrong-read-scope'));
  await assert.rejects(repository.readExact('a'), /active transaction/);
 }), /active transaction/);
 assert.equal(await repository.readExact('wrong-read-scope'), null);
 assert.equal(await repository.readExact('rollback'), null); assert.deepEqual(effects, ['committed']);
 await assert.rejects(repository.transaction('write', async tx => {
  const row = (await tx.readExact('a'))!;
  await assert.rejects(tx.compareAndSwap(version(row), { ...row, _id: 'changed' }), /immutable/);
 }), /immutable/);
 await assert.rejects(repository.transaction('write', async tx => { try { getThingsTransactionBinding(tx, 'foreign'); } catch {} }), /owner mismatch/);
 repository.close(); await assert.rejects(repository.readExact('a'), /closed/);
});

test('read candidates do not require writable accounting; unsupported writes refuse before callback', async t => {
 const { provider, repository } = await fixture(t, false);
 await provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize(document('foreign-readable', { ownerId: 'other' }))));
 assert.equal((await repository.readExact('foreign-readable'))?.ownerId, 'other');
 const anonymous = createNativeContentRepository(provider, { ...scope, ownerId: null });
 assert.equal((await anonymous.readExact('foreign-readable'))?.shareId, 'foreign-readable');
 await assert.rejects(anonymous.transaction('write', async () => {}), /authenticated owner/);
 let entered = false; await assert.rejects(repository.transaction('write', async () => { entered = true; })); assert.equal(entered, false);
 assert.throws(() => createNativeContentRepository(provider, { ...scope, contentPlaneId: 'foreign' }), /one home/);
});

test('folder placement is cycle-safe; children page without truncation; deletion returns exact before-image', async t => {
 const { repository } = await fixture(t);
 await repository.transaction('write', async tx => {
  await tx.insert(document('folder', { thingtime: ['folder'] })); await tx.insert(document('child', { thingtime: ['folder'], folderId: 'folder' }));
  await tx.lockFolder('child'); assert.deepEqual((await tx.folderAncestors('child')).map(row => row.shareId), ['child', 'folder']);
  assert.deepEqual((await tx.folderChildren('folder')).map(row => row.shareId), ['child']);
 });
 await assert.rejects(repository.transaction('write', async tx => { await assert.rejects(tx.lockFolder('child', 'folder'), /descendant/); }), /descendant/);
 await repository.transaction('delete', async tx => { const row = (await tx.readExact('child'))!; assert.equal((await tx.remove(version(row)))?.shareId, 'child'); });
 assert.equal(await repository.readExact('child'), null);
});


test('unfiltered and empty-kind windows retain every candidate and paginate without invalid predicates', async t => {
 const { repository } = await fixture(t);
 await repository.transaction('write', async tx => {
  await tx.insert(document('plain')); await tx.insert(document('folder', { thingtime: ['folder'] }));
 });
 const all = await repository.readWindow({ limit: 100 });
 const emptyKinds = await repository.readWindow({ kinds: [], limit: 100 });
 assert.equal(all.documents.length, 4);
 assert.deepEqual(emptyKinds.documents.map(row => row.shareId), all.documents.map(row => row.shareId));
 let cursor: string | null = null; const ids: string[] = [];
 do { const page = await repository.readWindow({ kinds: [], limit: 1, cursor }); ids.push(...page.documents.map(row => row.shareId)); cursor = page.nextCursor; } while (cursor);
 assert.deepEqual(ids, all.documents.map(row => row.shareId));
});

test('equal timestamp share IDs use Mongo simple binary UTF-8 order in sort and cursor filtering', async t => {
 const { repository } = await fixture(t);
 const supplementary = '\u{10000}', bmp = '\ue000';
 // UTF-16 would place the supplementary character first. Mongo binary UTF-8
 // orders E000 (EE...) before 10000 (F0...).
 await repository.transaction('write', async tx => {
  await tx.insert(document(supplementary)); await tx.insert(document(bmp));
 });
 const selection = { ownerId: owner, kinds: ['data'], limit: 1 };
 const first = await repository.readWindow(selection);
 assert.deepEqual(first.documents.map(row => row.shareId), [bmp]); assert.ok(first.nextCursor);
 const second = await repository.readWindow({ ...selection, cursor: first.nextCursor });
 assert.deepEqual(second.documents.map(row => row.shareId), [supplementary]); assert.equal(second.nextCursor, null);
});

test('generated physical identities fence stale CAS across delete/recreate with identical public identity and timestamp', async t => {
 const { repository } = await fixture(t);
 const input = document('recreated'); delete input._id;
 const before = await repository.transaction('write', tx => tx.insert(input));
 assert.notEqual(String(before._id), before.shareId);
 await repository.transaction('delete', tx => tx.remove(version(before)));
 const replacement = await repository.transaction('write', tx => tx.insert(input));
 assert.notEqual(String(replacement._id), String(before._id));
 await repository.transaction('write', async tx => {
  assert.equal(await tx.compareAndSwap(version(before), { ...before, crystal: { stale: true } }), false);
 });
 assert.deepEqual((await repository.readExact(input.shareId))?.crystal, {});
 const supplied = await repository.transaction('write', tx => tx.insert(document('supplied', { _id: 'caller-physical' })));
 assert.equal(supplied._id, 'caller-physical');
});
