import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listAppDataSummaries } from '~/api/utils/apps/browse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/apps/data-summary — every app namespace holding data for the
// signed-in user: appId, name (null when the app was deleted — the data
// persists and stays deletable), entry count, stored bytes vs budget, last
// activity. Session auth only; enumerated from things (never from grants, so
// orphaned data can't hide).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const limit = await enforceRateLimit(request, 'oauth.grants', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Reading too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  return json({ ok: true, apps: await listAppDataSummaries(user.id) });
};
