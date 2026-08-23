import { json } from '~/api/http';

import { fedcmRoster, isFedcmFetch, toFedcmAccount } from '~/api/utils/auth/fedcm';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/fedcm/accounts — the account list behind the browser's native
// "Continue as …" sheet. Only the browser's FedCM machinery can read this
// (Sec-Fetch-Dest: webidentity — page JS can never set Sec-Fetch-*); it
// fetches with the user's first-party cookies and shows the sheet itself, so
// the embedding page learns nothing until the user consents. The list is this
// browser's own switcher roster — ownership-gated, never a central registry.
export const loader = async ({ request }: { request: Request }) => {
	if (!isFedcmFetch(request)) {
		return json({ ok: false, error: 'FedCM requests only' }, { status: 400 });
	}

	const limit = await enforceRateLimit(request, 'fedcm.accounts', null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many requests' }, rateLimitedResponseInit(limit));
	}

	const { accounts } = await fedcmRoster(request);
	if (!accounts.length) {
		// non-200 = "no signed-in accounts" to the FedCM machinery
		return json({ accounts: [] }, { status: 401 });
	}

	return json({ accounts: accounts.map(toFedcmAccount) });
};
