import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { unlinkConnection } from '~/api/utils/connections/connections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/connections/unlink — remove one of the caller's third-party
// connections: { id: <connection id> }. The shared external account retires
// with its last link; synced posts (and any Thingtime comments on them) stay.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'connections.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Unlinking very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 4 * 1024);
  const result = await unlinkConnection(user, { id: body?.id });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, removed: result.removed });
};
