import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { updateCommunity } from '~/api/utils/messenger/communities';

// POST /api/v1/communities/update — { id, name?, description? } — community
// admins and the owner only.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 32 * 1024);
  const result = await updateCommunity(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
