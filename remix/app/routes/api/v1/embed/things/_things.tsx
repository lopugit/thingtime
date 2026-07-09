import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getEmbeddedThing, listEmbeddedThings, saveEmbeddedThing } from '~/api/utils/things/embeddedThings';

const MAX_BODY_BYTES = 300 * 1024;

const withPublicReadCors = (response: Response) => {
	response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
	response.headers.set('Access-Control-Allow-Origin', '*');
	response.headers.set('Access-Control-Max-Age', '86400');
	return response;
};

const resultResponse = (result: any) =>
	result.ok === false
		? json({ ok: false, error: result.error, ...(result.thing ? { thing: result.thing } : {}) }, { status: result.status })
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

	if (id) {
		const response = resultResponse(await getEmbeddedThing(user?.id || null, id));
		return isCrossOrigin ? withPublicReadCors(response) : response;
	}
	if (!user) return resultResponse({ ok: false, status: 401, error: 'Unauthorized' });
	return resultResponse(await listEmbeddedThings(user.id));
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

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	return resultResponse(await saveEmbeddedThing(user.id, body));
};
