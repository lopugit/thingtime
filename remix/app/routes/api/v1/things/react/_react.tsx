import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { toggleReaction } from '~/api/utils/things/things';

// POST /api/v1/things/react — { id, emoji } — set/replace the caller's
// reaction on a post; the same emoji again (or emoji: null) clears it.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await toggleReaction({ id: user.id, username: user.username }, body.id, body.emoji ?? null);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, reactionCounts: result.reactionCounts, viewerReaction: result.viewerReaction });
};
