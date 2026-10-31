import { networkProbePingResponse } from '~/api/utils/networkProbe';
import { networkProbeAccess } from '~/api/utils/networkProbeAccess';

// GET /api/v1/network-probe/ping — a tiny uncached payload used to measure a
// complete request/response round-trip from Commander to Thingtime.
export const loader = async ({ request }: { request: Request }) => {
	const denied = await networkProbeAccess(request, 'ping');
	if (denied) return denied;
	return networkProbePingResponse();
};
