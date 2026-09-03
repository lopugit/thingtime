import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApnsPayload, notificationURL } from './apns';
import { normalizePushDeviceInput } from './pushDevices';

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
