import { json } from '~/api/http';

import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';

// GET /api/v1/fedcm/client-metadata — links the browser shows alongside the
// consent sheet for a given client_id. Thingtime's own pages and registered
// apps share the platform policies.
export const loader = async ({ request }: { request: Request }) => {
	const origin = resolvePublicOrigin(request).origin;
	return json({
		privacy_policy_url: `${origin}/`,
		terms_of_service_url: `${origin}/`
	});
};
