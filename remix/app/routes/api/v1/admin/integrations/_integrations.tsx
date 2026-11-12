import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import {
	createAdminSecret,
	deleteAdminEndpoint,
	deleteAdminSecret,
	listAdminIntegrations,
	proxyAdminIntegration,
	saveAdminEndpoint
} from '~/api/utils/admin/integrations';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';

// GET  /api/v1/admin/integrations — write-only vault metadata, endpoint
// policies, and redacted audit rows. POST accepts one explicit action. Secret
// values are accepted only for create-secret and are never returned.
export const loader = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		return json({ ok: true, ...(await listAdminIntegrations()) });
	});

export const action = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		const body = await readJsonBody(request, 40 * 1024);
		try {
			switch (body?.action) {
				case 'create-secret': {
					const secret = await createAdminSecret(body, gate.user.id);
					return json({ ok: true, secret });
				}
				case 'delete-secret':
					await deleteAdminSecret(body?.id);
					return json({ ok: true });
				case 'save-endpoint': {
					const endpoint = await saveAdminEndpoint(body?.endpoint || {}, gate.user.id);
					return json({ ok: true, endpoint });
				}
				case 'delete-endpoint':
					await deleteAdminEndpoint(body?.id);
					return json({ ok: true });
				case 'proxy': {
					const result = await proxyAdminIntegration(request, gate.user.id, body);
					if (!result.ok) return json(result, result.init);
					return json({ ok: true, ...result.result });
				}
				default:
					return json({ ok: false, error: 'Unknown integration action.' }, { status: 400 });
			}
		} catch (error: any) {
			// Integration utilities deliberately use fixed, credential-free errors.
			return json({ ok: false, error: typeof error?.message === 'string' ? error.message : 'Integration action failed.' }, { status: 400 });
		}
	});
