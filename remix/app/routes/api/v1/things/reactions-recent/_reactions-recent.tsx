import { json } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { getUserRecentReactions } from '~/api/utils/auth/users';

// GET /api/v1/things/reactions-recent — the caller's full recently-used emoji
// list (most-recent-first). The custom-emoji picker loads this lazily when it
// opens and pages through it 20 at a time; anonymous callers get an empty list.
export const loader = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.read');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  const recentReactions = user ? await getUserRecentReactions(user.id) : [];
  return json({ ok: true, recentReactions });
};
