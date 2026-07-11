import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { addComment } from '~/api/utils/things/things';

// POST /api/v1/things/comment — { id, text } — comment on a visible post.
// Rate-limited per user (admin-configurable, see the admin panel).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.comment', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re commenting too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await addComment({ id: user.id, username: user.username }, body.id, body.text);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, comment: result.comment, commentCount: result.commentCount });
};
