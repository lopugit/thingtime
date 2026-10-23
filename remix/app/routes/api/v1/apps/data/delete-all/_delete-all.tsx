import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteAllAppData } from '~/api/utils/apps/browse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/apps/data/delete-all — { appId } — delete EVERYTHING one app
// stored for the signed-in user (their namespace docs + cascading children),
// refund the ledgers, zero their budget. The user owns every namespace doc,
// so this needs no live grant — it works on orphaned data too.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const limit = await enforceRateLimit(request, 'things.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re doing that too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 16 * 1024);
  const result = await deleteAllAppData(user.id, body?.appId);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, deleted: result.deleted });
};
