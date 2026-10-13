import { json, readJsonBody, requireJsonContentType } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { beginOAuth, requestOrigin, oauthSessionBinding } from '~/api/utils/connections/oauth';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/connections/oauth/begin — start an SSO account link:
// { provider } → { authorizeUrl }. The client sends the browser there; the
// provider's own sign-in page returns to /api/v1/connections/oauth/callback.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user || user.accountKind === 'service') {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'connections.write', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    return json({ ok: false, error: 'Starting sign-ins very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const unsupported = requireJsonContentType(request);
  if (unsupported) return unsupported;
  const body = await readJsonBody(request, 4 * 1024);
  if (body?.expectedOwnerId !== undefined && body.expectedOwnerId !== user.id)
    return json(
      { ok: false, error: 'Your Thingtime account changed. Reload before saving.' },
      { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
    );
  const result = await beginOAuth(
    { ...user, sessionBinding: (await oauthSessionBinding(request)) || undefined },
    { provider: body?.provider },
    requestOrigin(request)
  );
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(
    { ok: true, provider: result.provider, authorizeUrl: result.authorizeUrl },
    { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } }
  );
};
