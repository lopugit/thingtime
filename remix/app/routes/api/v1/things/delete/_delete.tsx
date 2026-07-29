import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { deletePost } from '~/api/utils/things/things';

// POST /api/v1/things/delete — { id } — delete one of the caller's own posts.
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.delete');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await deletePost({ id: user.id, username: user.username }, body.id);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
