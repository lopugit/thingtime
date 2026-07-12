import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { appAllowsOrigin, findAppByClientId, normalizeAppOrigin } from '~/api/utils/apps/apps';
import { issueAppToken, toEmbedUser } from '~/api/utils/apps/appTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/oauth/authorize — { clientId, origin } — the consent step of
// the "Login with Thingtime" popup. Requires the user's real session (cookie);
// app-scoped bearer tokens are rejected by getCurrentUser, so a leaked app
// token can never mint further grants. Returns an app-scoped Bearer token the
// popup hands to the embedding origin via postMessage.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'oauth.authorize', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many authorizations — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 8 * 1024);
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
  const origin = normalizeAppOrigin(body?.origin);

  if (!clientId) return json({ ok: false, error: 'clientId is required' }, { status: 400 });
  if (!origin) return json({ ok: false, error: 'origin must be a valid web origin' }, { status: 400 });

  const app = await findAppByClientId(clientId);
  if (!app) return json({ ok: false, error: 'App not found' }, { status: 404 });

  if (!appAllowsOrigin(app, origin)) {
    return json({ ok: false, error: 'This origin is not on the app’s allowlist' }, { status: 403 });
  }

  const grant = await issueAppToken(user.id, clientId, origin);

  return json({
    ok: true,
    token: grant.token,
    tokenType: grant.tokenType,
    expiresAt: grant.expiresAt.toISOString(),
    user: toEmbedUser(user)
  });
};
