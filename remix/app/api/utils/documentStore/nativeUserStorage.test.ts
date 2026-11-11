import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { BSON, Long } from 'mongodb';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { applyUserStorageDelta } from '../storage/userStorage';
import { thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { userSubscriptionLedgerEnvelopeIsTrusted, subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { buildUserSecure, insertUser } from '../auth/users';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { withNativeHomeStorageTransaction, type NativeUserStorageSession } from './nativeUserStorage';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';
const namespace = physicalCollectionName('things');
const owner = 'synthetic-native-owner';
const binding = { ownerId: owner, homePlaneId: 'isolated-profile', contentPlaneId: 'isolated-profile' };
const encode = (row: Record<string, unknown>) => BSON.serialize(row);
const eq = (path: string[], value: any) => ({ op: 'eq' as const, path, value });
const code = (value: string) => (error: unknown) => (error as { code?: string })?.code === value;
const ledger = (usedBytes = 0, allowanceBytes: number | null = 100_000) => {
 const now = new Date('2026-11-12T00:00:00Z');
 return {
  _id: 'ledger', shareId: subscriptionShareId('user', owner), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['subscription'],
  ownerId: owner, acl: [ACL_OWNER], targetId: null, tags: [], storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
  createdAt: now, updatedAt: now,
  crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: owner, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1,
   tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: allowanceBytes, maxApps: 1, maxPats: 1 },
   overrides: null, note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: usedBytes,
   storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready as string,
   storageReconciledAt: now, storageUpdatedAt: now }
 };
};
const fixture = async (t: TestContext, options: { used?: number; allowance?: number | null; mutateLedger?: (row: any) => void; meta?: any; noUser?: boolean } = {}) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-account-ledger-'));
 const handles: CollectionProvider[] = [];
 const open = async () => { const p = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'store.sqlite'))); handles.push(p); return p; };
 t.after(async () => { await Promise.all(handles.map(p => p.close())); await rm(directory, { recursive: true, force: true }); });
 const provider = await open(), subscription = ledger(options.used, options.allowance);
 options.mutateLedger?.(subscription);
 // These are module-level synthetic persistence fixtures, NOT API signup,
 // normal Timeline rows or production account-data seeds.
 await provider.transaction(s => {
  defineNativeThingsCollection(s);
  const things = s.collection(namespace);
  if (!options.noUser) things.insert(encode({ _id: 'user', shareId: owner, ownerId: owner, thingtime: ['user'], secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused-hash', emailVerified: false, accountKind: 'user', meta: options.meta ?? {} }).secure }));
  things.insert(encode(subscription));
 });
 const read = async (shareId: string) => provider.transaction(s => {
  const bytes = s.collection(namespace).find({ filter: eq(['shareId'], shareId), limit: 1 }).documents[0];
  return bytes ? BSON.deserialize(bytes) : null;
 });
 return { provider, open, read, subscription };
};

// Synthetic history demonstrates SQLite transaction lifetime only; canonical
// recordThingMutation/Timeline adapters and API registration remain unproved.
const content = { _id: 'content', shareId: 'content', ownerId: owner, thingtime: ['data'], crystal: { text: 'Local 中文\ncontent' }, extended: null, tags: [] };
const history = { _id: 'synthetic-history', shareId: 'synthetic-history', ownerId: owner, thingtime: ['probe-history'], crystal: { after: content.crystal }, tags: [] };

test('canonical delta consumer charges exact logical content/history bytes in the same real file transaction and survives reopen', async t => {
 const { provider, open, read, subscription } = await fixture(t);
 assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(subscription, owner), true);
 const bytes = thingStorageSizeBytes(content) + thingStorageSizeBytes(history);
 await withNativeHomeStorageTransaction(provider, binding, async (session, s) => {
  await applyUserStorageDelta(owner, thingStorageSizeBytes(content), session);
  s.collection(namespace).insert(encode(content));
  await applyUserStorageDelta(owner, thingStorageSizeBytes(history), session);
  s.collection(namespace).insert(encode(history));
 });
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, bytes);
 assert.deepEqual((await read(content.shareId)).crystal, content.crystal);
 await provider.close(); const reopened = await open();
 await withNativeHomeStorageTransaction(reopened, binding, async (session, s) => {
  const rows = s.collection(namespace).find({ filter: eq(['shareId'], subscription.shareId), limit: 1 }).documents;
  assert.equal(BSON.deserialize(rows[0]).crystal.storageUsedBytes, bytes);
  await applyUserStorageDelta(owner, -thingStorageSizeBytes(content), session);
  assert.equal(s.collection(namespace).deleteOne(eq(['shareId'], content.shareId)), true);
 });
});

