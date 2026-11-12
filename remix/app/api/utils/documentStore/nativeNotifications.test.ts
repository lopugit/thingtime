import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { emitSystemNotification, emitLoginNotification, listNotifications, markNotificationsRead, notificationDoc } from '../notifications/notifications';
import { currentNotificationRepository, withHomeNotificationRepository } from '../notifications/repository';
import { insertUser, getUserNotificationPrefs, setUserNotificationPrefs } from '../auth/users';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { createNativeNotificationRepository } from './nativeNotifications';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import type { CollectionProvider } from './collectionContract';

const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-notifications-'));
 const providers: CollectionProvider[] = [];
 t.after(async () => { await Promise.all(providers.map(p => p.close())); await rm(directory, { recursive: true, force: true }); });
 return async (file = 'home.sqlite', home = 'home') => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, file))); providers.push(provider);
  const auth = await createNativeHomeAuthRepositories(provider, home), notifications = await createNativeNotificationRepository(provider, home);
  return { provider, auth, notifications, run: <T>(work: () => T | Promise<T>) => auth.run(() => withHomeNotificationRepository(notifications, work)) };
 };
};
const user = async (name: string) => {
 const now = new Date();
 return String((await insertUser({ ttid: name, username: name, email: `${name}@example.invalid`, displayName: `Display ${name}`,
  passwordHash: 'synthetic-unused-hash', emailVerified: false, accountKind: 'user', meta: {}, createdAt: now, updatedAt: now }))._id);
};
const record = (owner: string, at: Date, overrides: Record<string, unknown> = {}) => ({ ...notificationDoc({
 recipientId: owner, type: 'system-message', actor: { id: 'system', displayName: 'Lopu' }, title: 'Synthetic note'
}, at), ...overrides });

test('canonical account notification history/preferences survive SQLite reopen without hosted persistence', async t => {
 const open = await fixture(t), a = await open(); let owner = '', id = '';
 await a.run(async () => {
  owner = await user('notification-owner');
  await emitSystemNotification({ recipientId: owner, type: 'system-message', title: 'Account created successfully ✨', historyOnly: true });
  const bell = await listNotifications(owner); assert.equal(bell.ok, true); if (!bell.ok) return;
  assert.deepEqual(bell.notifications, []); assert.equal(bell.unreadCount, 0);
  const history = await listNotifications(owner, { history: true, withTotal: true }); assert.equal(history.ok, true); if (!history.ok) return;
  assert.equal(history.notifications.length, 1); assert.equal(history.total, 1); assert.equal(history.historyUnreadCount, 1);
  assert.equal(history.notifications[0].title, 'Account created successfully ✨'); id = history.notifications[0].id;
  assert.equal('secure' in history.notifications[0], false);
  assert.equal(await setUserNotificationPrefs(owner, { masters: { push: false }, email: { 'system-message': false } }), true);
  assert.deepEqual(await getUserNotificationPrefs(owner), { masters: { push: false }, email: { 'system-message': false } });
 });
 await a.provider.close(); const b = await open();
 await b.run(async () => {
  const history = await listNotifications(owner, { history: true }); assert.equal(history.ok, true); if (!history.ok) return;
  assert.equal(history.notifications[0].id, id); assert.equal(history.historyUnreadCount, 1); assert.equal(history.unreadCount, 0);
  assert.deepEqual(await markNotificationsRead('another-owner', { ids: [id] }), { ok: true, updated: 0 });
  assert.deepEqual(await markNotificationsRead(owner, { ids: [id] }), { ok: true, updated: 1 });
  assert.deepEqual(await markNotificationsRead(owner, { all: true }), { ok: true, updated: 0 });
  const read = await listNotifications(owner, { history: true }); assert.equal(read.ok, true); if (!read.ok) return;
  assert.equal(read.historyUnreadCount, 0); assert.ok(read.notifications[0].readAt);
 });
});

test('history selection crosses scan pages and preserves literal search, stable cursor, totals and independent badge', async t => {
 const open = await fixture(t), f = await open(), base = Date.parse('2026-01-01T00:00:00Z');
 await f.run(async () => {
  const owner = await user('history-owner');
  const docs = Array.from({ length: 161 }, (_, index) => record(owner, new Date(base + Math.floor(index / 3) * 1000), {
   shareId: `note-${String(index).padStart(3, '0')}`, historyOnly: index % 3 === 0,
   readAt: index % 5 === 0 ? new Date(base + 100000) : null,
   crystal: { type: index % 2 === 0 ? 'system-message' : 'login-success', actorId: 'system', title: index % 4 === 0 ? 'Match [literal].*' : 'Another note' }
  }));
  await f.notifications.insertMany([...docs, record('foreign', new Date(base + 200000))]);
  await setUserNotificationPrefs(owner, { 'login-success': false });
  const first = await listNotifications(owner, { history: true, limit: 7, withTotal: true }); assert.equal(first.ok, true); if (!first.ok) return;
  assert.equal(first.total, 161); assert.equal(first.historyUnreadCount, 128);
  assert.equal(first.unreadCount, docs.filter(doc => !doc.historyOnly && doc.readAt === null && doc.crystal.type === 'system-message').length);
  const ids: string[] = [], seen = new Set<string>(); let page = first;
  for (;;) {
   for (const row of page.notifications) { assert.equal(seen.has(row.id), false); seen.add(row.id); ids.push(row.id); }
   if (!page.nextCursor) break;
   const next = await listNotifications(owner, { history: true, limit: 7, cursor: page.nextCursor }); assert.equal(next.ok, true); if (!next.ok) return; page = next;
  }
  const expected = [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.shareId.localeCompare(b.shareId)).map(doc => doc.shareId);
  assert.deepEqual(ids, expected);
  const literal = await listNotifications(owner, { history: true, q: '[literal].*', from: new Date(base + 10000).toISOString(), to: new Date(base + 20000).toISOString(), withTotal: true });
  assert.equal(literal.ok, true); if (!literal.ok) return;
  assert.equal(literal.total, docs.filter(doc => doc.crystal.title.includes('[literal].*') && doc.createdAt.getTime() >= base + 10000 && doc.createdAt.getTime() < base + 20000).length);
  const invalid = await listNotifications(owner, { history: true, cursor: 'invalid' }); assert.equal(invalid.ok, false);
  const unknown = await listNotifications(owner, { types: ['not-a-type'], withTotal: true }); assert.equal(unknown.ok, true); if (unknown.ok) assert.equal(unknown.total, 0);
  assert.deepEqual(await markNotificationsRead(owner, { all: true }), { ok: true, updated: 128 });
 });
});

