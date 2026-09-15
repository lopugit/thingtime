import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { systemEnvironmentStore } from '~/api/utils/admin/systemEnvironment';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { deriveWebAuthnParams } from '~/api/utils/auth/passkeys';

export const createSystemEnvironmentHandlers = (deps = { requireAdmin, systemEnvironmentStore }) => {
	const handle = async (request: Request, mutate: boolean) =>
		withAdminPrivateResponse(async () => {
			const gate = await deps.requireAdmin(request);
			if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
			try {
				if (
					mutate &&
					(request.method !== 'POST' ||
						request.headers.get('Origin') !== deriveWebAuthnParams(request).origin ||
						request.headers.get('Sec-Fetch-Site') === 'cross-site')
				)
					return json({ ok: false, error: 'Same-origin POST required.' }, { status: 403 });
				const store = await deps.systemEnvironmentStore();
				if (!store)
					return mutate
						? json({ ok: false, error: 'Environment management is not configured.' }, { status: 503 })
						: json({ ok: true, configured: false, entries: [] });
				if (mutate) {
					if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
						return json({ ok: false, error: 'JSON required.' }, { status: 415 });
					const body = await readJsonBody(request, 40 * 1024);
					if (!body || typeof body !== 'object' || Array.isArray(body))
						return json({ ok: false, error: 'Invalid environment action.' }, { status: 400 });
					await store.mutate(body);
				}
				return json({ ok: true, configured: true, entries: await store.list(), ...(mutate ? { requiresRedeploy: true } : {}) });
			} catch (error) {
				if (error instanceof Response) throw error;
				return json(
					{ ok: false, error: 'Environment request failed. Check project access, key, and environment; refresh before retrying a change.' },
					{ status: 409 }
				);
			}
		});
	return {
		loader: ({ request }: { request: Request }) => handle(request, false),
		action: ({ request }: { request: Request }) => handle(request, true)
	};
};
export const { loader, action } = createSystemEnvironmentHandlers();
