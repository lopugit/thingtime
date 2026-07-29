import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { addComment } from '~/api/utils/things/things';

// POST /api/v1/things/comment — { id, text } for a simple text comment, or
// { id, type, text?, images?, listing?, thing?, tags? } for a rich comment (a
// full ["post","comment"] thing — comments share the post schema, so the post
// crystal rules apply and the response comment carries the post vocabulary).
// Rate-limited per user (admin-configurable, see the admin panel).
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.comment');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.comment', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re commenting too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  // same ceiling as post creation — rich comments carry image URL lists
  const body = await readJsonBody(request, 256 * 1024);
  const { id, ...rest } = body || {};
  const result = await addComment({ id: user.id, username: user.username }, id, rest);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, comment: result.comment, commentCount: result.commentCount });
};
