import { json } from '~/api/http';

import { appAllowsDesktopRedirect, appAllowsOrigin, appIsRevoked, findAppByClientId, normalizeAppOrigin, toEmbedApp } from '~/api/utils/apps/apps';
import { normalizeDesktopRedirectUri } from '~/api/utils/apps/desktopOAuthRedirect';
import { describeScopes, parseScopeParam, scopeCovers } from '~/api/utils/apps/scopes';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/apps/public?clientId=…&origin=…&scope=…&optional_scope=… —
// anonymous lookup used by the authorize popup to render its consent screen.
// Returns the app's public face (clientId + name) plus the REQUIRED and
// OPTIONAL scope sets as descriptor entries ({ id, title, description, kind,
// baseline }) for the permissions selector — ONLY when the app exists and the
// origin is on its allowlist, so the popup can refuse to run for unregistered
// embedders before any login UI shows.
export const loader = async ({ request }: { request: Request }) => {
  // Anonymous endpoint — bound per IP before any DB work.
  const limit = await enforceRateLimit(request, 'apps.public', null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many requests — slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }

  const url = new URL(request.url);
  const clientId = (url.searchParams.get('clientId') || url.searchParams.get('client_id') || '').trim();
  const redirect = normalizeDesktopRedirectUri(url.searchParams.get('redirect_uri'));
  const origin = redirect ? null : normalizeAppOrigin(url.searchParams.get('origin'));

  if (!clientId) return json({ ok: false, error: 'clientId is required' }, { status: 400 });
  if (!origin && !redirect)
    return json({ ok: false, error: 'origin must be a valid web origin or redirect_uri must be an exact desktop callback' }, { status: 400 });

  const required = parseScopeParam(url.searchParams.get('scope'));
  if (required.ok === false) return json({ ok: false, error: required.error }, { status: 400 });

  const optional = parseScopeParam(url.searchParams.get('optional_scope'), [], false);
  if (optional.ok === false) return json({ ok: false, error: optional.error }, { status: 400 });

  // Optional entries the required set already covers are noise — and worse, a
  // toggle for a scope a required ancestor already grants would be a lie
  // (unticking it wouldn't withhold anything). Drop by COVERAGE, not exact id.
  const requiredIds = required.scopes;
  const optionalIds = optional.scopes.filter((id) => !scopeCovers(requiredIds, id));

  // sandbox=1: answer for ANY clientId — a mock app payload, clearly flagged,
  // so integrators (and their AIs) can render/validate the consent shape
  // before the app exists. No lookup, no allowlist; pair it with
  // POST /api/v1/oauth/sandbox for a working pretend token.
  if (url.searchParams.get('sandbox') === '1') {
    const mockId = clientId.slice(0, 128); // don't reflect unbounded input
    return json({
      ok: true,
      sandbox: true,
      app: { clientId: mockId, name: mockId.startsWith('ttapp_') ? 'Your App' : mockId },
      origin,
      requiredScopes: describeScopes(requiredIds),
      optionalScopes: describeScopes(optionalIds)
    });
  }

  const app = await findAppByClientId(clientId);
  if (!app) return json({ ok: false, error: 'App not found' }, { status: 404 });
  if (appIsRevoked(app)) {
    return json({ ok: false, error: 'This app has been suspended by an administrator' }, { status: 403 });
  }

  if (redirect ? !appAllowsDesktopRedirect(app, redirect) : !appAllowsOrigin(app, origin!)) {
    return json({ ok: false, error: redirect ? 'This desktop callback is not registered on the app' : 'This origin is not on the app’s allowlist' }, { status: 403 });
  }

  return json({
    ok: true,
    app: toEmbedApp(app),
    origin: redirect?.uri ?? origin,
    requiredScopes: describeScopes(requiredIds),
    optionalScopes: describeScopes(optionalIds)
  });
};
