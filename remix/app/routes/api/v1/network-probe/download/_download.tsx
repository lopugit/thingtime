import { json } from '~/api/http';
import { networkProbeDownloadResponse, parseNetworkProbePacketBytes } from '~/api/utils/networkProbe';
import { networkProbeAccess } from '~/api/utils/networkProbeAccess';

// GET /api/v1/network-probe/download?bytes=<fixed ladder value> — bounded,
// non-cacheable transfer measurement. Only the documented packet sizes work.
export const loader = async ({ request }: { request: Request }) => {
	const bytes = parseNetworkProbePacketBytes(new URL(request.url).searchParams.get('bytes'));
	if (!bytes) return json({ ok: false, error: 'bytes must be a supported network probe packet size' }, { status: 400 });
	const denied = await networkProbeAccess(request, 'download');
	if (denied) return denied;
	return networkProbeDownloadResponse(bytes);
};
