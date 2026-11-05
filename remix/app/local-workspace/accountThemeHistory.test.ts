import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThemeSync } from './accountThemes';
import { AccountThingSync } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { WorkspaceDatabase } from './storage';
import { LocalThemes } from './themes';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { TimelineNoteStore } from '../timeline/noteStore';
import { TimelineSync } from '../timeline/sync';
import { themeContentValue } from '../timeline/themeContent';
import { parseTimelineEntry } from '../timeline/contract';
import { exportAccountTimelineVersion } from './accountTimelineExport';
import { parseTimelineVersionExport } from '../timeline/exportVersion';

const scope = { kind: 'account', origin: 'https://theme-history.test', ownerId: 'owner', dataPlane: 'home' } as const;
const stamp = '2026-10-18T00:00:00.000Z';
const remote = { id: 'remote-theme', name: 'Peach', title: null, theme: {}, visibility: 'public', folderId: null,
 version: 'theme-state-v1:' + '1'.repeat(64), createdAt: stamp, updatedAt: stamp };
function fixture(factory = new IDBFactory()) {
 const db = new WorkspaceDatabase(factory), backend = new IndexedDbTimelineBackend(factory);
 let current = true;
 const lease = { assertCurrent() { if (!current) throw Error('Retired workspace'); }, onInvalidate: () => () => {} };
 const themes = new AccountThemeSync(db, scope, lease), sync = new AccountThingSync(db, scope, lease, undefined, undefined, undefined, themes);
 const history = new AccountTimeline(db, scope, lease), store = new AccountTimelineStore(accountTimelineScope(scope), backend, history);
 return { factory, db, backend, lease, themes, sync, history, store, notes: new TimelineNoteStore(store.scope, backend),
  retire: () => { current = false; }, close: async () => { await backend.close(); await db.close(); } };
}

test('dedicated account theme edits retain exact private draft History, independent of content sync', async () => {
 const f = fixture();
 try {
  await f.themes.remember([remote], await f.themes.beginRead());
  await f.themes.setActive(remote.id);
  assert.deepEqual(await f.history.rows(), [], 'hydration and selection do not invent content edits');
  await f.themes.save({ id: remote.id, name: 'Peach', theme: {}, visibility: 'private' });
  const [first] = await f.store.pending();
  assert.ok(first, 'a successful dedicated write must retain its authored History');
  assert.equal(first.source, 'client'); assert.equal(first.mode, 'draft');
  assert.equal(themeContentValue(first.before!).visibility, 'public');
  assert.equal(themeContentValue(first.after!).visibility, 'private');
  assert.equal((await f.history.rows())[0].receipt, null);
  await f.themes.save({ id: remote.id, name: 'Terracotta', theme: { colors: { accent: '#bb8866' } } });
  await f.themes.save({ id: remote.id, name: 'Terracotta', theme: { colors: { accent: '#bb8866' } } });
  assert.equal((await f.store.pending()).length, 2, 'equivalent content is not another version');
  await f.themes.remove(remote.id);
  const events = await f.store.pending();
  assert.deepEqual(events.map(event => event.operation), ['update', 'update', 'delete']);
  assert.deepEqual(events[1].parentIds, [first.id]); assert.deepEqual(events[2].parentIds, [events[1].id]);
  assert.equal(events[2].after, null);
  const archive = (await exportAccountTimelineVersion(events[2].id, f)).export;
  assert.equal(themeContentValue(archive.content).crystal.name, 'Terracotta');
  assert.equal(archive.receipt, null);
  assert.deepEqual(parseTimelineVersionExport(archive, { ownerId: scope.ownerId, id: events[2].id }), archive);
  let position = 0;
  const sender = new TimelineSync(f.store, {
   push: async event => parseTimelineEntry({ event, receipt: { formatVersion: 1, eventId: event.id, ownerId: scope.ownerId, position: ++position, acceptedAt: stamp } }),
   page: async () => ({ entries: [], nextBefore: null, nextAfter: null })
  });
  assert.equal(await sender.pushPending(), 3);
  assert.equal((await f.store.pending()).length, 0);
  assert.equal((await f.themes.status())[0].state, 'pending', 'History receipt cannot acknowledge the separate theme deletion');
  await f.themes.sync({ snapshot: async () => [], write: async () => { throw Error('Offline content sender'); } });
  assert.equal((await f.history.rows()).length, 3, 'failed content sync cannot add or erase History');
 } finally { await f.close(); }
});

