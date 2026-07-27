import { json } from '~/api/http';

import { getAppData, listAppData, setAppData } from '~/api/utils/apps/appData';
import { resolveAppRequest } from '~/api/utils/apps/appRequest';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { scopeCovers } from '~/api/utils/apps/scopes';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// The embed data API: an app-scoped Bearer token (minted by /oauth/authorize)
// reads and writes key/value entries in the END USER's Thingtime account,
// scoped to that app. Called cross-origin by the SDK, so responses carry CORS
// headers — but data only ever flows to the token's own bound origin.
// Storage needs the 'app-data' scope — the user can decline it on the consent
// screen and still log in with just their identity.

// GET /api/v1/app-data?key=… — one entry (200 with { entry: null } when the
// key is unset) — or without ?key: every entry for this (user, app).
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

  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== null) {
    const entry = await getAppData(ctx.user.id, ctx.clientId, key.trim());
    return json({ ok: true, entry }, { headers: cors });
  }

  const entries = await listAppData(ctx.user.id, ctx.clientId);
  return json({ ok: true, entries }, { headers: cors });
};

// POST /api/v1/app-data — { key, value, visibility?, acl? } — insert-or-update
// one entry. Audience is the acl array (visibility is derived sugar):
// 'private' (default) or 'app', which lets other users of THIS app read the
// entry via /app-data/shared — allowed only when this token carries the
// app-data.shared scope. OPTIONS preflights land here too (the catch-all
// routes non-GET to action).
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

  const body = await readJsonBodyWithCors(request, 64 * 1024, cors);
  const result = await setAppData(ctx.user.id, ctx.clientId, body?.key, body?.value, {
    visibility: body?.visibility,
    acl: body?.acl,
    allowShared: scopeCovers(ctx.scopes, 'app-data.shared')
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, entry: result.entry }, { headers: cors });
};
