import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { runAction } from '~/api/utils/actions/execute';
import { isFail, viewerOf, withFriendIds, withLinkKeys } from '~/api/utils/things/things';
import { resolveSharedComposition } from '~/api/utils/actions/sharedComposition';

// POST /api/v1/actions/run — execute one action thing inside its declared
// capability + budget envelope. Ordinary runs require a user session. Shared
// runs instead authorize a stored root and execute read-only, without private
// author/visitor account authority or persistent run records.
const MAX_BODY_BYTES = 96 * 1024; // 64KB input ceiling + envelope headroom

export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	const limit = await enforceRateLimit(request, 'actions.run', user ? `user:${user.id}` : null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Actions are running very fast — take a breather ⚡' }, rateLimitedResponseInit(limit));
	}
	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const sharedRoot = body?.sharedRoot;
	if (sharedRoot !== undefined && (typeof sharedRoot !== 'string' || !sharedRoot || sharedRoot.length > 128)) {
		return json({ ok: false, error: 'sharedRoot must be a Thing id' }, { status: 400 });
	}
	if (!user && !sharedRoot) return json({ ok: false, error: 'Sign in to run actions' }, { status: 401 });
	const viewer = await withFriendIds(withLinkKeys(user ? viewerOf(user) : null, [typeof body?.key === 'string' ? body.key : '']));
	const shared = sharedRoot ? await resolveSharedComposition(viewer, sharedRoot, { contentRoot: true }) : undefined;
	if (isFail(shared)) return json({ ok: false, error: shared.error }, { status: shared.status });
	const result = await runAction(user ? viewerOf(user) : null, { action: body?.action, inputs: body?.inputs, source: body?.source }, shared);
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
	return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
};
