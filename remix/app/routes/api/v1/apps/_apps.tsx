import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createApp, listApps } from '~/api/utils/apps/apps';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/apps — list the apps you've registered for "Login with
// Thingtime" embedding. Session (or full-account bearer) auth.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  return json({ ok: true, apps: await listApps(user.id) });
};

// POST /api/v1/apps — { name, origins, nativeRedirectUris? } — register a new embed app. The server
// mints the clientId + storage allowances; origins are validated (https, or
// http on localhost for dev). Caller-supplied quota fields are never copied.
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
  const result = await createApp(user.id, {
    name: body?.name,
    origins: body?.origins,
    nativeRedirectUris: body?.nativeRedirectUris
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, app: result.app });
};
