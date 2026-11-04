import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { manageChatMembers } from '~/api/utils/messenger/messenger';

// POST /api/v1/chats/members — one membership verb per call, always with
// { chatId }: { join: true } (public channels), { add: [userIds] },
// { remove: userId } (admins), { role: { userId, role } } (admins),
// { nickname: { userId?, nickname } } (any member, Messenger style),
// { mute: boolean } (your own notifications). Returns the fresh member list.
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
  const result = await manageChatMembers(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
