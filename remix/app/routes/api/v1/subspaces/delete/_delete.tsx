import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { deleteSubspace } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// POST /api/v1/subspaces/delete — { id|slug, confirmSlug } — the owner deletes
// the subspace after retyping its slug. Posts survive as plain posts (subspace
// pointer, flair, moderation state and private fence stripped); members,
// mod-log and report rows are removed; former moderators are notified.
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
  const result = await deleteSubspace(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
