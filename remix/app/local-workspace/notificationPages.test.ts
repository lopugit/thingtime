import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { notificationHistoryAccess } from './notificationHistoryAccess';
import { NotificationPages } from './notificationPages';
import { LocalNotificationHistory } from './notifications';
import { WorkspaceDatabase, WorkspaceError } from './storage';
const scope = { kind: 'account', origin: 'https://history.test', ownerId: 'owner', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const offline = async (): Promise<any> => { throw new Error('Offline'); };
const query = { history: 1, limit: 30, withTotal: 1 };
const page = (id: string, nextCursor: string | null = null) => ({ ok: true, notifications: [{ id, type: 'comment', actorName: 'Private actor', preview: 'Social content' }], total: 2, nextCursor });
const markerValues = new Map<string, string>();
const markerStorage = { getItem: (key: string) => markerValues.get(key) ?? null, setItem: (key: string, value: string) => { markerValues.set(key, value); }, removeItem: (key: string) => { markerValues.delete(key); } };
const access = (target = scope) => notificationHistoryAccess(target, () => markerStorage);
const fixture = () => { const factory = new IDBFactory(); return { factory, db: new WorkspaceDatabase(factory, 'notification-pages-test', 10000, IDBKeyRange) }; };

test('downloaded social pages survive cold reload, preserve exact filters/cursors, and never invent unfetched results', async () => {
 const { factory, db } = fixture();
 const pages = new NotificationPages(db, scope, lease, access());
 await pages.read(query, async () => page('new', 'older'));
 await pages.read({ ...query, cursor: 'older' }, async () => page('old'));
 await pages.read({ ...query, q: 'private' }, async () => page('filtered'));
 await db.close();
 const reopened = new WorkspaceDatabase(factory, 'notification-pages-test', 10000, IDBKeyRange);
 try {
  const retained = new NotificationPages(reopened, scope, lease, access());
  const first = await retained.read(query, offline);
  assert.equal(first.cachedHistory, true); assert.equal(first.notifications[0].id, 'new');
  assert.ok(first.savedAt > 0);
  let remoteReads = 0;
  const old = await retained.read({ ...query, cursor: first.nextCursor }, async () => { remoteReads++; return page('wrong'); }, true);
  assert.equal(old.notifications[0].id, 'old'); assert.equal(remoteReads, 0, 'retained cursors never resume fresh remote pagination');
  assert.equal((await retained.read({ ...query, q: 'private' }, offline)).notifications[0].id, 'filtered');
  await assert.rejects(retained.read({ ...query, q: 'unfetched' }, offline), /Offline/);
  await assert.rejects(retained.read({ ...query, cursor: 'unfetched' }, offline, true), /previously downloaded/);
  for (const other of [{ ...scope, ownerId: 'other' }, { ...scope, origin: 'https://other.test' }, { ...scope, dataPlane: 'other' }]) await assert.rejects(new NotificationPages(reopened, other, lease, notificationHistoryAccess(other, () => markerStorage)).read(query, offline), /Offline/);
 } finally { await reopened.close(); }
});

test('permission refusal retires cached remote projection while independent pending local messages survive', async () => {
 const { db } = fixture();
 try {
  const pages = new NotificationPages(db, scope, lease, access());
  await pages.read(query, async () => page('private'));
  const local = new LocalNotificationHistory(db, scope, lease);
  await local.save({ userId: scope.ownerId, eventId: crypto.randomUUID(), title: 'Saved offline', description: '', status: 'success' });
  for (const status of [401, 403, 409]) {
   await pages.read(query, async () => page('private'));
   await assert.rejects(pages.read(query, async () => { throw new WorkspaceError('REFUSED', 'Refused', status); }), /Refused/);
   await assert.rejects(pages.read(query, offline), /Offline/);
   assert.equal((await local.list({ history: true })).pendingCount, 1);
   await pages.read(query, async () => page('private'));
   await assert.rejects(pages.read(query, async () => ({ ok: false, status, notifications: [] })), /Could not read/);
   await assert.rejects(pages.read(query, offline), /Offline/);
  }
 } finally { await db.close(); }
});

test('late remote reads cannot persist or project after account retirement', async () => {
 const { db } = fixture(); let current = true;
 const retiring = { ...lease, assertCurrent() { if (!current) throw new Error('Account retired'); } };
 try {
  const pages = new NotificationPages(db, scope, retiring, access());
  let release!: (response: any) => void;
  const remote = new Promise(resolve => { release = resolve; });
  const result = pages.read(query, () => remote);
  await new Promise(resolve => setImmediate(resolve));
  current = false; release(page('late'));
  await assert.rejects(result, /Account retired/);
  await assert.rejects(new NotificationPages(db, scope, lease, access()).read(query, offline), /Offline/);
 } finally { await db.close(); }
});

test('failed purge preserves the original refusal and blocks fresh adapters until fresh authorization', async () => {
 const { db } = fixture(); const transaction = db.transaction.bind(db); let failed = false;
 db.transaction = ((...args: Parameters<typeof db.transaction>) => {
  if (failed && args[1] === 'readwrite') return Promise.reject(new Error('Device storage unavailable'));
  return transaction(...args);
 }) as typeof db.transaction;
 try {
  const pages = new NotificationPages(db, scope, lease, access());
  await pages.read(query, async () => page('private'));
  const local = new LocalNotificationHistory(db, scope, lease);
  await local.save({ userId: scope.ownerId, eventId: crypto.randomUUID(), title: 'Independent pending message', description: '', status: 'success' });
  failed = true;
  const refusal = new WorkspaceError('REFUSED', 'Original refusal', 403);
  await assert.rejects(pages.read(query, async () => { throw refusal; }), error => error === refusal);
  assert.equal((await transaction(scope, 'readonly', lease, tx => tx.list('notification-account-pages'))).length, 1, 'Unavailable cleanup cannot physically erase the old snapshot');
  assert.equal(access().canReadCached(), false); assert.ok(markerValues.size > 0);
  failed = false;
  const fresh = new NotificationPages(db, scope, lease, access());
  await assert.rejects(fresh.read(query, offline), /Offline/);
  assert.equal((await local.list({ history: true })).pendingCount, 1);
  await fresh.read(query, async () => page('fresh-authorized'));
  assert.equal(access().canReadCached(), true);
  assert.equal((await new NotificationPages(db, scope, lease, access()).read(query, offline)).notifications[0].id, 'fresh-authorized');
 } finally { await db.close(); }
});

test('unavailable marker storage blocks cached reads while authorized live reads remain usable', async () => {
 const { db } = fixture();
 try {
  await new NotificationPages(db, scope, lease, access()).read(query, async () => page('retained'));
  const blocked = notificationHistoryAccess(scope, () => { throw new Error('Storage disabled'); });
  await assert.rejects(new NotificationPages(db, scope, lease, blocked).read(query, offline), /Offline/);
  const live = await new NotificationPages(db, scope, lease, blocked).read(query, async () => page('live'));
  assert.equal(live.cachedHistory, false); assert.equal(live.retainedHistory, false);
  blocked.refuse(); assert.equal(access().canReadCached(), false);
  await new NotificationPages(db, scope, lease, access()).read(query, async () => page('recovered'));
 } finally { await db.close(); }
});

test('a delayed authorized success cannot reopen history after a newer refusal', async () => {
 const { db } = fixture();
 try {
  const pages = new NotificationPages(db, scope, lease, access());
  await pages.read(query, async () => page('initial'));
  let release!: (value: any) => void;
  const waiting = new Promise(resolve => { release = resolve; });
  const late = pages.read(query, () => waiting);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(pages.read(query, async () => { throw new WorkspaceError('REFUSED', 'New refusal', 403); }), /New refusal/);
  release(page('late-private-content'));
  await assert.rejects(late, error => error instanceof WorkspaceError && error.status === 409);
  assert.equal(access().canReadCached(), false);
  await assert.rejects(new NotificationPages(db, scope, lease, access()).read(query, offline), /Offline/);
  await pages.read(query, async () => page('freshly-authorized'));
  assert.equal(access().canReadCached(), true);
 } finally { await db.close(); }
});
