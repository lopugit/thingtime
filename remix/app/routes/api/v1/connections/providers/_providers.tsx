import { json } from '~/api/http';

import { listProviders } from '~/api/utils/connections/connections';

// GET /api/v1/connections/providers — the third-party provider catalog:
// connect fields, auth mode, and whether each is configured on this
// deployment. Public read (the catalog holds no user data).
export const loader = async () => {
  return json({ ok: true, providers: listProviders() });
};
