import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { userAppLens } from '~/api/utils/apps/browse';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listThings, viewerOf } from '~/api/utils/things/things';

const csv = (value: string | null): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

// GET /api/v1/apps/data/shared?appId=&thingtime=&cursor=&limit= — the app's
// view, for its user: a synthetic namespace lens built from the caller's OWN
// live grant, run through the SAME read path app tokens use — everything the
// third-party app would show them (their entries + the app-audience slice
// their grant covers), and never a byte more. 403 with a plain explanation
// when there's no live grant (the data itself stays browsable via
// /api/v1/things?appId= — ownership never expires).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const limit = await enforceRateLimit(request, 'oauth.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Reading too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const params = new URL(request.url).searchParams;
  const appId = (params.get('appId') || '').trim();
  if (!appId) return json({ ok: false, error: 'appId is required' }, { status: 400 });

  const lens = await userAppLens(appId, user);
  if (lens.ok === false) {
    return json({ ok: false, error: lens.error, sharedRead: false }, { status: lens.status });
  }

  const result = await listThings(
    viewerOf(user),
    {
      thingtime: csv(params.get('thingtime')),
      targetId: (params.get('target') || '').trim() || null,
      cursor: params.get('cursor'),
      limit: Number(params.get('limit')) || undefined
    },
    lens.scope
  );
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({
    ok: true,
    things: result.things,
    nextCursor: result.nextCursor,
    sharedRead: lens.sharedRead,
    scopes: lens.scope.scopes
  });
};
