import { json } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { countSeededWebpages, seedDemoWebpages } from '~/api/utils/webpages/seed';

// POST /api/v1/admin/webpages/seed-demos — upsert the builder DEMO LIBRARY
// (shareId webpage-demo-<slug>, one system-owned public webpage thing per
// catalog entry) so every demo opens at /p/ and in the builder. The catalog is
// the deterministic schemas/webpageDemos module, so the POST takes no payload.
// Admin-only, idempotent, self-healing — the same envelope and reconciling
// upsert as the site-page seed.
//
// GET returns the seed census (site + demo counts) without mutating anything.
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

		const result = await seedDemoWebpages();
		if (result.ok === false) {
			return json({ ok: false, error: result.error }, { status: result.status });
		}
		return json(result);
	});
