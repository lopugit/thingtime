import { json } from '~/api/http';

import { normalizeAppOrigin } from '~/api/utils/apps/apps';
import { appCorsHeaders, appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import {
  mintSandboxToken,
  sandboxPublicUser,
  sanitizeSandboxSpace,
  sanitizeSandboxUsername
} from '~/api/utils/apps/sandbox';
import { parseScopeParam, sanitizeGrantedScopes, scopeCovers } from '~/api/utils/apps/scopes';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/oauth/sandbox — mint a REAL sandbox token, no browser, no
// registration, no account. Body (all optional):
//   clientId — any string; unregistered is the point (default 'sandbox')
//   origin   — the origin the token will be used from (default the request's
//              Origin header, else a sandbox placeholder)
//   scope    — space-delimited scope paths, exactly like /oauth/authorize
//   scopes   — or an explicit array (the "granted" selection)
//   space    — opt-in pool secret (8-64 chars; use a uuid): tokens minted
//              into the same space share their 'app'-visibility entries as
//              distinct pretend users — the way to rehearse the multi-user
//              /app-data/shared feed. Omit for a fully isolated sandbox.
//   username — pretend-author name for pooled feeds (always 'sandbox-'
//              prefixed; default sandbox-you)
// The token works against /api/v1/app-data*, /oauth/userinfo and
// /app-data/shared for ONE HOUR, resolves to the synthetic sandbox user, and
// everything written under it is namespaced per token and TTL-reaped. Nothing
// real is ever touched — see api/utils/apps/sandbox.ts for the containment.
// This is the headless counterpart of the popup's ?sandbox=1 mode, so
// integrators (human or AI) can build and test the entire flow before
// registering an app.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request, 'POST, OPTIONS');
  if (preflight) return preflight;

  const requestOrigin = request.headers.get('Origin');
  const cors = appCorsHeaders(requestOrigin);

  // Anonymous endpoint — bound per IP before any DB work.
  const limit = await enforceRateLimit(request, 'oauth.sandbox', null);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'Minting sandbox tokens too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const body = await readJsonBodyWithCors(request, 8 * 1024, cors);

  const clientId =
    typeof body?.clientId === 'string' && body.clientId.trim() ? body.clientId.trim().slice(0, 128) : 'sandbox';

  const origin =
    normalizeAppOrigin(body?.origin) || normalizeAppOrigin(requestOrigin) || 'https://sandbox.thingtime.invalid';

  const requested = parseScopeParam(body?.scope);
  if (requested.ok === false) return json({ ok: false, error: requested.error }, { status: 400, headers: cors });

  // An explicit scopes array narrows/widens the request exactly like the
  // consent screen's selection (unknown names 400, baseline injected).
  const granted = sanitizeGrantedScopes(body?.scopes, [], requested.scopes, true);
  if (granted.ok === false) return json({ ok: false, error: granted.error }, { status: 400, headers: cors });
  const scopes = body?.scopes === undefined || body?.scopes === null ? requested.scopes : granted.scopes;

  const space = sanitizeSandboxSpace(body?.space);
  if (space && typeof space === 'object') return json({ ok: false, error: space.error }, { status: 400, headers: cors });
  const username = sanitizeSandboxUsername(body?.username);

  const grant = await mintSandboxToken(clientId, origin, scopes, { space, username });

  // Mirror /oauth/authorize's handoff shape (+ sandbox: true) so integration
  // code written against the sandbox works unchanged against the real flow.
  const user = sandboxPublicUser('sandbox', new Date(), username);
  const has = (path: string) => scopeCovers(scopes, path);
  return json(
    {
      ok: true,
      sandbox: true,
      token: grant.token,
      tokenType: grant.tokenType,
      expiresAt: grant.expiresAt.toISOString(),
      scopes,
      space,
      sharedThings: 0,
      user: {
        id: user.id,
        username: user.username,
        ...(has('profile.displayName') ? { displayName: user.displayName } : {}),
        ...(has('profile.avatar') ? { avatarUrl: user.avatarUrl } : {})
      }
    },
    { headers: cors }
  );
};
