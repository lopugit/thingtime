import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { recordPostViews } from '~/api/utils/things/views';
import { friendIdsOf } from '~/api/utils/users/social';

// POST /api/v1/things/views — { events: [{ id, dwellMs?, ratio?, pos? }] } —
// record post view/impression telemetry (batched by the client, beacon-safe).
// Works logged out: anonymous viewers dedup on a salted hash of ip+UA. The
// server treats every field as hostile — see views.ts for the anti-bot /
// anti-manipulation layers (dedup by viewer identity, self-view drop, dwell
// clamps, visibility checks, rate limit).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'things.views', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    // view telemetry is fire-and-forget on the client — 429 with no drama
    return json({ ok: false, error: 'Too many view reports' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  const viewer = user ? { id: user.id, username: user.username } : null;
  // friends-only posts count views from actual friends
  const friendIds = user ? await friendIdsOf(user.id) : undefined;
  const result = await recordPostViews(request, viewer, body?.events, friendIds);
  return json({ ok: true, counted: result.counted });
};
