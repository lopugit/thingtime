import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateYoutubeChannels } from '~/api/utils/connections/connections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/connections/youtube/channels — manage the caller's virtual
// YouTube subscription list: { add: <channel ref | search text> } and/or
// { remove: <channelId> }. The first add auto-creates the connection.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  // `add` accepts free search text, so this resolves through the YouTube Data
  // API on the shared deployment quota — same bound as the search route, and
  // enforced before the body is read
  const limit = await enforceRateLimit(request, 'connections.provider', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Updating channels very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 16 * 1024);
  const result = await updateYoutubeChannels(user, { add: body?.add, remove: body?.remove });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, connection: result.connection, channels: result.channels });
};
