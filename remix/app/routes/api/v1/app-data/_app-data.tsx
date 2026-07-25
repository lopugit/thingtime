import { json } from '~/api/http';

import { resolveAppToken } from '~/api/utils/apps/appTokens';
import type { AppTokenContext } from '~/api/utils/apps/appTokens';
import { getAppData, listAppData, setAppData } from '~/api/utils/apps/appData';
import { appCorsHeaders, appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// The embed data API: an app-scoped Bearer token (minted by /oauth/authorize)
// reads and writes key/value entries in the END USER's Thingtime account,
// scoped to that app. Called cross-origin by the SDK, so responses carry CORS
// headers — but data only ever flows to the token's own bound origin.

type AppRequestContext = {
  ctx: AppTokenContext;
  cors: Record<string, string>;
};

// Resolve the token + enforce the origin binding shared by every app-data
// handler. Browser calls carry an Origin header, which must equal the origin
// the token was granted to; server-to-server calls (no Origin) pass.
const resolveAppRequest = async (request: Request): Promise<AppRequestContext | Response> => {
  const requestOrigin = request.headers.get('Origin');
  const cors = appCorsHeaders(requestOrigin);

  const ctx = await resolveAppToken(request);
  if (!ctx) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  if (requestOrigin && requestOrigin !== ctx.origin) {
    return json({ ok: false, error: 'Origin does not match this token' }, { status: 403, headers: cors });
  }

  // Storage needs the 'app-data' scope — the user can decline it on the
  // consent screen and still log in with just their identity.
  if (!ctx.scopes.includes('app-data')) {
    return json(
      { ok: false, error: 'This token was not granted the app-data scope' },
      { status: 403, headers: cors }
    );
  }

  return { ctx, cors };
};

// GET /api/v1/app-data?key=… — one entry (200 with { entry: null } when the
// key is unset) — or without ?key: every entry for this (user, app).
export const loader = async ({ request }: { request: Request }) => {
  const resolved = await resolveAppRequest(request);
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

  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== null) {
    const entry = await getAppData(ctx.user.id, ctx.clientId, key.trim());
    return json({ ok: true, entry }, { headers: cors });
  }

  const entries = await listAppData(ctx.user.id, ctx.clientId);
  return json({ ok: true, entries }, { headers: cors });
};

// POST /api/v1/app-data — { key, value } — insert-or-update one entry.
// OPTIONS preflights land here too (the catch-all routes non-GET to action).
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const resolved = await resolveAppRequest(request);
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

  const body = await readJsonBodyWithCors(request, 64 * 1024, cors);
  const result = await setAppData(ctx.user.id, ctx.clientId, body?.key, body?.value);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, entry: result.entry }, { headers: cors });
};
