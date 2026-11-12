import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { externalAccountShareId, externalLinkShareId, externalPostShareId, externalPostSourceShareId } from '../connections/connections';
import { canView, canViewInherited, type Viewer } from './things';
import { resolveWebpage } from '../webpages/webpages';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence } from './persistenceContext';
import { ensureNativeExtAccountIds, ensureNativeExtSourced, nativeExternalAccountIds, nativeSourcesExternalPost } from './nativeExternalAudienceReads';

// Actual SQLite authorization/read-service tests over isolated protected metadata
// unit fixtures. Canonical external connection setup/sync is still Mongo-only;
// these inserts are NOT external-account setup, OAuth or end-to-end acceptance.
const ownerId = 'abcdef0123456789abcdef01', otherId = 'abcdef0123456789abcdef02';
const at = new Date('2026-11-12T00:00:00Z');
const accountId = externalAccountShareId('rss', 'synthetic-feed');
const postId = externalPostShareId('rss', 'synthetic-item');
const linkId = externalLinkShareId(ownerId, accountId);
const sourceId = externalPostSourceShareId(postId, accountId);
const row = (shareId: string, thingtime: string[], extra: Record<string, unknown> = {}) => ({ _id: shareId, shareId, ownerId: 'system', schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime, crystal: {}, acl: [], tags: [], createdAt: at, updatedAt: at, ...extra });
const post = row(postId, ['external-post'], { acl: ['tt:extsourced'], crystal: { text: 'Imported offline item' }, targetId: null });
const viewer = { id: ownerId, username: 'reader' };
async function fixture(t: TestContext, linked = true) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-external-audience-'));
 const source = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'home.sqlite'))); let calls = 0;
 const provider: typeof source = { transaction(work) { calls++; return source.transaction(work); }, close: () => source.close() };
 const auth = await createNativeHomeAuthRepositories(provider, 'native-home'), context = createNativeThingsPersistenceContext(provider, 'native-home');
 t.after(async () => { context.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); });
 const insert = (rows: ReturnType<typeof row>[]) => provider.transaction(collections => { const things = collections.collection(physicalCollectionName('things')); for (const doc of rows) things.insert(BSON.serialize(doc)); });
 await insert([
  row(ownerId, ['user'], { ownerId, secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }),
  row(subscriptionShareId('user', ownerId), ['subscription'], { ownerId, acl: [ACL_OWNER], storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION, crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: at, storageUpdatedAt: at } }),
  row(accountId, ['external-account'], { crystal: { expiresAt: '2000-01-01T00:00:00Z', lastSyncError: 'reconnect' } }), post,
  row(sourceId, ['external-post-source'], { targetId: postId, parentId: accountId, crystal: { accountId, provider: 'rss' } }),
  row('inherited-child', ['data'], { ownerId: otherId, targetId: postId, acl: ['tt:inherit'] }),
  row('legacy-page', ['webpage', 'builder-thing'], { ownerId: otherId, acl: [`tt:extacct/${accountId}`], crystal: { name: 'Offline page', blocks: [] } })
 ]);
 if (linked) await insert([row(linkId, ['external-account-link'], { ownerId, parentId: 'legacy-denormalization-may-be-stale', crystal: { accountId, provider: 'rss' } })]);
 return { provider, context, auth, insert, reset() { calls = 0; }, calls: () => calls,
  run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
}

