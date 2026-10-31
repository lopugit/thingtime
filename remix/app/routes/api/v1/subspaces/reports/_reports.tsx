import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listReports, mutateReports } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/subspaces/reports?slug=&status=open|resolved&cursor=&limit= —
// the moderators' Reports queue: the subspace's reports grouped by post
// (reportCount, a reasons tally, the reporters, the post re-projected for
// the mod), newest activity first. Moderator-only.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const result = await listReports(viewerOf(user), {
    id: params.get('id'),
    slug: params.get('slug'),
    status: params.get('status'),
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/subspaces/reports — { postId, action: 'dismiss', id|slug? } —
// settles every open report on the post with resolution dismissed (mod log
// report.dismiss). moderate remove / approve settle them implicitly.
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
  const result = await mutateReports(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
