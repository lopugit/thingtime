import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence, withBoundTimelineRead } from './persistenceContext';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildUserSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { resolveWebpage } from '../webpages/webpages';
import { createNativeTimelinePersistence } from '../documentStore/nativeTimelinePersistence';
import { getThingsTransactionBinding, type ThingsReads, type ThingsTransaction } from './persistence';
import { recordPageComponentBindings } from '../timeline/componentBindings';
import { newThingMutationCapture, prepareThingMutation } from '../timeline/recordMutation';
import { readTimelineEntries } from '../timeline/repository';
import { readComponentBinding } from '../../../timeline/componentBindings';
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
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize({ _id: 'unsupported-private', shareId: 'unsupported-private', ownerId, thingtime: ['action'], crystal: {}, acl: [ACL_OWNER], createdAt: at, updatedAt: at })));
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

test('native Builder schema provenance uses canonical validation, live visibility and stale CAS', async t => {
 const f = await fixture(t);
 const schema = await f.run(() => createThing(ownerId, { shareId: 'builder-schema', thingtime: ['schema'], crystal: { name: 'Tasks', fields: [{ name: 'title', type: 'string' }] }, visibility: 'private' }, { id: ownerId }));
 assert.equal(schema.ok, true); if (!schema.ok) return;
 assert.ok(schema.doc.thingtime.includes('builder-thing'));
 const data = await f.run(() => createThing(ownerId, { shareId: 'typed-data', thingtime: ['data'], crystal: { title: 'Editable', schemaId: 'builder-schema', schema: 'Forged name' }, visibility: 'private' }, { id: ownerId }));
 assert.equal(data.ok, true); if (!data.ok) return; assert.equal(data.doc.crystal.schema, 'Tasks');
 const listed = await f.run(() => listThings(ownerId, { schemaId: 'builder-schema' })); assert.equal(listed.ok, true); if (listed.ok) assert.deepEqual(listed.things.map(row => row.id), ['typed-data']);
 const first = await f.run(() => getThing(ownerId, 'typed-data')); assert.equal(first.ok, true); if (!first.ok) return;
 const edited = await f.run(() => updateThing(ownerId, 'typed-data', { crystal: { title: 'Changed' } }, { expectedUpdatedAt: first.thing.updatedAt })); assert.equal(edited.ok, true);
 const stale = await f.run(() => updateThing(ownerId, 'typed-data', { crystal: { title: 'Stale' } }, { expectedUpdatedAt: first.thing.updatedAt })); assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.status, 409);
 const foreignId = 'abcdef0123456789abcdef02';
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize({ _id: 'foreign-schema', shareId: 'foreign-schema', ownerId: foreignId, thingtime: ['schema'], crystal: { name: 'Private foreign', fields: [] }, acl: [ACL_OWNER], createdAt: at, updatedAt: at })));
 const privateSchema = await f.run(() => createThing(ownerId, { shareId: 'forbidden-typed-data', thingtime: ['data'], crystal: { schemaId: 'foreign-schema' } }, { id: ownerId })); assert.equal(privateSchema.ok, false); if (!privateSchema.ok) assert.equal(privateSchema.status, 400);
 const replaced = await f.run(() => updateThing(ownerId, 'typed-data', { crystal: { schemaId: 'foreign-schema' } })); assert.equal(replaced.ok, false);
 assert.equal((await f.run(() => deleteThing(ownerId, 'builder-schema'))).ok, true);
 // Unchanged validated provenance remains editable after schema revocation.
 assert.equal((await f.run(() => updateThing(ownerId, 'typed-data', { crystal: { title: 'After schema removal' } }))).ok, true);
 const invalid = await f.run(() => createThing(ownerId, { shareId: 'invalid-schema', thingtime: ['schema'], crystal: { name: 'Bad', fields: [{ name: 'unsafe.path', type: 'string' }] } }, { id: ownerId })); assert.equal(invalid.ok, false);
 await f.run(async () => { assert.equal(await getBoundThingsPersistence(null)!.readExact('forbidden-typed-data'), null); assert.equal(await getBoundThingsPersistence(null)!.readExact('invalid-schema'), null); });
});

const fixtureRows = async (f: Awaited<ReturnType<typeof fixture>>) => f.run(async () => {
 const rows: any[] = []; let cursor: string | null = null;
 do { const page = await getBoundThingsPersistence(null)!.readWindow({ ownerId, limit: 128, cursor }); rows.push(...page.documents); cursor = page.nextCursor; } while (cursor);
 return rows;
});
const pageCaptures = async (f: Awaited<ReturnType<typeof fixture>>, headId: string) => f.run(async () => {
 const entries = await withBoundTimelineRead(ownerId, port => readTimelineEntries(port, ownerId, [headId]));
 assert.equal(entries?.length, 1);
 const dependencies = entries![0].event.dependencies;
 return await withBoundTimelineRead(ownerId, port => readTimelineEntries(port, ownerId, dependencies.map(item => item.eventId)));
});

