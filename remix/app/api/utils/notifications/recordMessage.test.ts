import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNotificationMessage } from './recordMessage';
import { notificationDoc, safeInternalHref, SYSTEM_NOTIFICATION_ACTOR } from './notifications';

const message = { userId: 'alice', eventId: 'bb617572-ff32-4c98-b3e4-d668ac000fac', title: 'Saved successfully', status: 'success', description: 'Your work is saved.' };

test('record retries have one identity per account; repeated real events are distinct', () => {
  const first = parseNotificationMessage('alice', message)!;
  assert.equal(first.id, parseNotificationMessage('alice', { ...message })?.id);
  assert.notEqual(first.id, parseNotificationMessage('alice', { ...message, eventId: 'bb617572-ff32-4c98-b3e4-d668ac000fad' })?.id);
  assert.notEqual(first.id, parseNotificationMessage('bob', { ...message, userId: 'bob' })?.id);
});

test('client history cannot forge audit types, recipient, actor, dates or read state', () => {
  for (const extra of [{ type: 'login-success' }, { ownerId: 'bob' }, { actorId: 'bob' }, { createdAt: new Date() }, { readAt: null }]) {
    assert.equal(parseNotificationMessage('alice', { ...message, ...extra }), null);
  }
  assert.equal(parseNotificationMessage('bob', message), null);
  for (const extra of [{ title: '' }, { title: 'a'.repeat(401) }, { description: 'a'.repeat(48001) }, { eventId: '../x' }, { href: {} }, { status: 'unknown' }]) {
    assert.equal(parseNotificationMessage('alice', { ...message, ...extra }), null);
  }
});

test('message text is retained beyond the preview and credentials do not enter stored history', () => {
  const parsed = parseNotificationMessage('alice', { ...message, description: 'x'.repeat(2000), href: '/settings?token=secret#secret' })!;
  assert.equal(parsed.description.length, 2000);
  assert.equal(parsed.href, '/settings');
  const doc = notificationDoc({ recipientId: 'alice', actor: SYSTEM_NOTIFICATION_ACTOR, type: 'system-message', title: parsed.title, preview: parsed.description, detail: parsed.description }, new Date());
  assert.equal(doc.crystal.detail?.length, 2000);
  assert.equal(doc.crystal.preview?.length, 140);
  assert.deepEqual(doc.acl, ['tt:user']);
  const redacted = parseNotificationMessage('alice', { ...message, description: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 password=verysecret' })!;
  assert.ok(!redacted.description.includes('verysecret'));
  assert.ok(!redacted.description.includes('abcdefghijklmnopqrstuvwxyz123456'));
  for (const href of ['//evil.example', '/\\evil.example', 'https://evil.example']) assert.equal(safeInternalHref(href), null);
});
