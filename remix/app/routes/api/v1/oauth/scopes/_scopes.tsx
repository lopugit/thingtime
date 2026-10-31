import { json } from '~/api/http';

import { appCorsHeaders } from '~/api/utils/apps/cors';
import { APP_SCOPE_CATALOG, DEFAULT_APP_SCOPES } from '~/api/utils/apps/scopes';

// GET /api/v1/oauth/scopes — the public permission-scope catalog: every path
// a platform can request (and a user can volunteer) with its consent-screen
// wording. Anonymous — it's documentation data; the authorize popup also uses
// it to render the "share more" section and sandbox mode. CORS-open so
// embedding platforms can feature-detect scopes before opening the popup
// (requesting a scope this deployment doesn't know is a hard 400 there).
export const loader = async ({ request }: { request: Request }) => {
  return json(
    { ok: true, scopes: APP_SCOPE_CATALOG, defaults: DEFAULT_APP_SCOPES },
    { headers: appCorsHeaders(request.headers.get('Origin')) }
  );
};
