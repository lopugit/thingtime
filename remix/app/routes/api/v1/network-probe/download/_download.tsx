import { json } from '~/api/http';
import { networkProbeDownloadResponse, parseNetworkProbePacketBytes } from '~/api/utils/networkProbe';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/network-probe/download?bytes=<fixed ladder value> — bounded,
// non-cacheable transfer measurement. Only the documented packet sizes work.
export const loader = async ({ request }: { request: Request }) => {
	const bytes = parseNetworkProbePacketBytes(new URL(request.url).searchParams.get('bytes'));
	if (!bytes) return json({ ok: false, error: 'bytes must be a supported network probe packet size' }, { status: 400 });
	const limit = await enforceRateLimit(request, 'networkProbe.download', null, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Network probe rate limit reached' }, rateLimitedResponseInit(limit));
	return networkProbeDownloadResponse(bytes);
};
