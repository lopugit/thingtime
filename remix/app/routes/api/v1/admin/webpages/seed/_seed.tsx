import { json } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { countSeededWebpages, seedSiteWebpages } from '~/api/utils/webpages/seed';

// POST /api/v1/admin/webpages/seed — upsert the built-in SITE PAGE docs
// (shareId webpage-route-<key>, one per app route, native-block bodies) plus
// the site-global doc, as system-owned public webpage things. The definitions
// are a deterministic server-side table, so the POST takes no payload.
// Admin-only, idempotent, self-healing: re-runs refresh drifted crystals and
// skip foreign docs squatting a destination id.
//
// GET returns the seed census ({ totalSeeded }) without mutating anything.
export const loader = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		return json(await countSeededWebpages());
	});

export const action = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

		// fail-closed: a broken limiter must never let a seed loop hammer writes
		const limit = await enforceRateLimit(request, 'webpages.seed', `user:${gate.user.id}`, { failClosed: true });
		if (!limit.allowed) {
			return json({ ok: false, error: 'Seeding is rate-limited — pause between runs 🌱' }, rateLimitedResponseInit(limit));
		}

		const result = await seedSiteWebpages();
		if (result.ok === false) {
			return json({ ok: false, error: result.error }, { status: result.status });
		}
		return json(result);
	});
