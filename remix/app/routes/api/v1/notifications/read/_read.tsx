import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { markNotificationsRead } from '~/api/utils/notifications/notifications';

// POST /api/v1/notifications/read — { ids: string[] } or { all: true } —
// mark the caller's notifications read (flips root readAt; the unread badge
// recomputes from it).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'notifications.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Marking read very fast — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, 32 * 1024);
  const result = await markNotificationsRead(user.id, { ids: body?.ids, all: body?.all });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, updated: result.updated });
};