test('a caught quota refusal rolls back content, synthetic history and earlier ledger debit together', async t => {
 const { provider, read, subscription } = await fixture(t, { allowance: thingStorageSizeBytes(content) });
 await assert.rejects(withNativeHomeStorageTransaction(provider, binding, async (session, s) => {
  await applyUserStorageDelta(owner, thingStorageSizeBytes(content), session);
  s.collection(namespace).insert(encode(content)); s.collection(namespace).insert(encode(history));
  await assert.rejects(applyUserStorageDelta(owner, 1, session), code('quota_exceeded'));
 }), code('quota_exceeded'));
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, 0);
 assert.equal(await read(content.shareId), null); assert.equal(await read(history.shareId), null);
});

test('owner, plane, counterfeit, foreign-context and expired native sessions are refused without Mongo fallback', async t => {
 const { provider, read, subscription } = await fixture(t);
 let entered = false;
 await assert.rejects(withNativeHomeStorageTransaction(provider, { ...binding, contentPlaneId: 'foreign' }, () => { entered = true; }), code('storage_invariant'));
 assert.equal(entered, false);
 await assert.rejects(applyUserStorageDelta(owner, 1, { kind: 'native-user-storage' }), code('storage_invariant'));
 await assert.rejects(withNativeHomeStorageTransaction(provider, binding, async session => { await assert.rejects(applyUserStorageDelta('different-owner', 1, session), code('storage_invariant')); }), code('storage_invariant'));
 let escaped!: NativeUserStorageSession, release!: () => void, signal!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { signal = resolve; });
 const active = withNativeHomeStorageTransaction(provider, binding, async session => { escaped = session; signal(); await gate; });
 await ready;
 await assert.rejects(applyUserStorageDelta(owner, 1, escaped), error => code('TRANSACTION_OWNERSHIP')(error));
 release(); await assert.rejects(active, code('TRANSACTION_OWNERSHIP'));
 await assert.rejects(applyUserStorageDelta(owner, 0, escaped), code('storage_invariant'));
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, 0);
});

test('competing allowance claims on separate handles have exactly one winner', async t => {
 const { provider, open, read, subscription } = await fixture(t, { allowance: 10 }), second = await open();
 let signal!: () => void, release!: () => void;
 const entered = new Promise<void>(resolve => { signal = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 const first = withNativeHomeStorageTransaction(provider, binding, async session => { await applyUserStorageDelta(owner, 10, session); signal(); await gate; });
 await entered;
 let secondEntered = false;
 const next = withNativeHomeStorageTransaction(second, binding, async session => { secondEntered = true; await applyUserStorageDelta(owner, 1, session); });
 const rejected = assert.rejects(next, code('quota_exceeded'));
 await immediate(); assert.equal(secondEntered, false); release(); await first; await rejected;
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, 10);
});

for (const options of [
 { noUser: true }, { meta: { character: { ownerId: 'another', loginMode: 'inherit', disabled: false } } },
 { mutateLedger: (row: any) => { row.crystal.storageLedgerStatus = USER_STORAGE_STATUS.needsReconcile; } },
 { mutateLedger: (row: any) => { row.crystal.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION - 1; } },
 { mutateLedger: (row: any) => { row.ownerId = 'other'; } },
 { mutateLedger: (row: any) => { row.crystal.storageUsedBytes = '0'; } },
 { mutateLedger: (row: any) => { row.crystal.storagePendingBytes = 1; row.crystal.storagePendingCount = 1; row.crystal.storagePendingSince = new Date(); } },
 { mutateLedger: (row: any) => { row.crystal.overrides = { userStorageBytes: 'unlimited' }; } }
]) test('unsupported/corrupt account or ledger state fails before content mutation: ' + JSON.stringify(Object.keys(options)), async t => {
 const { provider, read } = await fixture(t, options);
 let invoked = false;
 await assert.rejects(withNativeHomeStorageTransaction(provider, binding, async (session, s) => {
  invoked = true;
  s.collection(namespace).insert(encode(content));
  await assert.rejects(applyUserStorageDelta(owner, 1, session), code('accounting_unavailable'));
 }), code('accounting_unavailable'));
 assert.equal(invoked, false, 'Unsupported state must be refused before admitting the writable callback');
 assert.equal(await read(content.shareId), null);
});

test('unlimited allowance, exact finite boundary, underflow, overflow and Int32 promotion preserve safe accounting', async t => {
 const { provider, read, subscription } = await fixture(t, { used: 2147483647, allowance: null });
 await withNativeHomeStorageTransaction(provider, binding, async session => { await applyUserStorageDelta(owner, 1, session); });
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, 2147483648);
 await provider.transaction(s => {
  const bytes = s.collection(namespace).find({ filter: eq(['shareId'], subscription.shareId), limit: 1 }).documents[0];
  assert.ok(BSON.deserialize(bytes, { promoteValues: false }).crystal.storageUsedBytes instanceof Long);
 });
 await assert.rejects(withNativeHomeStorageTransaction(provider, binding, session => applyUserStorageDelta(owner, -2147483649, session)), code('accounting_unavailable'));
 await assert.rejects(withNativeHomeStorageTransaction(provider, binding, session => applyUserStorageDelta(owner, Number.MAX_SAFE_INTEGER, session)), code('storage_invariant'));
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, 2147483648);
});


