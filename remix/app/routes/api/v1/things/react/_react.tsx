import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { safeErrorText } from '~/api/utils/errors/safeError';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import { toggleReaction, viewerOf, withLinkKeys } from '~/api/utils/things/things';

// POST /api/v1/things/react — { id, emoji } — toggle the caller's reaction on a
// post. `emoji` may be any single emoji or a multi-emoji group (one token);
// clicking a token you already have removes it, a new one is added (you can
// hold several at once). Adding a token also records it in your recents.
// Rate-limited per user (admin-configurable, see the admin panel).
// App tokens react only to things inside their namespace; counts come back
// namespace-fenced and the personal emoji recents are never touched.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const actor = await resolveActor(request, { thingsScope: 'things.react' });
  if (actor instanceof Response) return actor;
  if (actor.kind === 'anonymous') {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const user = actorUser(actor)!;
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

  const limit = await enforceRateLimit(
    request,
    'things.react',
    actor.kind === 'app' ? actor.rateIdentity : `user:${user.id}`
  );
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'You’re reacting too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const body = await readJsonBodyWithCors(request, 64 * 1024, cors);
  let result: Awaited<ReturnType<typeof toggleReaction>>;
  try {
    result = await toggleReaction(
      withLinkKeys(viewerOf(user, actorPat(actor)), [typeof body?.key === 'string' ? body.key : '']),
      body.id,
      body.emoji ?? null,
      app
    );
  } catch (error) {
    if (error instanceof StorageMutationError) {
      return json({ ok: false, error: error.message, outcome: 'rejected' }, { status: error.status, headers: cors });
    }
    const detail = safeErrorText(error, 'things react', 'Unexpected reaction error');
    return json(
      { ok: false, error: `Thingtime could not finish that reaction: ${detail}.`, outcome: 'unknown' },
      { status: 500, headers: cors }
    );
  }

  if (result.ok === false) {
    return json({ ok: false, error: result.error, outcome: 'rejected' }, { status: result.status, headers: cors });
  }
  return json(
    {
      ok: true,
      reactionCounts: result.reactionCounts,
      viewerReactions: result.viewerReactions,
      recentReactions: result.recentReactions
    },
    { headers: cors }
  );
};
