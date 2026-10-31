import { json } from '~/api/http';

import { resolveAppRequest } from '~/api/utils/apps/appRequest';
import { appDataPreflight } from '~/api/utils/apps/cors';
import { appScopeOf, getAppStorageUsage } from '~/api/utils/apps/namespace';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/app-data/usage — both standing storage ledgers: this app user
// plus the registered app aggregate. usedBytes/budgetBytes remain aliases for
// the user ledger. Storage is byte-budgeted (no doc counts), so apps can pace
// themselves instead of discovering 507s.
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
  if (!usage.storageAccountingReady) {
    return json(
      { ok: false, error: 'App storage accounting is not initialized — run the pending storage migration' },
      { status: 503, headers: cors }
    );
  }
  return json({ ok: true, ...usage }, { headers: cors });
};

// OPTIONS preflights land on action (the catch-all routes non-GET here); a
// bare non-OPTIONS mutation gets a CORS-carrying 405.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request, 'GET, OPTIONS');
  if (preflight) return preflight;
  return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
};
