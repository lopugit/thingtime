import { json } from '~/api/http';

import { resolveOwnOriginHints } from '~/api/utils/auth/accountHints';
import { privateAccountHintsHeaders } from '~/api/utils/auth/accountHintsHeaders';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// Thingtime-family pages (plus localhost dev, which is same-site across ports)
// may read this cross-origin WITH credentials. Anything else gets no CORS
// headers, so its JS cannot read the response — and non-family fetches are
// cross-site anyway, so the tt_hints cookie never even arrives.
const corsHeadersFor = (request: Request): Record<string, string> => {
	const origin = request.headers.get('Origin');
	if (!origin) return { Vary: 'Origin' };
	let hostname = '';
	try {
		hostname = new URL(origin).hostname;
	} catch {
		return { Vary: 'Origin' };
	}
	const allowed =
		hostname === 'thingtime.com' ||
		hostname.endsWith('.thingtime.com') ||
		hostname === 'localhost' ||
		hostname === '127.0.0.1';
	if (!allowed) return { Vary: 'Origin' };
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Credentials': 'true',
		Vary: 'Origin'
	};
};

// GET /api/v1/auth/account-hints/resolve — the federated half of the
// auto-login suggestions: another Thingtime deployment's page (same site, so
// the shared tt_hints cookie flows) asks THIS deployment to vouch for the
// pointers its own origin wrote. Each environment answers only for its own
// sessions — the user's browser assembles the full cross-environment picture,
// no central session store anywhere. Read-only: never prunes, never sets
// cookies.
export const loader = async ({ request }: { request: Request }) => {
	const cors = corsHeadersFor(request);
	const limit = await enforceRateLimit(request, 'auth.hintsResolve', null);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'Too many requests — take a breather 🌸' }, { ...init, headers: privateAccountHintsHeaders(init.headers, cors) });
	}

	const hints = await resolveOwnOriginHints(request);
	return json({ ok: true, hints }, { headers: privateAccountHintsHeaders(cors) });
};
