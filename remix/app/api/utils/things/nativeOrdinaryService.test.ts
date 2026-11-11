import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence } from './persistenceContext';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { createThing, getThing, getThings, listThings, updateThing, deleteThing } from './things';
const ownerId = 'abcdef0123456789abcdef01', at = new Date('2026-11-12T00:00:00Z');
const document = (id: string) => ({ _id: id, shareId: id, ownerId, thingtime: ['data'], crystal: {}, createdAt: at, updatedAt: at });
async function fixture(t: TestContext) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-things-request-'));
 const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'home.sqlite')));
 const auth = await createNativeHomeAuthRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home');
 t.after(async () => { context.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); });
 await provider.transaction(collections => {
  const things = collections.collection(physicalCollectionName('things'));
  things.insert(BSON.serialize({ _id: 'user', shareId: ownerId, ownerId, thingtime: ['user'], createdAt: at, updatedAt: at, secure: buildUserSecure({ email: '', passwordHash: 'synthetic-unused', emailVerified: false, accountKind: 'user', meta: {} }).secure }));
  things.insert(BSON.serialize({ _id: 'ledger', shareId: subscriptionShareId('user', ownerId), ownerId, thingtime: ['subscription'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER], targetId: null, tags: [], createdAt: at, updatedAt: at, storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
   crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: ownerId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1, tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 }, overrides: null, note: null, updatedBy: null, isDefaultAssignment: true, storageUsedBytes: 0, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, storageLedgerStatus: USER_STORAGE_STATUS.ready, storageReconciledAt: at, storageUpdatedAt: at } }));
 });
 return { provider, auth, context, directory, run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
}

test('canonical native Things CRUD, projections, folder move, CAS and History use real SQLite', async t => {
 const f = await fixture(t), run = f.run;
 const make = async (id: string, kind = 'data', folderId?: string) => run(() => createThing(ownerId, { shareId: id, thingtime: [kind], crystal: kind === 'folder' ? { name: id } : { text: id }, visibility: 'private', folderId }, { id: ownerId }));
 assert.equal((await make('parent', 'folder')).ok, true);
 assert.equal((await make('nested', 'folder', 'parent')).ok, true);
 const created = await make('item', 'data', 'nested'); assert.equal(created.ok, true); if (!created.ok) return;
 assert.ok(created.doc.timelineHeadId);
 const first = await run(() => getThing(ownerId, 'item')); assert.equal(first.ok, true); if (!first.ok) return;
 assert.equal(first.thing.folderId, 'nested'); assert.equal(first.thing.author?.id, ownerId);
 assert.ok(first.discussion); assert.deepEqual(first.thing.attachments, []);
 const listed = await run(() => listThings(ownerId, { folder: 'nested' })); assert.equal(listed.ok, true); if (listed.ok) assert.deepEqual(listed.things.map(row => row.id), ['item']);
 const edited = await run(() => updateThing(ownerId, 'item', { crystal: { text: 'edited' } }, { expectedUpdatedAt: first.thing.updatedAt })); assert.equal(edited.ok, true);
 const stale = await run(() => updateThing(ownerId, 'item', { crystal: { text: 'stale' } }, { expectedUpdatedAt: first.thing.updatedAt })); assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.status, 409);
 assert.equal((await run(() => updateThing(ownerId, 'parent', { folderId: 'nested' }))).ok, false);
 const staleDelete = await run(() => deleteThing(ownerId, 'item', null, { expectedUpdatedAt: first.thing.updatedAt })); assert.equal(staleDelete.ok, false); if (!staleDelete.ok) assert.equal(staleDelete.status, 409);
 assert.equal((await run(() => deleteThing(ownerId, 'nested'))).ok, true);
 const moved = await run(() => getThing(ownerId, 'item')); assert.equal(moved.ok, true); if (moved.ok) { assert.equal(moved.thing.folderId, 'parent'); assert.equal(moved.thing.crystal.text, 'edited'); }
 assert.equal((await run(() => deleteThing(ownerId, 'item'))).ok, true);
 assert.equal((await run(() => getThing(ownerId, 'item'))).ok, false);
 const reopened = createCollectionProvider(await openSqliteDocumentStore(join(f.directory, 'home.sqlite')));
 const reopenedAuth = await createNativeHomeAuthRepositories(reopened, 'home'), reopenedContext = createNativeThingsPersistenceContext(reopened, 'home');
 try { const read = await reopenedAuth.run(() => reopenedContext.run(() => getThing(ownerId, 'parent'))); assert.equal(read.ok, true); } finally { reopenedContext.close(); await reopened.close(); }
 await run(async () => { const events = await getBoundThingsPersistence(null)!.readWindow({ kinds: ['timeline-event'], ownerId, targetId: 'item', limit: 20 }); assert.ok(events.documents.length >= 4); });
});

