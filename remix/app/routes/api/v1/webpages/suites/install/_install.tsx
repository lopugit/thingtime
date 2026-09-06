import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { viewerOf } from '~/api/utils/things/things';
import { installSuiteForViewer } from '~/api/utils/webpages/suites';

// POST /api/v1/webpages/suites/install { key } — install (or re-install) a
// behaviour suite / app suite into the caller's own things in one request.
// Idempotent: parts are upserted by their stable keys (schema name,
// componentKey, actionKey, pageKey, sample stamp), so running it again after
// the catalog changed updates the caller's copy in place and never
// duplicates. Session-only like actions.run: an install writes programs the
// caller will then run as themselves.
const MAX_BODY_BYTES = 4 * 1024;

export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Sign in to install a suite' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'webpages.install', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Installs are rate-limited — give it a minute 🌱' }, rateLimitedResponseInit(limit));
	}
	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const result = await installSuiteForViewer(viewerOf(user), body?.key);
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
	return json(result);
};
