import { catalogueSnapshotBody } from '~/api/utils/catalogue/catalogueSnapshot';
import { readUserAlgorithmSelection, synchronizeAlgorithmSelection } from '~/api/utils/algorithms/algorithmSelection';
import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { CHARACTER_HEADER } from '~/api/utils/auth/characterSession';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '~/utils/dataPlane';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { algorithmSyncSnapshot, synchronizeAlgorithmWrite, AlgorithmSyncError } from '~/api/utils/algorithms/algorithmSync';
import { ALGORITHM_SYNC_MAX_BYTES } from '~/api/utils/algorithms/algorithmSyncContract';
const headers = {
	'Cache-Control': 'private, no-store',
	Vary: 'Cookie, Authorization, X-Thingtime-Character, X-Thingtime-Expected-Data-Plane',
	'Referrer-Policy': 'no-referrer'
};
const privateResponse = (response: Response) => {
	for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
	return response;
};
const defaults = {
	catalogueSnapshotBody,
	getAuthToken,
	resolveTokenUser,
	mongoDataPlane,
	enforceRateLimit,
	algorithmSyncSnapshot,
	synchronizeAlgorithmWrite,
	readUserAlgorithmSelection,
	synchronizeAlgorithmSelection
};
class Changed extends Error {
	constructor(readonly status: number, readonly code?: string) {
		super('Algorithm account confirmation changed.');
	}
}
export function createAlgorithmSyncResponse(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async ({ request }: { request: Request }) => {
		const deny = (status: number, error: string, code?: string) => json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers });
		try {
			if (request.method !== 'POST') return deny(405, 'Use POST for algorithm synchronization.');
			if (request.headers.get('Origin') !== resolvePublicOrigin(request).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
				return deny(403, 'Use the same Thingtime origin.');
			const unsupported = requireJsonContentType(request);
			if (unsupported) return privateResponse(unsupported);
			if (internalRequestActor(request)) return deny(403, 'A current account session is required.');
			const token = await deps.getAuthToken(request),
				expectedPlane = request.headers.get(EXPECTED_DATA_PLANE_HEADER);
			if (!isDataPlane(expectedPlane)) return deny(400, 'Confirm the selected database before synchronizing.', 'INVALID_DATA_PLANE');
			const body = await readJsonBody(request, ALGORITHM_SYNC_MAX_BYTES + 1024);
			if (
				!body ||
				typeof body !== 'object' ||
				Array.isArray(body) ||
				!['catalogue', 'snapshot', 'write', 'selection', 'select'].includes(body.operation) ||
				typeof body.expectedOwnerId !== 'string' ||
				!body.expectedOwnerId ||
				Object.keys(body).some(
					(key) =>
						!(['write', 'select'].includes(body.operation) ? ['operation', 'expectedOwnerId', 'command'] : ['operation', 'expectedOwnerId']).includes(
							key
						)
				) ||
				(['write', 'select'].includes(body.operation) && !body.command)
			)
				return deny(400, 'Invalid algorithm synchronization request.');
			const ownerId = body.expectedOwnerId;
			const admit = async () => {
				const account = token ? await deps.resolveTokenUser(token, request.headers.get(CHARACTER_HEADER)) : null;
				if (!account || account.user.temporary || account.user.accountKind === 'service') throw new Changed(401);
				if (account.user.id !== ownerId) throw new Changed(409, 'ACTOR_CHANGED');
				if (deps.mongoDataPlane() !== expectedPlane) throw new Changed(409, 'DATA_PLANE_CHANGED');
			};
			await admit();
			const limit = await deps.enforceRateLimit(request, 'algorithms.sync', `user:${ownerId}`, { failClosed: true });
			if (!limit.allowed) {
				const init = rateLimitedResponseInit(limit);
				return json({ ok: false, error: 'Algorithm synchronization is rate limited.' }, { ...init, headers: { ...init.headers, ...headers } });
			}
			if (body.operation === 'catalogue') {
				return new Response(deps.catalogueSnapshotBody({
					identity: { domain: 'algorithms', origin: resolvePublicOrigin(request).origin, ownerId, dataPlane: expectedPlane, storagePlane: 'home' },
					admit, signal: request.signal
				}), { headers: { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
			}
			const result =
				body.operation === 'snapshot'
					? { complete: true, algorithms: await deps.algorithmSyncSnapshot(ownerId) }
					: body.operation === 'selection'
					? { selection: await deps.readUserAlgorithmSelection(ownerId) }
					: body.operation === 'select'
					? { acknowledgment: await deps.synchronizeAlgorithmSelection(ownerId, body.command, admit) }
					: { acknowledgment: await deps.synchronizeAlgorithmWrite(ownerId, expectedPlane, body.command, admit) };
			await admit();
			return json({ ok: true, ownerId, dataPlane: expectedPlane, storagePlane: 'home', ...result }, { headers });
		} catch (error) {
			if (error instanceof Changed)
				return deny(error.status, 'Your account or database confirmation changed. Device changes have been kept.', error.code);
			if (error instanceof AlgorithmSyncError) return deny(error.status, error.message);
			if (error instanceof Response) return privateResponse(error);
			return deny(503, 'Algorithm synchronization is temporarily unavailable. Retry the same save; device changes have been kept.');
		}
	};
}
export const action = createAlgorithmSyncResponse();
