import { JSON_BODY_WITHOUT_APPLICATION_LIMIT, json, readJsonBody, requireJsonContentType } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { listDeploymentProfiles, saveDeploymentProfile } from '~/api/utils/ciControl/deploymentProfiles';
import { DeploymentProfileConflict } from '~/api/utils/ciControl/deploymentProfilesCore';

type Dependencies = { requireAdmin: typeof requireAdmin; get: typeof listDeploymentProfiles; set: typeof saveDeploymentProfile };
export const createDeploymentProfileHandlers = (deps: Dependencies) => {
	const handle =
		(write: boolean) =>
		({ request }: { request: Request }) =>
			withAdminPrivateResponse(async () => {
				if (request.method !== (write ? 'POST' : 'GET')) return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
				const gate = await deps.requireAdmin(request);
				if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
				try {
					if (!write) return json({ ok: true, profiles: await deps.get() });
					const contentTypeError = requireJsonContentType(request);
					if (contentTypeError) return contentTypeError;
					if (request.headers.get('x-thingtime-expected-actor') !== gate.user.id)
						return json({ ok: false, error: 'The administrator account changed.' }, { status: 409 });
					const body = await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT);
					if (!(body?.expectedRevision === null || typeof body?.expectedRevision === 'string'))
						return json({ ok: false, error: 'Include the saved revision.' }, { status: 400 });
					return json({ ok: true, profile: await deps.set(body.profile, body.expectedRevision, gate.user.id) });
				} catch (error) {
					if (error instanceof Response) throw error;
					const status = error instanceof DeploymentProfileConflict ? 409 : write && error instanceof TypeError ? 400 : 503;
					return json({ ok: false, error: status === 503 ? 'Deployment profiles are unavailable.' : (error as Error).message }, { status });
				}
			});
	return { loader: handle(false), action: handle(true) };
};
export const { loader, action } = createDeploymentProfileHandlers({ requireAdmin, get: listDeploymentProfiles, set: saveDeploymentProfile });