test('SQLite external audience unit fixtures retain canonical account/source/inherit and negative-ACL semantics', async t => {
 const f = await fixture(t);
 await f.run(async () => {
  const snapshot = await ensureNativeExtSourced(viewer, postId)!; assert.notEqual(snapshot, viewer);
  assert.equal(snapshot!.extAccountIds?.has(accountId), true); assert.equal(snapshot!.extSourcedPostIds?.has(postId), true);
  assert.equal(Object.prototype.hasOwnProperty.call(viewer, 'extAccountIds'), false); assert.equal(Object.prototype.hasOwnProperty.call(viewer, 'extSourcedPostIds'), false);
  assert.equal(await canViewInherited(post as any, viewer), true);
  const child = await getBoundThingsPersistence(null)!.readExact('inherited-child'); assert.equal(await canViewInherited(child as any, viewer), true);
  assert.equal(await canViewInherited({ ...post, acl: [ACL_OWNER] } as any, viewer), false);
  assert.equal(await canViewInherited({ ...post, acl: ['tt:all', '-tt:extsourced'] } as any, viewer), false);
  assert.equal(await canViewInherited({ ...post, acl: ['tt:all', `-tt:extacct/${accountId}`] } as any, viewer), false);
  assert.equal(await canViewInherited(post as any, { id: otherId }), false);
  assert.equal(await canViewInherited(post as any, null), false);
  const forged = { ...viewer, extAccountIds: new Set([accountId]), extSourcedPostIds: new Set([postId]) };
  assert.equal(await canViewInherited(post as any, { ...forged, id: otherId }), false);
  const page = await resolveWebpage(viewer, { id: 'legacy-page' }); assert.equal(page.ok, true);
 });
 const unlinked = await fixture(t, false);
 await unlinked.run(async () => { assert.equal(await canViewInherited({ ...post, acl: ['tt:all', '-tt:extsourced'] } as any, viewer), true); assert.equal((await resolveWebpage(viewer, { id: 'legacy-page' })).ok, false); });
});

test('SQLite external audience metadata filters ignore malformed/foreign links and wrong source fields', async t => {
 const f = await fixture(t, false);
 await f.insert([
  row('foreign-link', ['external-account-link'], { ownerId: otherId, crystal: { accountId } }),
  ...[null, 0, {}, ''].map((value, i) => row(`malformed-link-${i}`, ['external-account-link'], { ownerId, crystal: { accountId: value } })),
  row('ordinary-not-link', ['data'], { ownerId, crystal: { accountId } }),
  row('wrong-root-source', ['external-post-source'], { targetId: 'wrong-fields-post', parentId: 'unlinked-account', crystal: { accountId } }),
  row('missing-root-source', ['external-post-source'], { targetId: 'wrong-fields-post', crystal: { accountId } })
 ]);
 await f.run(async () => { const repository = getBoundThingsPersistence(null)!; assert.deepEqual([...await nativeExternalAccountIds(repository, ownerId)], []); assert.equal(await canViewInherited(post as any, viewer), false); });
 await f.insert([row(linkId, ['external-account-link'], { ownerId, crystal: { accountId } })]);
 await f.run(async () => {
  const repository = getBoundThingsPersistence(null)!, ids = await nativeExternalAccountIds(repository, ownerId);
  assert.equal(await nativeSourcesExternalPost(repository, 'wrong-fields-post', ids), false);
  assert.equal(await nativeSourcesExternalPost(repository, 'different-post', ids), false);
  assert.equal(await nativeSourcesExternalPost(repository, postId, ids), true, 'credential expiry/reconnect status is not offline audience authority');
 });
});

test('SQLite external audience memo coalesces clones and misses without truncating relationship pages', async t => {
 const f = await fixture(t, false), links: ReturnType<typeof row>[] = [], sources: ReturnType<typeof row>[] = [];
 for (let i = 0; i < 270; i++) {
  const account = externalAccountShareId('rss', `account-${i}`);
  links.push(row(externalLinkShareId(ownerId, account), ['external-account-link'], { ownerId, crystal: { accountId: account } }));
  sources.push(row(externalPostSourceShareId('many-post', account), ['external-post-source'], { targetId: 'many-post', parentId: account }));
 }
 await f.insert([...links, ...sources]); f.reset();
 await f.run(async () => {
  const answers = await Promise.all(Array.from({ length: 25 }, () => ensureNativeExtSourced({ ...viewer }, 'many-post')));
  assert.ok(answers.every(answer => answer?.extAccountIds?.size === 270 && answer.extSourcedPostIds?.has('many-post')));
  assert.equal(f.calls(), 6, 'three link pages plus three source pages, coalesced for every clone');
  await Promise.all(Array.from({ length: 25 }, () => ensureNativeExtSourced({ ...viewer }, 'absent-post')));
  assert.equal(f.calls(), 7, 'resolved absence is coalesced too');
 });
});

