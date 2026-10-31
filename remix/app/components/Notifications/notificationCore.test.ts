import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES } from '~/schemas/registry';
import {
  DEFAULT_NOTIFICATION_FILTERS,
  NOTIFICATION_TYPES_BY_CATEGORY,
  NOTIFICATION_TYPE_META,
  hasActiveNotificationFilters,
  isSystemNotification,
  notificationCategory,
  notificationEmoji,
  notificationFiltersToParams,
  notificationFiltersToQuery,
  notificationHeadline,
  notificationHref,
  parseNotificationFilters,
  withNotificationCategory,
  withNotificationType,
  type NotificationItem
} from './notificationCore';

const row = (patch: Partial<NotificationItem>): NotificationItem => ({
  id: 'n1',
  type: 'comment',
  actorId: 'u2',
  actorUsername: 'rick',
  actorName: 'Rick Deckard',
  actorAvatarUrl: null,
  targetId: null,
  postId: null,
  preview: null,
  readAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...patch
});

test('every notification type has bell copy and lands in exactly one category bucket', () => {
  for (const type of NOTIFICATION_TYPES) {
    const meta = NOTIFICATION_TYPE_META[type];
    assert.ok(meta?.emoji && meta.label.trim() && meta.hint.trim(), `${type} needs emoji, label and hint`);
    assert.equal(notificationEmoji(type), meta.emoji);
  }
  assert.equal(notificationEmoji('mystery'), '✨');
  const bucketed = NOTIFICATION_CATEGORIES.flatMap((category) => NOTIFICATION_TYPES_BY_CATEGORY[category]).sort();
  assert.deepEqual(bucketed, [...NOTIFICATION_TYPES].sort());
});

test('people rows read actor + verb, system notes read their headline as Lopu', () => {
  assert.deepEqual(notificationHeadline(row({ type: 'reaction', preview: '🔥' })), { actor: 'Rick Deckard', text: 'reacted 🔥' });
  assert.deepEqual(notificationHeadline(row({ actorName: null, actorUsername: null })), { actor: 'Someone', text: 'commented on your post' });

  const system = row({ type: 'action-run', category: 'system', actorId: 'thingtime', actorName: 'Lopu', title: 'Action “Digest” finished ✅' });
  assert.equal(isSystemNotification(system), true);
  assert.deepEqual(notificationHeadline(system), { actor: null, text: 'Action “Digest” finished ✅' });
  // an older cached row without the server-stamped category still classifies
  assert.equal(notificationCategory(row({ type: 'action-run' })), 'system');
  assert.deepEqual(notificationHeadline(row({ type: 'action-run', title: null })), { actor: null, text: 'Lopu ran an action' });
});

test('click-through prefers the note path, then the post, then the actor, and never an external href', () => {
  assert.equal(notificationHref(row({ href: '/actions/digest', postId: 'p1' })), '/actions/digest');
  assert.equal(notificationHref(row({ postId: 'p 1' })), '/post/p%201');
  assert.equal(notificationHref(row({})), '/profile/rick');
  assert.equal(notificationHref(row({ actorUsername: null })), null);
  assert.equal(notificationHref(row({ href: '//evil.example', actorUsername: null })), null);
  assert.equal(notificationHref(row({ href: 'https://evil.example', actorUsername: null })), null);
});

test('filters round-trip through the URL and drop junk', () => {
  assert.deepEqual(parseNotificationFilters(new URLSearchParams()), DEFAULT_NOTIFICATION_FILTERS);
  assert.equal(hasActiveNotificationFilters(DEFAULT_NOTIFICATION_FILTERS), false);

  const params = new URLSearchParams('category=engagement&type=comment&unread=1&q=+rick++deckard+&since=2026-08-01&until=2026-13-40');
  const filters = parseNotificationFilters(params);
  assert.deepEqual(filters, { category: 'engagement', type: 'comment', unread: true, q: 'rick deckard', since: '2026-08-01', until: '' });
  assert.equal(hasActiveNotificationFilters(filters), true);
  assert.equal(notificationFiltersToParams(filters).toString(), 'category=engagement&type=comment&unread=1&q=rick+deckard&since=2026-08-01');

  const junk = parseNotificationFilters(new URLSearchParams('category=nope&type=NOPE&unread=yes&since=yesterday'));
  assert.deepEqual(junk, DEFAULT_NOTIFICATION_FILTERS);
});

test('the API query maps days to inclusive local bounds and a type to the types csv', () => {
  const query = notificationFiltersToQuery({ ...DEFAULT_NOTIFICATION_FILTERS, type: 'mention', unread: true, q: 'hey', since: '2026-08-01', until: '2026-08-01' });
  assert.equal(query.types, 'mention');
  assert.equal(query.unread, '1');
  assert.equal(query.q, 'hey');
  assert.equal('category' in query, false);
  assert.match(query.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(query.until) - Date.parse(query.since) === 24 * 60 * 60 * 1000 - 1, 'until closes the same local day');
  assert.deepEqual(notificationFiltersToQuery({ ...DEFAULT_NOTIFICATION_FILTERS, category: 'system' }), { category: 'system' });
});

test('category chips and the type dropdown never contradict each other', () => {
  const typed = withNotificationType(DEFAULT_NOTIFICATION_FILTERS, 'action-run');
  assert.equal(typed.category, 'system');
  assert.equal(withNotificationType(typed, 'all').category, 'system');
  // a chip that cannot hold the current type drops the type
  assert.deepEqual(withNotificationCategory(typed, 'social'), { ...DEFAULT_NOTIFICATION_FILTERS, category: 'social', type: 'all' });
  // a chip that does keeps it
  assert.equal(withNotificationCategory(typed, 'system').type, 'action-run');
  assert.equal(withNotificationCategory(typed, 'all').type, 'action-run');
});
