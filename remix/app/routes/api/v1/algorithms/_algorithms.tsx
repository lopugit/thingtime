import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createAlgorithm, listAlgorithmsForUser } from '~/api/utils/algorithms/algorithms';

// GET /api/v1/algorithms — list the current user's feed algorithms + which is active.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const algorithms = await listAlgorithmsForUser(user.id);
  return json({ ok: true, algorithms, activeAlgorithmId: user.activeFeedAlgorithmId });
};

// Event batches are small; weights maps stay bounded server-side.
const MAX_BODY_BYTES = 128 * 1024;

// POST /api/v1/algorithms — { name, emoji?, branchFrom?, events? } — create an
// algorithm, optionally branching an existing one and/or seed-training it from
// a doomscroll session's events. branchFrom resolves the caller's OWN algorithms
// first and then falls back to any algorithm its owner explicitly shared, so it
// accepts a share-link id the caller does not own; 404 means "neither owned nor
// shared". The copy is always private and starts unshared.
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
  const result = await createAlgorithm(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, algorithm: result.algorithm });
};
