import { json, readJsonBody } from '~/api/http';

import { exchangeDesktopAuthorizationCode } from '~/api/utils/apps/desktopOAuth';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// Public-client authorization-code exchange. A desktop app cannot protect a
// secret; one-time code, exact callback binding, and S256 PKCE are the proof.
export const action = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'oauth.authorize', null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many token exchanges — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, 16 * 1024);
	if (body?.grantType !== 'authorization_code') {
		return json({ ok: false, error: 'grantType must be authorization_code' }, { status: 400 });
	}

	const result = await exchangeDesktopAuthorizationCode({
		code: body?.code,
		clientId: body?.clientId,
		redirectUri: body?.redirectUri,
		codeVerifier: body?.codeVerifier
	});
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });

	const { grant } = result;
	return json(
		{
			ok: true,
			accessToken: grant.token,
			tokenType: grant.tokenType,
			expiresAt: grant.expiresAt.toISOString(),
			expiresIn: Math.max(0, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)),
			scopes: grant.scopes
		},
		{ headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
	);
};
