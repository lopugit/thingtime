import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getEmbeddedThing, listEmbeddedThings, saveEmbeddedThing } from '~/api/utils/things/embeddedThings';

const MAX_BODY_BYTES = 300 * 1024;

const withPublicReadCors = (response: Response) => {
	response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
	response.headers.set('Access-Control-Allow-Origin', '*');
	response.headers.set('Access-Control-Max-Age', '86400');
	return response;
};

// A GET body depends on who is asking: a cross-site caller gets the anonymous
// public projection, a first-party one may get its own private thing. Say so, so
// a shared cache cannot serve one audience's variant to the other. no-store is
// the belt here and Vary the braces — errors carry it too, because a 404 is the
// "does this id exist" answer and it is equally auth-dependent.
const withOriginVariance = (response: Response) => {
	response.headers.append('Vary', 'Origin');
	return response;
};

const resultResponse = (result: any) =>
	result.ok === false
		? json(
				{ ok: false, error: result.error, ...(result.thing ? { thing: result.thing } : {}) },
				{ status: result.status, headers: { 'Cache-Control': 'no-store' } }
		  )
		: json(result, { headers: { 'Cache-Control': 'no-store' } });

// GET /api/v1/embed/things?id=<share-id> — public things are readable from
// any origin. Without id, lists the current user's embedded things.
export const loader = async ({ request }: { request: Request }) => {
	const url = new URL(request.url);
	const id = url.searchParams.get('id');
	const requestOrigin = request.headers.get('Origin');
	const isCrossOrigin = !!requestOrigin && requestOrigin !== url.origin;
	// Cross-site callers receive the anonymous public projection only. Private
	// reads and owner lists stay first-party in the Thingtime popup/app.
	const user = isCrossOrigin ? null : await getCurrentUser(request);

	// This is the one anonymous cross-origin read in the API, so it must be
	// bounded like the other public reads (things.search / schemas.browse).
	// Anonymous callers key by IP; signed-in first-party callers by user. The
	// 429 keeps its CORS headers so a host page sees a real status instead of an
	// opaque network error it cannot report.
	const limit = await enforceRateLimit(request, 'embed.read', user ? `user:${user.id}` : null);
	if (!limit.allowed) {
		const limited = json({ ok: false, error: 'Too many embed reads — take a breather 🌸' }, rateLimitedResponseInit(limit));
		return withOriginVariance(isCrossOrigin ? withPublicReadCors(limited) : limited);
	}

	if (id) {
		const response = resultResponse(await getEmbeddedThing(user?.id || null, id));
		return withOriginVariance(isCrossOrigin ? withPublicReadCors(response) : response);
	}
	if (!user) return withOriginVariance(resultResponse({ ok: false, status: 401, error: 'Unauthorized' }));
	return withOriginVariance(resultResponse(await listEmbeddedThings(user.id)));
};

// POST /api/v1/embed/things — create or version-safely update an embedded
// thing. Browser embeds should use same-origin auth; external integrations can
// use the existing Authorization: Bearer flow.
export const action = async ({ request }: { request: Request }) => {
	if (request.method === 'OPTIONS') {
		return withPublicReadCors(new Response(null, { status: 204 }));
	}
	if (request.method !== 'POST') {
		return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
	}
	const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
	if (contentType !== 'application/json') {
		return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
	}

	const authorization = request.headers.get('Authorization');
	const hasBearer = authorization?.startsWith('Bearer ') && authorization.slice(7).trim();
	const requestOrigin = request.headers.get('Origin');
	const requestUrl = new URL(request.url);
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	const unsafeCookieOrigin =
		!hasBearer && ((requestOrigin && requestOrigin !== requestUrl.origin) || fetchSite === 'cross-site' || fetchSite === 'same-site');
	if (unsafeCookieOrigin) {
		return json({ ok: false, error: 'Cross-origin cookie-authenticated writes are not allowed' }, { status: 403 });
	}

	const user = await getCurrentUser(request);
	if (!user) return resultResponse({ ok: false, status: 401, error: 'Unauthorized' });

	// MAX_THINGS_PER_OWNER bounds how many embeds exist, not how fast they
	// churn — each save costs a count + find + CAS update, so throttle the rate
	// too. Rate-limited before the body is read so a flood cannot force the
	// 300 KB body parse.
	const limit = await enforceRateLimit(request, 'embed.write', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Saving embeds very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	return resultResponse(await saveEmbeddedThing(user.id, body));
};
