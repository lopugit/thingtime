import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { searchUsersPublic } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/users/search?q=&limit= — public people search (the People rail
// on /search). Public profile projections only; works logged out.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'users.search', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re searching very enthusiastically — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim();
  if (!q) {
    return json({ ok: true, users: [] });
  }

  const users = await searchUsersPublic(q, Number(params.get('limit')) || undefined);
  return json({ ok: true, users });
};
