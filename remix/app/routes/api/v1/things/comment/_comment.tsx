import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { addComment, viewerOf } from '~/api/utils/things/things';

// POST /api/v1/things/comment — { id, text } for a simple text comment, or
// { id, type, text?, images?, listing?, thing?, tags? } for a rich comment (a
// full ["post","comment"] thing — comments share the post schema, so the post
// crystal rules apply and the response comment carries the post vocabulary).
// Rate-limited per user (admin-configurable, see the admin panel).
// App tokens comment only on things inside their namespace; the comment is
// stamped + budgeted and the returned count is namespace-fenced.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const actor = await resolveActor(request, { thingsScope: 'things.comment' });
  if (actor instanceof Response) return actor;
  if (actor.kind === 'anonymous') {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const user = actorUser(actor)!;
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

  const limit = await enforceRateLimit(
    request,
    'things.comment',
    actor.kind === 'app' ? actor.rateIdentity : `user:${user.id}`
  );
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'You’re commenting too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  // same ceiling as post creation — rich comments carry image URL lists
  const body = await readJsonBodyWithCors(request, 256 * 1024, cors);
  const { id, ...rest } = body || {};
  const result = await addComment(viewerOf(user, actorPat(actor)), id, rest, app);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, comment: result.comment, commentCount: result.commentCount }, { headers: cors });
};
