import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listConnections, resolveSocialTarget } from '~/api/utils/users/social';

// GET /api/v1/users/connections?username=|userId=&type=&limit=&before= —
// public profile lists: type followers | following | friends (public, like
// the counts) or requests (pending incoming friend requests — only your own).
// Cursor pagination via `before` (createdAt ISO of the last row).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'users.connections', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re very curious — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const params = new URL(request.url).searchParams;
  const target = await resolveSocialTarget({
    userId: params.get('userId') || undefined,
    username: params.get('username') || undefined
  });
  const result = await listConnections(user?.id || null, target, params.get('type'), {
    limit: params.get('limit') || undefined,
    before: params.get('before') || undefined
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, users: result.users, nextBefore: result.nextBefore });
};
