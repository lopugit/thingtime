import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listGrants } from '~/api/utils/apps/grants';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/oauth/grants — the apps connected to YOUR account via "Login
// with Thingtime": app name, scopes you granted, session count, expiry.
// Session auth (your own account — app tokens are rejected). Rate-limited
// because each call aggregates over the user's live app sessions.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'oauth.grants', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Reading too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  return json({ ok: true, grants: await listGrants(user.id) });
};
