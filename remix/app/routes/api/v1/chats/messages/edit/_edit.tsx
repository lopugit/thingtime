import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { editMessage } from '~/api/utils/messenger/messenger';

// POST /api/v1/chats/messages/edit — { id, text }. Author only; the message
// gets an editedAt stamp the UI shows as "(edited)".
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.message', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Easy there, speed-typer 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 64 * 1024);
  const result = await editMessage(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
