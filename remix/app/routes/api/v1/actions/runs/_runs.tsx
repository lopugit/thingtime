import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listActionRuns } from '~/api/utils/actions/execute';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/actions/runs?action=<id>&limit=<n> — the viewer's own run
// records, newest first. action-run things are PROTECTED (invisible to the
// generic reads), so history has this dedicated read model.
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Sign in to see your action runs' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'actions.runs', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'You’re reading run history very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}
	const params = new URL(request.url).searchParams;
	const result = await listActionRuns(viewerOf(user), {
		action: params.get('action'),
		limit: params.get('limit') ? Number(params.get('limit')) : undefined
	});
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
	return json(result);
};
