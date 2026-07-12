import { json } from '~/api/http';

import { getJwtIssuer } from '~/api/utils/auth/jwt';
import { resolveAppToken, toEmbedUser } from '~/api/utils/apps/appTokens';
import { appCorsHeaders, appDataPreflight } from '~/api/utils/apps/cors';

// GET /api/v1/oauth/userinfo — the SSO identity endpoint: a platform holding
// an app-scoped Bearer token reads the user it was granted for. Base fields
// are the public profile (the mandatory 'profile' scope) plus a Thingtime
// profile link; email is included only when the user granted the 'email'
// scope on the consent screen. Same CORS + origin binding as /app-data.
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

  const issuer = getJwtIssuer().replace(/\/+$/, '');

  return json(
    {
      ok: true,
      scopes: ctx.scopes,
      user: {
        ...toEmbedUser(ctx.user),
        profileUrl: `${issuer}/profile/${encodeURIComponent(ctx.user.username)}`,
        ...(ctx.scopes.includes('email') ? { email: ctx.user.email } : {})
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

  return json(
    { ok: false, error: 'Method not allowed' },
    { status: 405, headers: appCorsHeaders(request.headers.get('Origin')) }
  );
};
