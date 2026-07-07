import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { sharePost } from '~/api/utils/things/things';

// POST /api/v1/things/share — { id, text?, visibility? } — repost a public
// post (or one of your own) as a new share post.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await sharePost(user.id, body.id, { text: body.text, visibility: body.visibility });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, post: result.post });
};
