import { json } from '~/api/http';

import { resolveAccountHints } from '~/api/utils/auth/accountHints';
import { privateAccountHintsHeaders } from '~/api/utils/auth/accountHintsHeaders';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/auth/account-hints — accounts this BROWSER is signed into on
// other Thingtime deployments (via the Domain=.thingtime.com tt_hints pointer
// cookie), resolved live: a suggestion exists exactly while its session on the
// other deployment is live. Powers the auto-login "continue as" popup for
// signed-out visitors; picking one still requires that account's password or
// passkey. Same-origin only — no CORS headers, so no cross-site page can read
// this browser's suggestions.
export const loader = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'auth.accountHints', null);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'Too many requests — take a breather 🌸' }, { ...init, headers: privateAccountHintsHeaders(init.headers) });
	}

	const { hints, setCookies, unresolvedOrigins } = await resolveAccountHints(request);

	const headers = privateAccountHintsHeaders();
	for (const cookie of setCookies) headers.append('Set-Cookie', cookie);
	// `unresolved`: foreign origins whose pointers this deployment can't vouch
	// for (different database) — the client federates to each origin's own
	// /account-hints/resolve and merges.
	return json({ ok: true, hints, unresolved: unresolvedOrigins }, { headers });
};
