import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { boundedPeerLimit, decodePeerCursor, listKnownPeers } from '~/api/utils/peers/peerDiscovery';

// GET /api/v1/admin/peers — a private, cursor-paged diagnostic projection for
// administrators. The signed peer protocol at /api/v1/peers remains the only
// deployment-to-deployment interface; a browser can never obtain its keys or
// gossip cursor through this route.
export const loader = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

		const params = new URL(request.url).searchParams;
		const rawCursor = params.get('cursor');
		const cursor = decodePeerCursor(rawCursor);
		if (rawCursor && !cursor) return json({ ok: false, error: 'Invalid peer cursor' }, { status: 400 });

		return json({ ok: true, ...(await listKnownPeers({ cursor, limit: boundedPeerLimit(params.get('limit')) })) });
	});
