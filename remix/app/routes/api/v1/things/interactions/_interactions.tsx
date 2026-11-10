import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { readInteractionStates, writeInteractionState, viewerOf } from '~/api/utils/things/things';
import { interactionWrite } from '~/utils/interactionState';

const headers = { 'Cache-Control': 'private, no-store' };
async function handle(request: Request) {
	if (
		request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
		(request.method !== 'GET' && request.headers.get('Origin') !== resolvePublicOrigin(request).origin)
	)
		return json({ ok: false, error: 'Use the same Thingtime origin.' }, { status: 403, headers });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
	let command: ReturnType<typeof interactionWrite> | undefined;
	if (request.method !== 'GET') {
		try {
			command = interactionWrite(await readJsonBody(request, 4096));
		} catch (error) {
			if (error instanceof Response) {
				error.headers.set('Cache-Control', 'private, no-store');
				throw error;
			}
			return json({ ok: false, error: error instanceof Error ? error.message : 'Invalid interaction command' }, { status: 400, headers });
		}
	}
	const limit = await enforceRateLimit(request, command?.kind === 'reaction' ? 'things.react' : 'things.save', `user:${user.id}`);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'Interaction requests are rate-limited. Retry shortly.' }, { ...init, headers: { ...init.headers, ...headers } });
	}
	const result = command
		? await writeInteractionState(viewerOf(user), command)
		: await readInteractionStates(
				viewerOf(user),
				new URL(request.url).searchParams.getAll('id').flatMap((value) => value.split(','))
		  );
	return json(result, { status: result.ok === false ? result.status : 200, headers });
}
export const loader = ({ request }: { request: Request }) => handle(request);
export const action = ({ request }: { request: Request }) => handle(request);
