import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApnsPayload, notificationURL } from './apns';
import { normalizePushDeviceInput, pushDeviceUpsert } from './pushDevices';

test('normalizes variable-length APNs tokens without hardcoding 32 bytes', () => {
  const result = normalizePushDeviceInput({ token: `<${'AB'.repeat(40)}>`, platform: 'watchos', environment: 'sandbox' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.token, 'ab'.repeat(40));
    assert.equal(result.topic, 'com.thingtime.appletime.watchkitapp');
    assert.equal(result.key.length, 64);
  }
});

test('rejects malformed tokens, platforms, and environments', () => {
  assert.equal(normalizePushDeviceInput({ token: 'not-hex', platform: 'watchos', environment: 'sandbox' }).ok, false);
  assert.equal(normalizePushDeviceInput({ token: 'ab'.repeat(32), platform: 'android', environment: 'sandbox' }).ok, false);
  assert.equal(normalizePushDeviceInput({ token: 'ab'.repeat(32), platform: 'ios', environment: 'preview' }).ok, false);
});

test('re-registering rebinds the device to the current owner and session', () => {
  const device = normalizePushDeviceInput({ token: 'ab'.repeat(32), platform: 'ios', environment: 'production' });
  assert.equal(device.ok, true);
  if (!device.ok) return;

  const now = new Date('2026-09-03T00:00:00.000Z');
  const update = pushDeviceUpsert('user-2', 'session-jti-2', device, now);

  // One physical device is one row (uniqueKeys is token-scoped), so the row a
  // second login matches is the FIRST login's row. Both identity fields must
  // ride $set: listPushDevicesForUser drops any device whose targetId session
  // is not live and owned by ownerId, so leaving either frozen at insert makes
  // push permanently undeliverable after logout/login or an account switch.
  assert.equal(update.$set.targetId, 'session-jti-2');
  assert.equal(update.$set.ownerId, 'user-2');
  assert.ok(!('targetId' in update.$setOnInsert), 'targetId must not be pinned at insert');
  assert.ok(!('ownerId' in update.$setOnInsert), 'ownerId must not be pinned at insert');

  // Insert-only fields stay insert-only: rewriting them would rotate the
  // public id and creation time of a device that never actually changed.
  assert.equal(update.$setOnInsert.createdAt, now);
  assert.equal(typeof update.$setOnInsert.shareId, 'string');
  assert.ok(!('shareId' in update.$set), 'shareId must be stable across re-registration');
});

test('builds portable APNs content with a safe Thingtime deep link', () => {
  const input = {
    notificationId: 'notification-1',
    recipientId: 'recipient-1',
    type: 'comment' as const,
    actor: { id: 'actor-1', username: 'lopu', displayName: 'Lopu' },
    targetId: 'comment-1',
    postId: 'post/1',
    preview: 'Hello from Thingtime'
  };
  const payload = buildApnsPayload(input);
  assert.equal(payload.aps.alert.title, 'Lopu commented on your post');
  assert.equal(payload.aps.alert.body, 'Hello from Thingtime');
  assert.equal(payload.url, '/post/post%2F1');
  assert.equal(notificationURL(input), payload.url);
});

test('clamps a long preview so APNs cannot reject the push as too large', () => {
  // emitNotification hands every channel the RAW input, and a comment preview
  // is post text bounded only by MAX_TEXT_CHARS = 5000 — past the 4 KB APNs
  // ceiling. A 413/PayloadTooLarge is not one of the reasons sendNotificationPush
  // acts on, so an unclamped body dropped the push silently.
  const payload = buildApnsPayload({
    notificationId: 'notification-1',
    recipientId: 'recipient-1',
    type: 'comment' as const,
    actor: { id: 'actor-1', username: 'lopu', displayName: 'Lopu' },
    targetId: 'comment-1',
    postId: 'post-1',
    preview: 'a'.repeat(5000)
  });
  assert.ok(payload.aps.alert.body!.length < 5000, 'preview must be clamped, not passed through');
  assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 4096, 'APNs alert payloads must stay under 4 KB');
});

test('recording reminders carry their bounded title and safe recording deep link', () => {
  const input = {
    notificationId: 'reminder-1', recipientId: 'owner', type: 'recording-reminder' as const,
    actor: { id: 'system', displayName: 'Thingtime' }, targetId: 'todo-1',
    title: 'A little reminder from Lopu', preview: 'Buy bike tubes', href: '/lopu/recordings'
  };
  const payload = buildApnsPayload(input);
  assert.equal(payload.aps.alert.title, input.title);
  assert.equal(payload.aps.alert.body, input.preview);
  assert.equal(payload.url, input.href);
  for (const href of ['https://evil.invalid', '//evil.invalid', '/bad\npath']) {
    assert.equal(notificationURL({ ...input, href }), '/lopu/recordings');
  }
  const long = buildApnsPayload({ ...input, title: '🦄'.repeat(5000), preview: '🦄'.repeat(5000) });
  assert.ok(Buffer.byteLength(JSON.stringify(long), 'utf8') < 4096);
});
