import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getMarketingPublications } from '~/api/utils/marketing/marketingPublications';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/marketing/publications — which parts of the generated marketing
// suite an admin has published (marketing/publishing.ts). Anonymous-readable:
// the client gates every /marketing surface on it, so visitors need it before
// first paint. Admin sessions additionally receive `audit` (who switched each
// key, and when). Never cached: a publish must show on the next navigation.
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);

	const limit = await enforceRateLimit(request, 'marketing.publications', user ? `user:${user.id}` : null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Publication reads are rate-limited — one breath at a time 🌸' }, rateLimitedResponseInit(limit));
	}

	const publications = await getMarketingPublications({ audit: !!user?.isAdmin });
	return json(
		{ ok: true, publications },
		{ headers: { 'Cache-Control': user ? 'private, no-store, max-age=0' : 'no-store', Pragma: 'no-cache' } }
	);
};
