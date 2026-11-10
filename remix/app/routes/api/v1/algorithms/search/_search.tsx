import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { json } from '~/api/http';
import { searchListedAlgorithms } from '~/api/utils/algorithms/algorithms';

export const loader = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'algorithms.shared', null);
	if (!limit.allowed) return json({ ok: false, error: 'Too many searches; please try again shortly' }, rateLimitedResponseInit(limit));
	const params = new URL(request.url).searchParams;
	const result = await searchListedAlgorithms({ q: params.get('q'), cursor: params.get('cursor') });
	return json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
};
