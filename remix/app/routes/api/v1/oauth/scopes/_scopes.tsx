import { json } from '~/api/http';

import { APP_SCOPE_CATALOG, DEFAULT_APP_SCOPES } from '~/api/utils/apps/scopes';

// GET /api/v1/oauth/scopes — the public permission-scope catalog: every path
// a platform can request (and a user can volunteer) with its consent-screen
// wording. Anonymous — it's documentation data; the authorize popup also uses
// it to render the "share more" section and sandbox mode.
export const loader = async () => {
  return json({ ok: true, scopes: APP_SCOPE_CATALOG, defaults: DEFAULT_APP_SCOPES });
};
