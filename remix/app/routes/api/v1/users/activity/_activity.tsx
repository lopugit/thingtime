import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getUserActivity } from '~/api/utils/things/things';

// GET /api/v1/users/activity?username= — day-bucketed counts of a user's
// viewer-visible things over the last year (the profile contribution
// heatmap). Counts only — no content, no kind breakdown. Works logged out
// (public things only); friends additionally see friends-circle activity;
// owners always see all of their own.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'users.activity', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re very curious — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const params = new URL(request.url).searchParams;
  const result = await getUserActivity(
    user ? { id: user.id, username: user.username } : null,
    params.get('username') || ''
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, days: result.days, total: result.total, firstDayUtc: result.firstDayUtc });
};
