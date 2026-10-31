import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateApp } from '~/api/utils/apps/apps';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/apps/update — { clientId, name?, origins?, nativeRedirectUris? } — update one of
// your embed apps. Origins are re-validated; tokens minted for an origin you
// remove stop working on their next request (appTokens re-checks the list).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'apps.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many app changes — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 16 * 1024);
  const result = await updateApp(user.id, body?.clientId, {
    name: body?.name,
    origins: body?.origins,
    nativeRedirectUris: body?.nativeRedirectUris
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, app: result.app });
};
