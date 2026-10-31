import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { appAllowsOrigin, appIsRevoked, findAppByClientId, normalizeAppOrigin } from '~/api/utils/apps/apps';
import { issueAppToken } from '~/api/utils/apps/appTokens';
import { thirdPartyProfileMediaUrl } from '~/api/utils/apps/profileMedia';
import { parseScopeParam, sanitizeGrantedScopes, scopeCovers } from '~/api/utils/apps/scopes';
import { sanitizeSharedThings } from '~/api/utils/apps/sharedThings';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/oauth/authorize — the consent step of the "Login with
// Thingtime" popup. Body:
//   clientId, origin       — the app + the embedding origin (allowlist-checked)
//   scope                  — space-delimited REQUIRED scopes the platform declared
//   optionalScope          — space-delimited OPTIONAL scopes it also asked for
//   extra                  — '0' when the platform opted out of volunteer sharing
//   scopes                 — the paths the USER approved on the permissions selector
//   sharedThings           — shareIds hand-picked for the 'things' picker scope
// The grant must cover every required scope, may include the approved
// optionals, and (unless extra='0') any known scope the user volunteered —
// consent can reshape a request, but the platform's REQUIRED floor holds and
// nothing unknown ever enters a grant.
//
// Requires the user's real session (cookie); app-scoped bearer tokens are
// rejected by getCurrentUser, so a leaked app token can never mint further
// grants. Returns an app-scoped Bearer token the popup hands to the embedding
// origin via postMessage.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'oauth.authorize', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many authorizations — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 32 * 1024);
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
  const origin = normalizeAppOrigin(body?.origin);

  if (!clientId) return json({ ok: false, error: 'clientId is required' }, { status: 400 });
  if (!origin) return json({ ok: false, error: 'origin must be a valid web origin' }, { status: 400 });

  const required = parseScopeParam(body?.scope);
  if (required.ok === false) return json({ ok: false, error: required.error }, { status: 400 });

  const optional = parseScopeParam(body?.optionalScope, [], false);
  if (optional.ok === false) return json({ ok: false, error: optional.error }, { status: 400 });

  const allowExtra = body?.extra !== '0' && body?.extra !== 0 && body?.extra !== false;

  const granted = sanitizeGrantedScopes(body?.scopes, required.scopes, optional.scopes, allowExtra);
  if (granted.ok === false) return json({ ok: false, error: granted.error }, { status: 400 });

  // The things picker: only meaningful when the grant includes the scope, and
  // every picked id must be a thing this user owns.
  let sharedThings: string[] = [];
  if (scopeCovers(granted.scopes, 'things')) {
    const picked = await sanitizeSharedThings(user.id, body?.sharedThings);
    if (picked.ok === false) return json({ ok: false, error: picked.error }, { status: picked.status });
    sharedThings = picked.sharedThings;
  }

  const app = await findAppByClientId(clientId);
  if (!app) return json({ ok: false, error: 'App not found' }, { status: 404 });
  if (appIsRevoked(app)) {
    return json({ ok: false, error: 'This app has been suspended by an administrator' }, { status: 403 });
  }

  if (!appAllowsOrigin(app, origin)) {
    return json({ ok: false, error: 'This origin is not on the app’s allowlist' }, { status: 403 });
  }

  const grant = await issueAppToken(user.id, clientId, origin, granted.scopes, sharedThings);

  // The handoff user object honours the grant exactly like /oauth/userinfo —
  // a field the user didn't share never crosses to the platform.
  const has = (path: string) => scopeCovers(grant.scopes, path);

  return json({
    ok: true,
    token: grant.token,
    tokenType: grant.tokenType,
    expiresAt: grant.expiresAt.toISOString(),
    scopes: grant.scopes,
    sharedThings: grant.sharedThings.length,
    user: {
      id: user.id,
      username: user.username,
      ...(has('profile.displayName') ? { displayName: user.displayName } : {}),
			...(has('profile.avatar') ? { avatarUrl: thirdPartyProfileMediaUrl(user.avatarUrl) } : {}),
			...(has('profile.birthday') ? { birthday: user.birthday } : {})
    }
  });
};
