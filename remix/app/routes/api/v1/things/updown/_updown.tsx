import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { viewerOf } from '~/api/utils/things/things';
import { castUpdown } from '~/api/utils/things/updown';

// POST /api/v1/things/updown — { id, direction: 'up' | 'down' | null } — the
// caller's up/down vote on a visible post or comment. A SEPARATE focused
// reaction kind beside the emoji reactions: exactly one of up/down per user
// per target; the same direction again clears it, the other direction flips
// it, null clears. Votes are relational child things (thingtime ['updown'],
// acl ['tt:inherit']) minted only here. Rate-limited per user
// (admin-configurable).
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.updown');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.updown', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re voting very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 16 * 1024);
  const result = await castUpdown(viewerOf(user, auth.actor.pat), body?.id, body?.direction);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, votes: result.votes, direction: result.direction });
};
