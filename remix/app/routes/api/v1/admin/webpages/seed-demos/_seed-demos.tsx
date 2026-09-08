import { json } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { countSeededWebpages, seedDemoSuites, seedDemoWebpages } from '~/api/utils/webpages/seed';

// POST /api/v1/admin/webpages/seed-demos — upsert the builder DEMO LIBRARY:
// every webpage demo (shareId webpage-demo-<slug>) AND every behaviour suite
// part (schema-demo-*, component-demo-*, action-demo-*, data-demo-*,
// webpage-demo-suite-*) as system-owned public things, so every demo opens at
// /p/ and in the builder and every suite part is browsable on its kind's
// page. The catalogs are the deterministic schemas/webpageDemos +
// schemas/behaviourSuites modules, so the POST takes no payload. Admin-only,
// idempotent, self-healing — the same envelope and reconciling upsert as the
// site-page seed. The report sums both passes; `suites` carries the suite
// pass on its own.
//
// GET returns the seed census (site + demo + suite counts) without mutating.
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

		const pages = await seedDemoWebpages();
		if (pages.ok === false) {
			return json({ ok: false, error: pages.error }, { status: pages.status });
		}
		const suites = await seedDemoSuites();
		if (suites.ok === false) {
			return json({ ok: false, error: suites.error }, { status: suites.status });
		}
		return json({
			ok: true,
			received: pages.received + suites.received,
			created: pages.created + suites.created,
			refreshed: pages.refreshed + suites.refreshed,
			unchanged: pages.unchanged + suites.unchanged,
			skipped: pages.skipped + suites.skipped,
			notes: [...pages.notes, ...suites.notes].slice(0, 40),
			totalSeeded: suites.totalSeeded,
			suites
		});
	});
