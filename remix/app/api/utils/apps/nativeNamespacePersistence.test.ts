import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BSON } from 'mongodb';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { defineNativeThingsCollection } from '../documentStore/nativeThingsCollection';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { APP_STORAGE_ACCOUNTING_VERSION, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, thingStorageSizeBytes } from '../storage/storageCore';
import { applyNativeAppStorageDelta, assertNativeAppNamespaceSession, nativeAppSharingAuthors, nativeSandboxSharingAuthors, nativeAppsByClientIds } from './nativeNamespacePersistence';
import { appStorageCounterShareId, appStorageCounterUpsertPlan, type AppNamespaceScope } from './namespace';
const at = new Date('2026-11-12T00:00:00Z');
const scope = (ownerId = 'owner', appId = 'app'): AppNamespaceScope => ({ ownerId, appId, sharedRead: true, scopes: ['app-data.shared'], username: '', sandbox: null });
const app = (clientId = 'app', extra = {}) => ({ _id: `app:${clientId}`, shareId: `app:${clientId}`, ownerId: 'developer', thingtime: ['app'], crystal: { clientId, storageAllowanceBytes: 1000, userStorageAllowanceBytes: 600, storageUsedBytes: 0, storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: 'ready', ...extra } });
async function fixture(t: TestContext) {
 const dir = await mkdtemp(join(tmpdir(), 'tt-native-namespace-'));
 const provider = createCollectionProvider(await openSqliteDocumentStore(join(dir, 'fixture.sqlite')));
 t.after(async () => { await provider.close(); await rm(dir, { recursive: true, force: true }); });
 await provider.transaction(tx => { defineNativeThingsCollection(tx); tx.defineCollection(physicalCollectionName('sessions'), { unique: [{ name: 'session-jti', path: ['jti'], sparse: false, multikey: false }] }); });
 const insert = (name: 'things' | 'sessions', doc: any) => provider.transaction(tx => tx.collection(physicalCollectionName(name)).insert(BSON.serialize(doc)));
 const read = (id: string) => provider.transaction(tx => { const bytes = tx.collection(physicalCollectionName('things')).find({ filter: { op: 'eq', path: ['shareId'], value: id }, limit: 2 }).documents; return bytes[0] ? BSON.deserialize(bytes[0]) : null; });
 return { provider, insert, read };
}
// Explicit protected adapter unit fixtures. These rows test server-owned
// envelopes, not account creation or OAuth/service-level acceptance.
test('SQLite namespace accounting reconciles current content, charges both quotas and rolls back refusal', async t => {
 const f = await fixture(t); await f.insert('things', app());
 const content: any = { _id: 'content', shareId: 'content', ownerId: 'owner', appId: 'app', schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['data'], crystal: { text: 'saved' }, tags: [], storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION };
 content.sizeBytes = thingStorageSizeBytes(content); await f.insert('things', content);
 await f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), 100, at));
 assert.equal((await f.read('app:app')).crystal.storageUsedBytes, content.sizeBytes + 100);
 assert.equal((await f.read(appStorageCounterShareId('owner', 'app'))).crystal.usedBytes, content.sizeBytes + 100);
 await assert.rejects(f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), 600, at)), /allowance/);
 assert.equal((await f.read('app:app')).crystal.storageUsedBytes, content.sizeBytes + 100);
 await f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), -50, at));
 assert.equal((await f.read('app:app')).crystal.storageUsedBytes, content.sizeBytes + 50);
});
test('registered app counters cannot adopt forged ids, invalid bytes, revoked app or another namespace', async t => {
 const f = await fixture(t); await f.insert('things', app()); await f.insert('things', app('other'));
 await f.insert('things', { _id: 'forged', ...appStorageCounterUpsertPlan(scope()).setOnInsert, appId: 'app' });
 await assert.rejects(f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), 1, at)), /trusted accounting/);
 await f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope('owner', 'other'), 8, at));
 assert.equal((await f.read('app:app')).crystal.storageUsedBytes, 0);
 assert.equal((await f.read('app:other')).crystal.storageUsedBytes, 8);
 await f.insert('things', app('revoked', { revokedAt: at }));
 await assert.rejects(f.provider.transaction(tx => applyNativeAppStorageDelta(tx, { ...scope('owner', 'revoked'), tokenId: 'revoked-grant' }, 1, at)), /current app session/);
 await assert.rejects(f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), NaN, at)), /invalid/);
});
test('deletion underflow fences the real counters without fabricating balances', async t => {
 const f = await fixture(t); await f.insert('things', app());
 await f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), 10, at));
 await f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), -11, at));
 const aggregate = (await f.read('app:app')).crystal, user = (await f.read(appStorageCounterShareId('owner', 'app'))).crystal;
 assert.equal(aggregate.storageUsedBytes, 10); assert.equal(user.usedBytes, 10);
 assert.equal(aggregate.storageLedgerStatus, 'needs-reconcile'); assert.equal(user.storageLedgerStatus, 'needs-reconcile');
});

