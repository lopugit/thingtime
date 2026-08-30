import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { resolveWebpage } from '~/api/utils/webpages/webpages';

// GET /api/v1/webpages/resolve — resolve ONE webpage thing together with every
// component thing its blocks reference (one batched query, no client N+1).
//
//   ?id=<shareId>   a standalone page (the /p/<id> route)
//   ?path=</route>  the site page bound to an app route — the viewer's own
//                   personalised doc outranks the seeded system default
//   ?global=1       the site-global block doc (blocks on every page)
//
// Anonymous callers resolve public pages and the seeded site defaults. The
// response carries page, source ('user' | 'system'), components[], and a
// refs map (block component ref → resolved component id).
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);

	const limit = await enforceRateLimit(request, 'webpages.resolve', user ? `user:${user.id}` : null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Page resolving is rate-limited — one breath at a time 🌸' }, rateLimitedResponseInit(limit));
	}

	const params = new URL(request.url).searchParams;
	const result = await resolveWebpage(user ? { id: user.id, username: user.username } : null, {
		id: params.get('id') || undefined,
		path: params.get('path') || undefined,
		global: params.get('global') || undefined
	});

	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};
