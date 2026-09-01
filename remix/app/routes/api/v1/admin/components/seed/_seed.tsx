import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { countSeededComponents, seedComponents } from '~/api/utils/components/seed';

// POST /api/v1/admin/components/seed — upsert a batch of components-db
// definitions as system-owned public component things (shareId
// component-<slug>). Admin-only, idempotent, self-healing: re-runs refresh
// drifted crystals and skip foreign docs squatting a destination id. Body:
// { components: [definition, …] } (max 100 per call).
//
// GET returns the seed census ({ totalSeeded }) so tooling can check progress
// without mutating anything.
export const loader = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		return json(await countSeededComponents());
	});

export const action = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

		// fail-closed: a broken limiter must never let a seed loop hammer writes
		const limit = await enforceRateLimit(request, 'components.seed', `user:${gate.user.id}`, { failClosed: true });
		if (!limit.allowed) {
			return json({ ok: false, error: 'Seeding is rate-limited — pause between batches 🌱' }, rateLimitedResponseInit(limit));
		}

		const body: any = await readJsonBody(request, 2 * 1024 * 1024);
		const result = await seedComponents(body?.components);
		if (result.ok === false) {
			return json({ ok: false, error: result.error }, { status: result.status });
		}
		return json(result);
	});
