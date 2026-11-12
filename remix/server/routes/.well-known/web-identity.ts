import { defineHandler } from 'nitro/h3';

import { resolvePublicOrigin } from '../../../app/api/utils/auth/publicOrigin';

// GET /.well-known/web-identity — FedCM identity-provider discovery. Browsers
// fetch this from the domain ROOT (never under /api), so it lives as its own
// nitro route beside the API catch-all. Points at this deployment's FedCM
// config manifest, derived from the browser-facing origin (x-forwarded aware).
export default defineHandler((event) => {
	const origin = resolvePublicOrigin(event.req).origin;
	return { provider_urls: [`${origin}/api/v1/fedcm/config`] };
});
