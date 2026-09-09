import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const stored = new Map<string, any>();
let prefs: any = { masters: { push: false, email: false } };
let prefsFailure = false;
let pushes = 0;
let emails = 0;
const collection = {
  insertOne: async (doc: any) => { stored.set(doc.shareId, doc); },
  insertMany: async (docs: any[]) => { docs.forEach(doc => stored.set(doc.shareId, doc)); },
  updateOne: async (_filter: any, update: any) => {
    const doc = update.$setOnInsert;
    if (!stored.has(doc.shareId)) stored.set(doc.shareId, doc);
  },
  find: () => ({ project: () => ({ toArray: async () => [{ ownerId: 'recipient', crystal: { type: 'friend-request' } }] }) })
};
mock.module('../mongodb/collections.ts', { namedExports: { getHomeThingsCollection: async () => collection, getUsersCollection: async () => collection } });
mock.module('../auth/users.ts', { namedExports: { getUserNotificationPrefs: async () => { if (prefsFailure) throw new Error('settings unavailable'); return prefs; } } });
mock.module('./emails.ts', { namedExports: { maybeEmailNotification: async () => { emails++; }, emailNotificationsBulk: async () => { emails++; } } });
mock.module('./apns.ts', { namedExports: { sendNotificationPush: async () => { pushes++; } } });

const { emitNotification, emitSystemNotification, emitNotificationsBulk } = await import('./notifications.ts');
const { recordNotificationMessage } = await import('./recordMessage.ts');

beforeEach(() => { stored.clear(); pushes = 0; emails = 0; prefsFailure = false; prefs = { masters: { push: false, email: false } }; });

test('single-recipient history is saved even with all delivery disabled or preferences unavailable', async () => {
  const event = { recipientId: 'recipient', type: 'comment' as const, actor: { id: 'actor' } };
  await emitNotification(event);
  assert.equal(stored.size, 1);
  assert.equal(pushes, 0);
  prefsFailure = true;
  await emitNotification(event);
  assert.equal(stored.size, 2);
});

test('quiet system events are saved but do not invoke delivery or preferences', async () => {
  prefsFailure = true;
  await emitSystemNotification({ recipientId: 'recipient', type: 'action-run', title: 'Finished', historyOnly: true });
  assert.equal(stored.size, 1);
  assert.equal([...stored.values()][0].historyOnly, true);
  assert.equal(pushes, 0);
  assert.equal(emails, 0);
});

test('deduplicating bulk delivery never discards repeated events from history', async () => {
  await emitNotificationsBulk([{ recipientId: 'recipient', type: 'friend-request' }], { actor: { id: 'actor' } }, { dedupeUnread: true });
  assert.equal(stored.size, 1);
  assert.equal([...stored.values()][0].historyOnly, true);
});

test('record retries do not overwrite text, ownership or read state', async () => {
  const event = { userId: 'recipient', eventId: 'bb617572-ff32-4c98-b3e4-d668ac000fac', title: 'Saved', status: 'success' };
  const first = await recordNotificationMessage('recipient', event);
  assert.equal(first.ok, true);
  const doc = [...stored.values()][0];
  const readAt = doc.readAt;
  await recordNotificationMessage('recipient', { ...event, title: 'Replacement attempt' });
  assert.equal(stored.size, 1);
  assert.equal(doc.crystal.title, 'Saved');
  assert.equal(doc.readAt, readAt);
  assert.equal(doc.historyOnly, true);
  assert.equal((await recordNotificationMessage('different-user', event)).ok, false);
});
