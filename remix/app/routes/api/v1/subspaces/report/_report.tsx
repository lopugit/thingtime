import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { reportPost } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// POST /api/v1/subspaces/report — { id (post or comment), reason, note? } —
// a logged-in viewer who can see the target (and is not banned in its
// subspace) flags it to the subspace's moderators. A comment resolves to its
// root post. One report per (post, reporter): a repeat updates the reason /
// note (200, updated: true). The mods are notified (subspace-report).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'subspaces.report', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await reportPost(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
