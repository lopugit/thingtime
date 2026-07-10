import { json } from '~/api/http';
import { readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateThing } from '~/api/utils/things/things';

// POST /api/v1/things/update — { id, crystal?, visibility?, tags? } — update
// your own thing. Crystal patches merge over the existing crystal and are
// re-validated against the thing's schemas.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body: any = await readJsonBody(request, 256 * 1024);
  const result = await updateThing({ id: user.id, username: user.username }, body?.id, {
    crystal: body?.crystal,
    acl: body?.acl,
    visibility: body?.visibility,
    tags: body?.tags
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, thing: result.thing, post: result.post });
};
