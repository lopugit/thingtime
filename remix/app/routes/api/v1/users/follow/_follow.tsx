import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { followStatus, toggleFollow } from '~/api/utils/messenger/follows';

// GET /api/v1/users/follow?username= | ?userId= — follow relationship between
// the caller and that user (following / followsYou) plus their counts.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const result = await followStatus(user.id, {
    username: params.get('username') || undefined,
    userId: params.get('userId') || undefined
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/users/follow — { username | userId, follow: boolean } — follow
// or unfollow. Following someone routes their future DMs straight to your
// inbox instead of message requests.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'users.follow', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'That is a lot of following 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await toggleFollow(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
