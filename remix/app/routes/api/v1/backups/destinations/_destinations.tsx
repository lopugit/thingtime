import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { backupDestinationRegistry } from '~/api/utils/backups/backupDestinations';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const privateHeaders = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
export function createBackupDestinationHandlers(overrides: Partial<{
	user: typeof getCurrentUser; plane: typeof mongoDataPlane;
	discover: typeof backupDestinationRegistry.discover; limit: typeof enforceRateLimit;
}> = {}) {
	const deps = { user: getCurrentUser, plane: mongoDataPlane, discover: backupDestinationRegistry.discover, limit: enforceRateLimit, ...overrides };
	const loader = async ({ request }: { request: Request }) => {
		const reply = (body: unknown, status = 200) => json(body, { status, headers: privateHeaders });
		if (request.method !== 'GET') return reply({ ok: false, error: 'Method not allowed' }, 405);
		const origin = resolvePublicOrigin(request).origin;
		if ((request.headers.has('Origin') && request.headers.get('Origin') !== origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
			return reply({ ok: false, error: 'Use the selected Thingtime origin' }, 403);
		if (new URL(request.url).search) return reply({ ok: false, error: 'Destination discovery does not accept selectors' }, 400);
		if (internalRequestActor(request)) return reply({ ok: false, error: 'Use your full account session' }, 403);
		const user = await deps.user(request);
		if (!user) return reply({ ok: false, error: 'Unauthorized' }, 401);
		if (user.temporary || user.isCharacter || user.accountKind !== 'user') return reply({ ok: false, error: 'A full Thingtime account is required' }, 403);
		const expected = request.headers.get(EXPECTED_ACTOR_HEADER);
		if (expected !== null && expected !== user.id) return reply({ ok: false, error: 'The active account changed' }, 409);
		if (deps.plane() !== 'home') return reply({ ok: false, error: 'Backups require home storage' }, 409);
		const limit = await deps.limit(request, 'backups.destinations', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) {
			const init = rateLimitedResponseInit(limit);
			return json({ ok: false, error: 'Retry destination discovery shortly' }, { ...init,
				headers: { ...Object.fromEntries(new Headers(init.headers)), ...privateHeaders } });
		}
		return reply(await deps.discover(origin));
	};
	return { loader };
}
export const { loader } = createBackupDestinationHandlers();
