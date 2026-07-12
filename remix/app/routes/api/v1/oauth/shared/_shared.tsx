import { json } from '~/api/http';

import { resolveAppToken } from '~/api/utils/apps/appTokens';
import { appCorsHeaders, appDataPreflight } from '~/api/utils/apps/cors';
import { scopeCovers } from '~/api/utils/apps/scopes';
import { getSharedThings } from '~/api/utils/apps/sharedThings';

// GET /api/v1/oauth/shared — the things the user HAND-PICKED to share with
// this app on the consent screen ('things' picker scope). Read-only, exactly
// the granted set, ownership re-checked at read time (deleted things drop
// out). Same CORS + origin binding as the other app-token endpoints.
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

  if (!scopeCovers(ctx.scopes, 'things')) {
    return json(
      { ok: false, error: 'This token was not granted the things scope' },
      { status: 403, headers: cors }
    );
  }

  const things = await getSharedThings(ctx.user.id, ctx.sharedThings);
  return json({ ok: true, things }, { headers: cors });
};

// GET-only: preflights advertise GET, and stray POSTs get a CORS-readable 405.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request, 'GET, OPTIONS');
  if (preflight) return preflight;

  return json(
    { ok: false, error: 'Method not allowed' },
    { status: 405, headers: appCorsHeaders(request.headers.get('Origin')) }
  );
};
