import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listGrants } from '~/api/utils/apps/grants';

// GET /api/v1/oauth/grants — the apps connected to YOUR account via "Login
// with Thingtime": app name, scopes you granted, session count, expiry.
// Session auth (your own account — app tokens are rejected).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  return json({ ok: true, grants: await listGrants(user.id) });
};
