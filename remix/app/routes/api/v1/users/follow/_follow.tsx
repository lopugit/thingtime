import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { resolveSocialTarget, setFollow } from '~/api/utils/users/social';

// POST /api/v1/users/follow — { userId | username, follow? } — follow or
// unfollow another user (one-way, no approval). Omitting `follow` toggles;
// passing it makes the call idempotent. Emits a new-follower notification.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'users.follow', `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re following very enthusiastically — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, 16 * 1024);
  const target = await resolveSocialTarget({ userId: body?.userId, username: body?.username });
  const result = await setFollow(
    { id: user.id, username: user.username, displayName: user.displayName },
    target,
    body?.follow
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, following: result.following, followerCount: result.followerCount });
};
