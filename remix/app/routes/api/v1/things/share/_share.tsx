import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { sharePost, viewerOf } from '~/api/utils/things/things';

// POST /api/v1/things/share — { id, text?, tags?, visibility? } — repost a
// public post (or one of your own) as a new share post. tags carry the quote
// caption's harvested inline #hashtags; they merge with the original's tags.
export const action = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.share');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // A share mints a new post thing, so it's throttled on the same write
  // ceiling as creating one through the generic /things route (service
  // accounts get the higher bulk ceiling); otherwise this route is an
  // unbounded post-creation bypass.
  const limit = await enforceRateLimit(
    request,
    user.accountKind === 'service' ? 'things.write.service' : 'things.write',
    `user:${user.id}`
  );
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re sharing too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await sharePost(viewerOf(user, auth.actor.pat), body.id, {
    text: body.text,
    tags: body.tags,
    acl: body.acl,
    visibility: body.visibility
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, post: result.post });
};
