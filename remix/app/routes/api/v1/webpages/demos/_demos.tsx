import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listWebpageDemos } from '~/api/utils/webpages/demos';

// GET /api/v1/webpages/demos — the builder demo library: a deterministic
// catalog of example sections, full pages, and component-block pages, with
// each entry's seeded flag (whether its system webpage-demo-<slug> doc exists
// on this deployment, i.e. whether /p/ and the builder can open it directly).
//
//   ?family=<key>  only that family
//   ?kind=<kind>   section | page | component
//   ?slug=<slug>   one demo, WITH its block tree (for "use this template")
//   ?suite=<key>   one behaviour suite WITH its installable bundle (schemas,
//                  components, actions, data, page — own-mode references)
//
// Every response also lists the behaviour suites (summary + seeded flag) and
// components/refs — the platform library components the component-kind demos
// reference, in the same shape /webpages/resolve returns them.
// Public and read-only: the catalogs are code, the seeded census is one
// indexed projection query. The gallery paints the catalog before this answers.
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);

	const limit = await enforceRateLimit(request, 'webpages.demos', user ? `user:${user.id}` : null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Demo browsing is rate-limited — take a breath 🌿' }, rateLimitedResponseInit(limit));
	}

	const params = new URL(request.url).searchParams;
	const result = await listWebpageDemos({
		family: params.get('family') || undefined,
		kind: params.get('kind') || undefined,
		slug: params.get('slug') || undefined,
		suite: params.get('suite') || undefined
	});
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};
