import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { friendAction, resolveSocialTarget } from '~/api/utils/users/social';

// POST /api/v1/users/friend — { userId | username, intent } — drive the
// friendship state machine: request | cancel | accept | decline | unfriend.
// Friendships need approval (unlike follows); one doc per pair, status
// pending → accepted. Emits friend-request / friend-accepted notifications.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'users.friend', `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'So much friendship, so fast — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, 16 * 1024);
  const target = await resolveSocialTarget({ userId: body?.userId, username: body?.username });
  const result = await friendAction(
    { id: user.id, username: user.username, displayName: user.displayName },
    target,
    body?.intent
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, friendState: result.friendState });
};
