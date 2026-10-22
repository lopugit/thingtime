import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalNotificationHistory } from './notifications';
import { validateNotificationMessage } from '../api/utils/notifications/messageContract';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceScope } from './storage';

const anonymous = { kind: 'anonymous' } as const;
const account = { kind: 'account', origin: 'https://notifications.test', ownerId: 'owner', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const body = (userId = 'owner', title = 'Saved') => ({ userId, eventId: randomUUID(), title, description: 'Details', status: 'success' });
const idOf = (body: any) => `notification-message-${createHash('sha256').update(JSON.stringify([body.userId, body.eventId])).digest('hex')}`;
const fixture = () => { const factory = new IDBFactory(); return { factory, db: new WorkspaceDatabase(factory, 'notifications-test', 10000, IDBKeyRange) }; };

test('anonymous history survives reopening, is redacted before persistence, and never invokes a transport', async () => {
 const { factory, db } = fixture();
 const local = new LocalNotificationHistory(db, anonymous, lease);
 const input = { ...body('local-workspace', 'Local message'), description: 'password=secret-value\nBearer abcdef\nownerId: 507f1f77bcf86cd799439011', href: '/things/card?key=private#secret' };
 const id = await local.save(input);
 assert.equal(id, idOf(input));
 const rows = await db.transaction(anonymous, 'readonly', lease, tx => tx.list('notification-messages'));
 assert.doesNotMatch(JSON.stringify(rows), /secret-value|abcdef|507f1f77bcf86cd799439011|private/);
 assert.match(JSON.stringify(rows), /redacted/);
 await db.close();
 const reopened = new WorkspaceDatabase(factory, 'notifications-test', 10000, IDBKeyRange);
 try {
  const history = new LocalNotificationHistory(reopened, anonymous, lease);
  const page = await history.list({ history: 1 });
  assert.equal(page.total, 1); assert.equal(page.notifications[0].href, '/things/card'); assert.equal(page.unreadCount, 0);
  assert.equal((await history.list()).total, 0, 'history-only messages do not create bell deliveries');
  await history.sync(async () => { assert.fail('Anonymous sync'); });
  assert.equal((await new LocalNotificationHistory(reopened, account, lease).list({ history: true })).total, 0);
 } finally { await reopened.close(); }
});

test('immutable events preserve distinct equal messages and reject invalid, oversized or foreign account content', async () => {
 const { db } = fixture(); const history = new LocalNotificationHistory(db, account, lease), input = body();
 try {
  assert.equal(await history.save(input), await history.save(input));
  await history.save(body());
  await assert.rejects(history.save({ ...input, title: 'changed' }), /cannot be overwritten/);
  for (const bad of [body('different'), { ...body(), extra: true }, { ...body(), eventId: 'bad' }, { ...body(), description: '🥰'.repeat(24000) }]) await assert.rejects(history.save(bad));
  assert.equal((await history.list({ history: true })).total, 2);
  assert.equal((await history.list({ history: true })).pendingCount, 2);
 } finally { await db.close(); }
});

test('lost response retries reuse the same canonical server identity and only one tab holds a live claim', async () => {
 const { db } = fixture(); let now = Date.now(); const history = new LocalNotificationHistory(db, account, lease, () => now), input = body();
 try {
  await history.save(input); const deliveries: string[] = [];
  await history.sync(async value => { deliveries.push(value.eventId); throw new Error('Lost response'); });
  assert.equal((await history.list({ history: true })).pendingCount, 1);
  now += 31_000;
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const syncing = history.sync(async value => { deliveries.push(value.eventId); entered(); await wait; return idOf(value); });
  await ready;
  const other = new LocalNotificationHistory(db, account, lease, () => now);
  await other.sync(async () => { assert.fail('Concurrent delivery'); });
  release(); assert.equal((await syncing).completed, 1);
  assert.deepEqual(deliveries, [input.eventId, input.eventId]);
  assert.equal((await history.list({ history: true })).pendingCount, 0);
 } finally { await db.close(); }
});

test('a failed acknowledgement never deletes the local message and bounded retries surface a sync failure', async () => {
 const { db } = fixture(); let now = Date.now(); const history = new LocalNotificationHistory(db, account, lease, () => now);
 try {
  await history.save(body());
  for (let i = 0; i < 5; i++) { await history.sync(async () => 'wrong-id'); now += 61_000; }
  const page = await history.list({ history: true });
  assert.equal(page.total, 1); assert.equal(page.pendingCount, 0); assert.equal(page.failedCount, 1);
  await history.sync(async () => { assert.fail('Unbounded retry'); });
 } finally { await db.close(); }
});

test('permanent refusal remains local and a lost account confirmation retires without discarding the pending event', async () => {
 const { db } = fixture(); const history = new LocalNotificationHistory(db, account, lease);
 try {
  await history.save(body());
  await assert.rejects(history.sync(async () => { throw new WorkspaceError('WORKSPACE_CHANGED', 'Changed', 409); }), /Changed/);
  assert.equal((await history.list({ history: true })).pendingCount, 1);
  const second = new LocalNotificationHistory(db, account, lease, () => Date.now() + 60_000);
  await second.sync(async () => { throw new WorkspaceError('REFUSED', 'Refused', 400); });
  const page = await second.list({ history: true }); assert.equal(page.failedCount, 1); assert.equal(page.total, 1);
 } finally { await db.close(); }
});

test('stable pagination handles equal timestamps, scopes and filters without dropping or duplicating rows', async () => {
 const { db } = fixture(); const history = new LocalNotificationHistory(db, account, lease, () => Date.parse('2026-10-17T12:00:00Z'));
 try {
  for (let i = 0; i < 5; i++) await history.save(body('owner', `Message ${i}`));
  let cursor: string | null = null; const ids: string[] = [];
  do { const page = await history.list({ history: true, limit: 2, cursor }); ids.push(...page.notifications.map(row => row.id)); cursor = page.nextCursor; } while (cursor);
  assert.equal(new Set(ids).size, 5); assert.equal(ids.length, 5);
  const first = await history.list({ history: true, limit: 1 });
  await assert.rejects(history.list({ history: true, cursor: first.nextCursor, q: 'other' }), /filters or workspace/);
  for (const scope of [anonymous, { ...account, dataPlane: 'other' }, { ...account, ownerId: 'other' }, { ...account, origin: 'https://other.test' }] satisfies WorkspaceScope[]) {
   const other = new LocalNotificationHistory(db, scope, lease);
   assert.equal((await other.list({ history: true })).total, 0);
   await assert.rejects(other.list({ history: true, cursor: first.nextCursor }), /filters or workspace/);
  }
  assert.equal((await history.list({ history: true, q: 'Message 2' })).total, 1);
  assert.equal((await history.list({ history: true, category: 'social' })).total, 0);
  assert.equal((await history.list({ history: true, unread: true })).total, 0);
  assert.equal((await history.list({ history: true, since: '2026-10-18' })).total, 0);
 } finally { await db.close(); }
});

test('workspace retirement aborts writes before persistence', async () => {
 const { db } = fixture(); let valid = true;
 const history = new LocalNotificationHistory(db, anonymous, { ...lease, assertCurrent() { if (!valid) throw new Error('retired'); } });
 try {
  const saving = history.save(body('local-workspace')); valid = false;
  await assert.rejects(saving, /retired/);
  assert.equal((await new LocalNotificationHistory(db, anonymous, lease).list({ history: true })).total, 0);
 } finally { await db.close(); }
});


test('redaction expansion remains inside canonical server field and byte limits', async () => {
 const { db } = fixture(); const history = new LocalNotificationHistory(db, account, lease);
 try {
  const input = { ...body(), title: 'ghp_x '.repeat(60), description: 'ghp_x '.repeat(7500) };
  const id = await history.save(input);
  assert.equal(await history.save(input), id);
  let sent = false;
  await history.sync(async message => {
   sent = true;
   assert.ok(validateNotificationMessage(account.ownerId, message));
   assert.ok(message.title.length <= 400); assert.ok(message.description.length <= 48000);
   assert.ok(new TextEncoder().encode(JSON.stringify(message)).byteLength <= 60000);
   assert.doesNotMatch(JSON.stringify(message), /ghp_x/);
   assert.match(message.title, /truncated/); assert.match(message.description, /truncated/);
   return idOf(message);
  });
  assert.equal(sent, true); assert.equal((await history.list({ history: true })).pendingCount, 0);
 } finally { await db.close(); }
});
