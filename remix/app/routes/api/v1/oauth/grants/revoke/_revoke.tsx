import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { revokeGrant } from '~/api/utils/apps/grants';

// POST /api/v1/oauth/grants/revoke — { clientId } — disconnect an app from
// YOUR account: revokes every live app session you hold for it, so its tokens
// stop working immediately. Session auth; only narrows access, so unlimited.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 4 * 1024);
  const result = await revokeGrant(user.id, body?.clientId);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, revoked: result.revoked });
};
