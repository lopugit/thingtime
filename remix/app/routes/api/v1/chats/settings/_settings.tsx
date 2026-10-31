import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getUserReadReceiptsEnabled, setUserReadReceiptsEnabled } from '~/api/utils/auth/users';

// GET /api/v1/chats/settings — the caller's messenger settings (currently the
// read-receipts privacy flag; default on).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return json({ ok: true, readReceipts: await getUserReadReceiptsEnabled(user.id) });
};

// POST /api/v1/chats/settings — { readReceipts: boolean }. Parity rule:
// turning receipts off stops sharing yours AND stops showing you everyone
// else's. Unread counts are unaffected either way.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  if (typeof body.readReceipts !== 'boolean') {
    return json({ ok: false, error: 'Pass readReceipts: true | false' }, { status: 400 });
  }
  await setUserReadReceiptsEnabled(user.id, body.readReceipts);
  return json({ ok: true, readReceipts: body.readReceipts });
};
