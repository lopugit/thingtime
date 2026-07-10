import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { toggleReaction } from '~/api/utils/things/things';

// POST /api/v1/things/react — { id, emoji } — toggle the caller's reaction on a
// post. `emoji` may be any single emoji or a multi-emoji group (one token);
// clicking a token you already have removes it, a new one is added (you can
// hold several at once). Adding a token also records it in your recents.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await toggleReaction(user.id, body.id, body.emoji ?? null);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({
    ok: true,
    reactionCounts: result.reactionCounts,
    viewerReactions: result.viewerReactions,
    recentReactions: result.recentReactions
  });
};
