import { networkProbePingResponse } from '~/api/utils/networkProbe';
import { json } from '~/api/http';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/network-probe/ping — a tiny uncached payload used to measure a
// complete request/response round-trip from Commander to Thingtime.
export const loader = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'networkProbe.ping', null);
	if (!limit.allowed) return json({ ok: false, error: 'Too many network probe requests' }, rateLimitedResponseInit(limit));
	return networkProbePingResponse();
};
