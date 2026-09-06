import assert from 'node:assert/strict';
import test from 'node:test';

import { notificationListResponse } from './_notifications';

test('notification pages identify the authenticated account without exposing private fields', () => {
  const body = notificationListResponse('lopu', {
    notifications: [{ id: 'notification-1' }],
    unreadCount: 1,
    nextBefore: null,
    nextCursor: 'older-page'
  });

  assert.deepEqual(body.viewer, { username: 'lopu' });
  assert.equal(body.notifications[0]?.id, 'notification-1');
  assert.equal(body.unreadCount, 1);
  assert.equal('email' in body.viewer, false);
});
