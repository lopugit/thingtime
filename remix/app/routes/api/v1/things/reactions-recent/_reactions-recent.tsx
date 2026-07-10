import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getUserRecentReactions } from '~/api/utils/auth/users';

// GET /api/v1/things/reactions-recent — the caller's full recently-used emoji
// list (most-recent-first). The custom-emoji picker loads this lazily when it
// opens and pages through it 20 at a time; anonymous callers get an empty list.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const recentReactions = user ? await getUserRecentReactions(user.id) : [];
  return json({ ok: true, recentReactions });
};
