import { json, readJsonBody } from '~/api/http';

import { resolveAppToken } from '~/api/utils/apps/appTokens';
import { deleteAppData } from '~/api/utils/apps/appData';
import { appCorsHeaders, appDataPreflight } from '~/api/utils/apps/cors';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/app-data/delete — { key } — remove one entry for this
// (user, app). App-scoped Bearer token; CORS like the main app-data route.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const requestOrigin = request.headers.get('Origin');
  const cors = appCorsHeaders(requestOrigin);

  const ctx = await resolveAppToken(request);
  if (!ctx) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  if (requestOrigin && requestOrigin !== ctx.origin) {
    return json({ ok: false, error: 'Origin does not match this token' }, { status: 403, headers: cors });
  }

  const limit = await enforceRateLimit(request, 'appData.write', `user:${ctx.user.id}:app:${ctx.clientId}`);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'Writing too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const body = await readJsonBody(request, 8 * 1024);
  const result = await deleteAppData(ctx.user.id, ctx.clientId, body?.key);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, deleted: result.deleted }, { headers: cors });
};
