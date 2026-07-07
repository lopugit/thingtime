import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createPost } from '~/api/utils/things/things';

// Posts are small JSON payloads (text + image URLs + listing fields).
const MAX_BODY_BYTES = 256 * 1024;

// POST /api/v1/things — { type, text?, images?, listing?, visibility?, tags? }
// — create a feed post as the current user.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Post payload too large' }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await createPost(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, post: result.post });
};
