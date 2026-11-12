import { json } from '~/api/http';

import { fedcmRoster, FEDCM_SELF_CLIENT_ID, isFedcmFetch } from '~/api/utils/auth/fedcm';
import { issueSsoHandoffCode } from '~/api/utils/auth/ssoHandoff';
import { appAllowsOrigin, appIsRevoked, findAppByClientId } from '~/api/utils/apps/apps';
import { issueAppToken } from '~/api/utils/apps/appTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// FedCM error shape (spec): { error: { code } } with a non-200 status.
const fedcmError = (status: number, code: string) => json({ error: { code } }, { status });

// POST /api/v1/fedcm/assertion — the browser calls this (form-encoded, with
// first-party cookies, Sec-Fetch-Dest: webidentity, Origin = the embedding
// page) after the user picks an account on the native sheet. Two client
// kinds:
//   • client_id 'thingtime-self' — another Thingtime deployment: mints a
//     short-lived aud-bound single-use handoff code (ssoHandoff.ts); the page
//     redeems it at ITS OWN /api/v1/auth/sso-session for a first-class
//     session. Redemption only works where the databases match — fail-closed.
//   • client_id 'ttapp_…' — a registered app: mints the same app-scoped
//     Bearer token the /authorize popup consent flow issues, with the
//     baseline profile scope only (FedCM has no scope-negotiation UI; wider
//     grants still go through the consent popup).
// The picked account must belong to this browser's roster (ownership gate) —
// the sheet only offers roster accounts, and this re-checks server-side.
export const action = async ({ request }: { request: Request }) => {
	if (!isFedcmFetch(request)) {
		return fedcmError(400, 'invalid_request');
	}

	const limit = await enforceRateLimit(request, 'fedcm.assertion', null);
	if (!limit.allowed) {
		return json({ error: { code: 'temporarily_unavailable' } }, rateLimitedResponseInit(limit));
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return fedcmError(400, 'invalid_request');
	}
	const clientId = String(form.get('client_id') || '');
	const accountId = String(form.get('account_id') || '');
	const rpOrigin = request.headers.get('Origin');
	if (!clientId || !accountId || !rpOrigin) {
		return fedcmError(400, 'invalid_request');
	}

	const { accounts } = await fedcmRoster(request);
	const account = accounts.find((entry) => entry.userId === accountId);
	if (!account) {
		return fedcmError(401, 'unauthorized');
	}

	if (clientId === FEDCM_SELF_CLIENT_ID) {
		const minted = await issueSsoHandoffCode(account.userId, rpOrigin, request);
		if (minted.ok === false) return fedcmError(400, 'invalid_request');
		return json({ token: minted.code });
	}

	if (clientId.startsWith('ttapp_')) {
		const app = await findAppByClientId(clientId);
		if (!app || appIsRevoked(app)) return fedcmError(401, 'unauthorized');
		if (!appAllowsOrigin(app, rpOrigin)) return fedcmError(403, 'access_denied');
		const grant = await issueAppToken(account.userId, clientId, rpOrigin, ['profile']);
		return json({ token: grant.token });
	}

	return fedcmError(401, 'unauthorized');
};
