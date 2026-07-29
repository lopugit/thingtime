import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { toggleReaction, viewerOf } from '~/api/utils/things/things';

// POST /api/v1/things/react — { id, emoji } — toggle the caller's reaction on a
// post. `emoji` may be any single emoji or a multi-emoji group (one token);
// clicking a token you already have removes it, a new one is added (you can
// hold several at once). Adding a token also records it in your recents.
// Rate-limited per user (admin-configurable, see the admin panel).
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.react');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.react', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re reacting too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await toggleReaction(viewerOf(user, auth.actor.pat), body.id, body.emoji ?? null);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({
    ok: true,
    reactionCounts: result.reactionCounts,
    viewerReactions: result.viewerReactions,
    recentReactions: result.recentReactions
  });
};
