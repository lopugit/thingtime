import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { json } from '~/api/http';

import { listProviders } from '~/api/utils/connections/connections';

// GET /api/v1/connections/providers — the third-party provider catalog:
// connect fields, auth mode, and whether each is configured on this
// deployment. Public read (the catalog holds no user data).
export const loader = async ({ request }: { request: Request }) => {
  return json({ ok: true, providers: await listProviders(resolvePublicOrigin(request).origin) });
};
