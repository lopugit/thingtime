import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getScopedUser } from '~/api/utils/auth/scopedUser';
import { assertLopuAccess, lopuAccessResponse } from '~/api/utils/lopu/access';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { parseLopuNetworkRequest } from '~/api/utils/lopu/networkCore';
import { lopuNetworkRequest } from '~/api/utils/lopu/network.server';

export async function action({ request }: { request: Request }) {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const user = await getScopedUser(request, 'lopu.chat');
	if (!user || user.temporary) return json({ ok: false, error: 'Sign in with a full account.' }, { status: 401 });
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const access = await assertLopuAccess(user, { billing: 'free' });
	if (access.ok === false) return lopuAccessResponse(access);
	const limit = await enforceRateLimit(request, 'lopu.chat', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Network request limit reached.' }, rateLimitedResponseInit(limit));
	let input;
	try {
		input = parseLopuNetworkRequest(await readJsonBody(request, 64 * 1024));
	} catch {
		return json({ ok: false, error: 'Invalid public HTTPS request.' }, { status: 400 });
	}
	try {
		return json({ ok: true, ...(await lopuNetworkRequest(input, request.signal)) }, { headers: { 'Cache-Control': 'private, no-store' } });
	} catch {
		return json(
			{
				ok: false,
				error:
					'Request failed: destination must be public HTTPS, without redirects, and return bounded text/JSON within 15 seconds. No automatic retry was performed.'
			},
			{ status: 502, headers: { 'Cache-Control': 'private, no-store' } }
		);
	}
}