test('native Builder Component and Webpage services capture actual definitions, inaccessible nulls, edits and reopen', async t => {
 const f = await fixture(t);
 const component = await f.run(() => createThing(ownerId, { shareId: 'builder-component', thingtime: ['component'], visibility: 'private', crystal: { name: 'Editable card', componentKey: 'editable-card', version: 1, render: { tag: 'p', text: 'Original card' } } }, { id: ownerId })); assert.equal(component.ok, true); if (!component.ok) return;
 assert.ok(component.doc.thingtime.includes('builder-thing'));
 const foreignId = 'abcdef0123456789abcdef02';
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).insert(BSON.serialize({ _id: 'foreign-component', shareId: 'foreign-component', ownerId: foreignId, thingtime: ['component'], crystal: { name: 'Private foreign', render: { tag: 'p', text: 'Must stay private' } }, acl: [ACL_OWNER], createdAt: at, updatedAt: at })));
 const page = await f.run(() => createThing(ownerId, { shareId: 'builder-page', thingtime: ['webpage'], visibility: 'private', crystal: { name: 'Editable page', blocks: [{ id: 'owned', type: 'component', component: 'editable-card' }, { id: 'foreign', type: 'component', component: 'foreign-component' }] } }, { id: ownerId })); assert.equal(page.ok, true); if (!page.ok) return;
 const rendered = await f.run(() => resolveWebpage({ id: ownerId }, { id: 'builder-page' })); assert.equal(rendered.ok, true); if (!rendered.ok) return;
 assert.equal(rendered.refs['editable-card'], 'builder-component'); assert.equal(rendered.refs['foreign-component'], null);
 assert.deepEqual(rendered.components.map(row => row.id), ['builder-component']);
 const first = await pageCaptures(f, page.doc.timelineHeadId!);
 const bindings = first!.map(entry => readComponentBinding(entry.event));
 assert.equal(bindings.find(row => row?.ref === 'editable-card')?.component?.crystal.render.text, 'Original card');
 assert.equal(bindings.find(row => row?.ref === 'foreign-component')?.component, null);
 assert.ok(first!.every(entry => !JSON.stringify(entry.event).includes('Must stay private')));
 const updatedComponent = await f.run(() => updateThing(ownerId, 'builder-component', { crystal: { render: { tag: 'p', text: 'Changed card' }, version: 2 } })); assert.equal(updatedComponent.ok, true);
 const updatedPage = await f.run(() => updateThing(ownerId, 'builder-page', { crystal: { name: 'Edited page' } }, { expectedUpdatedAt: page.doc.updatedAt.toISOString() })); assert.equal(updatedPage.ok, true); if (!updatedPage.ok) return;
 const next = await pageCaptures(f, updatedPage.thing.timelineHeadId!);
 assert.equal(next!.map(entry => readComponentBinding(entry.event)).find(row => row?.ref === 'editable-card')?.component?.crystal.render.text, 'Changed card');
 // The earlier page still holds its own immutable render definition.
 assert.equal((await pageCaptures(f, page.doc.timelineHeadId!))!.map(entry => readComponentBinding(entry.event)).find(row => row?.ref === 'editable-card')?.component?.crystal.render.text, 'Original card');
 const stale = await f.run(() => updateThing(ownerId, 'builder-page', { crystal: { name: 'Stale page' } }, { expectedUpdatedAt: page.doc.updatedAt.toISOString() })); assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.status, 409);
 const reopened = createCollectionProvider(await openSqliteDocumentStore(join(f.directory, 'home.sqlite'))), auth = await createNativeHomeAuthRepositories(reopened, 'home'), context = createNativeThingsPersistenceContext(reopened, 'home');
 try { const after = await auth.run(() => context.run(() => resolveWebpage({ id: ownerId }, { id: 'builder-page' }))); assert.equal(after.ok, true); if (after.ok) { assert.equal(after.page?.crystal.name, 'Edited page'); assert.equal(after.components[0].crystal.render.text, 'Changed card'); } } finally { context.close(); await reopened.close(); }
 // Unsupported shared writes remain refused even for readable Builder data.
 const sharedWrite = await f.run(() => updateThing(foreignId, 'builder-page', { crystal: { name: 'Unauthorized' } })); assert.equal(sharedWrite.ok, false);
 const rows = await fixtureRows(f), ledger = rows.find(row => row.shareId === subscriptionShareId('user', ownerId));
 assert.equal(ledger.crystal.storageUsedBytes, rows.filter(row => row.storageClass === 'content').reduce((total, row) => total + row.sizeBytes, 0));
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: subscriptionShareId('user', ownerId) }, [{ op: 'set', path: ['crystal', 'tierQuotas', 'userStorageBytes'], value: 0 }]));
 const deleted = await f.run(() => deleteThing(ownerId, 'builder-page')); assert.equal(deleted.ok, true);
 assert.equal((await f.run(() => getThing(ownerId, 'builder-page'))).ok, false);
 assert.equal((await pageCaptures(f, updatedPage.thing.timelineHeadId!))!.map(entry => readComponentBinding(entry.event)).find(row => row?.ref === 'editable-card')?.component?.crystal.render.text, 'Changed card');
});

