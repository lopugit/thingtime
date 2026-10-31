import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { appAllowsDesktopRedirect, appIsRevoked, findAppByClientId } from '~/api/utils/apps/apps';
import { issueDesktopAuthorizationCode } from '~/api/utils/apps/desktopOAuth';
import {
	appendDesktopAuthorizationResult,
	normalizeDesktopRedirectUri,
	normalizeDesktopState,
	normalizePkceChallenge
} from '~/api/utils/apps/desktopOAuthCore';
import { parseScopeParam, sanitizeGrantedScopes, scopeCovers } from '~/api/utils/apps/scopes';
import { sanitizeSharedThings } from '~/api/utils/apps/sharedThings';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/oauth/desktop/authorize — the first-party /authorize page uses
// this after consent for installed apps. It returns a redirect containing a
// short-lived, one-time code — never the app token. The loopback receiver must
// exchange that code with the original S256 verifier at /api/v1/oauth/token.
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

	const limit = await enforceRateLimit(request, 'oauth.authorize', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many authorizations — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, 48 * 1024);
	const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
	const redirect = normalizeDesktopRedirectUri(body?.redirectUri);
	const codeChallenge = normalizePkceChallenge(body?.codeChallenge, body?.codeChallengeMethod);
	const state = normalizeDesktopState(body?.state);

	if (!clientId) return json({ ok: false, error: 'clientId is required' }, { status: 400 });
	if (!redirect) {
		return json(
			{
				ok: false,
				error: 'redirectUri must be an exact loopback callback or a registered reverse-domain native callback URI'
			},
			{ status: 400 }
		);
	}
	if (!codeChallenge) {
		return json({ ok: false, error: 'codeChallengeMethod must be S256 with a valid PKCE codeChallenge' }, { status: 400 });
	}
	if (!state) return json({ ok: false, error: 'state must be a random string of 16-512 characters' }, { status: 400 });

	const required = parseScopeParam(body?.scope);
	if (required.ok === false) return json({ ok: false, error: required.error }, { status: 400 });
	const optional = parseScopeParam(body?.optionalScope, [], false);
	if (optional.ok === false) return json({ ok: false, error: optional.error }, { status: 400 });
	const allowExtra = body?.extra !== '0' && body?.extra !== 0 && body?.extra !== false;
	const granted = sanitizeGrantedScopes(body?.scopes, required.scopes, optional.scopes, allowExtra);
	if (granted.ok === false) return json({ ok: false, error: granted.error }, { status: 400 });

	let sharedThings: string[] = [];
	if (scopeCovers(granted.scopes, 'things')) {
		const picked = await sanitizeSharedThings(user.id, body?.sharedThings);
		if (picked.ok === false) return json({ ok: false, error: picked.error }, { status: picked.status });
		sharedThings = picked.sharedThings;
	}

	const app = await findAppByClientId(clientId);
	if (!app) return json({ ok: false, error: 'App not found' }, { status: 404 });
	if (appIsRevoked(app)) return json({ ok: false, error: 'This app has been suspended by an administrator' }, { status: 403 });
	if (!appAllowsDesktopRedirect(app, redirect)) {
		return json({ ok: false, error: 'This desktop callback is not registered on the app' }, { status: 403 });
	}

	const issued = await issueDesktopAuthorizationCode(user.id, {
		clientId,
		redirectUri: redirect.uri,
		origin: redirect.origin,
		codeChallenge,
		scopes: granted.scopes,
		sharedThings
	});

	return json(
		{
			ok: true,
			redirectTo: appendDesktopAuthorizationResult(redirect.uri, { code: issued.code, state }),
			expiresAt: issued.expiresAt.toISOString()
		},
		{ headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
	);
};
