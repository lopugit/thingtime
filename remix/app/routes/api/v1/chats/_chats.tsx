import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { createChat, listChats } from '~/api/utils/messenger/messenger';

// GET /api/v1/chats — every conversation the caller is in (channels, groups,
// DMs) with unread counts, newest-message previews and membership, plus the
// pending message-request count — the one call both messenger modes and the
// notification poller build from.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const result = await listChats(user.id);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/chats — create a channel ({ chatType:'channel', communityId,
// name }), group ({ chatType:'group', memberIds }) or DM ({ chatType:'dm',
// memberIds:[otherUserId] }). DMs dedupe per pair and may land as a message
// request on the other side (follower/unknown classification).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 64 * 1024);
  const result = await createChat(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
