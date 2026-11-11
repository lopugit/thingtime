import { json, readJsonBody } from '~/api/http';
import { claimDevicePairing } from '~/api/utils/devices/devices';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
		return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
	}
	const limit = await enforceRateLimit(request, 'devices.pairing.claim', null, { failClosed: true });
	if (!limit.allowed)
		return json({ ok: false, error: 'Pairing claims are temporarily unavailable or moving too quickly' }, rateLimitedResponseInit(limit));
	const result = await claimDevicePairing(await readJsonBody(request, 32 * 1024));
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
