import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { issueSsoHandoffCode } from '~/api/utils/auth/ssoHandoff';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/sso-handoff — { origin } → a short-lived, aud-bound,
// single-use sign-in code for the signed-in user, redeemed by the TARGET
// deployment at its own /api/v1/auth/sso-session. Minted only from a
// first-party signed-in surface (the /authorize?self=1 popup and the FedCM
// assertion endpoint use this); origins stay default-open — the security is
// the per-code binding, TTL, and single use.
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}

	const limit = await enforceRateLimit(request, 'auth.ssoHandoff', user.id);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many sign-in links — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const result = await issueSsoHandoffCode(user.id, body?.origin, request);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json({ ok: true, code: result.code, aud: result.aud, expiresAt: result.expiresAt });
};
