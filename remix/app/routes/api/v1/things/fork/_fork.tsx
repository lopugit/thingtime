import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { isFail, viewerOf, withFriendIds, withLinkKeys } from '~/api/utils/things/things';
import { resolveSharedComposition } from '~/api/utils/actions/sharedComposition';
import { forkComposition } from '~/api/utils/actions/forkComposition';

export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Sign in to copy this app' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'webpages.install', `user:${user.id}`);
	if (!limit.allowed) return json({ ok: false, error: 'Copies are rate-limited — give it a minute' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 4096);
	if (typeof body?.id !== 'string' || !body.id || body.id.length > 128) return json({ ok: false, error: 'Pass the Thing id to copy' }, { status: 400 });
	const viewer = await withFriendIds(withLinkKeys(viewerOf(user), [typeof body?.key === 'string' ? body.key : '']));
	const composition = await resolveSharedComposition(viewer, body.id, { forCopy: true });
	if (isFail(composition)) return json({ ok: false, error: composition.error }, { status: composition.status });
	const result = await forkComposition(viewer, composition);
	return json(result, { status: isFail(result) ? result.status : 200, headers: { 'Cache-Control': 'private, no-store' } });
};
