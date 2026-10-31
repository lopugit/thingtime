import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { prepareAttachmentCascadeForThing } from '~/api/utils/attachments/attachments';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { deletePost, viewerOf } from '~/api/utils/things/things';

// POST /api/v1/things/delete — { id } — delete one of the caller's own posts.
// App tokens delete only inside their namespace (the stamp rides the delete
// filter itself), and freed bytes refund the storage ledger.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const actor = await resolveActor(request, { thingsScope: 'things.delete' });
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

  const body = await readJsonBodyWithCors(request, 64 * 1024, cors);
  const attachmentHooks =
    actor.kind !== 'app' && user.accountKind === 'user'
      ? { beforeCascade: prepareAttachmentCascadeForThing, expectedUpdatedAt: body.expectedUpdatedAt }
      : { expectedUpdatedAt: body.expectedUpdatedAt };
  const result = await deletePost(viewerOf(user, actorPat(actor)), body.id, app, attachmentHooks);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true }, { headers: cors });
};
