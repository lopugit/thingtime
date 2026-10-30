import { json } from '~/api/http';

import { getJwtIssuer } from '~/api/utils/auth/jwt';
import { resolveAppToken } from '~/api/utils/apps/appTokens';
import { thirdPartyProfileMediaUrl } from '~/api/utils/apps/profileMedia';
import { appCorsHeaders, appDataPreflight } from '~/api/utils/apps/cors';
import { scopeCovers } from '~/api/utils/apps/scopes';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/oauth/userinfo — the SSO identity endpoint: a platform holding
// an app-scoped Bearer token reads the user it was granted for. Every field
// beyond the identity itself is gated by its own scope path, so the response
// mirrors exactly what the user chose on the consent screen:
//   id, username, profileUrl        — always (profile.username baseline)
//   displayName / avatarUrl / bio / bannerUrl — profile.<field> (or profile)
//   birthday                         — profile.birthday only (exact: a plain
//                                      `profile` grant never covers it)
//   email                            — email scope
// Well-built platforms read `scopes` and light up features for whatever the
// user shared ("auto" sharing) instead of assuming a fixed shape. Same CORS +
// origin binding as /app-data.
export const loader = async ({ request }: { request: Request }) => {
  const requestOrigin = request.headers.get('Origin');
  const cors = appCorsHeaders(requestOrigin);

  const ctx = await resolveAppToken(request);
  if (!ctx) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  if (requestOrigin && requestOrigin !== ctx.origin) {
    return json({ ok: false, error: 'Origin does not match this token' }, { status: 403, headers: cors });
  }

  const limit = await enforceRateLimit(request, 'oauth.read', `user:${ctx.user.id}:app:${ctx.clientId}`);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'Reading too fast — take a breather 🌸' }, { ...init, headers: { ...init.headers, ...cors } });
  }

  const issuer = getJwtIssuer().replace(/\/+$/, '');
  const has = (path: string) => scopeCovers(ctx.scopes, path);

  return json(
    {
      ok: true,
      scopes: ctx.scopes,
      sharedThings: has('things') ? ctx.sharedThings.length : 0,
      user: {
        id: ctx.user.id,
        username: ctx.user.username,
        profileUrl: `${issuer}/profile/${encodeURIComponent(ctx.user.username)}`,
        ...(has('profile.displayName') ? { displayName: ctx.user.displayName } : {}),
				...(has('profile.avatar') ? { avatarUrl: thirdPartyProfileMediaUrl(ctx.user.avatarUrl) } : {}),
        ...(has('profile.bio') ? { bio: ctx.user.bio } : {}),
				...(has('profile.banner') ? { bannerUrl: thirdPartyProfileMediaUrl(ctx.user.bannerUrl) } : {}),
        ...(has('profile.birthday') ? { birthday: ctx.user.birthday } : {}),
        ...(has('email') ? { email: ctx.user.email } : {})
      }
    },
    { headers: cors }
  );
};

// OPTIONS preflights land on `action` (the catch-all routes non-GET there);
// GET with an Authorization header always preflights cross-origin. This route
// is GET-only, so the preflight advertises exactly that, and the 405 carries
// CORS headers so the embedding page can read it.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request, 'GET, OPTIONS');
  if (preflight) return preflight;

	return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: appCorsHeaders(request.headers.get('Origin')) });
};