for (const [label, path, value] of [
 ['invalid allowance', ['crystal', 'storageAllowanceBytes'], 'untrusted'],
 ['invalid timestamp', ['createdAt'], 'not-a-date']
] as const) test(`registered refunds keep ${label} counters fenced without decrementing`, async t => {
 const f = await fixture(t); await f.insert('things', app());
 await f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), 100, at));
 const id = appStorageCounterShareId('owner', 'app');
 await f.provider.transaction(tx => {
  tx.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: id }, [{ op: 'set', path, value }]);
  applyNativeAppStorageDelta(tx, scope(), -10, at);
 });
 const stored = await f.read(id);
 assert.equal(stored.crystal.usedBytes, 100);
 assert.equal(stored.crystal.storageLedgerStatus, 'needs-reconcile');
 assert.equal(path.length === 1 ? stored.createdAt : stored.crystal.storageAllowanceBytes, value);
});

test('current registered app actor cannot reuse revoked, expired, foreign-client or reduced-scope grants', async t => {
 const f = await fixture(t); await f.insert('things', app());
 const actor = { ...scope(), tokenId: 'actor-session' };
 await f.insert('sessions', { _id: 'actor', jti: actor.tokenId, userId: actor.ownerId, purpose: 'app', revokedAt: null, expiresAt: new Date(+at + 1000), meta: { clientId: actor.appId, scopes: actor.scopes } });
 await f.provider.transaction(tx => assertNativeAppNamespaceSession(tx, actor, at));
 for (const [path, value] of [[['revokedAt'], at], [['expiresAt'], at], [['meta', 'clientId'], 'another-app'], [['meta', 'scopes'], ['profile']]] as [string[], any][]) {
  await assert.rejects(f.provider.transaction(tx => {
   tx.collection(physicalCollectionName('sessions')).updateOne({ op: 'eq', path: ['jti'], value: actor.tokenId }, [{ op: 'set', path, value }]);
   assertNativeAppNamespaceSession(tx, actor, at);
  }), /current app session/);
 }
});

test('malformed sandbox stamp is an invalid reconciliation source, not unbilled content', async t => {
 const f = await fixture(t); await f.insert('things', app());
 const invalid: any = { _id: 'invalid-source', shareId: 'invalid-source', ownerId: 'owner', appId: 'app', schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['data'], crystal: {}, tags: [], storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sandboxExpiresAt: null };
 invalid.sizeBytes = thingStorageSizeBytes(invalid); await f.insert('things', invalid);
 await assert.rejects(f.provider.transaction(tx => applyNativeAppStorageDelta(tx, scope(), 1, at)), /invalid source/);
 assert.equal(await f.read(appStorageCounterShareId('owner', 'app')), null);
 assert.equal((await f.read('app:app')).crystal.storageUsedBytes, 0);
});
test('live author reads union current grants, respect expiry/revocation/client/space and scan all batches', async t => {
 const f = await fixture(t);
 for (let index = 0; index < 140; index++) await f.insert('sessions', { _id: `s${index}`, jti: `s${index}`, userId: 'author', purpose: 'app', revokedAt: null, expiresAt: new Date(+at + 100), meta: { clientId: 'app', scopes: index === 139 ? ['app-data.shared'] : ['profile'] } });
 for (const [id, extra] of Object.entries({ revoked: { revokedAt: at }, expired: { expiresAt: at }, foreign: { meta: { clientId: 'other', scopes: ['app-data.shared'] } } }))
  await f.insert('sessions', { _id: id, jti: id, userId: id, purpose: 'app', revokedAt: null, expiresAt: new Date(+at + 100), meta: { clientId: 'app', scopes: ['app-data.shared'] }, ...extra });
 await f.insert('sessions', { _id: 'pool', jti: 'pool', userId: 'sandbox:pool', purpose: 'app-sandbox', revokedAt: null, expiresAt: new Date(+at + 100), meta: { clientId: 'app', space: 'pool-one', scopes: ['app-data.shared'], username: 'sandbox-pool' } });
 await f.provider.transaction(tx => {
  assert.deepEqual([...nativeAppSharingAuthors(tx, 'app', ['author', 'revoked', 'expired', 'foreign'], at).keys()], ['author']);
  assert.deepEqual([...nativeSandboxSharingAuthors(tx, 'app', 'pool-one', ['sandbox:pool'], at).keys()], ['sandbox:pool']);
  assert.equal(nativeSandboxSharingAuthors(tx, 'app', 'pool-two', ['sandbox:pool'], at).size, 0);
  assert.deepEqual(nativeAppsByClientIds(tx, []), []);
 });
});

