import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getSubspace } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/subspaces/get?slug=<slug> (or ?id=) — one subspace with its
// counts, the moderator roster, and the caller's membership/permissions.
// Works logged out (private subspaces still describe themselves; their
// posts are members-only through the feed).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  const result = await getSubspace(viewerOf(user), { id: params.get('id'), slug: params.get('slug') });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
