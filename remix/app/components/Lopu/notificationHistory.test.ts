import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { saveLopuHistory } from './notificationHistory.client';
import { rootIdentity } from '../../utils/rootIdentity';
import { bindLocalWorkspace, workspaceDatabase } from '../../local-workspace/runtime.client';
import { deviceNotificationHistory, notificationMessageTransport } from '../../local-workspace/notifications.client';
const account = { kind: 'account', origin: 'https://notifications.example.test', ownerId: 'alice', dataPlane: 'home' } as const;

test('Lopu saves anonymous/offline messages without network, bounds UTF8, and rejects stale callers', async () => {
 const keys = ['window','indexedDB','IDBKeyRange','navigator'] as const;
 const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
 const previousFetch = globalThis.fetch; const events: string[] = [];
 const bind = (anonymous: boolean) => { rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(anonymous, rootIdentity.read().generation, anonymous ? undefined : account, false); };
 try {
  const window = Object.assign(new EventTarget(), { location: { origin: account.origin } });
  window.addEventListener('thingtime:notification-recorded', () => events.push('saved'));
  window.addEventListener('thingtime:notification-save-failed', () => events.push('failed'));
  for (const [key,value] of Object.entries({ window, indexedDB: new IDBFactory(), IDBKeyRange, navigator: { onLine: false } })) Object.defineProperty(globalThis, key, { configurable: true, value });
  globalThis.fetch = async () => { assert.fail('Local saving must not fetch'); };
  bind(true); await saveLopuHistory(undefined, { title: 'Anonymous message' });
  assert.equal((await deviceNotificationHistory({ kind: 'anonymous' }).list({ history: true })).total, 1);
  bind(false); await saveLopuHistory('alice', { title: 'Offline message' });
  for (const description of ['🥰'.repeat(24000), '\u0001'.repeat(48000)]) await saveLopuHistory('alice', { title: 'Long message', description });
  await saveLopuHistory('bob', { title: 'Stale caller' });
  const page = await deviceNotificationHistory(account).list({ history: true });
  assert.equal(page.total, 3); assert.equal(page.pendingCount, 3);
  assert.equal(page.notifications.filter(row => row.title === 'Long message').length, 2);
  for (const row of page.notifications.filter(row => row.title === 'Long message')) assert.match(row.detail!, /truncated/);
  assert.deepEqual(events, ['saved','saved','saved','saved']);
  await assert.rejects(notificationMessageTransport(account)({ userId: 'alice', eventId: crypto.randomUUID(), title: 'No authority', description: '', status: 'info' }), /confirm your account/);
  bind(true); assert.equal((await deviceNotificationHistory({ kind: 'anonymous' }).list({ history: true })).total, 1);
  assert.deepEqual(events, ['saved','saved','saved','saved']);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close(); globalThis.fetch = previousFetch;
  for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
 }
});

test('history transport requires live confirmation and retires acknowledgements after an account switch', async () => {
 const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), priorFetch = globalThis.fetch;
 const requests: any[] = [];
 const bind = () => { rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, account, true); };
 try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { location: { origin: account.origin } }) });
  const input = { userId: account.ownerId, eventId: crypto.randomUUID(), title: 'Saved fixture', description: '', status: 'success' as const };
  let switchBeforeResponse = false, responseStatus = 200;
  globalThis.fetch = async (url, init) => {
   if (String(url).includes('.well-known')) return Response.json({ schemaVersion: 1, origin: account.origin, features: { 'api.notifications-record': { version: '1.0.0' } } });
   requests.push({ body: JSON.parse(String(init?.body)), credentials: init?.credentials, redirect: init?.redirect, signal: init?.signal });
   if (switchBeforeResponse) { rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(true, rootIdentity.read().generation); }
   return Response.json({ ok: true, id: 'acknowledged' }, { status: responseStatus });
  };
  bind(); assert.equal(await notificationMessageTransport(account)(input), 'acknowledged');
  assert.equal(requests[0].credentials, 'same-origin'); assert.equal(requests[0].redirect, 'error'); assert.deepEqual(requests[0].body, input);
  switchBeforeResponse = true;
  await assert.rejects(notificationMessageTransport(account)(input), /workspace changed/i);
  assert.equal(requests[1].signal.aborted, true);
  await assert.rejects(notificationMessageTransport(account)(input), /workspace changed/i); assert.equal(requests.length, 2);
  bind(); switchBeforeResponse = false; responseStatus = 401;
  await assert.rejects(notificationMessageTransport(account)(input), /Confirm your account/);
  assert.equal(rootIdentity.read().pending, true);
 } finally { rootIdentity.changed(); globalThis.fetch = priorFetch; if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window'); }
});
