import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { enforceFixedRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import {
	approveWatchPairing,
	claimWatchPairing,
	inspectWatchPairing,
	lookupWatchPairing,
	offerWatchPairing,
	pendingWatchPairings,
	startWatchPairing
} from '~/api/utils/watch/watchPairing';

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const limitedResponse = (limit: Parameters<typeof rateLimitedResponseInit>[0]) => {
	const response = rateLimitedResponseInit(limit);
	return { ...response, headers: { ...response.headers, ...noStore } };
};

export const loader = async ({ request }: { request: Request }) => {
	const limit = await enforceFixedRateLimit(request, 'watch.pairing.inspect', null, { limit: 60, windowMs: 60_000 });
	if (!limit.allowed) return json({ ok: false, error: 'Please wait a moment before checking this code again.' }, limitedResponse(limit));
	const url = new URL(request.url);
	if (url.searchParams.get('op') === 'pending') {
		const user = await getCurrentUser(request);
		if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: noStore });
		return json({ ...(await pendingWatchPairings(user.id)), account: { id: user.id, username: user.username } }, { headers: noStore });
	}
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
	if (!['start', 'claim', 'lookup', 'approve', 'offer'].includes(op)) {
		return json({ ok: false, error: 'op must be start, lookup, offer, approve or claim' }, { status: 400, headers: noStore });
	}
	// Polling must not exhaust the much smaller budget for code creation or guesses.
	const rule = op === 'claim' ? { limit: 60, windowMs: 60_000 } : { limit: op === 'lookup' ? 10 : 20, windowMs: 5 * 60_000 };
	const limit = await enforceFixedRateLimit(request, `watch.pairing.${op}`, null, rule);
	if (!limit.allowed) {
		return json({ ok: false, code: 'slow_down', error: 'Please wait a moment before trying again.' }, limitedResponse(limit));
	}

	if (op === 'start') {
		if (typeof body.targetUsername === 'string' && body.targetUsername.trim()) {
			const targetLimit = await enforceFixedRateLimit(
				request,
				'watch.pairing.target',
				body.targetUsername.trim().replace(/^@/, '').toLowerCase().slice(0, 80),
				{ limit: 5, windowMs: 5 * 60_000 }
			);
			if (!targetLimit.allowed)
				return json({ ok: false, error: 'Please wait before sending this account another Watch request.' }, limitedResponse(targetLimit));
		}
		const result = await startWatchPairing(body);
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		return json(result, { status: 201, headers: noStore });
	}
	if (op === 'claim') {
		const result = await claimWatchPairing(body);
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		return json(result, { headers: noStore });
	}
	if (op === 'approve' || op === 'lookup' || op === 'offer') {
		if (!isSameOriginAttachmentRequest(request)) {
			return json({ ok: false, error: 'Cross-origin pairing approval is not allowed' }, { status: 403, headers: noStore });
		}
		const user = await getCurrentUser(request);
		if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: noStore });
		const accountLimit = await enforceFixedRateLimit(request, `watch.pairing.${op}.account`, user.id, {
			limit: op === 'lookup' ? 5 : 10,
			windowMs: 5 * 60_000
		});
		if (!accountLimit.allowed) return json({ ok: false, error: 'Please wait before trying more Watch codes.' }, limitedResponse(accountLimit));
		if (op === 'lookup') {
			const result = await lookupWatchPairing(body.userCode, user.id);
			if (result.ok === false) return json(result, { status: result.status, headers: noStore });
			return json(result, { headers: noStore });
		}
		if (op === 'offer') {
			const offered = await offerWatchPairing(user.id, body);
			return json(offered.ok ? { ...offered, account: { id: user.id, username: user.username } } : offered, {
				status: offered.ok ? 200 : offered.status,
				headers: noStore
			});
		}
		const result = await approveWatchPairing(user.id, body);
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		return json(result, { headers: noStore });
	}
	return json({ ok: false, error: 'Invalid pairing operation' }, { status: 400, headers: noStore });
};
