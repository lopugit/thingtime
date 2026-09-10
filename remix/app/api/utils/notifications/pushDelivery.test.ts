import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPushSender } from './apns';
import { pushDeliveryMessage } from './pushDeliveryCore';
import type { PushDevice } from './pushDevices';
const notification = { recipientId: 'owner', type: 'comment' as const, actor: { id: 'actor' }, notificationId: 'notice' };
const device = (id: string, platform: 'ios' | 'watchos' = 'ios'): PushDevice => ({ id, platform, ownerId: 'owner', token: 'private-token', environment: 'production', topic: 'com.example', updatedAt: new Date() });
const dependencies = () => ({ token: () => 'private-jwt' as string | null, devices: async (_owner: string) => [device('phone')], send: async () => ({ status: 200, reason: null as string | null }), remove: async (_id: string) => {} });
test('push diagnostics distinguish missing configuration, no devices and Apple acceptance', async () => {
  const deps = dependencies(); deps.token = () => null;
  assert.equal((await createPushSender(deps)(notification)).status, 'unconfigured');
  deps.token = () => 'jwt'; deps.devices = async owner => { assert.equal(owner, 'owner'); return []; };
  assert.equal((await createPushSender(deps)(notification)).status, 'no-devices');
  deps.devices = async () => [device('phone'), device('watch', 'watchos')];
  const report = await createPushSender(deps)(notification);
  assert.equal(report.status, 'accepted'); assert.equal(report.accepted, 2); assert.equal(report.ios, 1); assert.equal(report.watchos, 1);
  assert.match(pushDeliveryMessage(report), /Apple/);
  assert.doesNotMatch(JSON.stringify(report), /private|token|jwt/);
});
test('partial rejection retires stale tokens and sanitizes provider failures', async () => {
  const deps = dependencies(); let calls = 0; const removed: string[] = [];
  deps.devices = async () => [device('stale'), device('good'), device('bad')];
  deps.send = async () => ++calls === 1 ? { status: 410, reason: 'Unregistered' } : calls === 2 ? { status: 200, reason: null } : { status: 403, reason: 'private provider response!'};
  deps.remove = async id => { removed.push(id); };
  const report = await createPushSender(deps)(notification);
  assert.equal(report.status, 'partial'); assert.equal(report.rejected, 2); assert.deepEqual(removed, ['stale']);
  assert.deepEqual(report.reasons, ['Unregistered', 'ProviderRejected']);
});
test('transport failures settle as failures and concurrency is capped at four', async () => {
  const deps = dependencies(); let active = 0, peak = 0;
  deps.devices = async () => Array.from({length: 12}, (_, i) => device(String(i)));
  deps.send = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; throw new Error('private endpoint'); };
  const report = await createPushSender(deps)(notification);
  assert.equal(peak, 4); assert.equal(report.status, 'failed'); assert.equal(report.rejected, 12); assert.deepEqual(report.reasons, ['TransportError']);
});
