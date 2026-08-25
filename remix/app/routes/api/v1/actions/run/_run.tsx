import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { runAction } from '~/api/utils/actions/execute';
import { viewerOf } from '~/api/utils/things/things';

// POST /api/v1/actions/run — execute one action thing inside its declared
// capability + budget envelope. Session-only in v1 (PATs stay default-denied
// until an explicit things.action scope exists); the executor delegates every
// operation to the ordinary things utils as this user, so this endpoint can
// never do more than the user could by hand.
const MAX_BODY_BYTES = 96 * 1024; // 64KB input ceiling + envelope headroom

export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Sign in to run actions' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'actions.run', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Actions are running very fast — take a breather ⚡' }, rateLimitedResponseInit(limit));
	}
	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const result = await runAction(viewerOf(user), { action: body?.action, inputs: body?.inputs, source: body?.source });
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
	return json(result);
};
