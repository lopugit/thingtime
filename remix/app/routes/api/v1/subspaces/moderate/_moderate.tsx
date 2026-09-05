import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { moderatePost } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// POST /api/v1/subspaces/moderate — { id (post), action, reason?, value?,
// flairId? } — moderator actions on a post in the subspace: remove, approve,
// pin/unpin, lock/unlock, nsfw, spoiler, flair. Writes the server-owned
// subspaceMod state and a mod-log entry; returns the re-projected post.
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
  const result = await moderatePost(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
