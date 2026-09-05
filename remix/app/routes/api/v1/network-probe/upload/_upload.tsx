import { json } from '~/api/http';
import { parseNetworkProbeUploadBytes, readExactNetworkProbeUpload } from '~/api/utils/networkProbe';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/network-probe/upload?bytes=<fixed ladder value> — consumes a
// precisely bounded binary body and returns no caller data. It exists solely
// for an opt-in Commander upload measurement.
export const action = async ({ request }: { request: Request }) => {
	const bytes = parseNetworkProbeUploadBytes(new URL(request.url).searchParams.get('bytes'));
	if (!bytes) return json({ ok: false, error: 'Upload v2 requires a 56 KiB, 500 KiB, 1 MiB, or 2 MiB chunk; split larger samples' }, { status: 400 });
	const limit = await enforceRateLimit(request, 'networkProbe.upload.v2', null, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Network probe rate limit reached' }, rateLimitedResponseInit(limit));
	await readExactNetworkProbeUpload(request, bytes);
	return json({ ok: true, bytes }, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
