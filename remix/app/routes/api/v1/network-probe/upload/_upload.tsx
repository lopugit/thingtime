import { json } from '~/api/http';
import { parseNetworkProbePacketBytes, readExactNetworkProbeUpload } from '~/api/utils/networkProbe';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/network-probe/upload?bytes=<fixed ladder value> — consumes a
// precisely bounded binary body and returns no caller data. It exists solely
// for an opt-in Commander upload measurement.
export const action = async ({ request }: { request: Request }) => {
	const bytes = parseNetworkProbePacketBytes(new URL(request.url).searchParams.get('bytes'));
	if (!bytes) return json({ ok: false, error: 'bytes must be a supported network probe packet size' }, { status: 400 });
	const limit = await enforceRateLimit(request, 'networkProbe.upload', null, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Network probe rate limit reached' }, rateLimitedResponseInit(limit));
	await readExactNetworkProbeUpload(request, bytes);
	return json({ ok: true, bytes }, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
