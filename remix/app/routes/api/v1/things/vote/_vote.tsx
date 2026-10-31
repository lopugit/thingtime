import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { viewerOf } from '~/api/utils/things/things';
import { voteOnThing } from '~/api/utils/things/vote';

// POST /api/v1/things/vote — { id, optionIndex } — cast the caller's vote on a
// visible poll thing. One vote per (user, poll): a different option moves the
// vote, the same option again removes it (toggle off, matching reactions).
// Votes are relational child things (thingtime ['vote'], acl ['tt:inherit'])
// minted only here. Rate-limited per user (admin-configurable).
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.vote');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.vote', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re voting very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await voteOnThing(viewerOf(user, auth.actor.pat), body?.id, body?.optionIndex);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, pollVotes: result.pollVotes });
};
