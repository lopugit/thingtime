import { json } from '~/api/http';
import { resolveSocialMetadata } from '~/api/utils/meta/socialMetadata';
import { runWithHomeMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export const createSocialPreviewsLoader = (overrides: Partial<{
	resolve: typeof resolveSocialMetadata;
	limit: typeof enforceRateLimit;
}> = {}) => async ({ request }: { request: Request }) => {
	if (!['GET', 'HEAD'].includes(request.method)) return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
	return runWithHomeMongoEndpoint(async () => {
		const outcome = await (overrides.limit || enforceRateLimit)(request, 'social-previews.read', null, { failClosed: true });
		if (!outcome.allowed) {
			const limited = rateLimitedResponseInit(outcome);
			return json({ ok: false, error: 'Preview temporarily unavailable. Try again later.' }, { ...limited, status: outcome.unavailable ? 503 : limited.status, headers: { ...limited.headers, ...headers } });
		}
		try {
			// Anonymous resolver accepts no viewer/request identity. Reset any custom
			// data-plane selection inherited from the API dispatcher as well.
			const metadata = await (overrides.resolve || resolveSocialMetadata)(request);
			return json({ ok: true, ...metadata }, { headers });
		} catch {
			return json({ ok: false, error: 'Use a page URL on this origin.' }, { status: 400, headers });
		}
	});
};
export const loader = createSocialPreviewsLoader();
export const action = loader;
