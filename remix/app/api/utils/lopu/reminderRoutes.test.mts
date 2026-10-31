import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let user: any, allowed: boolean, calls: any[];
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../rateLimit/subscription.ts', import.meta.url).href, { namedExports: { enforceSubscriptionRateLimit: async () => ({ allowed }) } });
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: { runWithMongoEndpoint: async (_: unknown, fn: any) => fn() } });
mock.module(new URL('./reminders.ts', import.meta.url).href, { namedExports: {
  getLopuScheduledTask: async (owner: string, thingId: string) => { calls.push({ owner, thingId }); return { ok: true, reminder: { thingId }, runs: [], relatedThings: [] }; },
  createLopuReminder: async (owner: string, input: any) => { calls.push({ owner, input }); return { ok: true, reminder: { id: 'saved' } }; },
  listLopuReminders: async (owner: string) => { calls.push({ owner }); return []; },
  setLopuReminderEnabled: async (owner: string, id: string, enabled: boolean) => { calls.push({ owner, id, enabled }); return { ok: true, reminder: { id, enabled } }; }
} });
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, { namedExports: { emitSystemNotificationOnce: async (input: any) => { calls.push(input); return true; } } });
const reminders = await import('../../../routes/api/v1/lopu/reminders/_reminders');
const notifications = await import('../../../routes/api/v1/notifications/test/_test');
const request = (body: any, origin = 'https://thingtime.test', contentType = 'application/json') => new Request('https://thingtime.test/api/test', { method: 'POST', headers: { 'Content-Type': contentType, Origin: origin }, body: JSON.stringify(body) });
beforeEach(() => { user = { id: 'owner', accountKind: 'user', temporary: false }; allowed = true; calls = []; });
test('test notifications reject guests, temporary/service accounts, cross-origin and non-JSON requests', async () => {
  for (const value of [null, { id: 'guest', accountKind: 'user', temporary: true }, { id: 'service', accountKind: 'service' }]) {
    user = value; assert.equal((await notifications.action({ request: request({}) })).status, 401);
  }
  user = { id: 'owner', accountKind: 'user' };
  assert.equal((await notifications.action({ request: request({}, 'https://other.test') })).status, 403);
  assert.equal((await notifications.action({ request: request({}, undefined, 'text/plain') })).status, 415);
  assert.equal(calls.length, 0);
});
test('notification test ignores supplied recipients and never sends email', async () => {
  const response = await notifications.action({ request: request({ recipientId: 'other', preset: 'urgent' }) });
  assert.equal(response.status, 200); assert.equal(calls[0].recipientId, 'owner'); assert.equal(calls[0].skipEmail, true);
  assert.equal(calls[0].delivery, 'urgent'); assert.equal((await response.json()).saved, true);
});
test('reminder writes and reads use only the authenticated owner', async () => {
  await reminders.action({ request: request({ op: 'set-enabled', id: 'schedule', enabled: false, ownerId: 'other' }) });
  assert.deepEqual(calls[0], { owner: 'owner', id: 'schedule', enabled: false });
  const response = await reminders.loader({ request: new Request('https://thingtime.test/api/test') });
  assert.equal((await response.json()).ownerId, 'owner');
});
test('rate limits fail closed before mutations and invalid operations are rejected', async () => {
  allowed = false;
  assert.equal((await notifications.action({ request: request({}) })).status, 429);
  assert.equal((await reminders.action({ request: request({ op: 'create' }) })).status, 429);
  allowed = true;
  assert.equal((await reminders.action({ request: request({ op: 'delete-all' }) })).status, 400);
  assert.equal(calls.length, 0);
});