test('sandbox content, standing quota and burn commit together; expiry and revocation cannot borrow account storage', async t => {
 const { createNativeHomeAuthRepositories } = await import('../documentStore/nativeUserIdentities');
 const { createNativeRateLimitRepository } = await import('../documentStore/nativeRateLimits');
 const { withHomeRateLimitRepository } = await import('../rateLimit/repository');
 const { withNativeSandboxNamespace } = await import('./nativeSandboxNamespace');
 const { createNativeContentRepository } = await import('../documentStore/nativeContentRepository');
 const { getThingsTransactionBinding } = await import('../things/persistence');
 const { applyNativeSandboxStorageDelta, purgeNativeExpiredSandboxThings } = await import('./nativeNamespacePersistence');
 const f = await fixture(t), auth = await createNativeHomeAuthRepositories(f.provider, 'home');
 const rate = await createNativeRateLimitRepository(f.provider, 'home');
 const sandbox: AppNamespaceScope = { ...scope('sandbox:synthetic'), tokenId: 'synthetic-session', sandbox: { space: 'pool-one' } };
 const expiry = new Date(Date.now() + 60_000);
 await f.insert('sessions', { _id: 'sandbox-session', jti: sandbox.tokenId, userId: sandbox.ownerId, purpose: 'app-sandbox', revokedAt: null, expiresAt: expiry, meta: { clientId: sandbox.appId, scopes: sandbox.scopes, space: sandbox.sandbox!.space } });
 const repository = createNativeContentRepository(f.provider, { ownerId: sandbox.ownerId, homePlaneId: 'home', contentPlaneId: 'home' });
 const run = <T>(work: () => Promise<T>) => auth.run(() => withHomeRateLimitRepository(rate, () => withNativeSandboxNamespace(sandbox, work)));
 const insert = (id: string, refuse = false) => run(() => repository.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, sandbox.ownerId); if (binding.kind !== 'native') throw Error('native binding required');
  const expires = await applyNativeSandboxStorageDelta(binding.collections, binding.session, 10);
  await tx.insert({ _id: id, shareId: id, ownerId: sandbox.ownerId, appId: sandbox.appId, thingtime: ['data'], crystal: {}, acl: ['tt:user'], sandboxExpiresAt: expires, createdAt: new Date(), updatedAt: new Date() });
  if (refuse) throw Error('force rollback');
 }));
 await assert.rejects(repository.transaction('write', async () => {}), /real owner/);
 await insert('committed');
 assert.equal(+(await f.read('committed')).sandboxExpiresAt, +expiry);
 assert.equal((await f.read(appStorageCounterShareId(sandbox.ownerId, sandbox.appId))).crystal.usedBytes, 10);
 const burn = () => f.provider.transaction(tx => tx.collection(physicalCollectionName('rateLimits')).find({ limit: 10 }).documents.map(bytes => BSON.deserialize(bytes)).reduce((sum, doc) => sum + (doc.bytes ?? 0), 0));
 assert.equal(await burn(), 10);
 await assert.rejects(insert('rollback', true), /force rollback/);
 assert.equal(await f.read('rollback'), null); assert.equal(await burn(), 10);
 assert.equal((await f.read(appStorageCounterShareId(sandbox.ownerId, sandbox.appId))).crystal.usedBytes, 10);
 await assert.rejects(run(() => repository.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, sandbox.ownerId); if (binding.kind !== 'native') throw Error('native binding');
  await assert.rejects(applyNativeSandboxStorageDelta(binding.collections, binding.session, 1_000_000_000), /sandbox storage allowance/);
 })), /sandbox storage allowance/);
 assert.equal(await burn(), 10);
 for (const [path, value] of [[['crystal', 'storageAllowanceBytes'], 'untrusted'], [['createdAt'], 'not-a-date']] as [string[], string][]) {
  const id = appStorageCounterShareId(sandbox.ownerId, sandbox.appId), before = await f.read(id);
  await f.provider.transaction(tx => { tx.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: id }, [{ op: 'set', path, value }]); });
  await assert.rejects(run(() => repository.transaction('delete', async tx => {
   const binding = getThingsTransactionBinding(tx, sandbox.ownerId); if (binding.kind !== 'native') throw Error('native binding');
   await applyNativeSandboxStorageDelta(binding.collections, binding.session, -1);
  })), /trusted accounting/);
  const unchanged = await f.read(id);
  assert.equal(unchanged.crystal.usedBytes, 10);
  assert.equal(path.length === 1 ? unchanged.createdAt : unchanged.crystal.storageAllowanceBytes, value);
  // Restore only the deliberately corrupted fixture field for the next case.
  await f.provider.transaction(tx => { tx.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: id },
   path.length === 1 ? [{ op: 'set', path, value: before.createdAt }] : [{ op: 'unset', path }]); });
 }
 assert.equal(await burn(), 10);
 await assert.rejects(run(() => repository.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, sandbox.ownerId); if (binding.kind !== 'native') throw Error('native binding');
  binding.collections.collection(physicalCollectionName('sessions')).updateOne({ op: 'eq', path: ['jti'], value: sandbox.tokenId! }, [{ op: 'set', path: ['revokedAt'], value: new Date() }]);
  await tx.readExact('committed');
 })), /live app-sandbox session/);
 await assert.rejects(run(() => repository.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, sandbox.ownerId); if (binding.kind !== 'native') throw Error('native binding');
  await applyNativeSandboxStorageDelta(binding.collections, binding.session, 1, expiry);
 })), /live app-sandbox session/);
 await f.provider.transaction(tx => { assert.equal(purgeNativeExpiredSandboxThings(tx, expiry), 2); });
 assert.equal(await f.read('committed'), null); assert.equal(await burn(), 10);
});
