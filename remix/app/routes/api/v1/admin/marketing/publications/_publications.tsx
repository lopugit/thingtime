import { json, readJsonBody } from '~/api/http';

import { withMongoRequestBudget } from '~/api/utils/mongodb/requestBudget';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { applyMarketingPublicationChanges, getMarketingPublicationsResult } from '~/api/utils/marketing/marketingPublications';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { MAX_PUBLICATION_CHANGES } from '~/marketing/publishing';

// /api/v1/admin/marketing/publications — the admin side of marketing
// publishing (marketing/publishing.ts).
//
//   GET                → the current state WITH the per-key audit trail
//   POST { changes }   → publish / unpublish / hide / show up to
//                        MAX_PUBLICATION_CHANGES keys in one atomic write;
//                        every key is validated against the catalog and each
//                        target accepts only its own state ('published' for
//                        hub/social/category/page/feature keys, 'hidden' for
//                        section keys, null to clear). Responds with the
//                        full new state so the client reconciles in one hop.
//
// Admin-only, re-checked server-side on every call; the rate limit fails
// closed so a limiter outage cannot turn this into an unbounded write surface.

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' };

// 2,000 changes × ~100 bytes of key + state, with headroom.
const MAX_BODY_BYTES = 512 * 1024;

export const loader = async ({ request }: { request: Request }) => {
	try {
		return await withMongoRequestBudget(request.signal, 6000, async () => {
			const gate = await requireAdmin(request);
			if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: PRIVATE_HEADERS });
			const result = await getMarketingPublicationsResult({ audit: true });
			return json(result, {
				status: result.ok === false ? result.status : 200,
				headers: { ...PRIVATE_HEADERS, ...(!result.ok ? { 'Retry-After': '15' } : {}) }
			});
		});
	} catch {
		return json({ ok: false, freshness: 'unavailable', error: 'Marketing publishing is temporarily unavailable' }, {
			status: 503, headers: { ...PRIVATE_HEADERS, 'Retry-After': '15' }
		});
	}
};

export const action = async ({ request }: { request: Request }) => {
	const gate = await requireAdmin(request);
	if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: PRIVATE_HEADERS });

	const limit = await enforceRateLimit(request, 'admin.marketingPublications', `user:${gate.user.id}`, { failClosed: true });
	if (!limit.allowed) {
		return json({ ok: false, error: 'Publishing is rate-limited — one breath at a time 🌸' }, { ...rateLimitedResponseInit(limit), headers: { ...rateLimitedResponseInit(limit).headers, ...PRIVATE_HEADERS } });
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	if (!Array.isArray(body?.changes)) {
		return json({ ok: false, error: `changes must be an array of { key, state } (max ${MAX_PUBLICATION_CHANGES})` }, { status: 400, headers: PRIVATE_HEADERS });
	}

	const result = await applyMarketingPublicationChanges(body.changes, gate.user.username);
	if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status, headers: PRIVATE_HEADERS });
	return json({ ok: true, publications: result.publications, freshness: result.freshness, applied: result.applied }, { headers: PRIVATE_HEADERS });
};
