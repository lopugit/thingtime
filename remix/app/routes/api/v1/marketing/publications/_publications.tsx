import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getMarketingPublicationsResult } from '~/api/utils/marketing/marketingPublications';
import { withMongoRequestBudget } from '~/api/utils/mongodb/requestBudget';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// Anonymous-readable publication state. Admin sessions additionally receive
// audit, so responses stay private/no-store. All dependent database work shares
// one request deadline; shared initialization has its own bounded operations.
export const loader = async ({ request }: { request: Request }) => {
	try {
		return await withMongoRequestBudget(request.signal, 6000, async () => {
			const user = await getCurrentUser(request);
			const limit = await enforceRateLimit(request, 'marketing.publications', user ? `user:${user.id}` : null);
			if (!limit.allowed) {
				return json({ ok: false, error: 'Publication reads are rate-limited — one breath at a time 🌸' }, rateLimitedResponseInit(limit));
			}
			const result = await getMarketingPublicationsResult({ audit: !!user?.isAdmin });
			return json(result, {
				status: result.ok === false ? result.status : 200,
				headers: {
					'Cache-Control': user ? 'private, no-store, max-age=0' : 'no-store', Pragma: 'no-cache',
					...(!result.ok ? { 'Retry-After': '15' } : {})
				}
			});
		});
	} catch {
		return json({ ok: false, freshness: 'unavailable', error: 'Marketing publishing is temporarily unavailable' }, {
			status: 503,
			headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'Retry-After': '15' }
		});
	}
};
