import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { toggleChatReaction } from '~/api/utils/messenger/messenger';

// POST /api/v1/chats/react — { messageId, emoji } — toggle a reaction on a
// chat message. `emoji` is a unicode token (post rules) OR a custom token
// `custom:<emoji id>` referencing an uploaded emoji from this chat's
// community or your personal set. Members only; same storage and dedup index
// as post reactions.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.react', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re reacting too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await toggleChatReaction(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
