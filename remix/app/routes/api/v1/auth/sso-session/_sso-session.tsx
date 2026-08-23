import { json, readJsonBody } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { claimSsoHandoffCode } from '~/api/utils/auth/ssoHandoff';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/sso-session — { code } → redeem a handoff code minted by
// a signed-in thingtime.com surface and become a first-class session on THIS
// deployment. Verifies signature (shared key material), aud === this
// deployment's public origin, single use (second redemption revokes the
// session — theft signal), then runs the exact password-login tail: auth
// cookie, switcher roster merge, cross-deployment hint pointer. Fails closed
// with a generic error when this deployment doesn't share the minting
// environment's database.
export const action = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'auth.ssoSession', null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const result = await claimSsoHandoffCode(request, body?.code);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}

	const rosterCookies = await mergeAccountSession(request, { userId: result.user.id, jti: result.jti });

	const headers = new Headers();
	headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
	for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

	return json({ ok: true, user: result.user }, { headers });
};
