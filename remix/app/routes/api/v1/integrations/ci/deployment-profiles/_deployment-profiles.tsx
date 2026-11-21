import { readControllerRequestBody } from '~/api/utils/ciControl/controllerRequestBody';
import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { listDeploymentProfiles } from '~/api/utils/ciControl/deploymentProfiles';
import { validPreviewRetentionRead } from '~/api/utils/ciControl/previewRetentionCore';
import { verifyCiProviderRouteSignature } from '~/api/utils/ciControl/providerRouter';

type Dependencies = { get: typeof listDeploymentProfiles; secret: () => string; repository: () => string };
export const createControllerDeploymentProfilesHandler =
	(deps: Dependencies) =>
	({ request }: { request: Request }) =>
		withAdminPrivateResponse(async () => {
			if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
			const secret = deps.secret();
			if (!secret) return json({ ok: false, error: 'Controller authentication is unavailable.' }, { status: 503 });
			const raw = await readControllerRequestBody(request);
			if (raw instanceof Response) return raw;
			if (!verifyCiProviderRouteSignature(raw, request.headers.get('x-thingtime-ci-signature'), secret))
				return json({ ok: false, error: 'Invalid controller signature.' }, { status: 403 });
			const repository = deps.repository();
			let body: unknown;
			try {
				body = JSON.parse(raw);
			} catch {
				return json({ ok: false, error: 'Invalid request' }, { status: 400 });
			}
			if ((body as { purpose?: unknown } | null)?.purpose !== 'deployment-profiles' || !validPreviewRetentionRead(body, repository))
				return json({ ok: false, error: 'Invalid repository, controller ref or request time.' }, { status: 400 });
			try {
				return json({ ok: true, repository, profiles: (await deps.get()).map(({ revision, ...profile }) => profile) });
			} catch {
				return json({ ok: false, error: 'Deployment profiles are unavailable.' }, { status: 503 });
			}
		});
export const action = createControllerDeploymentProfilesHandler({
	get: listDeploymentProfiles,
	secret: () => process.env.THINGTIME_CI_ROUTER_SECRET?.trim() ?? '',
	repository: () => process.env.THINGTIME_GITHUB_REPOSITORY?.trim() || 'lopugit/thingtime'
});
