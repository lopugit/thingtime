import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { updateThing, viewerOf } from '~/api/utils/things/things';

// POST /api/v1/things/update — { id, crystal?, extended?, visibility?, tags? }
// — update your own thing. Crystal patches merge over the existing crystal and
// are re-validated against the thing's schemas; extended replaces as a whole
// value (null clears it), so the cap matches the generic /things route.
// App tokens update only inside their namespace: acl-clamped, byte-delta
// charged, per-(user, app) rate limited.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const actor = await resolveActor(request, { thingsScope: 'things.update' });
  if (actor instanceof Response) return actor;
  if (actor.kind === 'anonymous') {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const user = actorUser(actor)!;
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

  if (actor.kind === 'app') {
    const limit = await enforceRateLimit(request, 'appData.write', actor.rateIdentity);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json(
        { ok: false, error: 'Writing too fast — take a breather 🌸' },
        { ...init, headers: { ...init.headers, ...cors } }
      );
    }
  }

  const body: any = await readJsonBodyWithCors(request, 768 * 1024, cors);
  const result = await updateThing(
    viewerOf(user, actorPat(actor)),
    body?.id,
    {
      crystal: body?.crystal,
      extended: body?.extended,
      acl: body?.acl,
      visibility: body?.visibility,
      tags: body?.tags,
      tokenAcl: body?.tokenAcl,
      // folderId only when present — undefined means "leave it filed where it is"
      ...(body && typeof body === 'object' && 'folderId' in body ? { folderId: body.folderId } : {})
    },
    {
      replaceCrystal: body?.replaceCrystal === true,
      expectedUpdatedAt: body?.expectedUpdatedAt
    },
    app
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, thing: result.thing, post: result.post }, { headers: cors });
};