test('native canonical ACL never exposes foreign private content; unsupported operations have no side effects', async t => {
 const f = await fixture(t);
 const made = await f.run(() => createThing(ownerId, { shareId: 'private', thingtime: ['data'], crystal: { text: 'secret' }, visibility: 'private' }, { id: ownerId })); assert.equal(made.ok, true);
 const batch = await f.run(() => getThings(ownerId, ['private', 'missing'])); assert.equal(batch.ok, true); if (batch.ok) assert.deepEqual(batch.things.map(row => row?.id ?? null), ['private', null]);
 const other = await f.run(() => getThing({ id: 'other' }, 'private')); assert.equal(other.ok, false); if (!other.ok) assert.equal(other.status, 404);
 assert.equal((await f.run(() => getThing(null, 'private'))).ok, false);
 assert.equal((await f.run(() => updateThing('other', 'private', { crystal: { text: 'changed' } }))).ok, false);
 assert.equal((await f.run(() => createThing(ownerId, { shareId: 'unsupported', thingtime: ['post'], crystal: { text: 'post' } }, { id: ownerId }))).ok, false);
 await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact('unsupported'), null));
});

test('private unsupported Things remain indistinguishable from absent records', async t => {
 const f = await fixture(t);
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize({ _id: 'unsupported-private', shareId: 'unsupported-private', ownerId, thingtime: ['webpage'], crystal: {}, acl: [ACL_OWNER], createdAt: at, updatedAt: at })));
 for (const viewer of [null, { id: 'other' }]) {
  const found = await f.run(() => getThing(viewer, 'unsupported-private'));
  const absent = await f.run(() => getThing(viewer, 'missing'));
  assert.deepEqual(found, absent);
 }
});

test('folder deletion admits a legacy child baseline before deleting the root and retains accounting', async t => {
 const f = await fixture(t);
 for (const [shareId, thingtime, folderId] of [['legacy-folder', 'folder', null], ['legacy-child', 'data', 'legacy-folder']] as const) {
  const made = await f.run(() => createThing(ownerId, { shareId, thingtime: [thingtime], crystal: thingtime === 'folder' ? { name: shareId } : { text: shareId }, visibility: 'private', folderId }, { id: ownerId })); assert.equal(made.ok, true);
 }
 // Isolated module fixture representing a pre-Timeline child; no production
 // database or application seeding path is involved.
 await f.provider.transaction(collections => { const things = collections.collection(physicalCollectionName('things')); things.updateOne({ op: 'eq', path: ['shareId'], value: 'legacy-child' }, [{ op: 'unset', path: ['timelineHeadId'] }]); });
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: subscriptionShareId('user', ownerId) }, [{ op: 'set', path: ['crystal', 'tierQuotas', 'userStorageBytes'], value: 0 }]));
 const refused = await f.run(() => deleteThing(ownerId, 'legacy-folder')); assert.equal(refused.ok, false);
 const unchanged = await f.run(() => getThing(ownerId, 'legacy-child')); assert.equal(unchanged.ok, true); if (unchanged.ok) { assert.equal(unchanged.thing.folderId, 'legacy-folder'); assert.equal(unchanged.thing.timelineHeadId, undefined); }
 assert.equal((await f.run(() => getThing(ownerId, 'legacy-folder'))).ok, true);
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: subscriptionShareId('user', ownerId) }, [{ op: 'set', path: ['crystal', 'tierQuotas', 'userStorageBytes'], value: null }]));
 const removed = await f.run(() => deleteThing(ownerId, 'legacy-folder')); assert.equal(removed.ok, true);
 const child = await f.run(() => getThing(ownerId, 'legacy-child')); assert.equal(child.ok, true); if (child.ok) { assert.equal(child.thing.folderId, null); assert.ok(child.thing.timelineHeadId); }
 await f.run(async () => {
  const repository = getBoundThingsPersistence(null)!;
  const rows: any[] = []; let cursor: string | null = null;
  do { const page = await repository.readWindow({ ownerId, limit: 128, cursor }); rows.push(...page.documents); cursor = page.nextCursor; } while (cursor);
  const ledger = rows.find(row => row.shareId === subscriptionShareId('user', ownerId));
  const logicalBytes = rows.filter(row => row.storageClass === 'content').reduce((sum, row) => sum + row.sizeBytes, 0);
  assert.equal(ledger.crystal.storageUsedBytes, logicalBytes);
 });
});

