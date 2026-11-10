import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { relationshipSummary, resolveSocialTarget } from '~/api/utils/users/social';

// GET /api/v1/users/relationships?username=|userId= — public follower /
// following / friend counts for a profile, plus (when logged in) the viewer's
// relationship to that user (following, followedBy, friendState — and, on
// your own profile, the pending incoming request count). Works logged out.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'users.relationships', user ? `user:${user.id}` : null);
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
  const result = await relationshipSummary(user?.id || null, target);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, userId: result.userId, counts: result.counts, viewer: result.viewer });
};
