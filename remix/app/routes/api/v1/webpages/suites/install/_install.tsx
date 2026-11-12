import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '~/utils/dataPlane';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { viewerOf } from '~/api/utils/things/things';
import { installSuiteForViewer, SuiteInstallAdmissionError } from '~/api/utils/webpages/suites';

const MAX_BODY_BYTES = 4 * 1024;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, X-Thingtime-Character, X-Thingtime-Expected-Actor, X-Thingtime-Expected-Data-Plane', 'Referrer-Policy': 'no-referrer' };
const defaults = { getCurrentUser, mongoDataPlane, enforceRateLimit, installSuiteForViewer };
export function createSuiteInstallResponse(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async ({ request }: { request: Request }) => {
		const deny = (status: number, error: string, code?: string) => json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers });
		if (request.method !== 'POST') return deny(405, 'Use POST to install a suite');
		const origin = resolvePublicOrigin(request).origin;
		try {
			const body = await readJsonBody(request, MAX_BODY_BYTES);
			if (!body || typeof body !== 'object' || Array.isArray(body) || (body.requestId !== undefined && Object.keys(body).some(key => !['key', 'onlyMissing', 'requestId', 'bundleVersion'].includes(key))) ||
				(body.onlyMissing !== undefined && typeof body.onlyMissing !== 'boolean') || (body.requestId !== undefined && (typeof body.requestId !== 'string' || typeof body.bundleVersion !== 'string'))) return deny(400, 'Invalid suite installation request');
			if (body.requestId !== undefined) {
				if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return deny(403, 'Use the same Thingtime origin');
				const unsupported = requireJsonContentType(request);
				if (unsupported) { for (const [key, value] of Object.entries(headers)) unsupported.headers.set(key, value); return unsupported; }
				if (internalRequestActor(request)) return deny(403, 'A current account session is required');
			}
			const user = await deps.getCurrentUser(request);
			if (!user) return deny(401, 'Sign in to install a suite');
			const ownerId = user.id, plane = deps.mongoDataPlane(), expectedActor = request.headers.get(EXPECTED_ACTOR_HEADER), expectedPlane = request.headers.get(EXPECTED_DATA_PLANE_HEADER);
			if (body.requestId !== undefined && (!expectedActor || !isDataPlane(expectedPlane))) return deny(400, 'Confirm the account and database before installing');
			const admit = async () => {
				const current = await deps.getCurrentUser(request);
				if (!current || current.id !== ownerId || (expectedActor !== null && current.id !== expectedActor)) throw new SuiteInstallAdmissionError(current ? 409 : 401);
				if (deps.mongoDataPlane() !== plane || (expectedPlane !== null && expectedPlane !== plane)) throw new SuiteInstallAdmissionError(409);
			};
			await admit();
			const limit = await deps.enforceRateLimit(request, 'webpages.install', `user:${ownerId}`, { failClosed: true });
			if (!limit.allowed) { const init = rateLimitedResponseInit(limit); return json({ ok: false, error: 'Installs are rate limited. Retry the same operation shortly.' }, { ...init, headers: { ...init.headers, ...headers } }); }
			const result = await deps.installSuiteForViewer(viewerOf(user), body.key, { onlyMissing: body.onlyMissing === true,
				...(body.requestId === undefined ? {} : { requestId: body.requestId, bundleVersion: body.bundleVersion, origin, dataPlane: plane }), admit });
			await admit();
			if (result.ok === false) return deny(result.status, result.error, result.code);
			return json(result, { headers });
		} catch (error) {
			if (error instanceof SuiteInstallAdmissionError) return deny(error.status, error.message, error.code);
			if (error instanceof Response) { for (const [key, value] of Object.entries(headers)) error.headers.set(key, value); return error; }
			return deny(503, 'Suite installation could not be confirmed. Retry the same operation.');
		}
	};
}
export const action = createSuiteInstallResponse();