test('canonical-valid ready ledger can omit optional storageUpdatedAt without inventing a CAS requirement', async t => {
 const { provider, read, subscription } = await fixture(t, { mutateLedger: row => { delete row.crystal.storageUpdatedAt; } });
 assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(subscription, owner), true);
 await withNativeHomeStorageTransaction(provider, binding, session => applyUserStorageDelta(owner, 3, session));
 const saved = await read(subscription.shareId);
 assert.equal(saved.crystal.storageUsedBytes, 3);
 assert.ok(saved.crystal.storageUpdatedAt instanceof Date);
});

test('normal hosted import and existing zero/sandbox delta ordering require no SQLite module or store', async () => {
 const run = promisify(execFile);
 const userStorageUrl = new URL('../storage/userStorage.ts', import.meta.url).href;
 const { stdout } = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import Module from 'node:module';
  const load = Module._load;
  Module._load = function(name, ...args) {
   if (name === 'node:sqlite' || name === 'sqlite') throw Error('Hosted Mongo path must not load SQLite');
   return Reflect.apply(load, this, [name, ...args]);
  };
  const {applyUserStorageDelta} = await import(${JSON.stringify(userStorageUrl)});
  await applyUserStorageDelta('ordinary-account', 0, null);
  await applyUserStorageDelta('sandbox:isolated', 1, null);
  await assert.rejects(applyUserStorageDelta('ordinary-account', 1, null), error => error.code === 'storage_invariant');
  console.log('hosted-import-without-sqlite-ok');
 `], { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 15000, maxBuffer: 16384 });
 assert.match(stdout, /hosted-import-without-sqlite-ok/);
});


test('canonical ordinary-account metadata with a null Character field remains supported', async t => {
 const { provider, read, subscription } = await fixture(t, { meta: { character: null } });
 await withNativeHomeStorageTransaction(provider, binding, session => applyUserStorageDelta(owner, 1, session));
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes, 1);
});

// Synthetic ledger fixture plus canonical identity/session consumers share the
// SAME provider/Things definition. This is not subscription issuance or signup.
test('shared native Things definition composes identity and canonical accounting on the same provider after reopen', async t => {
 const { provider, open, read, subscription } = await fixture(t);
 const auth = await createNativeHomeAuthRepositories(provider, binding.homePlaneId);
 const saved = await auth.run(() => insertUser({username:'coexist',ttid:'coexist',email:'coexist@example.invalid',passwordHash:'synthetic-unused',displayName:null,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),meta:{}}));
 await withNativeHomeStorageTransaction(provider, binding, session => applyUserStorageDelta(owner, 17, session));
 assert.equal((await read(subscription.shareId)).crystal.storageUsedBytes,17);
 await provider.close();
 const reopened=await open(), next=await createNativeHomeAuthRepositories(reopened,binding.homePlaneId);
 await next.run(async()=>assert.equal((await next.identities.findUserThingById(saved._id))!.ownerId,saved._id));
 await withNativeHomeStorageTransaction(reopened,binding,session=>applyUserStorageDelta(owner,-7,session));
 await reopened.transaction(s=>assert.equal(BSON.deserialize(s.collection(namespace).find({filter:eq(['shareId'],subscription.shareId),limit:1}).documents[0]).crystal.storageUsedBytes,10));
});
