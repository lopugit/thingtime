import { json } from '~/api/http';

import { resolveAppRequest } from '~/api/utils/apps/appRequest';
import { appDataPreflight } from '~/api/utils/apps/cors';
import { appScopeOf, getAppStorageUsage } from '~/api/utils/apps/namespace';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/app-data/usage — this (user, app) namespace's storage ledger:
// { usedBytes, budgetBytes }. Storage is byte-budgeted (no doc counts): every
// app write charges its serialized size against the budget and deletes
// refund, so an app can pace itself instead of discovering 507s.
export const loader = async ({ request }: { request: Request }) => {
  const resolved = await resolveAppRequest(request, 'app-data');
  if (resolved instanceof Response) return resolved;
  const { ctx, cors } = resolved;

  const limit = await enforceRateLimit(request, 'oauth.read', `user:${ctx.user.id}:app:${ctx.clientId}`);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'Reading too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const usage = await getAppStorageUsage(appScopeOf(ctx));
  return json({ ok: true, ...usage }, { headers: cors });
};

// OPTIONS preflights land on action (the catch-all routes non-GET here); a
// bare non-OPTIONS mutation gets a CORS-carrying 405.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request, 'GET, OPTIONS');
  if (preflight) return preflight;
  return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
};
