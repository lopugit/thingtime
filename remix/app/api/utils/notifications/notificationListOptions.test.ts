import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeNotificationListOptions,
  notificationCursorClauseFor,
  notificationCursorFor
} from './notifications';

test('notification history accepts a bounded date range and clamps page size', () => {
  const parsed = normalizeNotificationListOptions({
    limit: 500,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-03T00:00:00.000Z'
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.limit, 50);
    assert.equal(parsed.value.from?.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(parsed.value.to?.toISOString(), '2026-09-03T00:00:00.000Z');
  }
});

test('notification cursor round-trips timestamp and tie-breaker', () => {
  const cursor = notificationCursorFor(new Date('2026-09-02T03:04:05.000Z'), 'notification-b');
  const parsed = normalizeNotificationListOptions({ cursor, limit: 10 });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.cursor?.createdAt.toISOString(), '2026-09-02T03:04:05.000Z');
    assert.equal(parsed.value.cursor?.shareId, 'notification-b');
    assert.deepEqual(notificationCursorClauseFor(parsed.value.cursor!), {
      $or: [
        { createdAt: { $lt: new Date('2026-09-02T03:04:05.000Z') } },
        {
          createdAt: new Date('2026-09-02T03:04:05.000Z'),
          shareId: { $gt: 'notification-b' }
        }
      ]
    });
  }
});

test('notification history rejects malformed and inverted windows', () => {
  assert.deepEqual(normalizeNotificationListOptions({ cursor: 'not-a-cursor' }), {
    ok: false,
    error: 'cursor is invalid'
  });
  assert.deepEqual(
    normalizeNotificationListOptions({ from: '2026-09-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' }),
    { ok: false, error: 'from must be earlier than to' }
  );
  assert.deepEqual(normalizeNotificationListOptions({ before: '2026-09-03T00:00:00.000Z', cursor: notificationCursorFor(new Date(), 'n') }), {
    ok: false,
    error: 'Pass before or cursor, not both'
  });
});
