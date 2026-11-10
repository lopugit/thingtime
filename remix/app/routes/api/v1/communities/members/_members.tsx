import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { leaveCommunity, manageCommunityMember } from '~/api/utils/messenger/communities';

// POST /api/v1/communities/members — { communityId } plus ONE of:
// { userId, role: "admin" | "member" } (admins), { userId, remove: true }
// (admins), or { leave: true } (yourself; owners cannot leave). The owner can
// never be demoted or removed.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = body.leave === true
    ? await leaveCommunity(user.id, body.communityId)
    : await manageCommunityMember(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
