import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listModlog } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/subspaces/modlog?slug=&cursor=&limit= — the subspace's
// moderation log, newest first (moderators only).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const result = await listModlog(viewerOf(user), {
    id: params.get('id'),
    slug: params.get('slug'),
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
