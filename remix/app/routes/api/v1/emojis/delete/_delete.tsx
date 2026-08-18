import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { deleteEmoji } from '~/api/utils/messenger/emojis';

// POST /api/v1/emojis/delete — { id } — retire a custom emoji (uploader or a
// community admin). Existing reactions keep their chips and render a
// placeholder once the id stops resolving.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'emojis.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'The emoji forge needs a moment 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await deleteEmoji(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
