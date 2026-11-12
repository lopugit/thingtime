import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateAlgorithm } from '~/api/utils/algorithms/algorithms';

// POST /api/v1/algorithms/update — { id, name?, emoji?, shared? } — rename/restyle
// an algorithm, or flip its "try my feed brain" branch invitation. `shared` is a
// STRICT boolean (a truthy string 400s rather than silently publishing a link) and
// never touches the acl: the doc stays private either way. Turning it off revokes
// both the /api/v1/algorithms/shared preview and share-link branching immediately.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await updateAlgorithm(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, algorithm: result.algorithm });
};
