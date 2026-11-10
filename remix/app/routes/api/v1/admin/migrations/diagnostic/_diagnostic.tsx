import { json } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { getMigrationDiagnostic } from '~/api/utils/migrations/migrationDiagnostics';

// GET /api/v1/admin/migrations/diagnostic?id=<migration-diagnostic-id> —
// current-admin, exact-owner read of a short-lived home-plane error report.
// The generic Things API intentionally cannot decode or expose these records.
export const loader = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

		const id = new URL(request.url).searchParams.get('id');
		const diagnostic = await getMigrationDiagnostic(gate.user.id, id);
		if (!diagnostic) return json({ ok: false, error: 'Diagnostic not found' }, { status: 404 });
		return json({ ok: true, diagnostic });
	});
