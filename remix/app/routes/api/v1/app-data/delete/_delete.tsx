import { json } from '~/api/http';

import { deleteAppData } from '~/api/utils/apps/appData';
import { resolveAppRequest } from '~/api/utils/apps/appRequest';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/app-data/delete — { key } — remove one entry for this
// (user, app). App-scoped Bearer token; CORS like the main app-data route.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const resolved = await resolveAppRequest(request, 'app-data');
  if (resolved instanceof Response) return resolved;
  const { ctx, cors } = resolved;

  const limit = await enforceRateLimit(request, 'appData.write', `user:${ctx.user.id}:app:${ctx.clientId}`);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'Writing too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const body = await readJsonBodyWithCors(request, 8 * 1024, cors);
  const result = await deleteAppData(ctx.user.id, ctx.clientId, body?.key);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, deleted: result.deleted }, { headers: cors });
};
