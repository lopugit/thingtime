import { json } from '~/api/http';
import { readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { updateThing, viewerOf } from '~/api/utils/things/things';

// POST /api/v1/things/update — { id, crystal?, extended?, visibility?, tags? }
// — update your own thing. Crystal patches merge over the existing crystal and
// are re-validated against the thing's schemas; extended replaces as a whole
// value (null clears it), so the cap matches the generic /things route.
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.update');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body: any = await readJsonBody(request, 768 * 1024);
  const result = await updateThing(viewerOf(user, auth.actor.pat), body?.id, {
    crystal: body?.crystal,
    extended: body?.extended,
    acl: body?.acl,
    visibility: body?.visibility,
    tags: body?.tags,
    tokenAcl: body?.tokenAcl
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, thing: result.thing, post: result.post });
};
