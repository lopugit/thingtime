import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { updateSubspace } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// POST /api/v1/subspaces/update — { id|slug, name?, description?, rules?,
// flairs?, branding?, access?, nsfw? } — moderators edit branding/rules/
// flairs; only the owner changes access (public/restricted/private) and the
// 18+ flag. Every change lands in the mod log.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'subspaces.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 64 * 1024);
  const result = await updateSubspace(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
