import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listMembers, mutateMember } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/subspaces/members?slug=&role=&banned=&cursor=&limit= — the
// moderator roster is public (role=owner|moderator); the full member list
// and the ban list (banned=1) are moderator-only.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  const result = await listMembers(viewerOf(user), {
    id: params.get('id'),
    slug: params.get('slug'),
    role: params.get('role'),
    banned: params.get('banned'),
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/subspaces/members — { id|slug, userId|username, action, role?,
// reason?, banDays? } — moderator actions on one member: add (private
// subspaces), remove (kick), approve/unapprove (restricted posting), ban/unban
// (optionally temporary), role (owner only: moderator|member).
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
  const result = await mutateMember(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
