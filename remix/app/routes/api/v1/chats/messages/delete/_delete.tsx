import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { deleteMessage } from '~/api/utils/messenger/messenger';

// POST /api/v1/chats/messages/delete — { id }. Author or a chat admin. Soft
// delete: the row stays as a "message deleted" placeholder so threads keep
// their shape; its reactions are removed.
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
  const result = await deleteMessage(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
