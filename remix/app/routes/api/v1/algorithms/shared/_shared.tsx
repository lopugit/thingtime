import { json } from '~/api/http';

import { getSharedAlgorithmPreview } from '~/api/utils/algorithms/algorithms';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/algorithms/shared?id=<shareId> — the "try my feed brain 🧠"
// share-link preview (claude-todo/10). Public and anonymous, but it only
// resolves algorithms whose owner explicitly flipped shared:true, and it never
// returns weights or interests — just identity + training size, enough for
// the branch prompt. Unknown, unshared, and private ids all 404 identically.
//
// Anonymous and unauthenticated with two DB reads per call (the algorithm
// lookup plus an owner-username resolve), so it carries the same per-IP budget
// the other public reads do — identity `null` makes the limiter key off the
// hashed request IP.
export const loader = async ({ request }: { request: Request }) => {
  const limit = await enforceRateLimit(request, 'algorithms.shared', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many share-link lookups — please wait a moment 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const id = new URL(request.url).searchParams.get('id') || '';
  const preview = await getSharedAlgorithmPreview(id);
  if (!preview) {
    return json({ ok: false, error: 'Algorithm not found' }, { status: 404 });
  }
  return json({ ok: true, algorithm: preview });
};