test('theme imports, display titles, folder moves and deletion each record once through their dedicated writer', async () => {
 const f = fixture();
 try {
  const imported = await f.sync.things.import({ format: 'thingtime.transfer', version: 1, roots: ['theme'], things: [
   { id: 'theme', thingtime: ['theme'], crystal: { name: 'Imported', theme: { colors: { accent: '#bb8866' } } } }
  ], files: [] });
  const id = imported.idMap.theme;
  assert.notEqual(id, 'theme');
  assert.equal((await f.history.rows({ thingId: id })).length, 1);
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Looks' } });
  await f.sync.things.move([id], folder.id);
  await f.sync.things.renameLibrary({ id, displayTitle: 'My look' });
  await f.sync.remove([id]);
  const events = (await f.store.pending()).filter(event => event.thingId === id);
  assert.deepEqual(events.map(event => event.operation), ['create', 'update', 'update', 'delete']);
  assert.equal(themeContentValue(events[1].after!).folderId, folder.id);
  assert.equal(themeContentValue(events[2].after!).crystal.title, 'My look');
  assert.equal(themeContentValue(events[3].before!).crystal.title, 'My look');
  assert.equal((await f.themes.status()).length, 0, 'unsent create/delete needs no content sync but preserves History');
  assert.ok(!(await f.sync.status()).some(row => row.id === id), 'theme does not enter the generic content queue');
 } finally { await f.close(); }
});

test('theme content, intent, selection and History roll back together on storage failure', async () => {
 const f = fixture();
 try {
  const saved = (await f.themes.save({ name: 'Retained', theme: {} })).theme;
  await f.themes.setActive(saved.id);
  const content = await f.themes.list(), intent = await f.themes.status(), history = await f.history.rows();
  const transaction = f.db.transaction.bind(f.db);
  f.db.transaction = ((scope, mode, lease, run) => transaction(scope, mode, lease, tx => run({ ...tx,
   put: async (collection, id, value) => { if (collection === 'timeline-events') throw Error('History storage failure'); await tx.put(collection, id, value); }
  }))) as typeof f.db.transaction;
  await assert.rejects(f.themes.save({ id: saved.id, name: 'Lost', theme: {} }), /History storage failure/);
  await assert.rejects(f.themes.remove(saved.id), /History storage failure/);
  assert.deepEqual(await f.themes.list(), content); assert.deepEqual(await f.themes.status(), intent); assert.deepEqual(await f.history.rows(), history);
 } finally { await f.close(); }
});

test('account theme History survives reload and cache eviction without crossing identity or data-plane partitions', async () => {
 const f = fixture();
 try {
  const saved = (await f.themes.save({ name: 'Device version', theme: {} })).theme;
  await new LocalThemes(f.db, f.lease).save({ name: 'Anonymous', theme: {} });
  const [event] = await f.store.pending();
  await f.store.prune(0, 0);
  await f.close();
  const reopened = fixture(f.factory);
  try {
   assert.deepEqual(await reopened.store.pending(), [event]);
   assert.equal(themeContentValue((await exportAccountTimelineVersion(event.id, reopened)).export.content).crystal.name, 'Device version');
   for (const other of [{ ...scope, ownerId: 'other' }, { ...scope, origin: 'https://other.test' }, { ...scope, dataPlane: 'other' }])
    assert.deepEqual(await new AccountTimeline(reopened.db, other, reopened.lease).rows(), []);
   await assert.rejects(reopened.sync.things.update({ id: saved.id, crystal: { name: 'Generic bypass' } }), /dedicated|protected/);
   reopened.retire();
   await assert.rejects(reopened.themes.save({ id: saved.id, name: 'Retired', theme: {} }), /Retired/);
  } finally { await reopened.close(); }
 } finally { await f.close(); }
});

test('remote theme refresh and acknowledgements do not fabricate authored versions', async () => {
 const f = fixture();
 try {
  const saved = (await f.themes.save({ name: 'Local', theme: {} })).theme, events = await f.store.pending();
  const version = 'theme-state-v1:' + '2'.repeat(64);
  assert.equal((await f.themes.sync({ snapshot: async () => [], write: async command => ({ id: command.id, writeId: command.writeId, action: command.action, expectedVersion: command.expectedVersion, resultVersion: version }) })).completed, 1);
  await f.themes.remember([{ ...remote, id: saved.id, name: 'Remote later', visibility: 'private', version: 'theme-state-v1:' + '3'.repeat(64), updatedAt: new Date(Date.now() + 1000).toISOString() }], await f.themes.beginRead());
  assert.deepEqual(await f.store.pending(), events);
  assert.equal((await f.themes.list()).themes[0].name, 'Remote later');
 } finally { await f.close(); }
});