test('same Viewer reused concurrently by a native transaction and another unlinked profile cannot exchange audience snapshots', async t => {
 const linked = await fixture(t), unlinked = await fixture(t, false), shared = { ...viewer };
 let positiveReady!: () => void, negativeReady!: () => void;
 const positive = new Promise<void>(resolve => { positiveReady = resolve; }), negative = new Promise<void>(resolve => { negativeReady = resolve; });
 await Promise.all([
  linked.run(() => getBoundThingsPersistence(ownerId)!.transaction('delete', async () => {
   const snapshot = await ensureNativeExtSourced(shared, postId)!; positiveReady(); await negative;
   assert.equal(canView(post as any, snapshot), true, 'another scope must not overwrite a completed positive snapshot before use');
   assert.equal(await canViewInherited(post as any, shared), true);
  })),
  unlinked.run(async () => { await positive; try { const snapshot = await ensureNativeExtSourced(shared, postId)!; assert.equal(canView(post as any, snapshot), false); assert.equal(await canViewInherited(post as any, shared), false); } finally { negativeReady(); } })
 ]);
 assert.equal(Object.prototype.hasOwnProperty.call(shared, 'extAccountIds'), false); assert.equal(Object.prototype.hasOwnProperty.call(shared, 'extSourcedPostIds'), false);
});

test('native external audience snapshots observe transactional unlink and fresh request authority without stale viewer expansion', async t => {
 const f = await fixture(t), shared = { ...viewer };
 await f.run(async () => {
  const prepared = await ensureNativeExtSourced(shared, postId)!; assert.equal(canView(post as any, prepared), true);
  await getBoundThingsPersistence(ownerId)!.transaction('delete', async tx => {
   assert.equal(await canViewInherited(post as any, shared), true, 'warm the same transaction before revocation');
   const link = await tx.readExact(linkId); assert.ok(link);
   assert.ok(await tx.remove({ id: linkId, identity: link!._id, updatedAt: link!.updatedAt }));
   assert.equal(await canViewInherited(post as any, shared), false);
   assert.equal(canView(post as any, prepared), true, 'the earlier immutable snapshot stays scoped to its own observed read');
   tx.afterCommit(async () => assert.equal(await canViewInherited(post as any, shared), false));
  });
  assert.equal(await canViewInherited(post as any, shared), false, 'postcommit reads cannot resume a pre-transaction positive memo');
 });
 await f.run(async () => { assert.equal(await canViewInherited(post as any, shared), false); assert.equal((await ensureNativeExtAccountIds(shared))!.extAccountIds?.size, 0); });
 assert.equal(ensureNativeExtAccountIds(shared), null, 'hosted dispatch remains a separate existing implementation');
});

test('native external memo cannot replay a positive snapshot in a later request or escaped async scope', async t => {
 const f = await fixture(t); let release!: () => void, escaped!: Promise<Viewer>, previous!: Viewer;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await f.run(async () => {
  previous = await ensureNativeExtSourced(viewer, postId)!;
  escaped = (async () => { await gate; return await ensureNativeExtSourced(previous, postId)!; })();
 });
 await f.run(() => getBoundThingsPersistence(ownerId)!.transaction('delete', async tx => {
  const link = await tx.readExact(linkId); assert.ok(link);
  assert.ok(await tx.remove({ id: linkId, identity: link!._id, updatedAt: link!.updatedAt }));
 }));
 release(); await assert.rejects(escaped, /request scope/);
 await f.run(async () => { assert.equal(await canViewInherited(post as any, previous), false); assert.equal((await ensureNativeExtSourced(previous, postId))!.extSourcedPostIds?.size, 0); });
});
