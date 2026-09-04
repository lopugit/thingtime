import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listNotifications } from '~/api/utils/notifications/notifications';

export const notificationListResponse = <Notification,>(
  username: string,
  result: {
    notifications: Notification[];
    unreadCount: number;
    nextBefore: string | null;
    nextCursor: string | null;
  }
) => ({
  ok: true as const,
  viewer: { username },
  notifications: result.notifications,
  unreadCount: result.unreadCount,
  nextBefore: result.nextBefore,
  nextCursor: result.nextCursor
});

// GET /api/v1/notifications?limit=&cursor=&from=&to= — the caller's notifications,
// newest first, filtered by their notification prefs (a disabled type is
// hidden even if it was written before the pref flip), plus the unread count
// for the bell badge. Stable cursor pagination plus an inclusive `from` and
// exclusive `to` range; legacy timestamp-only `before` remains supported.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'notifications.list', `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re checking very enthusiastically — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const params = new URL(request.url).searchParams;
  const result = await listNotifications(user.id, {
    limit: params.get('limit') || undefined,
    before: params.get('before') || undefined,
    cursor: params.get('cursor') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(notificationListResponse(user.username, result));
};
