import { JSON_BODY_WITHOUT_APPLICATION_LIMIT, json, readJsonBody } from '~/api/http';

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

  const body = await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT);
  const result = await createAlgorithm(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, algorithm: result.algorithm });
};
