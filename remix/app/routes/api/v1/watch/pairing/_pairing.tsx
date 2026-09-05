import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import {
	approveWatchPairing,
	claimWatchPairing,
	inspectWatchPairing,
	startWatchPairing
} from '~/api/utils/watch/watchPairing';

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export const loader = async ({ request }: { request: Request }) => {
	const url = new URL(request.url);
	const result = await inspectWatchPairing(url.searchParams.get('pairing'), url.searchParams.get('code'));
	if (result.ok === false) return json(result, { status: result.status, headers: noStore });
	return json(result, { headers: noStore });
};

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
		return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
	}
	const body = await readJsonBody(request, 32 * 1024);
	const op = typeof body?.op === 'string' ? body.op : '';
	const limit = await enforceRateLimit(request, 'devices.pairing.claim', null, { failClosed: true });
	if (!limit.allowed) {
		return json({ ok: false, error: 'Watch pairing is temporarily unavailable or moving too quickly' }, rateLimitedResponseInit(limit));
	}

	if (op === 'start') {
		const result = await startWatchPairing(body);
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		return json(result, { status: 201, headers: noStore });
	}
	if (op === 'claim') {
		const result = await claimWatchPairing(body);
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		return json(result, { headers: noStore });
	}
	if (op === 'approve') {
		if (!isSameOriginAttachmentRequest(request)) {
			return json({ ok: false, error: 'Cross-origin pairing approval is not allowed' }, { status: 403, headers: noStore });
		}
		const user = await getCurrentUser(request);
		if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: noStore });
		const result = await approveWatchPairing(user.id, body);
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		return json(result, { headers: noStore });
	}
	return json({ ok: false, error: 'op must be start, approve or claim' }, { status: 400, headers: noStore });
};
