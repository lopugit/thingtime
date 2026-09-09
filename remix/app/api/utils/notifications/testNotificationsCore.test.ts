import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationTestInput, NOTIFICATION_TESTS } from './testNotificationsCore';
import { buildApnsPayload } from './apns';
import { NOTIFICATION_TYPES } from '~/schemas/registry';
test('every preset has bounded fixed copy and every registered notification class can be tested', () => {
  for (const preset of NOTIFICATION_TESTS) for (const type of NOTIFICATION_TYPES) {
    const result = notificationTestInput({ preset: preset.id, type, title: 'ignored', recipientId: 'other', image: 'https://evil.test' });
    assert.equal(result.title, preset.title); assert.equal(result.type, type);
    assert.equal('recipientId' in result, false);
    assert.ok(!result.image || result.image === '/notification-test.svg');
  }
  assert.throws(() => notificationTestInput({ type: 'fake' }));
  assert.throws(() => notificationTestInput({ preset: 'critical' }));
});
test('APNs distinguishes quiet, normal and time-sensitive without pretending to be Critical', () => {
  for (const [preset, level] of [['quiet', 'passive'], ['normal', 'active'], ['urgent', 'time-sensitive']]) {
    const input = notificationTestInput({ preset });
    const result = buildApnsPayload({ ...input, recipientId: 'owner', notificationId: 'test', actor: { id: 'system', username: null, displayName: 'Lopu' } });
    assert.equal(result.aps['interruption-level'], level);
    assert.equal(result.aps.alert.title, input.title);
    assert.equal(result.aps.sound, preset === 'quiet' ? undefined : 'default');
    assert.equal('richText' in result.aps, false);
  }
});
