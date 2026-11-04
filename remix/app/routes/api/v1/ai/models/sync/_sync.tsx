import { timingSafeEqual } from 'node:crypto';
import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { syncAiProviderModels } from '~/api/utils/ai/modelSync';

export const createAiModelSyncLoader =
	(dependencies = { secret: () => process.env.CRON_SECRET, sync: syncAiProviderModels }) =>
	async ({ request }: { request: Request }) =>
		withAdminPrivateResponse(async () => {
			if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
			const secret = dependencies.secret();
			if (!secret?.trim()) return json({ ok: false, error: 'Model sync is not configured' }, { status: 503 });
			const actual = Buffer.from(request.headers.get('Authorization') ?? '');
			const expected = Buffer.from(`Bearer ${secret}`);
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
			const report = await dependencies.sync('scheduled');
			const ok = report.every((row) => row.status !== 'failed');
			return json({ ok, report }, { status: ok ? 200 : 503 });
		});
export const loader = createAiModelSyncLoader();
export const action = loader;
