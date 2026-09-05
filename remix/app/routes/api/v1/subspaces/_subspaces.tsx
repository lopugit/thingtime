import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { createSubspace, listSubspaces } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/subspaces?q=&mine=&cursor=&limit= — the subspace directory
// (public, newest first, with the caller's membership state on each row);
// `mine=1` narrows to the caller's own memberships.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  const result = await listSubspaces(viewerOf(user), {
    q: params.get('q'),
    mine: params.get('mine'),
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/subspaces — { slug, name, description?, access?, nsfw?, rules?,
// flairs?, branding? } — found a subspace; the caller becomes its owner and
// first member.
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
  const result = await createSubspace(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result, { status: 201 });
};
