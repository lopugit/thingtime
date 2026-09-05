import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { joinSubspace } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// POST /api/v1/subspaces/join — { id | slug } — become a member. Public and
// restricted subspaces accept anyone who isn't banned; private ones need a
// moderator to add you (403). Joining twice is a friendly no-op.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'subspaces.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await joinSubspace(viewerOf(user), { id: body?.id, slug: body?.slug });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
