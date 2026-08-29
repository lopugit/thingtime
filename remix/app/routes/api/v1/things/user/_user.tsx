import { json } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { listUserPosts, viewerOf } from '~/api/utils/things/things';

// GET /api/v1/things/user?username=&cursor=&limit= — a user's posts, filtered
// to what the viewer may see (owners see all their circles, others see public).
export const loader = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.read');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  const params = new URL(request.url).searchParams;

  // pat context rides along so a visibility-restricted token's audience fence
  // applies to profile listings too
  const result = await listUserPosts(
    viewerOf(user, auth.actor.pat),
    params.get('username') || '',
    params.get('cursor'),
    Number(params.get('limit')) || undefined
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, posts: result.posts, nextCursor: result.nextCursor, postCount: result.postCount });
};
