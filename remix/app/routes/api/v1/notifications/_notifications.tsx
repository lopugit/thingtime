import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listNotifications } from '~/api/utils/notifications/notifications';

// GET /api/v1/notifications?limit=&before=&category=&types=&unread=&q=&since=
// &until=&withTotal= — the caller's notifications, newest first, filtered by
// their notification prefs (a disabled type is hidden even if it was written
// before the pref flip), plus the unread count for the bell badge. The
// optional filters back the /notifications history page: category (social /
// engagement / feed / system) or a csv of types, unread=1, free-text q over
// preview + actor + system title, an inclusive since/until window, and
// withTotal=1 to also count everything that matches. Cursor pagination via
// `before` (createdAt ISO).
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
  const param = (name: string) => params.get(name) || undefined;
  const result = await listNotifications(user.id, {
    limit: param('limit'),
    before: param('before'),
    category: param('category'),
    types: param('types'),
    unread: param('unread'),
    q: param('q'),
    since: param('since'),
    until: param('until'),
    withTotal: param('withTotal')
  });
  return json({
    ok: true,
    notifications: result.notifications,
    unreadCount: result.unreadCount,
    ...(result.total === null ? {} : { total: result.total }),
    nextBefore: result.nextBefore
  });
};
