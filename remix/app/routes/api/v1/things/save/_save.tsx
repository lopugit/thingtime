import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { toggleSave, viewerOf, withLinkKeys } from '~/api/utils/things/things';

// POST /api/v1/things/save — { id } — toggle the caller's private library save
// of a thing ("add to my library"). Saves are relational child things
// (thingtime ['save'], acl ['tt:user']) so a library is personal by
// construction. Rate-limited per user (admin-configurable).
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.save');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'things.save', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re saving very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await toggleSave(
    withLinkKeys(viewerOf(user, auth.actor.pat), [typeof body?.key === 'string' ? body.key : '']),
    body?.id
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, saved: result.saved });
};