test('native Builder capture quota failure rolls back page content, head, captures and charges', async t => {
 const f = await fixture(t);
 const component = await f.run(() => createThing(ownerId, { shareId: 'capture-component', thingtime: ['component'], visibility: 'private', crystal: { name: 'Card', render: { tag: 'p', text: 'Small' } } }, { id: ownerId })); assert.equal(component.ok, true, JSON.stringify(component));
 const page = await f.run(() => createThing(ownerId, { shareId: 'capture-page', thingtime: ['webpage'], visibility: 'private', crystal: { name: 'Page', blocks: [{ id: 'card', type: 'component', component: 'capture-component' }] } }, { id: ownerId })); assert.equal(page.ok, true); if (!page.ok) return;
 assert.equal((await f.run(() => updateThing(ownerId, 'capture-component', { crystal: { render: { tag: 'p', text: 'Long capture '.repeat(1000) } } }))).ok, true);
 const before = await fixtureRows(f), oldPage = before.find(row => row.shareId === 'capture-page'), used = before.find(row => row.shareId === subscriptionShareId('user', ownerId)).crystal.storageUsedBytes;
 await f.provider.transaction(collections => collections.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: subscriptionShareId('user', ownerId) }, [{ op: 'set', path: ['crystal', 'tierQuotas', 'userStorageBytes'], value: used + 1000 }]));
 const refused = await f.run(() => updateThing(ownerId, 'capture-page', { crystal: { name: 'This edit must roll back' } })); assert.equal(refused.ok, false);
 const after = await fixtureRows(f), newPage = after.find(row => row.shareId === 'capture-page');
 assert.deepEqual(newPage, oldPage); assert.equal(after.length, before.length); assert.equal(after.find(row => row.shareId === subscriptionShareId('user', ownerId)).crystal.storageUsedBytes, used);
 const captureIdsBefore = before.filter(row => row.thingtime.includes('timeline-event')).map(row => row.shareId).sort();
 assert.deepEqual(after.filter(row => row.thingtime.includes('timeline-event')).map(row => row.shareId).sort(), captureIdsBefore);
});

test('native page captures reject arbitrary readers and live foreign-provider transactions before effects', async t => {
 const f = await fixture(t), other = await fixture(t), before = await fixtureRows(f);
 const page = { shareId: 'guarded-page', ownerId, thingtime: ['webpage'], crystal: { name: 'Guarded', blocks: [] }, createdAt: at, updatedAt: at };
 const event = prepareThingMutation(null, page, newThingMutationCapture(ownerId))!.event;
 const fake: ThingsReads = { readExact: async () => { throw Error('Untrusted reader must not execute'); }, readBatch: async () => { throw Error('Untrusted reader must not execute'); }, readWindow: async () => { throw Error('Untrusted reader must not execute'); } };
 await f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, ownerId); assert.equal(binding.kind, 'native'); if (binding.kind !== 'native') return;
  const port = createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session });
  await assert.rejects(recordPageComponentBindings(port, binding.session, null, page, event, fake), /unknown transaction/);
 }));
 let foreign!: ThingsTransaction, ready!: () => void, release!: () => void;
 const started = new Promise<void>(resolve => { ready = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
 const operation = other.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => { foreign = tx; ready(); await held; }));
 // Attach rejection handling before the foreign transaction is deliberately
 // invalidated, so the poison cannot become an unhandled promise rejection.
 const foreignResult = operation.then(() => null, error => error);
 await started;
 try {
  await f.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
   const binding = getThingsTransactionBinding(tx, ownerId); assert.equal(binding.kind, 'native'); if (binding.kind !== 'native') return;
   const port = createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session });
   await assert.rejects(recordPageComponentBindings(port, binding.session, null, page, event, foreign), /foreign transaction|request scope/);
  }));
 } finally { release(); }
 assert.ok(await foreignResult);
 assert.deepEqual(await fixtureRows(f), before);
});
