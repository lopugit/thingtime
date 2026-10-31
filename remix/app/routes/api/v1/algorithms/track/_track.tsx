import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { trackEngagement } from '~/api/utils/algorithms/algorithms';

const MAX_BODY_BYTES = 128 * 1024;

// POST /api/v1/algorithms/track — { algorithmId?, events } — feed a batch of
// doomscroll engagement events into the given (or active) algorithm.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Payload too large' }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await trackEngagement(user.id, user.activeFeedAlgorithmId, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  // eventCount: authoritative post-flush total, for growth-stage crossings
  return json({ ok: true, trained: result.trained, applied: result.applied, eventCount: result.eventCount });
};