test('native candidate pagination is stable and rejects cross-selection cursors; unsupported ordinary rows never disappear silently', async t => {
 const f = await fixture(t);
 for (const shareId of ['page-a', 'page-b', 'page-c']) assert.equal((await f.run(() => createThing(ownerId, { shareId, thingtime: ['data'], crystal: { text: shareId }, visibility: 'private' }, { id: ownerId }))).ok, true);
 const ids: string[] = []; let cursor: string | null = null, pages = 0;
 do { const pageCursor = cursor; const page = await f.run(() => listThings(ownerId, { limit: 1, cursor: pageCursor })); assert.equal(page.ok, true); if (!page.ok) return; ids.push(...page.things.map(row => row.id)); cursor = page.nextCursor; assert.ok(++pages < 30); } while (cursor);
 assert.deepEqual(ids.filter(id => !id.startsWith('timeline-folder-')).sort(), ['page-a', 'page-b', 'page-c']); assert.equal(ids.filter(id => id.startsWith('timeline-folder-')).length, 1); assert.equal(new Set(ids).size, ids.length);
 const first = await f.run(() => listThings(ownerId, { limit: 1, thingtime: ['data'] })); assert.equal(first.ok, true); if (first.ok) {
  assert.ok(first.nextCursor); const invalid = await f.run(() => listThings(ownerId, { limit: 1, folder: 'root', thingtime: ['data'], cursor: first.nextCursor })); assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.status, 400);
 }
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize({ _id: 'unsupported-post', shareId: 'unsupported-post', ownerId, thingtime: ['post'], crystal: { text: 'preserved' }, acl: [ACL_OWNER], createdAt: new Date(Date.now() + 1000), updatedAt: at })));
 const mixed = await f.run(() => listThings(ownerId, {})); assert.equal(mixed.ok, false); if (!mixed.ok) assert.equal(mixed.status, 503);
});

test('protected history and archived rows are excluded before paging and every selection predicate binds the cursor', async t => {
 const f = await fixture(t);
 await f.provider.transaction(collections => {
  const things = collections.collection(physicalCollectionName('things'));
  // More than two native scan batches of protected candidates precede all
  // readable content. They must consume neither slots nor next-page evidence.
  for (let index = 0; index < 270; index++) things.insert(BSON.serialize({ _id: `hidden-${index}`, shareId: `hidden-${index}`, ownerId, thingtime: ['timeline-note'], crystal: {}, createdAt: new Date('2035-01-01'), updatedAt: at }));
  for (const [shareId, second, archived] of [['eligible-a', 4, undefined], ['archived', 3, true], ['eligible-b', 2, 'true'], ['eligible-c', 1, undefined]] as const) things.insert(BSON.serialize({ _id: shareId, shareId, ownerId, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['data'], crystal: { text: shareId, ...(archived === undefined ? {} : { archived }) }, acl: [ACL_OWNER], tags: [], folderId: null, targetId: null, createdAt: new Date(`2030-01-01T00:00:0${second}Z`), updatedAt: at }));
 });
 const first = await f.run(() => listThings(ownerId, { limit: 2, excludeArchived: true })); assert.equal(first.ok, true); if (!first.ok) return;
 assert.deepEqual(first.things.map(row => row.id), ['eligible-a', 'eligible-b']); assert.ok(first.nextCursor);
 const second = await f.run(() => listThings(ownerId, { limit: 2, excludeArchived: true, cursor: first.nextCursor })); assert.equal(second.ok, true); if (!second.ok) return;
 assert.deepEqual(second.things.map(row => row.id), ['eligible-c']); assert.equal(second.nextCursor, null);
 const changedFilter = await f.run(() => listThings(ownerId, { limit: 2, cursor: first.nextCursor })); assert.equal(changedFilter.ok, false); if (!changedFilter.ok) assert.equal(changedFilter.status, 400);
 const all = await f.run(() => listThings(ownerId, { limit: 2 })); assert.equal(all.ok, true); if (all.ok) assert.deepEqual(all.things.map(row => row.id), ['eligible-a', 'archived']);
});
