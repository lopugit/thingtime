import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { beginOAuth, requestOrigin } from '~/api/utils/connections/oauth';

// POST /api/v1/connections/oauth/begin — start an SSO account link:
// { provider } → { authorizeUrl }. The client sends the browser there; the
// provider's own sign-in page returns to /api/v1/connections/oauth/callback.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = await readJsonBody(request, 4 * 1024);
  const result = await beginOAuth(user, { provider: body?.provider }, requestOrigin(request));
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, provider: result.provider, authorizeUrl: result.authorizeUrl });
};
