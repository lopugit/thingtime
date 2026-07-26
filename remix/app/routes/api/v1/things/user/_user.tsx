import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listUserPosts } from '~/api/utils/things/things';

// GET /api/v1/things/user?username=&cursor=&limit= — a user's posts, filtered
// to what the viewer may see (owners see all their circles, others see public).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;

  const result = await listUserPosts(
    user ? { id: user.id, username: user.username } : null,
    params.get('username') || '',
    params.get('cursor'),
    Number(params.get('limit')) || undefined
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, posts: result.posts, nextCursor: result.nextCursor, postCount: result.postCount });
};
