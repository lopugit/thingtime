import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteApp } from '~/api/utils/apps/apps';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/apps/delete — { clientId } — delete one of your embed apps.
// Revokes every app-scoped session minted for it; end users keep their
// app-data things (that data is theirs, not the developer's).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'apps.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many app changes — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 4 * 1024);
  const result = await deleteApp(user.id, body?.clientId);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
