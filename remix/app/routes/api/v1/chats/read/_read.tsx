import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { markChatRead } from '~/api/utils/messenger/messenger';

// POST /api/v1/chats/read — { chatId, messageId } — advance the caller's read
// receipt to that message. Forward-only (reading an old message never rewinds
// it); drives unread counts and the seen-by row other members see, subject to
// the read-receipts privacy setting.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Reading fast today 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await markChatRead(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
