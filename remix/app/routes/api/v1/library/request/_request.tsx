import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { API_EXAMPLES } from '~/library/apis';
import { runLibraryRequest } from '~/api/utils/library/request';
const headers = { 'Cache-Control': 'no-store' };
export async function action({ request }: { request: Request }) {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers });
	const user = await getCurrentUser(request);
	if (!user || user.temporary) return json({ ok: false, error: 'Sign in with a full account to use an API key.' }, { status: 401, headers });
	const unsupported = requireJsonContentType(request);
	if (unsupported) {
		unsupported.headers.set('Cache-Control', 'no-store');
		return unsupported;
	}
	const limit = await enforceRateLimit(request, 'library.request', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		const limitedHeaders = new Headers(init.headers);
		limitedHeaders.set('Cache-Control', 'no-store');
		return json({ ok: false, error: 'Please wait before running another API example.' }, { ...init, headers: limitedHeaders });
	}
	try {
		const body = await readJsonBody(request, 24 * 1024);
		const example = API_EXAMPLES.find((item) => item.id === body?.exampleId);
		if (!example?.request?.auth || typeof body.apiKey !== 'string')
			return json({ ok: false, error: 'Choose a supported credentialed example.' }, { status: 400, headers });
		const result = await runLibraryRequest(example, body.input, body.apiKey);
		return json({ ok: true, result }, { headers });
	} catch (error) {
		if (error instanceof Response && error.status === 413) {
			error.headers.set('Cache-Control', 'no-store');
			return error;
		}
		// Never send upstream bodies, request URLs, secret-bearing exceptions or inputs to logs/toasts.
		return json(
			{ ok: false, error: 'API request failed. Check the key, provider permissions, inputs and quota. Stripe requires a test-mode key.' },
			{ status: 400, headers }
		);
	}
}
