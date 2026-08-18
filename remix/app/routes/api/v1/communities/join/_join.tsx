import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { joinCommunityByCode } from '~/api/utils/messenger/communities';

// POST /api/v1/communities/join — { code } — redeem an invite code and become
// a member. Redemption is atomic (expiry, revocation and use caps enforced in
// the update filter); joining twice is a friendly no-op.
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
  const result = await joinCommunityByCode(user.id, body.code);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
