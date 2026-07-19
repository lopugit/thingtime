import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { toggleSave } from '~/api/utils/things/things';

// POST /api/v1/things/save — { id } — toggle the caller's private library save
// of a thing ("add to my library"). Saves are relational child things
// (thingtime ['save'], acl ['tt:user']) so a library is personal by
// construction. Rate-limited per user (admin-configurable).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.save', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re saving very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await toggleSave({ id: user.id, username: user.username }, body?.id);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, saved: result.saved });
};