test('actor enrichment and unread dedupe use only the same native home provider', async t => {
 const open = await fixture(t), f = await open();
 await f.run(async () => {
  const owner = await user('recipient'), actor = await user('actor');
  const doc = notificationDoc({ recipientId: owner, type: 'system-message', actor: { id: actor, displayName: 'Old snapshot' }, preview: 'Exact preview', targetId: 'target' }, new Date());
  await f.notifications.insertOne(doc);
  assert.deepEqual(await f.notifications.findUnreadDuplicates({ recipients: [{ recipientId: owner, type: 'system-message' }], actorId: actor, targetId: 'target', preview: 'Exact preview' }), [{ ownerId: owner, type: 'system-message' }]);
  assert.deepEqual(await f.notifications.findUnreadDuplicates({ recipients: [{ recipientId: owner, type: 'system-message' }], actorId: actor, targetId: 'other', preview: 'Exact preview' }), []);
  const page = await listNotifications(owner); assert.equal(page.ok, true); if (!page.ok) return;
  assert.equal(page.notifications[0].actorName, 'Display actor'); assert.equal(page.notifications[0].actorUsername, 'actor');
 });
});

test('native login notification remains durable and reports unavailable delivery without hosted dispatch', async t => {
 const open = await fixture(t), f = await open(); const diagnostics: unknown[][] = [];
 t.mock.method(console, 'error', (...values: unknown[]) => { diagnostics.push(values); });
 await f.run(async () => {
  const owner = await user('login-recipient');
  await emitLoginNotification(owner);
  const page = await listNotifications(owner, { history: true }); assert.equal(page.ok, true); if (!page.ok) return;
  assert.equal(page.notifications.length, 1); assert.equal(page.notifications[0].type, 'login-success');
  assert.deepEqual(diagnostics, [['[notifications] emit failed:', 'Native notification history was saved; external delivery is unavailable']]);
 });
});

test('missing, foreign same-label and expired notification bindings cannot fall back to Mongo', async t => {
 const open = await fixture(t), a = await open('a.sqlite'), b = await open('b.sqlite');
 await a.auth.run(async () => {
  assert.throws(() => currentNotificationRepository(), code('NOTIFICATION_REPOSITORY_SCOPE'));
  await assert.rejects(withHomeNotificationRepository(b.notifications, () => undefined), code('HOME_REPOSITORY_SCOPE'));
 });
 let release!: () => void, entered!: () => void, pending!: Promise<void>;
 const ready = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; });
 const blocking = a.provider.transaction(async () => { entered(); await hold; }); await ready;
 await a.run(() => { pending = a.notifications.insertOne(record('owner', new Date())); });
 const rejected = assert.rejects(pending, code('NOTIFICATION_REPOSITORY_SCOPE')); release(); await blocking; await rejected;
 await assert.rejects(a.notifications.insertOne(record('owner', new Date())), code('NOTIFICATION_REPOSITORY_SCOPE'));
 assert.equal(currentNotificationRepository().kind, 'mongo-home');
});

test('native notification input is copied before queueing and rejects hooks/protected envelope changes', async t => {
 const open = await fixture(t), f = await open(); let executed = false;
 await f.run(async () => {
  const doc = record('owner', new Date());
  await assert.rejects(f.notifications.insertOne({ ...doc, acl: ['*'] }), code('INVALID_NOTIFICATION'));
  await assert.rejects(f.notifications.insertOne(Object.defineProperty({ ...doc }, 'crystal', { enumerable: true, get() { executed = true; return doc.crystal; } })), code('UNSUPPORTED_COLLECTION_OPERATION'));
  assert.equal(executed, false);
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; });
  const blocked = f.provider.transaction(async () => { entered(); await hold; }); await ready;
  const pending = f.notifications.insertOne(doc); doc.ownerId = 'changed-after-call'; release(); await blocked; await pending;
  const original = await listNotifications('owner', { history: true }); assert.equal(original.ok, true); if (original.ok) assert.equal(original.notifications.length, 1);
  const changed = await listNotifications('changed-after-call', { history: true }); assert.equal(changed.ok, true); if (changed.ok) assert.equal(changed.notifications.length, 0);
 });
});

test('hosted notification repository retains its existing Mongo operations without native imports', async () => {
 const result = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(new URL('./nativeNotifications.mongo.fixture.mts', import.meta.url))], { cwd: process.cwd(), timeout: 30000 });
 assert.match(result.stdout, /hosted-notification-contract-ok/);
});
