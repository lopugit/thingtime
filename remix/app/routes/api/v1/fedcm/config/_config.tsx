import { json } from '~/api/http';

import { fedcmConfigFor } from '~/api/utils/auth/fedcm';

// GET /api/v1/fedcm/config — the FedCM provider manifest the browser loads
// from configURL. Pure metadata: where the accounts, client-metadata, and
// assertion endpoints live on this deployment, plus branding for the native
// sheet. Discovered via /.well-known/web-identity at the domain root.
export const loader = async ({ request }: { request: Request }) => {
	return json(fedcmConfigFor(request));
};
